/**
 * Speech timing helpers: energy VAD, silence ranges, word-range cuts,
 * caption phrasing and SRT/VTT.
 *
 * Ports of zenvi-core (ref b63c39be7) src/classes/speech/vad.py (EnergyVad,
 * silence_ranges_from_speech), speech/word_ranges.py, speech/captions.py and
 * agent_tools/present.py (words_to_script). The VAD runs on the RMS
 * envelope a host measures (`AudioHost.analyzeAudio`), frame for frame like
 * the desktop's EnergyVad on its 16 kHz mono extract.
 */

import { snap, toFrame, toSeconds, type Fps } from "./frame-time.js";
import type { AudioEnvelope } from "./types.js";

export type Range = [number, number];

// ---------------------------------------------------------------------------
// vad.py
// ---------------------------------------------------------------------------

export interface VadOptions {
  minSpeechSec?: number;
  minSilenceSec?: number;
  /** Frames at or above peak * ratio count as speech (EnergyVad speech_ratio). */
  speechRatio?: number;
}

/** EnergyVad.speech_windows on a measured envelope: speech [start, end) windows, source seconds. */
export function energyVadWindows(envelope: AudioEnvelope, options: VadOptions = {}): Range[] {
  const minSpeech = options.minSpeechSec ?? 0.15;
  const minSilence = options.minSilenceSec ?? 0.35;
  const ratio = options.speechRatio ?? 0.35;
  const energies = Array.from(envelope.rms, (v) => (Number.isFinite(v) ? Number(v) : 0));
  if (energies.length === 0) return [];
  const frame = Math.max(1, Math.trunc(envelope.frameSize));
  const rate = envelope.sampleRate > 0 ? envelope.sampleRate : 16000;
  const peak = Math.max(...energies) || 1e-9;
  const threshold = peak * ratio;
  const mask = energies.map((e) => e >= threshold);
  const windows: Range[] = [];
  let i = 0;
  while (i < mask.length) {
    if (!mask[i]) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < mask.length && mask[j]) j += 1;
    const start = (i * frame) / rate;
    const end = (j * frame) / rate;
    if (end - start >= minSpeech) windows.push([start, end]);
    i = j;
  }
  if (windows.length === 0) return [];
  const merged: Range[] = [windows[0]!];
  for (const [s, e] of windows.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (s - last[1] < minSilence) merged[merged.length - 1] = [last[0], e];
    else merged.push([s, e]);
  }
  return merged;
}

/** Removable silence between speech windows, keeping `padSec` around speech (silence_ranges_from_speech). */
export function silenceRangesFromSpeech(speech: readonly Range[], duration: number, minPauseSec: number, padSec = 0.05): Range[] {
  const dur = Number(duration);
  if (!(dur > 0)) return [];
  const padded: Range[] = speech.map(([s, e]) => [Math.max(0, s - padSec), Math.min(dur, e + padSec)]);
  if (padded.length === 0) return dur >= minPauseSec ? [[0, dur]] : [];
  padded.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Range[] = [padded[0]!];
  for (const [s, e] of padded.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (s <= last[1]) merged[merged.length - 1] = [last[0], Math.max(last[1], e)];
    else merged.push([s, e]);
  }
  const gaps: Range[] = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s - cursor >= minPauseSec) gaps.push([cursor, s]);
    cursor = e;
  }
  if (dur - cursor >= minPauseSec) gaps.push([cursor, dur]);
  return gaps;
}

// ---------------------------------------------------------------------------
// word_ranges.py
// ---------------------------------------------------------------------------

export const FILLER_PRESETS: Readonly<Record<string, ReadonlySet<string>>> = {
  um_uh: new Set(["um", "uh", "umm", "uhh", "uhm"]),
  english_fillers: new Set(["um", "uh", "umm", "uhh", "uhm", "er", "ah", "like", "youknow", "you", "know"]),
};

/** Lowercase letters and digits only (word_ranges.normalize_word). */
export function normalizeWord(value: string): string {
  return Array.from(String(value ?? "").toLowerCase())
    .filter((ch) => /[\p{L}\p{N}]/u.test(ch))
    .join("");
}

/** Merge overlapping or touching frame-snapped source ranges (merge_ranges). */
export function mergeRanges(ranges: readonly Range[], fps: Fps): Range[] {
  const cleaned: Range[] = [];
  for (const [a, b] of ranges) {
    const s0 = Number(a);
    const e0 = Number(b);
    if (!Number.isFinite(s0) || !Number.isFinite(e0) || !(e0 > s0)) continue;
    const s = snap(s0, fps);
    let e = snap(e0, fps);
    if (e <= s) e = toSeconds(toFrame(s, fps) + 1, fps);
    cleaned.push([s, e]);
  }
  if (cleaned.length === 0) return [];
  cleaned.sort((x, y) => x[0] - y[0]);
  const out: Range[] = [cleaned[0]!];
  for (const [s, e] of cleaned.slice(1)) {
    const last = out[out.length - 1]!;
    if (s <= last[1] + 1e-9) out[out.length - 1] = [last[0], Math.max(last[1], e)];
    else out.push([s, e]);
  }
  return out;
}

export interface TimedWord {
  index: number;
  text: string;
  startSec: number;
  endSec: number;
  startFrame?: number;
  endFrame?: number;
  [key: string]: unknown;
}

/** Source ranges covering the given word indices (ranges_for_word_indices). */
export function rangesForWordIndices(words: readonly TimedWord[], indices: Iterable<number>, fps: Fps): Range[] {
  const byIndex = new Map(words.map((w) => [Math.trunc(Number(w.index)), w]));
  const ranges: Range[] = [];
  for (const raw of indices) {
    const w = byIndex.get(Math.trunc(Number(raw)));
    if (!w) continue;
    const s = Number(w.startSec);
    const e = Number(w.endSec);
    if (e > s) ranges.push([s, e]);
  }
  return mergeRanges(ranges, fps);
}

export function indicesForFillerPreset(words: readonly TimedWord[], preset: string): number[] {
  const bag = FILLER_PRESETS[preset];
  if (!bag) return [];
  return words.filter((w) => bag.has(normalizeWord(w.text))).map((w) => Math.trunc(Number(w.index)));
}

/** Indices whose normalized text equals a match token (indices_for_matches). */
export function indicesForMatches(words: readonly TimedWord[], matches: readonly string[]): number[] {
  const bag = new Set(matches.map(normalizeWord).filter(Boolean));
  if (bag.size === 0) return [];
  return words
    .filter((w) => {
      const token = normalizeWord(w.text);
      return token !== "" && bag.has(token);
    })
    .map((w) => Math.trunc(Number(w.index)));
}

/** [timeline position, source start, source end] per kept fragment. */
export type Fragment = [number, number, number];

/**
 * Remove `removeRanges` from a clip and pack what is left back to back from
 * its position (compact_fragments_after_remove). Returns the fragments and
 * the seconds removed.
 */
export function compactFragmentsAfterRemove(
  position: number,
  start: number,
  end: number,
  removeRanges: readonly Range[],
  fps: Fps,
): { fragments: Fragment[]; removed: number } {
  const clipStart = snap(start, fps);
  const clipEnd = snap(end, fps);
  if (clipEnd <= clipStart) return { fragments: [], removed: 0 };
  const merged = mergeRanges(
    removeRanges.filter(([a, b]) => b > a).map(([a, b]) => [Math.max(clipStart, a), Math.min(clipEnd, b)] as Range),
    fps,
  );
  const kept: Range[] = [];
  let cursor = clipStart;
  for (const [s, e] of merged) {
    if (s > cursor) kept.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < clipEnd) kept.push([cursor, clipEnd]);
  const originalDur = toSeconds(toFrame(clipEnd, fps) - toFrame(clipStart, fps), fps);
  if (kept.length === 0) return { fragments: [], removed: originalDur };
  const fragments: Fragment[] = [];
  let pos = snap(position, fps);
  let keptDur = 0;
  for (const [s, e] of kept) {
    if (toFrame(e, fps) <= toFrame(s, fps)) continue;
    fragments.push([pos, s, e]);
    const dur = toSeconds(toFrame(e, fps) - toFrame(s, fps), fps);
    keptDur += dur;
    pos = snap(pos + dur, fps);
  }
  return { fragments, removed: Math.max(0, originalDur - keptDur) };
}

// ---------------------------------------------------------------------------
// map_timeline.py
// ---------------------------------------------------------------------------

/** Playback speed multiplier; 1 when unset or invalid (map_timeline.clip_speed). */
export function clipSpeed(clip: Readonly<Record<string, unknown>>): number {
  const time = clip.time;
  if (typeof time === "number" && time > 0) return time;
  const speed = Number(clip.speed);
  return clip.speed !== undefined && clip.speed !== null && Number.isFinite(speed) && speed > 0 ? speed : 1;
}

/**
 * True when `clip.time` is a no-op: forward at 1x, `tolerance` frames off the
 * 1:1 line at most (zenvi-core export_acceleration/smart_render.py
 * `_time_curve_is_identity`).
 */
export function timeCurveIsIdentity(curve: unknown, tolerance = 1): boolean {
  if (curve === undefined || curve === null) return true;
  if (typeof curve === "string") return ["TIME_MAP_FORWARD", "none", "", "0"].includes(curve);
  if (typeof curve === "number") return curve === 0 || curve === 1;
  if (typeof curve !== "object" || Array.isArray(curve)) return false;
  const data = curve as Record<string, unknown>;
  const points = (data.Points ?? data.points ?? []) as unknown;
  if (!Array.isArray(points) || points.length === 0) return true;
  const coords: [number, number][] = [];
  for (const point of points) {
    const co = (typeof point === "object" && point !== null ? (point as { co?: Record<string, unknown> }).co : undefined) ?? {};
    const x = Number(co.X ?? co.x ?? 0);
    const y = Number(co.Y ?? co.y ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    coords.push([x, y]);
  }
  if (coords.length === 1) {
    const [x, y] = coords[0]!;
    return Math.abs(y - 1) <= 1e-3 || Math.abs(y - x) <= tolerance + 1e-6;
  }
  coords.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < coords.length; i += 1) if (coords[i]![1] + 1e-6 < coords[i - 1]![1]) return false;
  return coords.every(([x, y]) => Math.abs(y - x) <= tolerance + 1e-6);
}

/**
 * True when the clip plays at another speed or through a time curve
 * (map_timeline.is_retimed). Exact: a one-frame hold shifts every later word.
 */
export function isRetimed(clip: Readonly<Record<string, unknown>>): boolean {
  return Math.abs(clipSpeed(clip) - 1) > 1e-9 || !timeCurveIsIdentity(clip.time, 0);
}

/** Source seconds to timeline seconds on a placement (map_timeline.source_to_timeline_sec). */
export function sourceToTimelineSec(sourceSec: number, position: number, start: number, speed = 1): number {
  const rate = speed > 0 ? speed : 1;
  return position + (sourceSec - start) / rate;
}

// ---------------------------------------------------------------------------
// captions.py
// ---------------------------------------------------------------------------

export interface CaptionCue {
  text: string;
  startFrame: number;
  endFrame: number;
  startSec: number;
  endSec: number;
  wordIndices?: number[];
}

type PhraseWord = TimedWord & { timelineStartSec?: number; timelineEndSec?: number };

/** A word's start or end on the timeline (captions.py `_timeline_sec`). */
function timelineSec(word: PhraseWord, edge: "Start" | "End", fps: Fps): number {
  const sec = edge === "Start" ? word.timelineStartSec : word.timelineEndSec;
  if (sec !== undefined && sec !== null) return Number(sec);
  const frame = edge === "Start" ? word.startFrame : word.endFrame;
  if (frame !== undefined && frame !== null) return toSeconds(Math.trunc(frame), fps);
  return Number((edge === "Start" ? word.startSec : word.endSec) || 0);
}

/**
 * Group word rows into caption cues in timeline frames (zenvi-core develop
 * speech/captions.py phrase_words). Pauses are measured on the timeline:
 * source time restarts in each clip and skips the words a cut removed.
 */
export function phraseWords(
  words: readonly PhraseWord[],
  fps: Fps,
  options: { maxWords?: number; maxChars?: number; maxGapSec?: number } = {},
): CaptionCue[] {
  const maxWords = options.maxWords ?? 8;
  const maxChars = options.maxChars ?? 42;
  const maxGap = options.maxGapSec ?? 0.8;
  const cues: CaptionCue[] = [];
  let bucket: PhraseWord[] = [];
  const flush = (): void => {
    if (bucket.length === 0) return;
    const body = bucket.map((w) => String(w.text ?? "").trim()).join(" ").trim();
    if (!body) {
      bucket = [];
      return;
    }
    const first = bucket[0]!;
    const last = bucket[bucket.length - 1]!;
    const startF = first.startFrame !== undefined && first.startFrame !== null
      ? Math.trunc(first.startFrame)
      : toFrame(timelineSec(first, "Start", fps), fps);
    let endF = last.endFrame !== undefined && last.endFrame !== null
      ? Math.trunc(last.endFrame)
      : toFrame(timelineSec(last, "End", fps), fps);
    if (endF <= startF) endF = startF + 1;
    cues.push({
      text: body,
      startFrame: startF,
      endFrame: endF,
      startSec: toSeconds(startF, fps),
      endSec: toSeconds(endF, fps),
      wordIndices: bucket.filter((w) => "index" in w).map((w) => Math.trunc(Number(w.index))),
    });
    bucket = [];
  };
  for (const w of words) {
    const t = String(w.text ?? "").trim();
    if (!t) continue;
    if (bucket.length === 0) {
      bucket = [w];
      continue;
    }
    const prev = bucket[bucket.length - 1]!;
    // Timeline time: source time restarts in each clip and skips cut words.
    const gap = timelineSec(w, "Start", fps) - timelineSec(prev, "End", fps);
    const chars = Array.from(bucket.map((x) => String(x.text ?? "")).join(" ") + " " + t).length;
    if (gap > maxGap || bucket.length >= maxWords || chars > maxChars) {
      flush();
      bucket = [w];
    } else bucket.push(w);
  }
  flush();
  return cues;
}

function tsSrt(seconds: number): string {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(milli).padStart(3, "0")}`;
}

function cueTimes(cue: CaptionCue, fps: Fps): Range {
  const t0 = cue.startSec;
  let t1 = cue.endSec;
  if (t1 <= t0) t1 = t0 + toSeconds(1, fps);
  return [t0, t1];
}

export function cuesToSrt(cues: readonly CaptionCue[], fps: Fps): string {
  const lines: string[] = [];
  cues.forEach((cue, i) => {
    const [t0, t1] = cueTimes(cue, fps);
    lines.push(String(i + 1), `${tsSrt(t0)} --> ${tsSrt(t1)}`, String(cue.text ?? "").trim(), "");
  });
  return lines.length > 0 ? lines.join("\n").trimEnd() + "\n" : "";
}

export function cuesToVtt(cues: readonly CaptionCue[], fps: Fps): string {
  const out = ["WEBVTT", ""];
  for (const cue of cues) {
    const [t0, t1] = cueTimes(cue, fps);
    out.push(`${tsSrt(t0).replace(",", ".")} --> ${tsSrt(t1).replace(",", ".")}`, String(cue.text ?? "").trim(), "");
  }
  return out.join("\n");
}

const TIME_RE = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function parseTs(h: string, m: string, s: string, frac: string): number {
  const milli = Number.parseInt((frac + "000").slice(0, 3), 10);
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + milli / 1000;
}

/** SRT or VTT to frame-snapped cues (parse_srt_or_vtt). */
export function parseSrtOrVtt(text: string, fps: Fps): CaptionCue[] {
  let body = text.replace(/^\uFEFF/, "");
  if (body.trimStart().toUpperCase().startsWith("WEBVTT")) body = body.replace(/^WEBVTT[^\n]*\n/i, "");
  const cues: CaptionCue[] = [];
  for (const block of body.trim().split(/\n\s*\n/)) {
    let lines = block.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
    if (lines.length === 0) continue;
    if (/^\d+$/.test(lines[0]!) && lines.length >= 2) lines = lines.slice(1);
    const m = TIME_RE.exec(lines[0]!);
    if (!m) continue;
    const t0 = snap(parseTs(m[1]!, m[2]!, m[3]!, m[4]!), fps);
    let t1 = snap(parseTs(m[5]!, m[6]!, m[7]!, m[8]!), fps);
    if (t1 <= t0) t1 = toSeconds(toFrame(t0, fps) + 1, fps);
    const caption = lines.slice(1).join(" ").trim();
    if (!caption) continue;
    cues.push({ text: caption, startSec: t0, endSec: t1, startFrame: toFrame(t0, fps), endFrame: toFrame(t1, fps) });
  }
  return cues;
}

// ---------------------------------------------------------------------------
// present.py
// ---------------------------------------------------------------------------

/** Words joined into a readable script, paragraph breaks at sentence ends (words_to_script). */
export function wordsToScript(words: readonly { text?: unknown }[]): string {
  const texts = words.map((w) => String(w.text ?? "").trim()).filter(Boolean);
  if (texts.length === 0) return "";
  const parts: string[] = [];
  let buf: string[] = [];
  texts.forEach((token, i) => {
    buf.push(token);
    const ends = ".!?".includes(token[token.length - 1]!);
    const next = texts[i + 1] ?? "";
    const nextCap = next !== "" && next[0] !== next[0]!.toLowerCase() && next[0] === next[0]!.toUpperCase();
    if (ends && nextCap) {
      parts.push(buf.join(" "));
      buf = [];
    }
  });
  if (buf.length > 0) parts.push(buf.join(" "));
  return parts.join("\n\n");
}
