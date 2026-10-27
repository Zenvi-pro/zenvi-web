/**
 * Agent audio mixing and context-aware ducking.
 *
 * Port of zenvi-core src/classes/audio_mix.py (ref b63c39be7). Volume
 * automation is written as clip `volume` keyframe Points whose X is a 1-based
 * clip-source frame, exactly like the desktop's Volume_Triggered:
 * `round(clip.start * fps) + 1` (Python round: ties to even). Speech windows
 * are timeline seconds throughout and become source frames only when points
 * are built.
 */

import { evaluateAtX } from "../keyframe/evaluate.js";
import { pyRound } from "../model/rounding.js";
import { Interpolation, type KeyframePoint } from "../model/types.js";
import { parsePythonFloat } from "./coerce.js";
import { isAudioOnlyMedia } from "./placement.js";
import { pyFixed } from "./pyfmt.js";

export const DEFAULT_DUCK_DB = -12.0;
export const DEFAULT_ATTACK = 0.15;
export const DEFAULT_RELEASE = 0.4;
export const DEFAULT_PAD_BEFORE = 0.2;
export const DEFAULT_PAD_AFTER = 0.3;
export const DEFAULT_RESTORE_MARGIN = 0.25;
export const DEFAULT_ENERGY_THRESHOLD = 0.06;
export const DEFAULT_ENERGY_MIN_RUN = 0.25;
/** An audio-only source at least this long reads as a music bed, not a sting. */
export const MUSIC_MIN_DURATION = 8.0;
/** The 0-130% volume menu range. */
export const MAX_LEVEL = 1.3;
export const AUTO_DUCK_HEADROOM_DB = -12.0;
export const AUTO_DUCK_MIN_DB = -24.0;
export const AUTO_DUCK_MAX_DB = -3.0;
/** A cut inside a spoken phrase may move this far to clear it. */
export const MAX_CUE_SHIFT_SEC = 2.0;
/** Chapter edges pull a cut that is already this close. */
export const CHAPTER_MAGNET_SEC = 0.5;

const EPS = 1e-6;

export type AudioRole = "speech" | "music" | "sfx" | "ambient" | "silent" | "unknown";
export const BED_ROLES: readonly AudioRole[] = ["music", "sfx"];

export type Window = [number, number];
type Data = Record<string, unknown>;

function isRecord(value: unknown): value is Data {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** audio_mix._f: `float(value)` when finite, else `fallback`. */
function f(value: unknown, fallback: number): number;
function f(value: unknown, fallback: null): number | null;
function f(value: unknown, fallback: number | null): number | null {
  let n: number | null;
  if (typeof value === "number") n = value;
  else if (typeof value === "boolean") n = value ? 1 : 0;
  else if (typeof value === "string") n = parsePythonFloat(value);
  else n = null;
  return n !== null && Number.isFinite(n) ? n : fallback;
}

/** Decibels to a linear gain (0 dB -> 1.0). */
export function dbToGain(db: unknown): number {
  return 10 ** (f(db, 0) / 20);
}

/** Linear gain to decibels; 0 or negative floors at -120. */
export function gainToDb(gain: unknown): number {
  const g = f(gain, 0);
  return g <= 0 ? -120 : 20 * Math.log10(g);
}

/** Project fps `{num, den}` (or a number) as a float. */
export function fpsFloat(fps: unknown): number {
  if (isRecord(fps)) {
    const num = f(fps.num, 30);
    const den = f(fps.den, 1);
    return den ? num / den : 30;
  }
  return f(fps, 30) || 30;
}

// ---------------------------------------------------------------------------
// Timeline / source geometry
// ---------------------------------------------------------------------------

/** (first, last) 1-based source frames of a clip, as Volume_Triggered computes them. */
export function clipSourceFrameRange(clip: unknown, fps: unknown): [number, number] {
  const rate = fpsFloat(fps);
  const data = isRecord(clip) ? clip : {};
  const first = pyRound(f(data.start, 0) * rate) + 1;
  let last = pyRound(f(data.end, 0) * rate) + 1;
  if (last < first) last = first;
  return [first, last];
}

/** (start, end) of a placement in timeline seconds. */
export function clipTimelineExtent(clip: unknown): Window {
  const data = isRecord(clip) ? clip : {};
  const pos = f(data.position, 0);
  const dur = Math.max(0, f(data.end, 0) - f(data.start, 0));
  return [pos, pos + dur];
}

/** Timeline seconds to a 1-based source frame, clamped inside the clip. */
export function timelineToSourceFrame(tTimeline: unknown, clip: unknown, fps: unknown): number {
  const data = isRecord(clip) ? clip : {};
  const rate = fpsFloat(fps);
  const sourceSeconds = f(tTimeline, 0) - f(data.position, 0) + f(data.start, 0);
  const frame = pyRound(sourceSeconds * rate) + 1;
  const [first, last] = clipSourceFrameRange(data, fps);
  return Math.max(first, Math.min(last, frame));
}

/** Root-source seconds to timeline seconds for a placement. */
export function sourceToTimelineSeconds(tSource: unknown, clip: unknown): number {
  const data = isRecord(clip) ? clip : {};
  return f(tSource, 0) - f(data.start, 0) + f(data.position, 0);
}

// ---------------------------------------------------------------------------
// Window algebra (timeline seconds)
// ---------------------------------------------------------------------------

/** Sort, drop empty/inverted, and merge windows separated by at most `gap`. */
export function mergeWindows(windows: readonly (readonly unknown[])[] | null | undefined, gap = 0): Window[] {
  const clean: Window[] = [];
  for (const win of windows ?? []) {
    if (!Array.isArray(win) || win.length < 2) continue;
    const s = f(win[0], 0);
    const e = f(win[1], 0);
    if (e - s <= EPS) continue;
    clean.push([s, e]);
  }
  if (clean.length === 0) return [];
  clean.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const g = Math.max(0, f(gap, 0));
  const merged: Window[] = [clean[0]!];
  for (const [s, e] of clean.slice(1)) {
    const last = merged[merged.length - 1]!;
    if (s - last[1] <= g + EPS) merged[merged.length - 1] = [last[0], Math.max(last[1], e)];
    else merged.push([s, e]);
  }
  return merged;
}

/** Intersect windows with [lo, hi]. */
export function clampWindows(windows: readonly Window[] | null | undefined, lo: number, hi: number): Window[] {
  const out: Window[] = [];
  for (const [s, e] of windows ?? []) {
    const s2 = Math.max(f(s, 0), f(lo, 0));
    const e2 = Math.min(f(e, 0), f(hi, 0));
    if (e2 - s2 > EPS) out.push([s2, e2]);
  }
  return out;
}

/** Gaps between windows inside [lo, hi] (where a ducked bed is restored). */
export function invertWindows(windows: readonly Window[] | null | undefined, lo: number, hi: number): Window[] {
  const gaps: Window[] = [];
  let cursor = f(lo, 0);
  for (const [s, e] of mergeWindows(windows ?? [])) {
    if (s - cursor > EPS) gaps.push([cursor, Math.min(s, f(hi, 0))]);
    cursor = Math.max(cursor, e);
  }
  if (f(hi, 0) - cursor > EPS) gaps.push([cursor, f(hi, 0)]);
  return gaps.filter(([s, e]) => e - s > EPS);
}

// ---------------------------------------------------------------------------
// Audio roles
// ---------------------------------------------------------------------------

function readerOf(clip: unknown, file: unknown): Data {
  const data = isRecord(clip) ? clip : {};
  const reader = data.reader;
  if (isRecord(reader) && Object.keys(reader).length > 0) return reader;
  if (isRecord(file)) {
    const nested = file.reader;
    if (isRecord(nested) && Object.keys(nested).length > 0) return nested;
    return file;
  }
  return {};
}

/** Split_Audio_Triggered's predicate: has_audio and channels > 0. */
export function hasAudioStream(clip: unknown, file?: unknown): boolean {
  const reader = readerOf(clip, file);
  const hasAudio = reader.has_audio === undefined || reader.has_audio === null ? true : Boolean(reader.has_audio);
  if (!hasAudio) return false;
  const channels = reader.channels;
  if (channels !== undefined && channels !== null) {
    const n = Math.trunc(Number(channels));
    return Number.isFinite(n) ? n > 0 : true;
  }
  return true;
}

export function hasVideoStream(clip: unknown, file: unknown): boolean {
  const reader = readerOf(clip, file);
  const probe: Data = { ...reader };
  for (const key of ["path", "media_type"]) {
    const value = isRecord(file) ? file[key] : undefined;
    if (value && !probe[key]) probe[key] = value;
  }
  if (isAudioOnlyMedia(probe)) return false;
  const hasVideo = reader.has_video;
  if (hasVideo !== undefined && hasVideo !== null) return Boolean(hasVideo);
  return true;
}

function cuesOf(effective: unknown): Data[] {
  const cues = isRecord(effective) ? effective.transcript_cues : undefined;
  return Array.isArray(cues) ? cues.filter(isRecord) : [];
}

/** Role from existing data, no re-indexing (classify_clip_audio_role). */
export function classifyClipAudioRole(clip: unknown, file?: unknown, effective?: unknown): AudioRole {
  if (!hasAudioStream(clip, file)) return "silent";
  const meta = isRecord(effective) ? effective : {};
  if (cuesOf(meta).length > 0 || meta.has_speech === true) return "speech";
  if (!meta.analyzed) return "unknown";
  if (!hasVideoStream(clip, file)) {
    const data = isRecord(clip) ? clip : {};
    const duration = Math.max(0, f(data.end, 0) - f(data.start, 0));
    return duration >= MUSIC_MIN_DURATION ? "music" : "sfx";
  }
  return "ambient";
}

// ---------------------------------------------------------------------------
// Cue snapping
// ---------------------------------------------------------------------------

/** `cue.get("source_start", cue.get("start"))`-style bounds. */
function cueBounds(cue: Data): Window | null {
  const start = f("source_start" in cue ? cue.source_start : cue.start, null);
  const end = f("source_end" in cue ? cue.source_end : cue.end, null);
  if (start === null || end === null || end <= start) return null;
  return [start, end];
}

/** Move a cut off a spoken line to the nearer cue edge. Returns [cut, cue | null]. */
export function snapCutOutOfSpeech(cutSource: unknown, cues: readonly unknown[], maxShift: number | null = null): [number, Data | null] {
  const cut = f(cutSource, 0);
  for (const cue of cues ?? []) {
    if (!isRecord(cue)) continue;
    const bounds = cueBounds(cue);
    if (!bounds) continue;
    const [start, end] = bounds;
    if (!(start + EPS < cut && cut < end - EPS)) continue;
    const nearer = cut - start <= end - cut ? start : end;
    if (maxShift !== null && Math.abs(nearer - cut) > maxShift) return [cut, null];
    return [nearer, cue];
  }
  return [cut, null];
}

/** Spoken-phrase spans a cut should not land inside. */
export function speechWindows(aiMetadata: unknown): Data[] {
  const meta = isRecord(aiMetadata) ? aiMetadata : {};
  return Array.isArray(meta.transcript_cues) ? meta.transcript_cues.filter(isRecord) : [];
}

/** Sorted scene / song-section boundary times. */
export function chapterEdges(aiMetadata: unknown): number[] {
  const meta = isRecord(aiMetadata) ? aiMetadata : {};
  const edges = new Set<number>();
  for (const ch of Array.isArray(meta.chapters) ? meta.chapters : []) {
    if (!isRecord(ch)) continue;
    for (const key of ["start", "end"]) {
      const value = f(ch[key], null);
      if (value !== null) edges.add(Number(pyFixed(value, 4)));
    }
  }
  return [...edges].sort((a, b) => a - b);
}

/** Fraction of [start, end) spoken phrases occupy. */
export function cueCoverage(cues: readonly unknown[], start: number, end: number): number {
  const span = f(end, 0) - f(start, 0);
  if (span <= 0) return 0;
  let covered = 0;
  for (const cue of cues ?? []) {
    if (!isRecord(cue)) continue;
    const bounds = cueBounds(cue);
    if (!bounds) continue;
    covered += Math.max(0, Math.min(bounds[1], end) - Math.max(bounds[0], start));
  }
  return Math.min(1, covered / span);
}

/** Land a cut on a phrase boundary (snap_cut_to_phrase_edge). */
export function snapCutToPhraseEdge(
  cut: unknown,
  cues: readonly unknown[],
  preferLater: boolean,
  maxShift: number | null = MAX_CUE_SHIFT_SEC,
): [number, Data | null] {
  const value = f(cut, 0);
  for (const cue of cues ?? []) {
    if (!isRecord(cue)) continue;
    const bounds = cueBounds(cue);
    if (!bounds) continue;
    const [c0, c1] = bounds;
    if (!(c0 + EPS < value && value < c1 - EPS)) continue;
    const preferred = preferLater ? c1 : c0;
    if (maxShift === null || Math.abs(preferred - value) <= maxShift) return [preferred, cue];
    return [value - c0 <= c1 - value ? c0 : c1, cue];
  }
  return [value, null];
}

/** Tidy a cut onto a scene break it is already next to. */
export function snapToChapterEdge(cut: unknown, edges: readonly number[], tolerance = CHAPTER_MAGNET_SEC): [number, boolean] {
  const value = f(cut, 0);
  let best: number | null = null;
  for (const edge of edges ?? []) {
    const delta = Math.abs(edge - value);
    if (delta <= tolerance && (best === null || delta < Math.abs(best - value))) best = edge;
  }
  if (best === null || best === value) return [value, false];
  return [best, true];
}

/**
 * Keep a placement window off mid-phrase edges, then align to scene breaks
 * (snap_window_to_boundaries). Never returns an inverted window.
 */
export function snapWindowToBoundaries(start: unknown, end: unknown, aiMetadata: unknown, maxShift = MAX_CUE_SHIFT_SEC): [number, number, boolean] {
  const s0 = f(start, 0);
  const e0 = f(end, 0);
  if (e0 <= s0) return [s0, e0, false];
  const cues = speechWindows(aiMetadata);
  const edges = chapterEdges(aiMetadata);
  const one = (value: number, preferLater: boolean): [number, boolean] => {
    let moved = false;
    let v = value;
    if (cues.length > 0) {
      const [snapped, cue] = snapCutToPhraseEdge(v, cues, preferLater, maxShift);
      v = snapped;
      moved = cue !== null;
    }
    if (edges.length > 0) {
      const [snapped, hit] = snapToChapterEdge(v, edges);
      v = snapped;
      moved = moved || hit;
    }
    return [v, moved];
  };
  const [s1, sMoved] = one(s0, false);
  const [e1, eMoved] = one(e0, true);
  if (e1 <= s1) {
    const [s2, sCue] = snapCutToPhraseEdge(s0, cues, false, null);
    const [e2, eCue] = snapCutToPhraseEdge(e0, cues, true, null);
    if (e2 > s2) return [s2, e2, Boolean(sCue || eCue)];
    return [s0, e0, false];
  }
  return [s1, e1, sMoved || eMoved];
}

// ---------------------------------------------------------------------------
// Speech windows
// ---------------------------------------------------------------------------

/** Transcript cues as timeline windows, clipped to the placement (speech_windows_from_cues). */
export function speechWindowsFromCues(clip: unknown, effective: unknown): Window[] {
  const data = isRecord(clip) ? clip : {};
  const [tlStart, tlEnd] = clipTimelineExtent(data);
  const srcStart = f(data.start, 0);
  const windows: Window[] = [];
  for (const cue of cuesOf(effective)) {
    let s: number;
    let e: number;
    if (cue.source_start !== undefined && cue.source_start !== null) {
      s = f(cue.source_start, 0);
      e = f(cue.source_end, s);
    } else {
      s = f(cue.start, 0) + srcStart;
      e = f(cue.end, 0) + srcStart;
    }
    if (e <= s) continue;
    windows.push([sourceToTimelineSeconds(s, data), sourceToTimelineSeconds(e, data)]);
  }
  return clampWindows(mergeWindows(windows), tlStart, tlEnd);
}

/** Map source-second speech windows (from a VAD) onto a placement's timeline (speech_windows_from_vad). */
export function speechWindowsFromSource(sourceWindows: readonly Window[], clip: unknown): Window[] {
  const data = isRecord(clip) ? clip : {};
  const [tlStart, tlEnd] = clipTimelineExtent(data);
  const srcStart = f(data.start, 0);
  const srcEnd = f(data.end, srcStart);
  const windows: Window[] = [];
  for (const [s, e] of sourceWindows) {
    const s2 = Math.max(s, srcStart);
    const e2 = Math.min(e, srcEnd);
    if (e2 <= s2) continue;
    windows.push([sourceToTimelineSeconds(s2, data), sourceToTimelineSeconds(e2, data)]);
  }
  return clampWindows(mergeWindows(windows), tlStart, tlEnd);
}

/** Loud runs in the clip's cached waveform (`ui.audio_data`), timeline windows. */
export function speechWindowsFromEnergy(
  clip: unknown,
  threshold = DEFAULT_ENERGY_THRESHOLD,
  minRun = DEFAULT_ENERGY_MIN_RUN,
): Window[] {
  const data = isRecord(clip) ? clip : {};
  const ui = isRecord(data.ui) ? data.ui : {};
  const samples = Array.isArray(ui.audio_data) ? ui.audio_data : [];
  if (samples.length < 2) return [];
  const [tlStart, tlEnd] = clipTimelineExtent(data);
  const span = tlEnd - tlStart;
  if (span <= EPS) return [];
  const values = samples.map((s) => Math.abs(f(s, 0)));
  const peak = Math.max(...values);
  if (peak <= EPS) return [];
  const gate = peak * Math.max(0, f(threshold, DEFAULT_ENERGY_THRESHOLD));
  const step = span / values.length;
  const windows: Window[] = [];
  let runStart: number | null = null;
  values.forEach((val, i) => {
    if (val >= gate) {
      if (runStart === null) runStart = i;
    } else if (runStart !== null) {
      windows.push([tlStart + runStart * step, tlStart + i * step]);
      runStart = null;
    }
  });
  if (runStart !== null) windows.push([tlStart + runStart * step, tlEnd]);
  const run = Math.max(0, f(minRun, DEFAULT_ENERGY_MIN_RUN));
  return mergeWindows(windows, run).filter(([s, e]) => e - s >= run);
}

/** Trim dead lead/tail off cue windows with waveform energy (refine_windows_with_energy). */
export function refineWindowsWithEnergy(
  windows: readonly Window[],
  clip: unknown,
  threshold = DEFAULT_ENERGY_THRESHOLD,
  minRun = DEFAULT_ENERGY_MIN_RUN,
): Window[] {
  const base = mergeWindows(windows);
  if (base.length === 0) return base;
  const energetic = speechWindowsFromEnergy(clip, threshold, minRun);
  if (energetic.length === 0) return base;
  const refined: Window[] = [];
  for (const [s, e] of base) {
    const parts = clampWindows(energetic, s, e);
    refined.push(...(parts.length > 0 ? parts : [[s, e] as Window]));
  }
  return mergeWindows(refined);
}

// ---------------------------------------------------------------------------
// Volume curve
// ---------------------------------------------------------------------------

/** A volume Point (LINEAR: bezier handles on a duck ramp can overshoot). */
export function makePoint(x: unknown, y: unknown, interpolation: number = Interpolation.LINEAR): KeyframePoint {
  return {
    co: { X: pyRound(f(x, 1)), Y: Math.max(0, f(y, 1)) },
    interpolation: Math.trunc(interpolation) as KeyframePoint["interpolation"],
  };
}

/** Existing volume Points, sorted by X. */
export function curvePoints(clip: unknown): KeyframePoint[] {
  const volume = isRecord(clip) ? clip.volume : undefined;
  const points = isRecord(volume) ? volume.Points : undefined;
  if (!Array.isArray(points)) return [];
  return (points.filter((p) => isRecord(p) && isRecord(p.co)) as KeyframePoint[])
    .map((p, i) => ({ p, i }))
    .sort((a, b) => f(a.p.co.X, 0) - f(b.p.co.X, 0) || a.i - b.i)
    .map(({ p }) => p);
}

/**
 * Value of a volume curve at source frame x, interpolated the way libopenshot
 * plays it (libopenshot/src/KeyFrame.cpp:36-95 `InterpolateBetween`: each
 * segment takes the right point's linear / bezier / constant shape; ported in
 * keyframe/evaluate.ts), so a relative change rides the curve the desktop
 * hears. zenvi-core audio_mix.py reads every segment as linear; on linear
 * curves (what the duck tools write) the two agree.
 */
export function evaluateVolumeCurve(points: readonly KeyframePoint[], x: unknown, fallback = 1.0): number {
  const pts = (points ?? []).filter((p) => isRecord(p) && isRecord(p.co));
  if (pts.length === 0) return f(fallback, 1);
  return evaluateAtX({ Points: pts }, f(x, 1));
}

/** dB of attenuation that sits a bed `headroomDb` under the speech (auto_duck_db). */
export function autoDuckDb(
  bedLevel: number | null | undefined,
  speechLevel: number | null | undefined = null,
  headroomDb = AUTO_DUCK_HEADROOM_DB,
  floorDb = AUTO_DUCK_MIN_DB,
  ceilingDb = AUTO_DUCK_MAX_DB,
): number {
  const bed = bedLevel && bedLevel > 0 ? bedLevel : 1;
  const speech = speechLevel && speechLevel > 0 ? speechLevel : 1;
  const needed = gainToDb(speech) - Math.abs(headroomDb) - gainToDb(bed);
  return Math.max(floorDb, Math.min(ceilingDb, needed));
}

/** The clip's level when it is a flat gain, else null (an automated curve). */
export function currentStaticLevel(clip: unknown): number | null {
  const pts = curvePoints(clip);
  if (pts.length === 0) return 1.0;
  // Python round(y, 6) in a set.
  const values = new Set(pts.map((p) => Number(pyFixed(f(p.co.Y, 1), 6))));
  return values.size === 1 ? [...values][0]! : null;
}

export interface DuckEnvelope {
  attack?: number;
  release?: number;
  padBefore?: number;
  padAfter?: number;
}

/** Speech windows padded, merged (no pumping between sentences) and clipped to the clip (ducked_windows). */
export function duckedWindows(clip: unknown, windows: readonly Window[], env: DuckEnvelope = {}): Window[] {
  const data = isRecord(clip) ? clip : {};
  const attack = env.attack ?? DEFAULT_ATTACK;
  const release = env.release ?? DEFAULT_RELEASE;
  const padBefore = env.padBefore ?? DEFAULT_PAD_BEFORE;
  const padAfter = env.padAfter ?? DEFAULT_PAD_AFTER;
  const [tlStart, tlEnd] = clipTimelineExtent(data);
  const padded: Window[] = mergeWindows(windows).map(([s, e]) => [s - Math.max(0, padBefore), e + Math.max(0, padAfter)]);
  const gap = Math.max(0, attack) + Math.max(0, release) + DEFAULT_RESTORE_MARGIN;
  return clampWindows(mergeWindows(padded, gap), tlStart, tlEnd);
}

/**
 * Volume Points that duck a bed under speech and restore it between
 * (build_duck_points). Existing automation rides along: boundaries follow the
 * current curve and existing points inside a duck window are scaled.
 */
export function buildDuckPoints(clip: unknown, fps: unknown, windows: readonly Window[], duckGain: number, env: DuckEnvelope = {}): KeyframePoint[] {
  const data = isRecord(clip) ? clip : {};
  const attack = env.attack ?? DEFAULT_ATTACK;
  const release = env.release ?? DEFAULT_RELEASE;
  const [first, last] = clipSourceFrameRange(data, fps);
  const padded = duckedWindows(data, windows, env);
  if (padded.length === 0) return [];
  const existing = curvePoints(data);
  const gain = Math.max(0, f(duckGain, 1));
  const baseAt = (frame: number): number => evaluateVolumeCurve(existing, frame, 1.0);

  const ducked = new Map<number, number>();
  const unity = new Map<number, number>();
  for (const [s, e] of padded) {
    const fs = timelineToSourceFrame(s, data, fps);
    const fe = timelineToSourceFrame(e, data, fps);
    let fIn = timelineToSourceFrame(s - Math.max(0, attack), data, fps);
    let fOut = timelineToSourceFrame(e + Math.max(0, release), data, fps);
    if (fIn >= fs && fs > first) fIn = fs - 1;
    if (fOut <= fe && fe < last) fOut = fe + 1;
    unity.set(fIn, baseAt(fIn));
    unity.set(fOut, baseAt(fOut));
    for (const frame of [fs, fe]) ducked.set(frame, baseAt(frame) * gain);
  }
  const spans: Window[] = padded.map(([s, e]) => [timelineToSourceFrame(s, data, fps), timelineToSourceFrame(e, data, fps)]);
  for (const point of existing) {
    const frame = pyRound(f(point.co.X, 1));
    if (ducked.has(frame) || unity.has(frame)) continue;
    const value = f(point.co.Y, 1);
    if (spans.some(([fs, fe]) => fs <= frame && frame <= fe)) ducked.set(frame, value * gain);
    else unity.set(frame, value);
  }
  const merged = new Map(unity);
  for (const [frame, value] of ducked) merged.set(frame, value);
  return [...merged.keys()].sort((a, b) => a - b).map((frame) => makePoint(frame, merged.get(frame)));
}

/**
 * Points for a flat gain over the whole clip, or over one timeline window
 * with `fade`-second ramps (build_static_level_points). `scale` multiplies
 * the existing curve instead of replacing it.
 */
export function buildStaticLevelPoints(
  clip: unknown,
  fps: unknown,
  level: number,
  options: { startSeconds?: number | null; endSeconds?: number | null; fade?: number; scale?: boolean } = {},
): KeyframePoint[] {
  const data = isRecord(clip) ? clip : {};
  const [first, last] = clipSourceFrameRange(data, fps);
  const target = Math.max(0, Math.min(MAX_LEVEL, f(level, 1)));
  const existing = curvePoints(data);
  const valueAt = (frame: number): number =>
    options.scale ? Math.max(0, evaluateVolumeCurve(existing, frame, 1.0) * target) : target;

  const startSeconds = options.startSeconds ?? null;
  const endSeconds = options.endSeconds ?? null;
  if (startSeconds === null && endSeconds === null) return [makePoint(first, valueAt(first))];

  const [tlStart, tlEnd] = clipTimelineExtent(data);
  const s0 = startSeconds !== null ? f(startSeconds, tlStart) : tlStart;
  const e0 = endSeconds !== null ? f(endSeconds, tlEnd) : tlEnd;
  const window = clampWindows([[s0, e0]], tlStart, tlEnd);
  if (window.length === 0) return [];
  const [s, e] = window[0]!;
  const fade = Math.max(0, f(options.fade ?? 0.15, 0));
  const fs = timelineToSourceFrame(s, data, fps);
  const fe = timelineToSourceFrame(e, data, fps);
  let fIn = timelineToSourceFrame(s - fade, data, fps);
  let fOut = timelineToSourceFrame(e + fade, data, fps);
  if (fIn >= fs && fs > first) fIn = fs - 1;
  if (fOut <= fe && fe < last) fOut = fe + 1;
  const frames = new Map<number, number>();
  for (const frame of [fIn, fOut]) frames.set(frame, evaluateVolumeCurve(existing, frame, 1.0));
  for (const frame of [fs, fe]) frames.set(frame, valueAt(frame));
  return [...frames.keys()].sort((a, b) => a - b).map((frame) => makePoint(frame, frames.get(frame)));
}
