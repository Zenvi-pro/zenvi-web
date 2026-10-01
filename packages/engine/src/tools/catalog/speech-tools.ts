/**
 * Speech tools: get_transcript_tool, transcribe_media_tool,
 * remove_words_tool, remove_silence_tool, export_captions_tool,
 * detect_beats_tool, diarize_media_tool, search_media_local_tool
 * (add_captions_tool lives in titles.ts).
 *
 * Ports of zenvi-core (ref b63c39be7) src/classes/agent_tools/transcript.py
 * and speech_extra.py. The desktop runs on-device ASR, VAD, beat tracking,
 * diarization and a visual index. On the web surfaces:
 *
 * - transcripts come from the indexed `ai_metadata.transcript_cues`
 *   (phrase-level, from Zenvi indexing); word timings inside a phrase are
 *   estimated by character length and labelled as such;
 * - remove_silence_tool runs the desktop's energy VAD on the RMS envelope the
 *   host measures (`AudioHost.analyzeAudio`);
 * - word cuts, transcription, beats, diarization and local visual search need
 *   on-device models and are refused as not available.
 */

import type { Transaction } from "../../history/document.js";
import type { Clip, Project, ProjectFile } from "../../model/types.js";
import { duplicateClip, moveClip, trimClip } from "../../ops/clips.js";
import { fileIsAnalyzed, getEffectiveAiMetadata } from "../ai-metadata.js";
import { contractTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { projectFps, snap, toFrame, toSeconds, type Fps } from "../frame-time.js";
import { pyFixed } from "../pyfmt.js";
import { applied, failed, refused, unchanged } from "../receipt.js";
import {
  compactFragmentsAfterRemove,
  cuesToSrt,
  cuesToVtt,
  energyVadWindows,
  phraseWords,
  silenceRangesFromSpeech,
  wordsToScript,
  type Fragment,
  type Range,
  type TimedWord,
} from "../speech.js";
import { layerNumberToDisplayIndex } from "../tracks.js";
import { fileById, record, text } from "./common.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SOURCE = "index_cues";
const ESTIMATED_WARNING =
  "Word timings are estimated from indexed transcript phrases: this Zenvi surface has no on-device speech recognition.";

// ---------------------------------------------------------------------------
// Words from indexed cues
// ---------------------------------------------------------------------------

interface SourceWord {
  text: string;
  startSec: number;
  endSec: number;
}

/** Split each transcript cue into words, sharing its time by character count. */
export function wordsFromCues(cues: readonly unknown[]): SourceWord[] {
  const rows = cues
    .filter(isRecord)
    .map((c) => ({
      text: String(c.text ?? "").trim(),
      start: Number("source_start" in c ? c.source_start : c.start),
      end: Number("source_end" in c ? c.source_end : c.end),
    }))
    .filter((c) => c.text && Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
    .sort((a, b) => a.start - b.start);
  const out: SourceWord[] = [];
  for (const cue of rows) {
    const tokens = cue.text.split(/\s+/).filter(Boolean);
    const weights = tokens.map((t) => Array.from(t).length + 1);
    const total = weights.reduce((a, b) => a + b, 0);
    let t = cue.start;
    tokens.forEach((token, i) => {
      const dur = ((cue.end - cue.start) * weights[i]!) / total;
      out.push({ text: token, startSec: t, endSec: i === tokens.length - 1 ? cue.end : t + dur });
      t += dur;
    });
  }
  return out;
}

/** Words overlapping a clip's source window, in project frames (map_timeline.words_for_clip). */
function wordsForClip(words: readonly SourceWord[], clip: Clip, fps: Fps): TimedWord[] {
  const position = Number(clip.position) || 0;
  const start = Number(clip.start) || 0;
  const end = Number(clip.end) || start;
  const out: TimedWord[] = [];
  let index = 0;
  for (const w of words) {
    if (w.endSec <= start || w.startSec >= end) continue;
    const s = Math.max(start, w.startSec);
    const e = Math.min(end, w.endSec);
    if (e <= s) continue;
    const startFrame = toFrame(position + (s - start), fps);
    let endFrame = toFrame(position + (e - start), fps);
    if (endFrame <= startFrame) endFrame = startFrame + 1;
    out.push({
      index,
      text: w.text,
      startFrame,
      endFrame,
      startSec: s,
      endSec: e,
      timelineStartSec: toSeconds(startFrame, fps),
      timelineEndSec: toSeconds(endFrame, fps),
      clipId: String(clip.id),
      transcriptGeneration: 1,
    });
    index += 1;
  }
  return out;
}

/** A media-bin file's words at source time = timeline time (transcript.py _words_payload). */
function fileWords(words: readonly SourceWord[], fps: Fps): TimedWord[] {
  return words.map((w, index) => {
    const startFrame = toFrame(w.startSec, fps);
    let endFrame = toFrame(w.endSec, fps);
    if (endFrame <= startFrame) endFrame = startFrame + 1;
    return { index, text: w.text, startFrame, endFrame, startSec: w.startSec, endSec: w.endSec, transcriptGeneration: 1 };
  });
}

function cuesForClip(project: Project, clip: Clip): { cues: unknown[]; indexed: boolean } {
  const file = clip.file_id ? fileById(project, String(clip.file_id)) : undefined;
  const effective = getEffectiveAiMetadata(file, clip, { clipAiMetadata: (clip as { ai_metadata?: unknown }).ai_metadata });
  const parentAnalyzed = file ? fileIsAnalyzed(file) || (file.parent_file_id ? fileIsAnalyzed(fileById(project, String(file.parent_file_id))) : false) : false;
  return { cues: Array.isArray(effective.transcript_cues) ? effective.transcript_cues : [], indexed: Boolean(effective.analyzed) || parentAnalyzed };
}

function cuesForFile(file: ProjectFile): { cues: unknown[]; indexed: boolean } {
  const ai = record(file.ai_metadata);
  return { cues: Array.isArray(ai.transcript_cues) ? ai.transcript_cues : [], indexed: Boolean(ai.analyzed) };
}

// ---------------------------------------------------------------------------
// Receipt payloads (transcript.py)
// ---------------------------------------------------------------------------

function compactRows(words: readonly TimedWord[]): unknown[][] {
  return words.map((w) => [w.index, w.text, w.startFrame]);
}

function clipPayload(words: readonly TimedWord[], meta: Record<string, unknown>, includeWords: boolean, includeCompact: boolean): Record<string, unknown> {
  const row: Record<string, unknown> = { ...meta, wordCount: words.length, transcriptGeneration: 1 };
  if (includeCompact || includeWords) row.compactWords = compactRows(words);
  if (includeWords) row.words = words;
  return row;
}

function transcriptNotes(): string[] {
  return [
    "data.script is the full dialogue for the user. " +
      "data.clipIds are TIMELINE clip ids (not media-bin fileIds). " +
      "For cuts: call remove_words_tool ONCE next with data.clipIds[0] + matches " +
      '(e.g. ["FlowCut","flocut"]) — do NOT call get_transcript_tool again. ' +
      "Keep language=auto. Never pass fileId to remove_words_tool.",
  ];
}

function shortSummary(wordCount: number, clipIds: readonly string[], fileIds: readonly string[], suffix = ""): string {
  let idBit = "";
  let action = "Full dialogue in data.script.";
  if (clipIds.length > 0) {
    idBit = clipIds.length === 1 ? ` clipId=${clipIds[0]}` : ` clipIds=[${clipIds.map((c) => `'${c}'`).join(", ")}]`;
    action = "Full dialogue in data.script. For word cuts call remove_words_tool next with that clipId + matches=[...] — do not re-call get_transcript_tool.";
  } else if (fileIds.length > 0) {
    idBit = fileIds.length === 1 ? ` fileId=${fileIds[0]}` : ` fileIds=[${fileIds.map((f) => `'${f}'`).join(", ")}]`;
    action =
      "Full dialogue in data.script. This is a media-bin fileId, NOT a timeline clipId — place the file on the timeline " +
      "(or re-call get_transcript_tool with empty args once it is placed) before remove_words_tool.";
  }
  const base = `Transcribed ${wordCount} words (${SOURCE}).${idBit} ${action}`;
  return suffix ? `${base} ${suffix}`.trim() : base;
}

function dataPayload(script: string, wordCount: number, clipsOut: readonly Record<string, unknown>[]): Record<string, unknown> {
  const clipIds = clipsOut.filter((c) => c.clipId).map((c) => String(c.clipId));
  const fileIds = clipsOut.filter((c) => c.fileId && !c.clipId).map((c) => String(c.fileId));
  const nextAction = clipIds.length
    ? "remove_words_tool"
    : fileIds.length
      ? "place file on timeline then get_transcript_tool again — remove_words_tool needs data.clipIds (timeline), not fileId"
      : "pass clipId to remove_words_tool or place the clip first";
  return {
    nextAction,
    clipIds,
    fileIds,
    transcriptGeneration: 1,
    wordCount,
    transcriptionSource: SOURCE,
    wordTiming: "estimated",
    modelId: "",
    language: "",
    engine: SOURCE,
    clips: clipsOut,
    script,
  };
}

const NO_TRANSCRIPT =
  "on-device transcription runs only in Zenvi desktop, and these clips have no indexed transcript. " +
  "Index the media with Zenvi (its transcript cues are used here), or transcribe in Zenvi desktop.";

/**
 * get_transcript over indexed cues. Returns a receipt (for `tool`, so the
 * caption tools refuse in their own name); `words` feeds captions.
 */
export function transcriptFromCues(
  call: ToolCall,
  input: Record<string, unknown>,
  tool = "get_transcript_tool",
): { words: TimedWord[]; receipt: ReturnType<typeof applied> } {
  const project = call.doc.project;
  const fps = projectFps(project);
  let clipId = text(input.clipId) || text(input.timeline_clip_id);
  let fileId = text(input.fileId) || text(input.file_id);
  const detail = text(input.detail_level).toLowerCase();
  const includeWords = input.includeWords === true;
  const includeCompact = includeWords || ["full", "all", "verbose", "words", "compact"].includes(detail);
  const warnings = [ESTIMATED_WARNING];

  let targets: Clip[] = [];
  if (clipId) {
    const clip = (project.clips ?? []).find((c) => String(c.id) === clipId);
    if (clip) targets = [clip];
    else {
      const hits = (project.clips ?? []).filter((c) => String(c.file_id ?? "") === clipId || String(record(c.reader).id ?? "") === clipId);
      if (hits.length > 0) targets = hits;
      else if (fileById(project, clipId)) {
        fileId = clipId;
        clipId = "";
      } else return { words: [], receipt: refused(tool, `Error: Unknown clipId '${clipId}'.`) };
    }
  }
  if (fileId && targets.length === 0) {
    const file = fileById(project, fileId);
    if (!file) return { words: [], receipt: refused(tool, `Error: Unknown fileId '${fileId}'.`) };
    return { words: [], receipt: fileReceipt(tool, file, fps, includeWords, includeCompact, warnings) };
  }
  if (targets.length === 0 && !fileId && !clipId) {
    const trackIndex = input.trackIndex;
    for (const clip of project.clips ?? []) {
      if (trackIndex !== undefined && trackIndex !== null) {
        const display = layerNumberToDisplayIndex(Math.trunc(Number(clip.layer ?? -1)), project.layers);
        if (display !== Number(trackIndex)) continue;
      }
      targets.push(clip);
    }
    if (targets.length === 0 && (trackIndex === undefined || trackIndex === null)) {
      const usable = (project.files ?? []).filter((f) => !["image", "image/sequence", "font"].includes(String(f.media_type ?? "").toLowerCase()) && f.path);
      if (usable.length === 1) {
        const receipt = fileReceipt(tool, usable[0]!, fps, includeWords, includeCompact, [
          ...warnings,
          "Timeline had no clips — transcribed the single media-bin file. Place it on the timeline for clip-scoped word frames.",
        ], "(timeline was empty; transcribed the media-bin file.)");
        return { words: [], receipt };
      }
      if (usable.length > 1) {
        const ids = usable.slice(0, 8).map((f) => String(f.id)).join(", ");
        return { words: [], receipt: refused(tool, `Error: Timeline is empty and multiple media-bin files exist. Pass fileId for one of: ${ids}`) };
      }
    }
  }
  if (targets.length === 0) {
    return {
      words: [],
      receipt: refused(tool, "Error: No clips to transcribe. Pass clipId/timeline_clip_id, fileId/file_id, put a clip on the timeline, or import media first."),
    };
  }

  const clipsOut: Record<string, unknown>[] = [];
  const all: TimedWord[] = [];
  let anyIndexed = false;
  for (const clip of targets) {
    const { cues, indexed } = cuesForClip(project, clip);
    anyIndexed = anyIndexed || indexed;
    if (!indexed) {
      warnings.push(`clip ${String(clip.id)}: not indexed (no transcript cues)`);
      continue;
    }
    const mapped = wordsForClip(wordsFromCues(cues), clip, fps);
    all.push(...mapped);
    clipsOut.push(
      clipPayload(mapped, {
        clipId: String(clip.id),
        fileId: String(clip.file_id ?? ""),
        position: Number(clip.position) || 0,
        start: Number(clip.start) || 0,
        end: Number(clip.end) || 0,
      }, includeWords, includeCompact),
    );
  }
  if (!anyIndexed) return { words: [], receipt: unavailable(tool, NO_TRANSCRIPT) };
  const wordCount = all.length;
  const clipIds = clipsOut.map((c) => String(c.clipId));
  const summary = wordCount ? shortSummary(wordCount, clipIds, []) : "No spoken dialogue found.";
  return {
    words: all,
    receipt: applied(tool, summary, { warnings, notes: transcriptNotes(), data: dataPayload(wordsToScript(all), wordCount, clipsOut) }, 0),
  };
}

function fileReceipt(tool: string, file: ProjectFile, fps: Fps, includeWords: boolean, includeCompact: boolean, warnings: string[], suffix = "") {
  const { cues, indexed } = cuesForFile(file);
  if (!indexed) return unavailable(tool, NO_TRANSCRIPT);
  const words = fileWords(wordsFromCues(cues), fps);
  const clips = [clipPayload(words, { fileId: String(file.id) }, includeWords, includeCompact)];
  const summary = words.length ? shortSummary(words.length, [], [String(file.id)], suffix) : `No spoken dialogue found.${suffix ? ` ${suffix}` : ""}`;
  return applied(tool, summary, { warnings, notes: transcriptNotes(), data: dataPayload(wordsToScript(words), words.length, clips) }, 0);
}

// ---------------------------------------------------------------------------
// Fragment edits (transcript.py apply_compacted_fragments)
// ---------------------------------------------------------------------------

/** Rewrite a clip as packed fragments and close the gap on its track. Returns created ids and shift rows. */
export function applyCompactedFragments(
  tx: Transaction,
  clipId: string,
  fragments: readonly Fragment[],
  removed: number,
  fps: Fps,
): { createdIds: string[]; shifted: Record<string, unknown>[] } {
  const original = tx.project.clips.find((c) => c.id === clipId);
  if (!original) throw new Error(`Unknown clipId '${clipId}'`);
  const layer = original.layer;
  const originalEnd = original.position + Math.max(0, original.end - original.start);
  const [first, ...rest] = fragments;
  trimClip(tx, clipId, { start: first![1], end: first![2] });
  moveClip(tx, clipId, { position: first![0] });
  const createdIds: string[] = [];
  for (const [position, start, end] of rest) {
    const copy = duplicateClip(tx, clipId, { position });
    trimClip(tx, copy.id, { start, end });
    const current = tx.project.clips.find((c) => c.id === copy.id)!;
    if ("ai_metadata" in current) {
      const { ai_metadata: _dropped, ...withoutMetadata } = current;
      tx.replace(["clips", { id: copy.id }], withoutMetadata);
    }
    createdIds.push(copy.id);
  }
  const shifted: Record<string, unknown>[] = [];
  if (removed > 1e-9) {
    const gap = snap(removed, fps);
    for (const other of tx.project.clips.filter((c) => c.layer === layer)) {
      if (other.id === clipId || createdIds.includes(other.id)) continue;
      if (other.position + 1e-9 >= originalEnd) {
        moveClip(tx, other.id, { position: snap(other.position - gap, fps) });
        shifted.push({ clipId: other.id, deltaSec: -gap });
      }
    }
  }
  return { createdIds, shifted };
}

function mediaPath(project: Project, clip: Clip): string {
  const file = clip.file_id ? fileById(project, String(clip.file_id)) : undefined;
  return String(file?.path || record(clip.reader).path || "");
}

const DESKTOP_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

export const speechTools: CatalogTool[] = [
  contractTool("get_transcript_tool", {
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    run: (call, input) => transcriptFromCues(call, input as Record<string, unknown>).receipt,
  }),

  contractTool("transcribe_media_tool", {
    annotations: DESKTOP_ONLY,
    run: () =>
      unavailable(
        "transcribe_media_tool",
        "on-device transcription runs only in Zenvi desktop. Indexed transcripts are available through get_transcript_tool.",
      ),
  }),

  contractTool("remove_words_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: () =>
      unavailable(
        "remove_words_tool",
        "cutting words needs word-level timings from on-device speech recognition, which runs only in Zenvi desktop.",
      ),
  }),

  contractTool("remove_silence_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    requires: ["audio"],
    run: async (call, input) => {
      const tool = "remove_silence_tool";
      const clipId = text(input.clipId) || text(input.timeline_clip_id);
      if (!clipId) return refused(tool, "Error: clipId is required.");
      const project = call.doc.project;
      const clip = (project.clips ?? []).find((c) => String(c.id) === clipId);
      if (!clip) return refused(tool, `Error: Unknown clipId '${clipId}'.`);
      const path = mediaPath(project, clip);
      if (!path) return refused(tool, "Error: Clip has no readable media path.");
      const minPause = input.minPauseSec ?? 0.4;
      const pad = input.padSec ?? 0.08;
      const maxFrac = input.maxRemoveFraction ?? 0.85;
      const pos = Number(clip.position) || 0;
      const start = Number(clip.start) || 0;
      const end = Number(clip.end) || start;
      const duration = Math.max(0, end - start);
      if (duration <= 0) return unchanged(tool, "Clip has zero duration.");
      let speech: Range[];
      try {
        const envelope = await call.host.audio!.analyzeAudio(path, { signal: call.signal });
        speech = energyVadWindows(envelope, { minSpeechSec: 0.12, minSilenceSec: minPause });
      } catch (error) {
        return failed(tool, `Error: VAD failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      const clipped: Range[] = speech.map(([s, e]) => [Math.max(s, start), Math.min(e, end)] as Range).filter(([s, e]) => e > s);
      const gaps = silenceRangesFromSpeech(clipped, end, minPause, pad)
        .map(([a, b]) => [Math.max(start, a), Math.min(end, b)] as Range)
        .filter(([a, b]) => b > a);
      if (gaps.length === 0) return unchanged(tool, "No removable silence found.");
      const fps = projectFps(project);
      const { fragments, removed } = compactFragmentsAfterRemove(pos, start, end, gaps, fps);
      if (duration > 0 && removed / duration > maxFrac) {
        return refused(
          tool,
          `Error: Would remove ${pyFixed((removed / duration) * 100, 0)}% of the clip — refusing (raise maxRemoveFraction or lower minPauseSec).`,
          { data: { removedDurationSec: removed, clipDurationSec: duration } },
        );
      }
      if (removed <= 1e-9) return unchanged(tool, "No silence to remove after padding.");
      if (fragments.length === 0) return refused(tool, "Error: Silence removal would delete the entire clip.");
      const { createdIds, shifted } = call.commit((tx) => applyCompactedFragments(tx, clipId, fragments, removed, fps));
      return applied(tool, `Removed ${pyFixed(removed, 2)}s silence (${gaps.length} gap(s)).`, {
        shifted,
        data: {
          clipId,
          removedDurationSec: removed,
          gaps: gaps.map(([a, b]) => ({ startSec: a, endSec: b })),
          createdClipIds: createdIds,
          speechWindows: clipped.map(([a, b]) => ({ startSec: a, endSec: b })),
          vadSource: "energy",
        },
      });
    },
  }),

  contractTool("export_captions_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    requires: ["storage"],
    run: async (call, input) => {
      const tool = "export_captions_tool";
      const path = text(input.path);
      if (!path) return refused(tool, "Error: path is required.");
      const writeText = call.host.storage!.writeText;
      if (!writeText) return unavailable(tool, "this host cannot write files.");
      const transcript = transcriptFromCues(
        call,
        { clipId: input.clipId, timeline_clip_id: input.timeline_clip_id, trackIndex: input.trackIndex, includeWords: true },
        tool,
      );
      if (transcript.receipt.status === "error" || transcript.receipt.status === "refused") return transcript.receipt;
      const fps = projectFps(call.doc.project);
      const cues = phraseWords(transcript.words, fps);
      const format = (text(input.format) || "srt").toLowerCase();
      const body = format === "vtt" ? cuesToVtt(cues, fps) : cuesToSrt(cues, fps);
      let location: string;
      try {
        location = await writeText.call(call.host.storage, path, body, format === "vtt" ? "text/vtt" : "application/x-subrip");
      } catch (error) {
        return failed(tool, `Error: write failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return applied(tool, `Exported ${cues.length} cue(s) to ${location || path}.`, {
        warnings: [ESTIMATED_WARNING],
        data: { path: location || path, format, count: cues.length },
      }, 0);
    },
  }),

  contractTool("detect_beats_tool", {
    annotations: DESKTOP_ONLY,
    run: () => unavailable("detect_beats_tool", "beat detection runs on-device only in Zenvi desktop."),
  }),

  contractTool("diarize_media_tool", {
    annotations: DESKTOP_ONLY,
    run: () => unavailable("diarize_media_tool", "speaker diarization runs on-device only in Zenvi desktop."),
  }),

  contractTool("search_media_local_tool", {
    annotations: DESKTOP_ONLY,
    run: () =>
      unavailable(
        "search_media_local_tool",
        "the on-device visual index exists only in Zenvi desktop. Use search_clips_tool for the project's cloud index.",
      ),
  }),
];

