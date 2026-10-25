/**
 * Project Files rules the file tools share (zenvi-core develop 1f80cb3d0
 * src/classes/project_files.py, which the Files dock and the File Properties
 * dialog use too): numbered image sequences found from the names in a folder,
 * a sequence's frame rate, a file's in/out frames, and a file's record after
 * it is pointed at new media. Pure: the host lists folders and probes media,
 * these decide what that means.
 */

import type { Fraction, ProjectFile } from "../model/types.js";
import { isRecord } from "./internal.js";

/** Frame file types an image sequence may have (project_files.SEQUENCE_EXTENSIONS). */
export const SEQUENCE_EXTENSIONS: readonly string[] = ["png", "jpg", "jpeg", "tif", "svg"];

const SEQUENCE_NAME_RE = new RegExp(`(.*[^\\d])?(0*)(\\d+)\\.(${SEQUENCE_EXTENSIONS.join("|")})$`, "i");

/** A numbered image set, as project_files.detect_image_sequence describes it. */
export interface ImageSequence {
  /** The frames' folder. */
  folder_path: string;
  /** The file name before the frame number ("frame_"). */
  base_name: string;
  /** Frame numbers are zero-padded to `digits`. */
  fixlen: boolean;
  digits: number;
  extension: string;
  /** The libopenshot pattern of the names: "frame_%04d.png". */
  pattern: string;
  /** Folder + pattern: what a sequence file stores as its path. */
  path: string;
}

/** A path's folder and file name (either separator). */
export function folderAndName(path: string): { folder: string; name: string } {
  const p = String(path ?? "");
  const cut = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return cut < 0 ? { folder: "", name: p } : { folder: p.slice(0, cut), name: p.slice(cut + 1) };
}

/** `os.path.join(folder, name)` with the folder's own separator. */
export function joinFolder(folder: string, name: string): string {
  if (!folder) return name;
  if (folder.endsWith("/") || folder.endsWith("\\")) return folder + name;
  const sep = folder.includes("\\") && !folder.includes("/") ? "\\" : "/";
  return folder + sep + name;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The image sequence `filePath` is one frame of, or null when it is not
 * numbered or has no numbered neighbour within 100 (project_files
 * .detect_image_sequence). `folderNames` are the file names in its folder.
 */
export function detectImageSequence(filePath: string, folderNames: ReadonlySet<string>): ImageSequence | null {
  const { folder, name } = folderAndName(filePath);
  const match = SEQUENCE_NAME_RE.exec(name);
  if (!match) return null;
  const baseName = match[1] ?? "";
  const zeros = match[2] ?? "";
  const number = Number.parseInt(match[3]!, 10);
  const digits = zeros.length + match[3]!.length;
  const extension = match[4]!;
  const hasDigitCount = (count: number): boolean => {
    const rx = new RegExp(`^${escapeRegExp(baseName)}[0-9]{${count}}\\.${escapeRegExp(extension)}$`);
    for (const n of folderNames) if (rx.test(n)) return true;
    return false;
  };
  // Names of another length mean the numbers are not padded (img8, img9, img10).
  const fixlen = zeros !== "" || !(hasDigitCount(digits + 1) || hasDigitCount(digits > 1 ? digits - 1 : 3));
  let neighbour = false;
  for (let x = Math.max(0, number - 100); x < Math.min(number + 101, 50000); x += 1) {
    const numbered = fixlen ? String(x).padStart(digits, "0") : String(x);
    if (x !== number && folderNames.has(`${baseName}${numbered}.${extension}`)) {
      neighbour = true;
      break;
    }
  }
  if (!neighbour) return null;
  const pattern = `${baseName}${fixlen ? `%0${digits}d` : "%d"}.${extension}`;
  return { folder_path: folder, base_name: baseName, fixlen, digits, extension, pattern, path: joinFolder(folder, pattern) };
}

/** Sorted frame numbers of a sequence among a folder's names (project_files.sequence_frame_numbers). */
export function sequenceFrameNumbers(sequence: ImageSequence, folderNames: Iterable<string>): number[] {
  const digits = sequence.fixlen ? `(\\d{${Math.trunc(sequence.digits) || 1}})` : "(\\d+)";
  const rx = new RegExp(`^${escapeRegExp(sequence.base_name)}${digits}\\.${escapeRegExp(sequence.extension)}$`);
  const numbers: number[] = [];
  for (const n of folderNames) {
    const m = rx.exec(n);
    if (m) numbers.push(Number.parseInt(m[1]!, 10));
  }
  return numbers.sort((a, b) => a - b);
}

/**
 * The first frame and the sequence of the largest numbered image set among a
 * folder's names (project_files.first_sequence_frame), or null.
 */
export function firstSequenceFrame(folder: string, folderNames: ReadonlySet<string>): { first: string; sequence: ImageSequence } | null {
  const names = [...folderNames].filter((n) => !n.startsWith(".")).sort();
  let best: { count: number; first: string; sequence: ImageSequence } | null = null;
  const seen = new Set<string>();
  for (const name of names) {
    if (!SEQUENCE_NAME_RE.test(name)) continue;
    const sequence = detectImageSequence(joinFolder(folder, name), folderNames);
    if (!sequence || seen.has(sequence.path)) continue;
    seen.add(sequence.path);
    const count = sequenceFrameNumbers(sequence, folderNames).length;
    if (count > (best?.count ?? 0)) best = { count, first: joinFolder(folder, name), sequence };
  }
  return best ? { first: best.first, sequence: best.sequence } : null;
}

/** True for a file that is an image sequence (its path holds a `%` pattern). */
export function isImageSequence(file: Record<string, unknown> | null | undefined): boolean {
  return String(file?.path ?? "").includes("%");
}

/**
 * Whether a sequence's frames are still there (media_files.media_missing for
 * a `%` path): some name in its folder starts with the pattern's stem and
 * ends with its extension. `folderNames` are the names in the pattern's
 * folder (the host lists it; a missing folder means missing media).
 */
export function sequenceFramesPresent(patternPath: string, folderNames: Iterable<string>): boolean {
  const { name } = folderAndName(patternPath);
  const stem = name.split("%", 1)[0] ?? "";
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot) : "";
  for (const n of folderNames) {
    // glob's `*` never matches a leading dot.
    if (n.startsWith(".") && !stem.startsWith(".")) continue;
    if (n.length >= stem.length + extension.length && n.startsWith(stem) && n.endsWith(extension)) return true;
  }
  return false;
}

/** Frame rates people say as decimals (project_files._NTSC_RATES). */
const NTSC_RATES: readonly [number, Fraction][] = [
  [23.976, { num: 24000, den: 1001 }],
  [23.98, { num: 24000, den: 1001 }],
  [29.97, { num: 30000, den: 1001 }],
  [47.952, { num: 48000, den: 1001 }],
  [59.94, { num: 60000, den: 1001 }],
  [119.88, { num: 120000, den: 1001 }],
];

function bigGcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) [x, y] = [y, x % y];
  return x;
}

/** Python `Fraction(x).limit_denominator(maxDen)` for a positive finite double. */
function limitDenominator(x: number, maxDen: number): Fraction {
  // Fraction(x) is the double's exact binary value.
  let mantissa = x;
  let exponent = 0;
  while (!Number.isInteger(mantissa)) {
    mantissa *= 2;
    exponent += 1;
  }
  let num = BigInt(mantissa);
  let den = 1n << BigInt(exponent);
  const g = bigGcd(num, den);
  num /= g;
  den /= g;
  const max = BigInt(maxDen);
  if (den <= max) return { num: Number(num), den: Number(den) };
  let [p0, q0, p1, q1] = [0n, 1n, 1n, 0n];
  let [n, d] = [num, den];
  for (;;) {
    const a = n / d;
    const q2 = q0 + a * q1;
    if (q2 > max) break;
    [p0, q0, p1, q1] = [p1, q1, p0 + a * p1, q2];
    [n, d] = [d, n - a * d];
  }
  const k = (max - q0) / q1;
  if (2n * d * (q0 + k * q1) <= den) return { num: Number(p1), den: Number(q1) };
  return { num: Number(p0 + k * p1), den: Number(q0 + k * q1) };
}

/** A frame rate given as a number (24, 23.976, 29.97, 12.5) as a fraction (project_files.fps_fraction). */
export function fpsFraction(value: number): Fraction {
  const rate = Number(value);
  if (!(rate > 0) || !Number.isFinite(rate)) throw new RangeError("frame rate must be positive");
  for (const [known, fraction] of NTSC_RATES) if (Math.abs(rate - known) < 0.005) return { ...fraction };
  return limitDenominator(rate, 1001);
}

/**
 * An image sequence's record played at a new frame rate
 * (project_files.apply_sequence_fps): fps, timebase, and duration and in/out
 * rescaled by old/new rate.
 */
export function withSequenceFps<T extends Record<string, unknown>>(file: T, fps: Fraction): T {
  const current = isRecord(file.fps) ? file.fps : { num: 30, den: 1 };
  const original = Number(current.num) / Number(current.den);
  const factor = original / (fps.num / fps.den);
  const next: Record<string, unknown> = { ...file };
  next.fps = { num: Math.trunc(fps.num), den: Math.trunc(fps.den) };
  next.video_timebase = { num: Math.trunc(fps.den), den: Math.trunc(fps.num) };
  next.duration = (Number(file.duration) || 0) * factor;
  if ("start" in file) next.start = Number(file.start) * factor;
  if ("end" in file) next.end = Number(file.end) * factor;
  return next as T;
}

/**
 * A file's in/out from 1-based frame numbers, the end frame inclusive
 * (project_files.set_in_out_frames, the dialog's Start/End Frame).
 */
export function withInOutFrames<T extends Record<string, unknown>>(file: T, startFrame: number, endFrame: number): T {
  const fps = isRecord(file.fps) ? file.fps : { num: 30, den: 1 };
  const rate = Number(fps.num) / Number(fps.den);
  return { ...file, start: (Math.trunc(startFrame) - 1) / rate, end: Math.trunc(endFrame) / rate };
}

/**
 * A file's record after pointing it at new media (project_files
 * .relinked_file_data): the reader's keys replace the old ones and the rest
 * (name, tags, AI metadata, in/out) stays, with in/out clamped to the new
 * length. The new fingerprint replaces the old one; an optimized preview is
 * kept only when the fingerprints prove the media is the same content.
 */
export function relinkedFileData(
  old: Record<string, unknown>,
  reader: Record<string, unknown>,
  mediaType: string,
  fingerprint?: Record<string, unknown> | null,
): ProjectFile {
  const data: Record<string, unknown> = { ...structuredClone(old), ...structuredClone(reader) };
  data.id = "id" in old ? old.id : data.id;
  const oldSha = isRecord(old.fingerprint) ? old.fingerprint.sha256 : undefined;
  if (fingerprint) data.fingerprint = structuredClone(fingerprint);
  else delete data.fingerprint;
  if (!(oldSha && fingerprint && oldSha === fingerprint.sha256)) delete data.proxy_reader;
  if (mediaType) data.media_type = mediaType;
  const duration = Number(data.duration) || 0;
  if ("end" in data && duration > 0 && Number(data.end) > duration) data.end = duration;
  if ("start" in data && "end" in data && Number(data.start) >= Number(data.end)) {
    delete data.start;
    delete data.end;
  }
  return data as ProjectFile;
}
