/**
 * Speech tools: get_transcript_tool, transcribe_media_tool,
 * remove_words_tool, remove_silence_tool, export_captions_tool,
 * detect_beats_tool, diarize_media_tool, search_media_local_tool
 * (add_captions_tool lives in captions.ts).
 *
 * Ports of zenvi-core develop src/classes/agent_tools/transcript.py and
 * speech_extra.py. The desktop runs on-device ASR, VAD, beat tracking,
 * diarization and a visual index. On the web surfaces:
 *
 * - words come from a transcription kept on the file, the media index's
 *   transcript cues, or a new transcription through the Zenvi backend
 *   (`AudioHost.transcribe`), in that order (../transcripts.ts); word timings
 *   estimated from index phrases are labelled as such;
 * - remove_words_tool cuts on real word timings only;
 * - with no target, the tools transcribe (and pay for) the talking footage,
 *   clips with a picture and sound, when the timeline has some; audio-only
 *   clips such as music beds use a transcript they already have, or are
 *   transcribed when named (`untargetedTranscription`);
 * - remove_silence_tool runs the desktop's energy VAD on the loudness
 *   envelope the host measures (`AudioHost.analyzeAudio`);
 * - detect_beats_tool tracks a tempo grid (`AudioHost.decodePcm`);
 * - diarization and local visual search need on-device models and are
 *   refused as not available.
 */

import type { Transaction } from "../../history/document.js";
import type { Clip, Project, ProjectFile } from "../../model/types.js";
import { duplicateClip, moveClip, trimClip } from "../../ops/clips.js";
import { beatsOfFile, canTrackBeats } from "../beats.js";
import { contractTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { projectFps, snap, toFrame, type Fps } from "../frame-time.js";
import { pyFixed } from "../pyfmt.js";
import { applied, failed, refused, unchanged, type ToolReceipt } from "../receipt.js";
import {
  FILLER_PRESETS,
  compactFragmentsAfterRemove,
  cuesToSrt,
  cuesToVtt,
  energyVadWindows,
  indicesForFillerPreset,
  indicesForMatches,
  isRetimed,
  phraseWords,
  rangesForWordIndices,
  silenceRangesFromSpeech,
  wordsToScript,
  type Fragment,
  type Range,
  type TimedWord,
} from "../speech.js";
import { layerNumberToDisplayIndex } from "../tracks.js";
import {
  INDEX_SOURCE,
  NO_AUDIO_MESSAGE,
  clipTarget,
  fileOfClip,
  fileTarget,
  isWordSource,
  mediaPathOf,
  untargetedTranscription,
  wordsFor,
  wordsForClip,
  wordsForFile,
  type WordRequest,
  type WordSource,
  type WordSourceFailure,
} from "../transcripts.js";
import { fileById, record, text } from "./common.js";

const ESTIMATED_WARNING =
  "Word timings are estimated from indexed transcript phrases (no speech recognition result for this media yet).";

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

function capitalized(message: string): string {
  return message ? message[0]!.toUpperCase() + message.slice(1) : message;
}

/** The receipt for a target whose words could not be had. */
function failureReceipt(tool: string, failure: WordSourceFailure): ToolReceipt {
  if (failure.kind === "no_audio") return unchanged(tool, NO_AUDIO_MESSAGE, { data: { reason: "no_audio" } });
  if (failure.kind === "unavailable") return unavailable(tool, `${failure.message}; the media has no indexed transcript either.`);
  return failed(tool, `Error: ${capitalized(failure.message.replace(/\.$/, ""))}.`);
}

// ---------------------------------------------------------------------------
// Receipt payloads (transcript.py)
// ---------------------------------------------------------------------------

function compactRows(words: readonly TimedWord[]): unknown[][] {
  return words.map((w) => [w.index, w.text, w.startFrame]);
}

function clipPayload(words: readonly TimedWord[], meta: Record<string, unknown>, generation: number, includeWords: boolean, includeCompact: boolean): Record<string, unknown> {
  const row: Record<string, unknown> = { ...meta, wordCount: words.length, transcriptGeneration: generation };
  if (includeCompact || includeWords) row.compactWords = compactRows(words);
  if (includeWords) row.words = words;
  return row;
}

/** transcript.py `_transcript_notes(for_edit=True)`. */
function transcriptNotes(): string[] {
  return [
    "data.script is the full dialogue for the user. " +
      "data.clipIds are TIMELINE clip ids (not media-bin fileIds). " +
      "For cuts: call remove_words_tool ONCE next with data.clipIds[0] + matches " +
      '(e.g. ["FlowCut","flocut"]) — do NOT call get_transcript_tool again. ' +
      "Keep language=auto. Never pass fileId to remove_words_tool.",
    "matches=[...] is enough for brand/filler cuts — you do not need " +
      "compactWords or a matching transcriptGeneration. After a successful cut, " +
      "use remove_words_tool data.script (full remaining dialogue) — do not " +
      "truncate or invent a message limit.",
  ];
}

/** transcript.py `_short_transcript_summary`. */
function shortSummary(wordCount: number, source: string, language: string, clipIds: readonly string[], fileIds: readonly string[], suffix = ""): string {
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
  const lang = language ? `, ${language}` : "";
  const base = `Transcribed ${wordCount} words (${source || "local"}${lang}).${idBit} ${action}`;
  return suffix ? `${base} ${suffix}`.trim() : base;
}

interface SourceFacts {
  source: string;
  modelId: string;
  language: string;
  generation: number;
  exact: boolean;
}

/** transcript.py `_transcript_data_payload`, plus `wordTiming` (exact or estimated). */
function dataPayload(script: string, wordCount: number, clipsOut: readonly Record<string, unknown>[], facts: SourceFacts): Record<string, unknown> {
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
    transcriptGeneration: facts.generation,
    wordCount,
    transcriptionSource: facts.source,
    wordTiming: facts.exact ? "exact" : "estimated",
    modelId: facts.modelId,
    language: facts.language,
    engine: facts.source,
    clips: clipsOut,
    script,
  };
}

function factsOf(sources: readonly WordSource[]): SourceFacts {
  const last = sources[sources.length - 1];
  return {
    source: last?.source ?? "local",
    modelId: last?.modelId ?? "",
    language: last?.language ?? "",
    generation: Math.max(1, ...sources.map((s) => s.generation)),
    exact: sources.length > 0 && sources.every((s) => s.exact),
  };
}

// ---------------------------------------------------------------------------
// get_transcript (transcript.py get_transcript)
// ---------------------------------------------------------------------------

export interface TranscriptRun {
  receipt: ToolReceipt;
  /** Every clip's (or the file's) words, with timeline frames. */
  words: TimedWord[];
}

function wantsFull(input: Record<string, unknown>): { includeWords: boolean; includeCompact: boolean } {
  const includeWords = input.includeWords === true || String(input.includeWords ?? "").toLowerCase() === "true";
  const detail = text(input.detail_level).toLowerCase();
  return { includeWords, includeCompact: includeWords || ["full", "all", "verbose", "words", "compact"].includes(detail) };
}

function fileReceipt(
  tool: string,
  file: ProjectFile,
  got: WordSource,
  fps: Fps,
  full: { includeWords: boolean; includeCompact: boolean },
  warnings: string[],
  suffix = "",
): TranscriptRun {
  const words = wordsForFile(got.words, fps, got.generation);
  const facts = factsOf([got]);
  const clips = [clipPayload(words, { fileId: String(file.id) }, got.generation, full.includeWords, full.includeCompact)];
  const summary = words.length
    ? shortSummary(words.length, facts.source, facts.language, [], [String(file.id)], suffix)
    : `No spoken dialogue found.${suffix ? ` ${suffix}` : ""}`;
  const allWarnings = [...warnings, ...got.warnings, ...(got.exact ? [] : [ESTIMATED_WARNING])];
  return {
    words,
    receipt: applied(tool, summary, { warnings: allWarnings, notes: transcriptNotes(), data: dataPayload(wordsToScript(words), words.length, clips, facts) }, 0),
  };
}

/**
 * get_transcript_tool for `tool` (the caption tools call it in their own
 * name). Words come from `wordsFor`, which keeps any new transcription.
 */
export async function runTranscript(call: ToolCall, input: Record<string, unknown>, tool = "get_transcript_tool"): Promise<TranscriptRun> {
  const project = (): Project => call.doc.project;
  const fps = projectFps(project());
  let clipId = text(input.clipId) || text(input.timeline_clip_id);
  let fileId = text(input.fileId) || text(input.file_id);
  const full = wantsFull(input);
  const trackRaw = input.trackIndex ?? input.track_index;
  const request = (transcribe = true): WordRequest => ({
    language: input.language,
    force: input.force === true || String(input.force ?? "").toLowerCase() === "true",
    estimatesOk: true,
    transcribe,
  });
  const none = (receipt: ToolReceipt): TranscriptRun => ({ receipt, words: [] });

  let targets: Clip[] = [];
  if (clipId) {
    const clip = project().clips.find((c) => String(c.id) === clipId);
    if (clip) targets = [clip];
    else {
      // Models often pass the media-bin fileId as clipId after a file-only receipt.
      const hits = project().clips.filter((c) => String(c.file_id ?? "") === clipId || String(record(c.reader).id ?? "") === clipId);
      if (hits.length > 0) targets = hits;
      else if (fileById(project(), clipId)) {
        fileId = clipId;
        clipId = "";
      } else return none(refused(tool, `Error: Unknown clipId '${clipId}'.`));
    }
  }
  if (fileId && targets.length === 0) {
    const file = fileById(project(), fileId);
    if (!file) return none(refused(tool, `Error: Unknown fileId '${fileId}'.`));
    if (!mediaPathOf(file)) return none(refused(tool, "Error: File has no media path."));
    const got = await wordsFor(call, fileTarget(file), request());
    if (!isWordSource(got)) return none(failureReceipt(tool, got));
    return fileReceipt(tool, fileById(project(), fileId) ?? file, got, fps, full, []);
  }

  let untargeted = false;
  if (targets.length === 0 && !clipId) {
    let want: number | null = null;
    if (trackRaw !== undefined && trackRaw !== null && trackRaw !== "") {
      want = Number(trackRaw);
      if (!Number.isInteger(want)) return none(refused(tool, "Error: trackIndex must be an integer."));
    }
    for (const clip of project().clips) {
      if (want !== null && layerNumberToDisplayIndex(Math.trunc(Number(clip.layer ?? -1)), project().layers) !== want) continue;
      targets.push(clip);
    }
    untargeted = want === null;
    if (targets.length === 0 && want === null) {
      // Imports only: the timeline is empty, so transcribe the media-bin file.
      const usable = project().files.filter((f) => !["image", "image/sequence", "font"].includes(String(f.media_type ?? "").toLowerCase()) && mediaPathOf(f));
      if (usable.length === 1) {
        const only = usable[0]!;
        const got = await wordsFor(call, fileTarget(only), request());
        if (!isWordSource(got)) return none(failureReceipt(tool, got));
        return fileReceipt(
          tool,
          fileById(project(), only.id) ?? only,
          got,
          fps,
          full,
          ["Timeline had no clips — transcribed the single media-bin file. Place it on the timeline for clip-scoped word frames."],
          "(timeline was empty; transcribed the media-bin file.)",
        );
      }
      if (usable.length > 1) {
        const ids = usable.slice(0, 8).map((f) => String(f.id)).join(", ");
        return none(refused(tool, `Error: Timeline is empty and multiple media-bin files exist. Pass fileId for one of: ${ids}`));
      }
    }
  }
  if (targets.length === 0) {
    return none(refused(tool, "Error: No clips to transcribe. Pass clipId/timeline_clip_id, fileId/file_id, put a clip on the timeline, or import media first."));
  }

  const clipsOut: Record<string, unknown>[] = [];
  const all: TimedWord[] = [];
  const sources: WordSource[] = [];
  const warnings: string[] = [];
  const failures: WordSourceFailure[] = [];
  const pays = untargeted ? untargetedTranscription(project(), targets) : () => true;
  for (const clip of targets) {
    const cid = String(clip.id);
    const target = clipTarget(project(), clip);
    if (!target || !mediaPathOf(target.file, clip)) {
      warnings.push(`clip ${cid}: no media path`);
      continue;
    }
    const paid = pays(clip);
    const got = await wordsFor(call, target, request(paid));
    if (!isWordSource(got)) {
      if (got.kind === "no_audio") warnings.push(`clip ${cid}: no audio track`);
      else if (!paid && got.kind === "unavailable") {
        warnings.push(`clip ${cid} (${String(clip.title || target.file.name || target.file.id)}): audio-only, not transcribed without a clipId (pass clipId=${cid} to transcribe it)`);
        continue;
      } else warnings.push(`clip ${cid}: ${got.message}`);
      failures.push(got);
      continue;
    }
    const mapped = wordsForClip(got.words, clip, fps, got.generation);
    all.push(...mapped);
    sources.push(got);
    warnings.push(...got.warnings);
    clipsOut.push(
      clipPayload(
        mapped,
        {
          clipId: cid,
          fileId: String(clip.file_id ?? ""),
          position: Number(clip.position) || 0,
          start: Number(clip.start) || 0,
          end: Number(clip.end) || 0,
        },
        got.generation,
        full.includeWords,
        full.includeCompact,
      ),
    );
  }
  if (clipsOut.length === 0) {
    if (failures.length > 0 && failures.every((f) => f.kind === "no_audio")) return none(unchanged(tool, NO_AUDIO_MESSAGE, { data: { reason: "no_audio" } }));
    const unavailableOne = failures.find((f) => f.kind === "unavailable");
    if (unavailableOne && failures.every((f) => f.kind !== "failed")) return none(unavailable(tool, `${unavailableOne.message}; these clips have no indexed transcript either.`));
    return none(failed(tool, `Error: Could not transcribe any clip. ${warnings.slice(0, 3).join("; ")}`));
  }
  const facts = factsOf(sources);
  if (!facts.exact) warnings.push(ESTIMATED_WARNING);
  const wordCount = all.length;
  const clipIds = clipsOut.map((c) => String(c.clipId));
  const summary = wordCount ? shortSummary(wordCount, facts.source, facts.language, clipIds, []) : "No spoken dialogue found.";
  return {
    words: all,
    receipt: applied(tool, summary, { warnings, notes: transcriptNotes(), data: dataPayload(wordsToScript(all), wordCount, clipsOut, facts) }, 0),
  };
}

// ---------------------------------------------------------------------------
// Fragment edits (transcript.py apply_compacted_fragments, _delete_clip_and_ripple)
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

/** Every word of the clip goes: delete it and close the gap (`_delete_clip_and_ripple`). */
function deleteClipAndRipple(tx: Transaction, clipId: string, removed: number, fps: Fps): Record<string, unknown>[] {
  const clip = tx.project.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error(`Unknown clipId '${clipId}'`);
  const { layer, position } = clip;
  tx.delete(["clips", { id: clipId }]);
  const shifted: Record<string, unknown>[] = [];
  const gap = snap(removed, fps);
  if (gap > 1e-9) {
    for (const other of tx.project.clips.filter((c) => c.layer === layer)) {
      if (other.position + 1e-9 >= position) {
        moveClip(tx, other.id, { position: snap(other.position - gap, fps) });
        shifted.push({ clipId: other.id, deltaSec: -gap });
      }
    }
  }
  return shifted;
}

// ---------------------------------------------------------------------------
// Argument helpers (transcript.py _as_int_list / _as_str_list)
// ---------------------------------------------------------------------------

function parseList(value: unknown): unknown[] | null {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return null;
    try {
      const parsed: unknown = JSON.parse(t);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return t.split(",").map((p) => p.trim()).filter(Boolean);
    }
  }
  return [value];
}

function intList(value: unknown): number[] | null {
  const items = parseList(value);
  if (items === null) return null;
  return items.map((item) => Number(item)).filter((n) => Number.isFinite(n)).map((n) => Math.trunc(n));
}

function strList(value: unknown): string[] | null {
  const items = parseList(value);
  if (items === null) return null;
  const out = items.map((item) => String(item).trim()).filter(Boolean);
  return out.length > 0 ? out : null;
}

const DESKTOP_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

export const speechTools: CatalogTool[] = [
  contractTool("get_transcript_tool", {
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    run: async (call, input) => (await runTranscript(call, input as Record<string, unknown>)).receipt,
  }),

  contractTool("transcribe_media_tool", {
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: async (call, input) => {
      const tool = "transcribe_media_tool";
      const fileId = text(input.fileId) || text(input.file_id);
      if (!fileId) return refused(tool, "Error: fileId is required.");
      const file = fileById(call.doc.project, fileId);
      if (!file) return refused(tool, `Error: Unknown fileId '${fileId}'.`);
      if (!mediaPathOf(file)) return refused(tool, "Error: File has no media path.");
      const got = await wordsFor(call, fileTarget(file), { language: input.language, force: input.force === true, estimatesOk: false, transcribe: true });
      if (!isWordSource(got)) {
        if (got.kind === "unavailable") {
          const indexed = fileTarget(file).indexed ? " Its indexed transcript is available through get_transcript_tool." : "";
          return unavailable(tool, `${got.message}.${indexed}`);
        }
        return failureReceipt(tool, got);
      }
      const script = wordsToScript(got.words);
      const summary = got.words.length ? shortSummary(got.words.length, got.source, got.language, [], [fileId]) : "No spoken dialogue found.";
      return applied(
        tool,
        summary,
        {
          warnings: got.warnings,
          notes: ["Show data.script to the user — never paste this receipt JSON. Do not re-call this tool; use get_transcript_tool / remove_words_tool next."],
          data: {
            fileId,
            wordCount: got.words.length,
            language: got.language,
            modelId: got.modelId,
            transcriptionSource: got.source,
            transcriptGeneration: got.generation,
            engine: got.source,
            script,
          },
        },
        0,
      );
    },
  }),

  contractTool("remove_words_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: async (call, input) => {
      const tool = "remove_words_tool";
      const raw = input as Record<string, unknown>;
      let clipId = text(input.clipId) || text(input.timeline_clip_id);
      const wordIndices = intList(raw.wordIndices ?? raw.word_indices);
      const matches = strList(raw.matches ?? raw.matchTexts ?? raw.match_texts);
      const fillerPreset = text(input.fillerPreset) || text(raw.filler_preset);
      const generationArg = raw.transcriptGeneration ?? raw.transcript_generation;
      const warnings: string[] = [];
      let project = call.doc.project;

      if (!clipId) {
        // A single-clip project: matches-only calls need no clipId.
        if (project.clips.length === 1) clipId = String(project.clips[0]!.id);
        else {
          return refused(tool, "Error: clipId is required when the timeline has zero or multiple clips. Pass clipId from get_transcript_tool data.clipIds.");
        }
      }
      let clip = project.clips.find((c) => String(c.id) === clipId);
      if (!clip) {
        // Agents often pass the media-bin fileId after a file-only transcript receipt.
        const hits = project.clips.filter((c) => String(c.file_id ?? "") === clipId || String(record(c.reader).id ?? "") === clipId);
        if (hits.length === 1) {
          clip = hits[0]!;
          clipId = String(clip.id);
        } else if (hits.length > 1) {
          return refused(tool, `Error: '${clipId}' is a media-bin fileId with multiple timeline clips. Pass one timeline clipId: ${hits.slice(0, 8).map((c) => c.id).join(", ")}`);
        } else if (fileById(project, clipId)) {
          return refused(
            tool,
            `Error: '${clipId}' is a media-bin fileId, not a timeline clipId. Place the file on the timeline, call get_transcript_tool (no args), then remove_words_tool with data.clipIds[0].`,
          );
        } else return refused(tool, `Error: Unknown clipId '${clipId}'.`);
      }
      const target = clipTarget(project, clip);
      if (!target || !mediaPathOf(target.file, clip)) return refused(tool, "Error: Clip has no media path.");
      // Before transcribing: refusals that need no words cost nothing.
      if (fillerPreset && !(fillerPreset in FILLER_PRESETS)) {
        return refused(tool, `Error: Unknown fillerPreset '${fillerPreset}'. Use one of: ${Object.keys(FILLER_PRESETS).sort().join(", ")}.`);
      }
      let pinned: number | null = null;
      if (generationArg !== undefined && generationArg !== null && generationArg !== "") {
        pinned = Number(generationArg);
        if (!Number.isInteger(pinned)) return refused(tool, "Error: transcriptGeneration must be an integer.");
      }
      if (isRetimed(clip as unknown as Record<string, unknown>)) {
        // Fragments are packed in source seconds; on a retimed clip that spaces them (and ripples later clips) wrongly.
        return refused(tool, "Error: this clip has a speed change or time curve; reset its speed (Time > Normal) before removing words.");
      }
      if ((!wordIndices || wordIndices.length === 0) && !matches && !fillerPreset) {
        return unchanged(tool, "No words matched — nothing removed.", { data: { matches: [] } });
      }
      const got = await wordsFor(call, target, { language: input.language, estimatesOk: false, transcribe: true });
      if (!isWordSource(got)) {
        if (got.kind === "no_audio") return unchanged(tool, NO_AUDIO_MESSAGE, { data: { reason: "no_audio" } });
        if (got.kind === "unavailable") return unavailable(tool, `${got.message}; cutting words needs exact word timings from speech recognition.`);
        return failed(tool, `Error: ${capitalized(got.message.replace(/\.$/, ""))}.`);
      }
      project = call.doc.project;
      clip = project.clips.find((c) => c.id === clipId)!;
      if (pinned !== null && pinned !== got.generation) {
        // matches / fillerPreset recompute indices from the live words; wordIndices win over both, so stale ones refuse.
        if (wordIndices !== null) {
          return refused(tool, "Error: transcriptGeneration mismatch — call get_transcript_tool again.", {
            data: { transcriptGeneration: got.generation, requested: pinned },
          });
        }
        warnings.push(`transcriptGeneration ${pinned} stale; using live generation ${got.generation}`);
      } else if (pinned === null && wordIndices !== null && got.fresh) {
        // Words transcribed by this call: the caller's indices cannot come from them.
        return refused(
          tool,
          "Error: wordIndices refer to words you have not seen: this clip was just transcribed with exact word timings. " +
            "Call get_transcript_tool again for its word indices (or pass matches=[...]).",
          { data: { transcriptGeneration: got.generation } },
        );
      }

      const fps = projectFps(project);
      const pos = Number(clip.position) || 0;
      const start = Number(clip.start) || 0;
      const end = Number(clip.end) || start;
      const mapped = wordsForClip(got.words, clip, fps, got.generation);
      let indices: number[] = [];
      if (fillerPreset) indices = indicesForFillerPreset(mapped, fillerPreset);
      if (matches !== null) indices = [...new Set([...indices, ...indicesForMatches(mapped, matches)])].sort((a, b) => a - b);
      if (wordIndices !== null) indices = wordIndices;
      warnings.push(...got.warnings);
      const facts = { transcriptGeneration: got.generation };
      if (indices.length === 0) {
        const hint = matches ? ` (no transcript words matched [${matches.map((m) => `'${m}'`).join(", ")}])` : "";
        return unchanged(tool, `No words matched — nothing removed.${hint}`, { data: { ...facts, matches: matches ?? [] }, warnings });
      }
      const ranges = rangesForWordIndices(mapped, indices, fps);
      if (ranges.length === 0) return unchanged(tool, "No removable ranges — nothing removed.", { data: facts, warnings });
      const { fragments, removed } = compactFragmentsAfterRemove(pos, start, end, ranges, fps);
      if (removed <= 0 && fragments.length === 1 && Math.abs(fragments[0]![1] - start) < 1e-9 && Math.abs(fragments[0]![2] - end) < 1e-9) {
        return unchanged(tool, "Selection produced no change.", { data: facts, warnings });
      }
      if (fragments.length === 0) {
        const shifted = call.commit((tx) => deleteClipAndRipple(tx, clipId, end - start, fps));
        return applied(tool, `Removed ${indices.length} word(s) (entire clip).`, {
          removedClipIds: [clipId],
          shifted,
          warnings,
          data: { clipId, removedDurationSec: end - start, transcriptGeneration: got.generation },
        });
      }
      const { createdIds, shifted } = call.commit((tx) => applyCompactedFragments(tx, clipId, fragments, removed, fps));
      // The remaining dialogue, so the agent need not re-call get_transcript_tool.
      const removedSet = new Set(indices);
      const kept = mapped.filter((w) => !removedSet.has(w.index) && String(w.text ?? "").trim()).map((w) => ({ text: String(w.text).trim() }));
      return applied(tool, `Removed ${indices.length} word(s), closed ${pyFixed(removed, 2)}s.`, {
        shifted,
        warnings,
        data: {
          clipId,
          createdClipIds: createdIds,
          removedWordIndices: indices,
          removedDurationSec: removed,
          fragmentCount: fragments.length,
          transcriptGeneration: got.generation,
          transcriptionSource: got.source,
          modelId: got.modelId,
          language: got.language,
          script: wordsToScript(kept),
          wordCount: kept.length,
        },
      });
    },
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
      const path = mediaPathOf(fileOfClip(project, clip), clip);
      if (!path) return refused(tool, "Error: Clip has no readable media path.");
      const minPause = input.minPauseSec ?? 0.4;
      const pad = input.padSec ?? 0.08;
      const maxFrac = input.maxRemoveFraction ?? 0.85;
      if (isRetimed(clip as unknown as Record<string, unknown>)) {
        // Same packing as remove_words: source seconds, wrong on a retimed clip.
        return refused(tool, "Error: this clip has a speed change or time curve; reset its speed (Time > Normal) before removing silence.");
      }
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
      const transcript = await runTranscript(
        call,
        { clipId: input.clipId, timeline_clip_id: input.timeline_clip_id, trackIndex: input.trackIndex, language: input.language, includeWords: true },
        tool,
      );
      const status = transcript.receipt.status;
      if (status === "error" || status === "refused") return transcript.receipt;
      if (status === "unchanged") return transcript.receipt;
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
      const data = record(transcript.receipt.data);
      return applied(
        tool,
        `Exported ${cues.length} cue(s) to ${location || path}.`,
        {
          warnings: transcript.receipt.warnings,
          data: { path: location || path, format, count: cues.length, transcriptionSource: data.transcriptionSource ?? INDEX_SOURCE, wordTiming: data.wordTiming },
        },
        0,
      );
    },
  }),

  contractTool("detect_beats_tool", {
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    run: async (call, input) => {
      const tool = "detect_beats_tool";
      const project = call.doc.project;
      const clipId = text(input.clipId) || text(input.timeline_clip_id);
      const fileId = text(input.fileId) || text(input.file_id);
      let file: ProjectFile | undefined;
      if (clipId) {
        const clip = project.clips.find((c) => String(c.id) === clipId);
        if (!clip) return refused(tool, `Error: Unknown clipId '${clipId}'.`);
        file = fileById(project, String(clip.file_id ?? ""));
      } else if (fileId) {
        file = fileById(project, fileId);
        if (!file) return refused(tool, `Error: Unknown fileId '${fileId}'.`);
      } else {
        return refused(tool, "Error: Provide fileId or clipId.");
      }
      if (!file) return refused(tool, "Error: Media path missing.");
      if (!canTrackBeats(call)) return unavailable(tool, "this surface cannot decode audio for beat tracking (Zenvi desktop, the CLI and Zenvi Cloud can).");
      const result = await beatsOfFile(call, file);
      if (typeof result === "string") return failed(tool, result);
      const fps = projectFps(project);
      // Same receipt as zenvi-core speech_extra.detect_beats_tool_handler; beats are a tempo grid here (not energy peaks).
      return applied(
        tool,
        `Detected ${result.beats.length} beat(s), BPM≈${result.bpm.toFixed(1)}.`,
        {
          data: {
            beats: result.beats.map((b) => ({ timeSec: b.timeSec, frame: toFrame(b.timeSec, fps), strength: b.strength })),
            downbeats: result.downbeats.map((d) => ({ timeSec: d.timeSec, frame: toFrame(d.timeSec, fps) })),
            bpm: result.bpm,
            fileId: fileId || "",
            clipId: clipId || "",
            provider: "local",
          },
        },
        0,
      );
    },
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
