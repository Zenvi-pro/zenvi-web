/**
 * Tile geometry of the montage grid: where each tile of a layout sits on the
 * frame. Pure rectangles in frame px, listed in reveal order.
 *
 *   grid        2 3 4 6 9 tiles in columns × rows (a wide region: 2×1 3×1 2×2
 *               3×2 3×3; a tall one turns them: 1×2 1×3 2×2 2×3 3×3)
 *   strips_v    n columns, full height (DcfH_-aRlVg's vertical strips)
 *   strips_h    n rows, full width
 *   film_strip  small frames in a strip along the top (and bottom) edge, the
 *               big frame last (DePJQgiIWSj's contact-sheet frame)
 *   mosaic      irregular bento: the region cut again and again along its long
 *               side, the bigger part getting the larger share
 *   repeat      one shot in columns × rows of copies (2 to 16), a field
 *               (Ddt-jwsIZKW's facade repeated into infinity)
 *   kaleidoscope 2 4 6 8 segments in columns × rows, alternate ones mirrored
 *               (DbeRyIvNrga, Ddt-jwsIZKW's towers folding round the sky)
 *
 * A `band` is a region narrower than the frame: the 16:9 band across the
 * middle of a 9:16 frame (DecuXPxxDXU), the rest of the frame bars.
 */

import type { MotionFrame } from "./types.js";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const GRID_LAYOUTS = ["grid", "strips_v", "strips_h", "film_strip", "mosaic", "repeat", "kaleidoscope"] as const;
export type GridLayoutId = (typeof GRID_LAYOUTS)[number];

/** Tile counts each layout takes. */
export const TILE_COUNTS: Readonly<Record<GridLayoutId, readonly number[]>> = {
  grid: [2, 3, 4, 6, 9],
  strips_v: [2, 3, 4, 5, 6],
  strips_h: [2, 3, 4, 5, 6],
  film_strip: [3, 4, 5, 6, 7],
  mosaic: [3, 4, 5, 6, 7, 8, 9],
  repeat: [2, 3, 4, 6, 8, 9, 12, 16],
  kaleidoscope: [2, 4, 6, 8],
};

/** Layouts of one shot: every tile shows the same clip, in step (a field rather than a montage). */
export const FIELD_LAYOUTS: readonly GridLayoutId[] = ["repeat", "kaleidoscope"];

/** Tiles a layout shows when `tiles` is not given. */
export const DEFAULT_TILES: Readonly<Record<GridLayoutId, number>> = { grid: 4, strips_v: 3, strips_h: 3, film_strip: 5, mosaic: 6, repeat: 9, kaleidoscope: 4 };

/** The largest rectangle of width / height `aspect` in the frame, centred (the whole frame when `aspect` is null). */
export function bandRect(frame: Pick<MotionFrame, "width" | "height">, aspect: number | null): Rect {
  const { width: W, height: H } = frame;
  if (aspect === null) return { x: 0, y: 0, w: W, h: H };
  const w = Math.min(W, H * aspect);
  const h = w / aspect;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

/** Columns and rows of a grid of `count` tiles in a region `w` × `h`. */
export function gridDims(count: number, w: number, h: number): { cols: number; rows: number } {
  const wide: Readonly<Record<number, [number, number]>> = { 2: [2, 1], 3: [3, 1], 4: [2, 2], 6: [3, 2], 8: [4, 2], 9: [3, 3], 12: [4, 3], 16: [4, 4] };
  const [cols, rows] = wide[count] ?? [count, 1];
  return h > w ? { cols: rows, rows: cols } : { cols, rows };
}

function columns(region: Rect, n: number, gap: number): Rect[] {
  const w = (region.w - (n - 1) * gap) / n;
  return Array.from({ length: n }, (_, i) => ({ x: region.x + i * (w + gap), y: region.y, w, h: region.h }));
}

function rowsOf(region: Rect, n: number, gap: number): Rect[] {
  const h = (region.h - (n - 1) * gap) / n;
  return Array.from({ length: n }, (_, i) => ({ x: region.x, y: region.y + i * (h + gap), w: region.w, h }));
}

function cells(region: Rect, cols: number, rows: number, gap: number): Rect[] {
  const w = (region.w - (cols - 1) * gap) / cols;
  const h = (region.h - (rows - 1) * gap) / rows;
  const out: Rect[] = [];
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) out.push({ x: region.x + c * (w + gap), y: region.y + r * (h + gap), w, h });
  return out;
}

/** Guillotine cuts along the long side; the first part is larger on even depths, smaller on odd ones. */
function cut(region: Rect, n: number, gap: number, depth: number): Rect[] {
  if (n <= 1) return [region];
  const first = Math.ceil(n / 2);
  const bias = n > 2 ? (depth % 2 === 0 ? 0.12 : -0.1) : 0;
  const share = Math.min(0.7, Math.max(0.3, first / n + bias));
  if (region.w >= region.h) {
    const w1 = (region.w - gap) * share;
    return [...cut({ ...region, w: w1 }, first, gap, depth + 1), ...cut({ ...region, x: region.x + w1 + gap, w: region.w - w1 - gap }, n - first, gap, depth + 1)];
  }
  const h1 = (region.h - gap) * share;
  return [...cut({ ...region, h: h1 }, first, gap, depth + 1), ...cut({ ...region, y: region.y + h1 + gap, h: region.h - h1 - gap }, n - first, gap, depth + 1)];
}

/** Reading order: top to bottom, then left to right (within a pixel of the same row). */
function reading(rects: Rect[]): Rect[] {
  return [...rects].sort((a, b) => (Math.abs(a.y - b.y) > 1 ? a.y - b.y : a.x - b.x));
}

/** A film strip's parts: the frames of each strip (top first), the strip band height, and the big frame. */
export interface FilmStrip {
  /** Bands behind the small frames (sprocket holes are drawn on them). */
  bands: Rect[];
  /** Small frames, strip by strip, left to right. */
  small: Rect[];
  hero: Rect;
  /** Sprocket margin inside a band, above and below its frames. */
  margin: number;
}

export function filmStrip(region: Rect, count: number, gap: number): FilmStrip {
  const smallCount = count - 1;
  const top = smallCount <= 3 ? smallCount : Math.ceil(smallCount / 2);
  const bottom = smallCount - top;
  const wide = region.w >= region.h;
  const perStrip = Math.max(top, bottom);
  const frameW = (region.w - (perStrip - 1) * gap) / perStrip;
  // Small frames about 16:9, at most 28 % (wide) or 22 % (tall) of the region's height; the band adds a sprocket margin.
  const margin = Math.max(8, Math.round(Math.min(region.w, region.h) * 0.018));
  const frameH = Math.min(frameW * (9 / 16), region.h * (wide ? 0.28 : 0.22) - 2 * margin);
  const bandH = frameH + 2 * margin;
  const bands: Rect[] = [];
  const small: Rect[] = [];
  const row = (n: number, y: number): void => {
    const w = (region.w - (n - 1) * gap) / n;
    bands.push({ x: region.x, y, w: region.w, h: bandH });
    for (let i = 0; i < n; i += 1) small.push({ x: region.x + i * (w + gap), y: y + margin, w, h: frameH });
  };
  row(top, region.y);
  if (bottom > 0) row(bottom, region.y + region.h - bandH);
  const above = region.y + bandH + gap;
  const below = bottom > 0 ? region.y + region.h - bandH - gap : region.y + region.h;
  return { bands, small, hero: { x: region.x, y: above, w: region.w, h: below - above }, margin };
}

/** The tiles of a layout in reveal order. `count` must be one of TILE_COUNTS[layout]. */
export function tileRects(layout: GridLayoutId, count: number, region: Rect, gap: number): Rect[] {
  switch (layout) {
    case "grid":
    case "repeat":
    case "kaleidoscope": {
      const { cols, rows } = gridDims(count, region.w, region.h);
      return cells(region, cols, rows, gap);
    }
    case "strips_v":
      return columns(region, count, gap);
    case "strips_h":
      return rowsOf(region, count, gap);
    case "film_strip": {
      const film = filmStrip(region, count, gap);
      return [...film.small, film.hero];
    }
    case "mosaic":
      return reading(cut(region, count, gap, 0));
  }
}

/**
 * Which tiles of a kaleidoscope (or a mirrored repeat) are flipped: every
 * other column left-right and every other row top-bottom, so neighbours meet
 * as mirrors. Tiles are in reading order (row by row).
 */
export function mirrorFlips(count: number, region: Rect): { x: boolean; y: boolean }[] {
  const { cols } = gridDims(count, region.w, region.h);
  return Array.from({ length: count }, (_, i) => ({ x: i % cols % 2 === 1, y: Math.floor(i / cols) % 2 === 1 }));
}

/**
 * The window of a shot every kaleidoscope segment shows (fractions of the
 * picture, like a Crop): the picture covers the region, and the window is one
 * tile of it placed so the mirror lines meet at `centre` (0-1 on the picture)
 * in the middle of the region. With an even number of tiles across, the
 * middle is the edge between two tiles and the window ends (or, when the
 * tile left of it is mirrored, starts) at the centre; with an odd number, the
 * window is centred on it. Kept inside the picture.
 */
export function kaleidoscopeWindow(
  picture: { width: number; height: number },
  region: Rect,
  tile: Rect,
  count: number,
  centre: { x: number; y: number },
): { left: number; top: number; right: number; bottom: number } {
  const { cols, rows } = gridDims(count, region.w, region.h);
  const cover = Math.max(region.w / picture.width, region.h / picture.height);
  const axis = (n: number, size: number, own: number, c: number): [number, number] => {
    const frac = Math.min(1, size / (own * cover));
    const at = n % 2 === 1 ? c - frac / 2 : (n / 2 - 1) % 2 === 1 ? c : c - frac;
    const start = Math.max(0, Math.min(1 - frac, at));
    return [start, 1 - frac - start];
  };
  const [left, right] = axis(cols, tile.w, picture.width, centre.x);
  const [top, bottom] = axis(rows, tile.h, picture.height, centre.y);
  return { left, top, right, bottom };
}

/** The shortest side among `rects`, px. */
export function shortestSide(rects: readonly Rect[]): number {
  return Math.min(...rects.map((r) => Math.min(r.w, r.h)));
}

/** Parse a band: "full", "16:9", "2.39:1", "21/9" or a number (width / height). Null for the whole frame, undefined when it makes no sense. */
export function parseBand(value: string | number | undefined): number | null | undefined {
  if (value === undefined) return null;
  if (typeof value === "number") return value > 0.2 && value < 8 ? value : undefined;
  const text = value.trim().toLowerCase();
  if (text === "" || text === "full" || text === "none") return null;
  const parts = text.split(/[:/x]/).map((p) => Number(p));
  const aspect = parts.length === 1 ? parts[0]! : parts.length === 2 ? parts[0]! / parts[1]! : Number.NaN;
  return Number.isFinite(aspect) && aspect > 0.2 && aspect < 8 ? aspect : undefined;
}
