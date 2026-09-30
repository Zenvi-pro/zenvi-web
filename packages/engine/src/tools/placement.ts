/**
 * Placement helpers: source windows, trim bounds, time arguments, media kinds.
 *
 * Ports of zenvi-core src/classes/clip_placement.py and
 * src/classes/image_types.py (ref b63c39be7).
 */

import { parsePythonFloat } from "./coerce.js";
import { quantizeSpan, type Fps } from "./frame-time.js";
import { pyRepr } from "./pyfmt.js";

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

// ---------------------------------------------------------------------------
// image_types.py
// ---------------------------------------------------------------------------

const AUDIO_EXTS = [".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".wma", ".opus", ".aiff", ".aif", ".oga"];

/** True when a path ends with a pure-audio extension (query strings ignored). */
export function isAudioPath(path: string | null | undefined): boolean {
  const p = String(path ?? "").toLowerCase().split("?")[0]!;
  return AUDIO_EXTS.some((ext) => p.endsWith(ext));
}

/**
 * True when a file should never composite video (music, SFX, voice-over).
 * Extension first: libopenshot reports has_video for MP3s with cover art.
 */
export function isAudioOnlyMedia(file: unknown): boolean {
  if (!isRecord(file)) return false;
  if (isAudioPath(String(file.path ?? ""))) return true;
  const mediaType = String(file.media_type ?? "").trim().toLowerCase();
  if (mediaType) return mediaType === "audio";
  return Boolean(file.has_audio) && !file.has_video;
}

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
 * else throws TimeArgError naming the raw value.
 */
export function parseSecondsArg(value: unknown, fallback: number | null, field = ""): number | null {
  const label = field || "value";
  if (value === null || value === undefined) return fallback;
  if (typeof value === "boolean") throw new TimeArgError(`${label}=${value ? "True" : "False"} is not a time in seconds`);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TimeArgError(`${label}=${String(value)} is not a time in seconds`);
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
  if (parsed === null) {
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
