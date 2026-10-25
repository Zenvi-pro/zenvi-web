/**
 * Audio mixing tools: analyze_timeline_audio_tool, set_clip_volume_tool,
 * duck_under_speech_tool.
 *
 * Ports of zenvi-core src/classes/tool_handlers.py (ref b63c39be7):
 * _collect_timeline_audio, analyze_timeline_audio, set_clip_volume,
 * duck_under_speech. The math lives in ../audio-mix.ts (audio_mix.py).
 * Volume curves are written the way the desktop's `_write_volume_points`
 * does: `clip.volume = { Points }`, in the call's one transaction.
 */

import type { TimedText } from "../../analysis/transcription.js";
import type { Transaction } from "../../history/document.js";
import { setClipKeyframes, setClipVolume } from "../../ops/clips.js";
import type { Clip, KeyframePoint, Project, ProjectFile } from "../../model/types.js";
import { getEffectiveAiMetadata } from "../ai-metadata.js";
import {
  BED_ROLES,
  DEFAULT_DUCK_DB,
  MAX_LEVEL,
  autoDuckDb,
  buildDuckPoints,
  buildStaticLevelPoints,
  clampWindows,
  classifyClipAudioRole,
  clipTimelineExtent,
  currentStaticLevel,
  curvePoints,
  dbToGain,
  duckedWindows,
  gainToDb,
  hasAudioStream,
  invertWindows,
  mergeWindows,
  refineWindowsWithEnergy,
  speechWindowsFromCues,
  speechWindowsFromEnergy,
  speechWindowsFromSource,
  type AudioRole,
  type Window,
} from "../audio-mix.js";
import { contractTool, type CatalogTool, type ToolCall } from "../define.js";
import { pyFixed, pyReprString } from "../pyfmt.js";
import { energyVadWindows } from "../speech.js";
import { clipTarget, isWordSource, speechWindowsFromWords, storedTranscript, untargetedTranscription, wordsFor } from "../transcripts.js";
import { formatTrackLabelForLlm, lockedTrackError, normalizeTrackOrLayerArg } from "../tracks.js";
import { boolArg, fileById, floatArg, idList, resolveClip, text } from "./common.js";

export interface AudioEntry {
  clip: Clip;
  id: string;
  file: ProjectFile | undefined;
  role: AudioRole;
  layer: number;
  trackLabel: string;
  title: string;
  start: number;
  end: number;
  windows: Window[];
  windowSource: string;
  level: number | null;
  points: number;
  analyzed: boolean;
}

function layerOf(clip: Clip): number {
  const n = Math.trunc(Number(clip.layer || 0));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fewer words than this are not dialogue to duck under: Whisper writes what it
 * hears in a tone or a jingle as a word or two ("Beeeeeeeep", "Ring...").
 */
const MIN_SPEECH_WORDS = 3;

/** Timeline speech windows from a clip's transcribed words, or none when they are too few to be dialogue. */
function transcriptWindows(words: readonly TimedText[], clip: Clip): Window[] {
  if (words.length < MIN_SPEECH_WORDS) return [];
  return speechWindowsFromSource(speechWindowsFromWords(words), clip);
}

/** Every timeline clip with sound, with its role and speech windows (_collect_timeline_audio). */
export function collectTimelineAudio(project: Project, layerFilter?: number): AudioEntry[] {
  const entries: AudioEntry[] = [];
  for (const clip of project.clips ?? []) {
    const layer = layerOf(clip);
    if (layerFilter !== undefined && layer !== layerFilter) continue;
    const file = clip.file_id ? fileById(project, String(clip.file_id)) : undefined;
    const effective = getEffectiveAiMetadata(file, clip, { clipAiMetadata: (clip as { ai_metadata?: unknown }).ai_metadata });
    let role = classifyClipAudioRole(clip, file, effective);
    if (role === "silent") continue;
    let windows = speechWindowsFromCues(clip, effective);
    let windowSource = windows.length > 0 ? "cues" : "";
    if (windows.length > 0) {
      const refined = refineWindowsWithEnergy(windows, clip);
      if (JSON.stringify(refined) !== JSON.stringify(windows)) windowSource = "cues+energy";
      windows = refined;
    } else if (role === "unknown") {
      // Not indexed, but transcribed on the web (transcripts.ts): its words say where the speech is.
      windows = transcriptWindows(storedTranscript(file)?.words ?? [], clip);
      if (windows.length > 0) {
        role = "speech";
        windowSource = "transcript";
      }
    }
    const [start, end] = clipTimelineExtent(clip);
    entries.push({
      clip,
      id: String(clip.id),
      file,
      role,
      layer,
      trackLabel: formatTrackLabelForLlm(layer, project.layers),
      title: String(clip.title || (clip as { label?: unknown }).label || "clip"),
      start,
      end,
      windows,
      windowSource,
      level: currentStaticLevel(clip),
      points: curvePoints(clip).length,
      analyzed: Boolean(effective.analyzed),
    });
  }
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.start - b.e.start || a.e.layer - b.e.layer || a.i - b.i)
    .map(({ e }) => e);
}

/** `{x:+.1f}`. */
function signed1(x: number): string {
  const body = pyFixed(x, 1);
  return body.startsWith("-") ? body : `+${body}`;
}

function describeAudioClip(entry: AudioEntry): string {
  const levelPart =
    entry.level !== null
      ? `level=${pyFixed(entry.level, 2)} (${signed1(gainToDb(entry.level))} dB)`
      : `level=automated(${entry.points} points)`;
  return (
    `  timeline_clip_id=${entry.id} audio_role=${entry.role} ` +
    `track=${entry.trackLabel} title=${pyReprString(entry.title)} ` +
    `${pyFixed(entry.start, 2)}s-${pyFixed(entry.end, 2)}s ${levelPart} ` +
    `indexed=${entry.analyzed ? "yes" : "no"}`
  );
}

function fmtWindows(windows: readonly Window[], limit = 8): string {
  const shown = windows.slice(0, limit).map(([s, e]) => `${pyFixed(s, 2)}-${pyFixed(e, 2)}`);
  if (windows.length > limit) shown.push(`... +${windows.length - limit} more`);
  return shown.join(", ");
}

function speechOverlaps(entries: readonly AudioEntry[]): [AudioEntry, AudioEntry][] {
  const speech = entries.filter((e) => e.role === "speech");
  const out: [AudioEntry, AudioEntry][] = [];
  speech.forEach((a, i) => {
    for (const b of speech.slice(i + 1)) {
      if (Math.min(a.end, b.end) - Math.max(a.start, b.start) > 0.05) out.push([a, b]);
    }
  });
  return out;
}

/** Write a volume curve (tool_handlers._write_volume_points) through the keyframe op. */
function writeVolumePoints(tx: Transaction, clipId: string, points: readonly KeyframePoint[]): void {
  setClipKeyframes(
    tx,
    clipId,
    "volume",
    points.map((p) => ({ frame: p.co.X, value: p.co.Y, interpolation: p.interpolation })),
    { mode: "replace" },
  );
}

/** Speech windows from the host's audio analysis (desktop: local VAD), timeline seconds. */
async function vadWindows(call: ToolCall, entry: AudioEntry): Promise<Window[]> {
  const audio = call.host.audio;
  const path = String((entry.clip.reader as { path?: unknown } | undefined)?.path ?? entry.file?.path ?? "");
  if (!audio || !path) return [];
  try {
    const envelope = await audio.analyzeAudio(path, { signal: call.signal });
    return speechWindowsFromSource(energyVadWindows(envelope, { minSpeechSec: 0.12, minSilenceSec: 0.35 }), entry.clip);
  } catch (error) {
    call.host.log?.(`analyzeAudio(${path}) failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/** speech_windows_best without cues: VAD (host audio analysis), then the cached waveform. */
async function fallbackSpeechWindows(call: ToolCall, entry: AudioEntry): Promise<[Window[], string]> {
  const vad = await vadWindows(call, entry);
  if (vad.length > 0) return [vad, "local_vad"];
  const energy = speechWindowsFromEnergy(entry.clip);
  if (energy.length > 0) return [energy, "energy"];
  return [[], "none"];
}

/**
 * Speech found by transcribing the talking footage (picture and sound) that
 * has no transcript yet, when nothing indexed or transcribed says where the
 * speech is. The words are kept on the file (transcripts.ts), so captions and
 * cuts reuse them. Music beds are not transcribed.
 */
async function transcribedSpeech(call: ToolCall, entries: AudioEntry[]): Promise<AudioEntry[]> {
  if (!call.host.audio?.transcribe) return [];
  const project = call.doc.project;
  const pays = untargetedTranscription(project, entries.map((e) => e.clip));
  const speech: AudioEntry[] = [];
  for (const entry of entries) {
    if (entry.windows.length > 0 || entry.role !== "unknown" || !pays(entry.clip)) continue;
    const target = clipTarget(call.doc.project, entry.clip);
    if (!target) continue;
    const got = await wordsFor(call, target, { estimatesOk: true, transcribe: true });
    if (!isWordSource(got)) {
      call.host.log?.(`duck_under_speech: no transcript for ${entry.id}: ${got.message}`);
      continue;
    }
    const windows = transcriptWindows(got.words, entry.clip);
    if (windows.length === 0) continue;
    entry.windows = windows;
    entry.windowSource = "transcript";
    entry.role = "speech";
    speech.push(entry);
  }
  return speech;
}

const ADJUST = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

export const audioTools: CatalogTool[] = [
  contractTool("analyze_timeline_audio_tool", {
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    run: (call, input) => {
      const project = call.doc.project;
      let layerFilter: number | undefined;
      if (text(input.track)) {
        const r = normalizeTrackOrLayerArg(text(input.track), project.layers);
        if (r.error) return r.error;
        layerFilter = r.layer;
      }
      let entries = collectTimelineAudio(project, layerFilter);
      const wanted = text(input.timeline_clip_id);
      if (wanted) {
        entries = entries.filter((e) => e.id === wanted);
        if (entries.length === 0) return `Error: No timeline clip with id=${wanted} (or it has no audio).`;
      }
      if (entries.length === 0) return "No timeline clips with audio.";

      const showWindows = String(input.detail ?? "").trim().toLowerCase() === "windows";
      const lines = [`Timeline audio (${entries.length} clip(s) with sound):`];
      for (const entry of entries) {
        lines.push(describeAudioClip(entry));
        if (showWindows && entry.windows.length > 0) {
          lines.push(`    speech windows (${entry.windowSource}, timeline s): ${fmtWindows(entry.windows)}`);
        }
      }
      const speech = entries.filter((e) => e.role === "speech");
      const beds = entries.filter((e) => e.role === "music" || e.role === "sfx");
      const unknown = entries.filter((e) => e.role === "unknown");
      lines.push(`Summary: ${speech.length} speech, ${beds.length} music/sfx bed(s), ${unknown.length} unknown.`);
      if (unknown.length > 0) {
        lines.push("  unknown = source not indexed yet; index it or pass the clip id explicitly to mix it.");
      }
      for (const [a, b] of speechOverlaps(entries)) {
        lines.push(
          `WARNING: speech clips ${a.id} and ${b.id} overlap in time ` +
            `(${pyFixed(Math.max(a.start, b.start), 2)}s-${pyFixed(Math.min(a.end, b.end), 2)}s). ` +
            "Two voices at once cannot be fixed by ducking — move or trim one.",
        );
      }
      for (const bed of beds) {
        const higher = speech.filter((s) => s.layer < bed.layer && Math.min(s.end, bed.end) - Math.max(s.start, bed.start) > 0.05);
        if (higher.length > 0) {
          lines.push(`NOTE: bed ${bed.id} sits above speech on track ${bed.trackLabel}. Duck its level instead of restacking tracks.`);
        }
      }
      return lines.join("\n");
    },
  }),

  contractTool("set_clip_volume_tool", {
    annotations: ADJUST,
    run: async (call, input) => {
      if (!text(input.timeline_clip_id) && !text(input.clip_query)) {
        return "Error: set_clip_volume requires timeline_clip_id or clip_query.";
      }
      // Web aliases (the CLI's): volume ("0.5" or "-6dB"), gain -> level; db -> level_db.
      let levelDbRaw: unknown = input.level_db ?? input.db;
      let levelRaw: unknown = input.level ?? input.gain;
      if (levelRaw === undefined && levelDbRaw === undefined && input.volume !== undefined) {
        const v = String(input.volume).trim();
        if (/db$/i.test(v)) levelDbRaw = v.replace(/db$/i, "").trim();
        else levelRaw = input.volume;
      }
      const db = floatArg(levelDbRaw, null);
      const lin = floatArg(levelRaw, null);
      if (db !== null && lin !== null) return "Error: pass either level_db or level, not both.";
      if (db === null && lin === null) return "Error: set_clip_volume requires level_db or level.";
      const target = db !== null ? dbToGain(db) : lin!;

      const resolved = await resolveClip(call, input);
      if (!resolved.ok) return resolved.error || "Error: Could not resolve timeline clip.";
      const project = call.doc.project;
      const clip = resolved.clip;
      const layer = layerOf(clip);
      const trackLabel = formatTrackLabelForLlm(layer, project.layers);
      const locked = lockedTrackError(layer, project.layers);
      if (locked) return locked;
      const file = clip.file_id ? fileById(project, String(clip.file_id)) : undefined;
      if (!hasAudioStream(clip, file)) return `Error: timeline clip ${String(clip.id)} has no audio stream.`;

      const before = currentStaticLevel(clip);
      const startS = floatArg(input.start_seconds, null);
      const endS = floatArg(input.end_seconds, null);
      const points = buildStaticLevelPoints(clip, project.fps, target, {
        startSeconds: startS,
        endSeconds: endS,
        fade: Math.max(0, (floatArg(input.fade_ms, 150) ?? 0) / 1000),
        scale: String(input.mode ?? "").trim().toLowerCase() === "scale",
      });
      if (points.length === 0) {
        const [s, e] = clipTimelineExtent(clip);
        return `Error: the requested window does not overlap timeline clip ${String(clip.id)} (${pyFixed(s, 2)}s-${pyFixed(e, 2)}s).`;
      }
      const clipId = String(clip.id);
      call.commit((tx) =>
        setClipVolume(tx, clipId, {
          level: target,
          ...(startS !== null ? { start: startS } : {}),
          ...(endS !== null ? { end: endS } : {}),
          fadeMs: Math.max(0, floatArg(input.fade_ms, 150) ?? 0),
          mode: String(input.mode ?? "").trim().toLowerCase() === "scale" ? "scale" : "replace",
        }),
      );

      const title = String(clip.title || (clip as { label?: unknown }).label || "clip");
      let windowText = "whole clip";
      if (startS !== null || endS !== null) {
        const [tlStart, tlEnd] = clipTimelineExtent(clip);
        windowText = `${pyFixed(startS ?? tlStart, 2)}s-${pyFixed(endS ?? tlEnd, 2)}s (timeline)`;
      }
      return (
        `Set volume on timeline_clip_id=${clipId} (track ${trackLabel}, ` +
        `${pyReprString(title)}): ${before !== null ? pyFixed(before, 2) : "automated"} -> ${pyFixed(target, 3)} ` +
        `(${signed1(gainToDb(target))} dB) over ${windowText}; ` +
        `${points.length} volume point(s) written. Track and position unchanged.`
      );
    },
  }),

  contractTool("duck_under_speech_tool", {
    annotations: ADJUST,
    run: async (call, input) => {
      const project = call.doc.project;
      let layerFilter: number | undefined;
      if (text(input.bed_track)) {
        const r = normalizeTrackOrLayerArg(text(input.bed_track), project.layers);
        if (r.error) return r.error;
        layerFilter = r.layer;
      }
      const entries = collectTimelineAudio(project);
      if (entries.length === 0) return "No timeline clips with audio — nothing to mix.";
      const byId = new Map(entries.map((e) => [e.id, e]));

      // Speech sources.
      const explicitSpeech = idList(input.speech_clip_ids ?? "auto");
      let speech: AudioEntry[] = [];
      if (explicitSpeech.length > 0 && !(explicitSpeech.length === 1 && explicitSpeech[0] === "auto")) {
        const missing = explicitSpeech.filter((id) => !byId.has(id));
        if (missing.length > 0) return `Error: no timeline clip with audio for id(s): ${missing.join(", ")}.`;
        speech = explicitSpeech.map((id) => byId.get(id)!);
        for (const entry of speech) {
          if (entry.windows.length > 0) continue;
          const [windows, source] = await fallbackSpeechWindows(call, entry);
          if (windows.length > 0) {
            entry.windows = windows;
            entry.windowSource = source;
          }
        }
      } else {
        speech = entries.filter((e) => e.role === "speech" && e.windows.length > 0);
        if (speech.length === 0) speech = await transcribedSpeech(call, entries);
        if (speech.length === 0) {
          for (const entry of entries) {
            if (entry.windows.length > 0) continue;
            const windows = await vadWindows(call, entry);
            if (windows.length > 0) {
              entry.windows = windows;
              entry.windowSource = "local_vad";
              entry.role = "speech";
              speech.push(entry);
            }
          }
        }
      }
      if (speech.length === 0) {
        const unknown = entries.filter((e) => e.role === "unknown").map((e) => e.id);
        const hint = unknown.length
          ? ` ${unknown.length} clip(s) are not indexed yet (${unknown.slice(0, 5).join(", ")}); index them or pass speech_clip_ids explicitly.`
          : "";
        return `No speech detected on the timeline, so there is nothing to duck under.${hint} Use set_clip_volume_tool for a static level change.`;
      }
      const speechWindows = mergeWindows(speech.flatMap((e) => e.windows));
      if (speechWindows.length === 0) {
        return (
          "Could not resolve any speech time windows for " +
          speech.map((e) => e.id).join(", ") +
          " (no transcript cues and no usable waveform). Index the source, " +
          "or use set_clip_volume_tool with an explicit time range."
        );
      }

      // Beds.
      const speechIds = new Set(speech.map((e) => e.id));
      const warnings: string[] = [];
      let beds: AudioEntry[];
      const explicitBeds = idList(input.bed_clip_ids ?? "");
      if (explicitBeds.length > 0) {
        beds = [];
        for (const id of explicitBeds) {
          const bed = byId.get(id);
          if (!bed) return `Error: no timeline clip with audio for id=${id}.`;
          beds.push(bed);
        }
        for (const bed of beds) {
          if (bed.role === "speech") warnings.push(`WARNING: ${bed.id} carries speech; ducking it will attenuate its own dialogue too.`);
        }
      } else if (text(input.bed_query)) {
        const resolved = await resolveClip(call, { clip_query: input.bed_query, track: input.bed_track });
        if (!resolved.ok) return resolved.error || "Error: Could not resolve the bed clip.";
        const bed = byId.get(String(resolved.clip.id));
        if (!bed) return `Error: timeline clip ${String(resolved.clip.id)} has no audio stream.`;
        beds = [bed];
      } else {
        beds = entries.filter(
          (e) =>
            BED_ROLES.includes(e.role) &&
            !speechIds.has(e.id) &&
            (layerFilter === undefined || e.layer === layerFilter) &&
            clampWindows(speechWindows, e.start, e.end).length > 0,
        );
      }
      if (beds.length === 0) {
        return `No music/SFX bed overlaps the detected speech, so no ducking was needed. Speech windows (timeline s): ${fmtWindows(speechWindows)}`;
      }

      // Envelopes.
      const duckArg = String(input.duck_db ?? "").trim().toLowerCase();
      const fixedGain = duckArg === "" || duckArg === "auto" ? null : dbToGain(floatArg(input.duck_db, DEFAULT_DUCK_DB));
      const speechLevels = speech.map((e) => e.level).filter((l): l is number => l !== null);
      const speechLevel = speechLevels.length > 0 ? Math.min(...speechLevels) : null;
      const env = {
        attack: Math.max(0, (floatArg(input.attack_ms, 150) ?? 0) / 1000),
        release: Math.max(0, (floatArg(input.release_ms, 400) ?? 0) / 1000),
        padBefore: Math.max(0, (floatArg(input.pad_before_ms, 200) ?? 0) / 1000),
        padAfter: Math.max(0, (floatArg(input.pad_after_ms, 300) ?? 0) / 1000),
      };
      const planned: { bed: AudioEntry; points: KeyframePoint[]; held: Window[]; gain: number }[] = [];
      for (const bed of beds) {
        const locked = lockedTrackError(bed.layer, project.layers);
        if (locked) return locked;
        const windows = clampWindows(speechWindows, bed.start, bed.end);
        if (windows.length === 0) continue;
        const gain = fixedGain ?? dbToGain(autoDuckDb(bed.level, speechLevel));
        const points = buildDuckPoints(bed.clip, project.fps, windows, gain, env);
        if (points.length === 0) continue;
        planned.push({ bed, points, held: duckedWindows(bed.clip, windows, env), gain });
      }
      const boostDb = floatArg(input.boost_speech_db, 0) || 0;
      const boosted: { entry: AudioEntry; points: KeyframePoint[] }[] = [];
      if (Math.abs(boostDb) > 1e-6) {
        const boostLevel = dbToGain(boostDb);
        for (const entry of speech) {
          if (lockedTrackError(entry.layer, project.layers)) continue;
          const pts = buildStaticLevelPoints(entry.clip, project.fps, Math.min(MAX_LEVEL, boostLevel));
          if (pts.length > 0) boosted.push({ entry, points: pts });
        }
      }
      if (planned.length === 0 && boosted.length === 0) {
        return "The music/SFX beds do not overlap the detected speech windows, so no volume automation was written.";
      }

      // Report.
      const dryRun = boolArg(input.dry_run);
      const header =
        `${dryRun ? "Would duck" : "Ducked"} ${planned.length} bed clip(s) under ${speech.length} speech clip(s). ` +
        (fixedGain === null
          ? "duck=auto (per bed, from measured levels)"
          : `duck=${signed1(gainToDb(fixedGain))} dB (gain ${pyFixed(fixedGain, 3)})`);
      const lines = [header, ""];
      for (const { bed, points, held, gain } of planned) {
        lines.push(`bed timeline_clip_id=${bed.id} track=${bed.trackLabel} title=${pyReprString(bed.title)}`);
        if (bed.level !== null) {
          lines.push(`  role=${bed.role} base=${pyFixed(bed.level, 2)} -> ${pyFixed(bed.level * gain, 2)} (${signed1(gainToDb(gain))} dB)`);
        } else {
          lines.push(`  role=${bed.role} base=automated (existing curve scaled by ${pyFixed(gain, 3)} under speech)`);
        }
        lines.push(`  ${held.length} duck window(s), ${points.length} volume points`);
        lines.push(`  ducked (timeline s): ${fmtWindows(held)}`);
        const gaps = invertWindows(held, bed.start, bed.end);
        if (gaps.length > 0) lines.push(`  restored (timeline s): ${fmtWindows(gaps)}`);
      }
      if (boosted.length > 0) {
        lines.push(`speech boosted by ${signed1(boostDb)} dB on: ${boosted.map((b) => b.entry.id).join(", ")}`);
      }
      lines.push(
        "speech sources: " +
          speech.map((e) => `${e.id} (${e.windowSource || "declared"}, ${e.windows.length} windows)`).join(", "),
      );
      const skipped = entries.filter((e) => e.role === "unknown");
      if (skipped.length > 0) lines.push("skipped: " + skipped.slice(0, 5).map((e) => `${e.id} role=unknown (not indexed)`).join(", "));
      lines.push(...warnings);
      for (const [a, b] of speechOverlaps(entries)) {
        lines.push(`WARNING: speech clips ${a.id} and ${b.id} overlap; ducking cannot separate two voices — move or trim one.`);
      }
      if (dryRun) {
        lines.push("", "dry_run=true — nothing was written.");
        return lines.join("\n");
      }
      call.commit((tx) => {
        for (const { bed, points } of planned) writeVolumePoints(tx, bed.id, points);
        for (const { entry, points } of boosted) writeVolumePoints(tx, entry.id, points);
      });
      lines.push("", "No clip changed track, position or trim. One undo reverts the whole mix.");
      return lines.join("\n");
    },
  }),
];
