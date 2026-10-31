/**
 * The general-flash limit of WCAG 2.3.1 (Three Flashes or Below Threshold):
 * no more than three general flashes in any one second. A flash is a pair of
 * opposing changes in relative luminance of 10 % or more of the maximum where
 * the darker state is below 0.80. Tools that add flashes (flash transitions,
 * strobes, kinetic-cut hits) thin theirs to this limit unless the user opts
 * in; review_render_tool measures it on the rendered picture.
 *
 * No imports: motion pages (packages/motion) bundle this into the browser.
 */

/** Flashes allowed in any window of FLASH_WINDOW_SECONDS. */
export const MAX_FLASHES = 3;
export const FLASH_WINDOW_SECONDS = 1;
/** A change counts at this share of the maximum relative luminance or more. */
export const FLASH_DELTA = 0.1;
/** ...when its darker state is below this. */
export const FLASH_DARK_LIMIT = 0.8;
/** Back-and-forth smaller than this (sensor noise, grain) does not end a change. */
const NOISE = 0.01;
/** Each flash is two changes; more changes than this in a window is more than three flashes. */
const MAX_CHANGES = 2 * MAX_FLASHES;
/** Changes at least this far apart never break the limit on their own (six in a window are three flashes). */
export const MIN_CHANGE_GAP = FLASH_WINDOW_SECONDS / MAX_CHANGES;

/** sRGB channel (0-1) to linear light. */
function linear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rrggbb colour (0-1); 0.5 for anything else. */
export function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const n = Number.parseInt(m[1]!, 16);
  return 0.2126 * linear(((n >> 16) & 255) / 255) + 0.7152 * linear(((n >> 8) & 255) / 255) + 0.0722 * linear((n & 255) / 255);
}

/** Relative luminance of an 8-bit grey (video luma) value, read as sRGB. */
export function lumaLuminance(value: number): number {
  return linear(Math.min(255, Math.max(0, value)) / 255);
}

/** A step from luminance `a` to `b` is half a flash. */
export function isFlashChange(a: number, b: number): boolean {
  return Math.abs(a - b) >= FLASH_DELTA && Math.min(a, b) < FLASH_DARK_LIMIT;
}

/**
 * The seconds at which a luminance series (one value per frame at `fps`)
 * completes a change that counts: each monotonic run (up or down, ignoring
 * wobble under NOISE) counts once, when it first reaches FLASH_DELTA.
 */
export function luminanceChanges(series: ArrayLike<number>, fps: number, startSeconds = 0): number[] {
  const out: number[] = [];
  if (series.length < 2) return out;
  let dir = 0;
  let from = series[0]!;
  let extreme = from;
  let counted = false;
  for (let i = 1; i < series.length; i += 1) {
    const v = series[i]!;
    if (dir === 0) {
      if (Math.abs(v - from) <= NOISE) continue;
      dir = Math.sign(v - from);
      extreme = v;
    } else if ((v - extreme) * dir > 0) {
      extreme = v;
    } else if ((extreme - v) * dir > NOISE) {
      from = extreme;
      extreme = v;
      dir = -dir;
      counted = false;
    }
    if (!counted && isFlashChange(from, extreme)) {
      out.push(startSeconds + i / fps);
      counted = true;
    }
  }
  return out;
}

export interface FlashWindow {
  /** Seconds: the first change of the window and the last within FLASH_WINDOW_SECONDS of it. */
  start: number;
  end: number;
  /** Flashes in it (changes / 2, rounded up). */
  flashes: number;
}

/**
 * Where a set of change times breaks the limit: overlapping one-second
 * windows with more than MAX_FLASHES flashes, merged into stretches; each
 * reports its busiest second.
 */
export function flashViolations(changes: readonly number[]): FlashWindow[] {
  const t = [...changes].sort((a, b) => a - b);
  const out: FlashWindow[] = [];
  let j = 0;
  for (let i = 0; i < t.length; i += 1) {
    if (j < i) j = i;
    while (j + 1 < t.length && t[j + 1]! - t[i]! < FLASH_WINDOW_SECONDS - 1e-9) j += 1;
    const count = j - i + 1;
    if (count <= MAX_CHANGES) continue;
    const flashes = Math.ceil(count / 2);
    const last = out[out.length - 1];
    if (last && t[i]! <= last.end) {
      last.end = Math.max(last.end, t[j]!);
      last.flashes = Math.max(last.flashes, flashes);
    } else out.push({ start: t[i]!, end: t[j]!, flashes });
  }
  return out;
}

/** True when adding `changes` to `kept` breaks the limit in no second that holds one of them. */
export function fitsFlashLimit(kept: readonly number[], changes: readonly number[]): boolean {
  return !flashViolations([...kept, ...changes]).some((w) => changes.some((c) => c >= w.start - 1e-9 && c <= w.end + 1e-9));
}

/** Small greyscale frames at a constant rate (MediaHost.decodeLuma's LumaFrames). */
export interface GreyFrames {
  fps: number;
  width: number;
  height: number;
  startSeconds: number;
  frames: readonly Uint8Array[];
}

/** Regions measured: the whole frame and a 3 x 3 grid, each cell about WCAG's 341 x 256 of 1024 x 768. */
const GRID = 3;

/**
 * Where a decoded picture breaks the limit. Each region's mean relative
 * luminance is followed frame by frame; the stretches of all regions merge.
 */
export function flashingOf(frames: GreyFrames): FlashWindow[] {
  const { width: w, height: h } = frames;
  const regions = 1 + GRID * GRID;
  const series = Array.from({ length: regions }, () => new Float64Array(frames.frames.length));
  const cellOf = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) cellOf[y * w + x] = 1 + Math.min(GRID - 1, Math.floor((y * GRID) / h)) * GRID + Math.min(GRID - 1, Math.floor((x * GRID) / w));
  const counts = new Float64Array(regions);
  for (let i = 0; i < w * h; i += 1) counts[cellOf[i]!] = counts[cellOf[i]!]! + 1;
  counts[0] = w * h;
  const table = Float64Array.from({ length: 256 }, (_, v) => lumaLuminance(v));
  frames.frames.forEach((frame, f) => {
    const sums = new Float64Array(regions);
    for (let i = 0; i < w * h; i += 1) {
      const l = table[frame[i] ?? 0]!;
      sums[0] = sums[0]! + l;
      sums[cellOf[i]!] = sums[cellOf[i]!]! + l;
    }
    for (let r = 0; r < regions; r += 1) series[r]![f] = counts[r]! > 0 ? sums[r]! / counts[r]! : 0;
  });
  const windows = series.flatMap((s) => flashViolations(luminanceChanges(s, frames.fps, frames.startSeconds)));
  windows.sort((a, b) => a.start - b.start);
  const out: FlashWindow[] = [];
  for (const win of windows) {
    const last = out[out.length - 1];
    if (last && win.start <= last.end) {
      last.end = Math.max(last.end, win.end);
      last.flashes = Math.max(last.flashes, win.flashes);
    } else out.push({ ...win });
  }
  return out;
}
