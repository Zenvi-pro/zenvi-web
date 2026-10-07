/**
 * Placement helpers: source windows, trim bounds, time arguments, media kinds.
 *
 * Ports of zenvi-core src/classes/clip_placement.py and
 * src/classes/image_types.py (ref b63c39be7).
 */

import { parsePythonFloat } from "./coerce.js";
import { quantizeSpan, type Fps } from "./frame-time.js";
import { pyFloat, pyRepr } from "./pyfmt.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Python float(x) for JSON numbers / numeric strings; null otherwise. */
function float(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return parsePythonFloat(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  return null;
}

/** `float(x or 0)`. */
function orZero(value: unknown): number {
  if (!value) return 0;
  return float(value) ?? 0;
}

// image_types.py lives in model/media.ts (one copy for the engine).
export { isAudioOnlyMedia, isAudioPath } from "../model/media.js";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);

/** clip_placement.file_looks_like_image. */
export function fileLooksLikeImage(file: unknown): boolean {
  const data = isRecord(file) ? file : {};
  if (String(data.media_type ?? "").toLowerCase() === "image") return true;
  const path = String(data.path || data.name || "");
  const ext = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "";
  return IMAGE_EXTS.has(ext);
}

// ---------------------------------------------------------------------------
// clip_placement.py
// ---------------------------------------------------------------------------

export const WATCH_MAX_WINDOW_SEC = 45.0;
export const DEFAULT_WATCH_QUERY = "the main visible action in this clip";

/** Snap placement start/end (and optionally position) to project frames. */
export function quantizePlacementSeconds(start: number, end: number, fps: Fps): [number, number] {
  const [, s, e] = quantizeSpan(0, start || 0, end || 0, fps);
  return [s, e];
}

/** A file's source window: its own start/end (subclips), else 0..duration (source_window_for_file). */
export function sourceWindowForFile(file: unknown, eps = 1e-3): [number, number] {
  const data = isRecord(file) ? file : {};
  const fStart = orZero(data.start);
  const fEnd = orZero(data.end);
  if (fEnd > fStart + eps) return [fStart, fEnd];
  let fileDur = orZero(data.duration);
  if (fileDur <= fStart + eps) {
    const reader = isRecord(data.reader) ? data.reader : {};
    fileDur = orZero(reader.duration);
  }
  if (fileDur > fStart + eps) return [fStart, fileDur];
  return [fStart, fStart + 0.1];
}

/** Source start/end for a placement trimmed to `trimDur` (compute_clip_trim_bounds). */
export function computeClipTrimBounds(
  sourceLen: number,
  options: { trimStart?: number; trimDur: number; fileStart?: number; minDuration?: number },
): [number, number] {
  const len = Math.max(0, sourceLen || 0);
  const trimStart = Math.max(0, options.trimStart || 0);
  const trimDur = Math.max(0, options.trimDur || 0);
  const fileStart = options.fileStart || 0;
  const minDuration = options.minDuration ?? 1 / 30;
  let startSec = fileStart + trimStart;
  let endSec: number;
  if (len > 0) {
    const maxEnd = fileStart + len;
    if (startSec > maxEnd) startSec = maxEnd;
    endSec = Math.min(startSec + trimDur, maxEnd);
  } else {
    endSec = startSec + trimDur;
  }
  if (endSec <= startSec) endSec = startSec + Math.max(minDuration, 1e-3);
  return [startSec, endSec];
}

/**
 * A planned position this close to where the clip before it was planned to
 * end was planned against that clip (clip_placement.py
 * PLANNED_POSITION_TOLERANCE_SEC, zenvi-core #168).
 */
export const PLANNED_POSITION_TOLERANCE_SEC = 0.1;

/** Where a resized placement was planned to end, and where it really ends (timeline seconds). */
export interface ResizedPlacement {
  plannedEnd: number;
  actualEnd: number;
}

/**
 * Timeline position that closes the gap or overlap a resized clip left
 * behind (clip_placement.py `butt_against_previous_clip`). Snapping a
 * placement onto phrase edges, or a watch trimming it, changes its length
 * after the caller planned where the next clip goes; a position on one of
 * those planned ends moves to where that clip really ends. Any other
 * position, a deliberate gap or overlap included, is kept.
 */
export function buttAgainstPreviousClip(
  position: number,
  resized: readonly ResizedPlacement[],
  tolerance = PLANNED_POSITION_TOLERANCE_SEC,
): number {
  let best: { miss: number; end: number } | null = null;
  for (const r of resized) {
    const miss = Math.abs(position - r.plannedEnd);
    if (miss <= tolerance && (best === null || miss < best.miss)) best = { miss, end: r.actualEnd };
  }
  return best ? best.end : position;
}

/**
 * A duration_seconds this close to end_seconds - start_seconds names the same
 * out-point (clip_placement.py KEEP_WINDOW_AGREE_SEC).
 */
export const KEEP_WINDOW_AGREE_SEC = 0.05;

/**
 * True when end_seconds sets the out-point of a placement
 * (clip_placement.py `end_bounds_keep_window`): duration_seconds wins when
 * both are given, so an end_seconds it overrides is a leftover argument; one
 * that agrees with start + duration names the same out-point.
 */
export function endBoundsKeepWindow(
  trimStart: number | null,
  trimDur: number | null,
  trimEnd: number | null,
  tolerance = KEEP_WINDOW_AGREE_SEC,
): boolean {
  if (trimEnd === null) return false;
  if (trimDur === null) return true;
  return Math.abs(trimEnd - (trimStart || 0) - trimDur) <= tolerance;
}

/**
 * True when a trim has no boundary behind it at all
 * (clip_placement.py `blind_trim_rejected`): only a blind "keep the first N
 * seconds" duration trim on a full file is refused. A watch, an explicit
 * start_seconds or an end_seconds that sets the out-point all bound the
 * window; audio, images and subclips are exempt. Times written only in the
 * query never count.
 */
export function blindTrimRejected(options: {
  trimDur: number | null;
  watchedStart: number | null;
  hasExplicitEnd?: boolean;
  hasExplicitStart?: boolean;
  isAudio?: boolean;
  isImage?: boolean;
  isSubclip?: boolean;
}): boolean {
  if (options.watchedStart !== null || options.hasExplicitEnd || options.hasExplicitStart) return false;
  if (options.isAudio || options.isImage || options.isSubclip) return false;
  const span = options.trimDur ?? 0;
  return Number.isFinite(span) && span > 0;
}

/** Seconds for "SS", "M:SS" or "H:M:SS" (parse_timecode_token). */
export function parseTimecodeToken(token: unknown): number | null {
  if (typeof token === "number") return Number.isFinite(token) ? token : null;
  if (typeof token !== "string") return null;
  const t = token.trim();
  if (!t) return null;
  if (!t.includes(":")) return parsePythonFloat(t);
  const parts = t.split(":");
  if (parts.length > 3) return null;
  const nums: number[] = [];
  for (const part of parts) {
    const v = parsePythonFloat(part);
    if (v === null) return null;
    nums.push(v);
  }
  if (nums.length === 2) return nums[0]! * 60 + nums[1]!;
  return nums[0]! * 3600 + nums[1]! * 60 + nums[2]!;
}

const SECONDS_SUFFIXES = ["seconds", "second", "secs", "sec", "s"];

/** Thrown by `parseSecondsArg` with the desktop's message. */
export class TimeArgError extends Error {
  override readonly name = "TimeArgError";
}

/**
 * An agent time argument in seconds (parse_seconds_arg): blank means
 * "not supplied" (`fallback`); numbers, "12.5", "12s", "0:12" parse; anything
 * else (nan and inf included) throws TimeArgError naming the raw value.
 */
export function parseSecondsArg(value: unknown, fallback: number | null, field = ""): number | null {
  const label = field || "value";
  if (value === null || value === undefined) return fallback;
  if (typeof value === "boolean") throw new TimeArgError(`${label}=${value ? "True" : "False"} is not a time in seconds`);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TimeArgError(`${label}=${pyFloat(value)} is not a time in seconds`);
    return value;
  }
  const text = String(value).trim();
  if (!text) return fallback;
  let lowered = text.toLowerCase().replaceAll(",", "");
  for (const suffix of SECONDS_SUFFIXES) {
    if (lowered.endsWith(suffix) && lowered.length > suffix.length) {
      lowered = lowered.slice(0, -suffix.length).trim();
      break;
    }
  }
  const parsed = parseTimecodeToken(lowered);
  // zenvi-core #168: nan/inf are refused too (float() accepts them).
  if (parsed === null || !Number.isFinite(parsed)) {
    throw new TimeArgError(
      `${label}=${pyRepr(value)} is not a time in seconds ` +
        "(use seconds like 12 or 12.5, or a timecode like 0:12)",
    );
  }
  return parsed;
}

function basenameStem(name: string): string {
  let base = String(name ?? "").replaceAll("\\", "/");
  base = base.slice(base.lastIndexOf("/") + 1);
  if (base.includes(".")) base = base.slice(0, base.lastIndexOf("."));
  return base.replaceAll("_", " ").replaceAll("-", " ").trim();
}

/** Query for a vision watch before placing (placement_watch_query). */
export function placementWatchQuery(file: unknown, query = "", extra = ""): string {
  const q = String(query ?? "").trim();
  if (q) return Array.from(q).slice(0, 200).join("");
  const data = isRecord(file) ? file : {};
  const ai = isRecord(data.ai_metadata) ? data.ai_metadata : {};
  for (const key of ["prompt", "short_summary", "description"]) {
    const text = String(ai[key] ?? "").trim();
    if (text) return Array.from(text).slice(0, 200).join("");
  }
  const extraText = String(extra ?? "").replaceAll("_", " ").trim();
  if (extraText) return Array.from(extraText).slice(0, 200).join("");
  const tags = data.tags;
  let tagText = "";
  if (typeof tags === "string") tagText = tags.replaceAll(",", " ").trim();
  else if (Array.isArray(tags)) tagText = tags.filter((t) => String(t).trim()).map(String).join(" ").trim();
  if (tagText) return Array.from(tagText).slice(0, 200).join("");
  const stem = basenameStem(String(data.name || data.path || ""));
  if (stem) return Array.from(stem).slice(0, 200).join("");
  return DEFAULT_WATCH_QUERY;
}

/** Watch a bounded window before placing (should_watch_placement). */
export function shouldWatchPlacement(options: {
  isAudio?: boolean;
  isImage?: boolean;
  skipExplicitTimes?: boolean;
  isAlreadyWatchedSubclip?: boolean;
  explicitQuery?: boolean;
  windowSec?: number;
  maxWindowSec?: number;
}): boolean {
  if (options.isAudio || options.isImage || options.skipExplicitTimes) return false;
  if (options.isAlreadyWatchedSubclip && !options.explicitQuery) return false;
  const span = Number.isFinite(options.windowSec) ? (options.windowSec as number) : 0;
  return span > 1e-3 && span <= (options.maxWindowSec ?? WATCH_MAX_WINDOW_SEC) + 1e-6;
}

/**
 * A concrete source time range named in a query ("from 4 seconds to 10
 * seconds", "4s to 10s", "0:04 to 0:10"), or null
 * (tool_handlers._parse_explicit_source_time_range_sec).
 */
export function parseExplicitSourceTimeRange(query: string | null | undefined): [number, number] | null {
  if (!query || typeof query !== "string") return null;
  const s = query.trim();
  const pair = (a: string, b: string): [number, number] | null => {
    const t0 = Number(a);
    const t1 = Number(b);
    return t1 > t0 ? [t0, t1] : null;
  };
  let m = /(\d+(?:\.\d+)?)\s*(?:seconds?|secs?)\s+to\s+(\d+(?:\.\d+)?)\s*(?:seconds?|secs?)\b/i.exec(s);
  if (m) {
    const r = pair(m[1]!, m[2]!);
    if (r) return r;
  }
  m = /from\s+(\d+(?:\.\d+)?)\s+to\s+(\d+(?:\.\d+)?)\s*(?:seconds?|secs?)\b/i.exec(s);
  if (m) {
    const r = pair(m[1]!, m[2]!);
    if (r) return r;
  }
  m = /(\d+(?:\.\d+)?)\s*s\b\s+to\s+(\d+(?:\.\d+)?)\s*s\b/i.exec(s);
  if (m) {
    const r = pair(m[1]!, m[2]!);
    if (r) return r;
  }
  m = /(\d+:\d{2}(?::\d{2})?)\s+to\s+(\d+:\d{2}(?::\d{2})?)/i.exec(s);
  if (m) {
    const t0 = parseTimecodeToken(m[1]!);
    const t1 = parseTimecodeToken(m[2]!);
    if (t0 !== null && t1 !== null && t1 > t0) return [t0, t1];
  }
  if (/\bsec/i.test(s)) {
    m = /from\s+(\d+(?:\.\d+)?)\s+to\s+(\d+(?:\.\d+)?)\b/i.exec(s);
    if (m) {
      const r = pair(m[1]!, m[2]!);
      if (r) return r;
    }
  }
  return null;
}
