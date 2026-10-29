/**
 * Negative space for captions: where on a shot words read best, from what
 * the shot shows (DekLMhxqrFE puts each caption in the empty part of its
 * shot, beside the speaker).
 *
 *   picture   a coarse grid of how busy (mean luma gradient) and how bright
 *             each cell is: white type reads on calm, dark areas.
 *   matte     a subject matte frame (white = subject) gives the head, the
 *             box the captions keep off (and emphasis words go behind), and
 *             how much of each cell is the subject.
 *   type      cells that look like type burnt into the footage (a creator's
 *             own captions, a lower third): captions laid over them collide
 *             (bench round 7: kinetic, real estate, product launch, talking
 *             head), so they cost as much as the subject.
 *
 * A cell's cost is 0 (calm, dark, empty) to 1.5; the caption builder
 * picks, among the spots that stay clear of the head, the cheapest one.
 */

import type { RgbaImage } from "../render/types.js";
import type { AvoidBox } from "./build.js";

/** Cost of each cell of a `cols` × `rows` grid over the frame, row by row, 0-1. */
export interface CostGrid {
  cols: number;
  rows: number;
  cells: number[];
}

/** What the captions over one stretch of the timeline see. */
export interface CaptionScene {
  /** Timeline seconds. */
  from: number;
  to: number;
  /** The subject's head, shares of the frame (from the matte), when there is one. */
  head?: AvoidBox;
  cost?: CostGrid;
  /** Share of each cell that is the subject (from the matte): how much of a word behind it would be hidden. */
  subject?: CostGrid;
  /** Rows of cells (0 = top) with type burnt into the picture. */
  textRows?: number[];
}

/** Grid cells across the frame's long side. */
export const GRID_LONG = 16;

/** Matte values at or above this (of 255) count as the subject. */
const SUBJECT = 128;

/** The grid for a `width` × `height` frame: `GRID_LONG` cells across its long side, square cells. */
export function gridSize(width: number, height: number): { cols: number; rows: number } {
  const long = Math.max(width, height);
  const cols = Math.max(1, Math.round((GRID_LONG * width) / long));
  const rows = Math.max(1, Math.round((GRID_LONG * height) / long));
  return { cols, rows };
}

const lumaAt = (img: RgbaImage, x: number, y: number): number => {
  const i = (y * img.width + x) * 4;
  return (0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!) / 255;
};

/** Per cell of the picture: busyness (mean absolute luma gradient, scaled so 0.12 reads as fully busy) and mean luma, both 0-1. */
export function pictureCells(img: RgbaImage, cols: number, rows: number): { busy: number[]; luma: number[] } {
  const sumG = new Array<number>(cols * rows).fill(0);
  const sumL = new Array<number>(cols * rows).fill(0);
  const count = new Array<number>(cols * rows).fill(0);
  for (let y = 0; y < img.height - 1; y += 1) {
    const r = Math.min(rows - 1, Math.floor((y * rows) / img.height));
    for (let x = 0; x < img.width - 1; x += 1) {
      const c = Math.min(cols - 1, Math.floor((x * cols) / img.width));
      const l = lumaAt(img, x, y);
      const g = Math.abs(lumaAt(img, x + 1, y) - l) + Math.abs(lumaAt(img, x, y + 1) - l);
      const k = r * cols + c;
      sumG[k]! += g;
      sumL[k]! += l;
      count[k]! += 1;
    }
  }
  return {
    busy: sumG.map((g, k) => Math.min(1, g / Math.max(1, count[k]!) / 0.12)),
    luma: sumL.map((l, k) => l / Math.max(1, count[k]!)),
  };
}

/** Luma step to a neighbour that counts as a letter's edge (type on footage: light letters, a dark outline or shadow, or the reverse). */
const STROKE = 0.3;

/**
 * Cells that look like burnt-in type: many strong edges with both near-white
 * and near-black pixels in the cell (letters and their outline or plate),
 * edges mostly across the row (letters' upright strokes), in a run of at
 * least two such cells along the row (a line of type is wide; a lone busy
 * cell is texture). Heuristic: a false hit only moves a caption elsewhere.
 */
export function textCells(img: RgbaImage, cols: number, rows: number): boolean[] {
  const n = cols * rows;
  const count = new Array<number>(n).fill(0);
  const across = new Array<number>(n).fill(0);
  const down = new Array<number>(n).fill(0);
  const bright = new Array<number>(n).fill(0);
  const dark = new Array<number>(n).fill(0);
  for (let y = 0; y < img.height - 1; y += 1) {
    const r = Math.min(rows - 1, Math.floor((y * rows) / img.height));
    for (let x = 0; x < img.width - 1; x += 1) {
      const k = r * cols + Math.min(cols - 1, Math.floor((x * cols) / img.width));
      const l = lumaAt(img, x, y);
      count[k]! += 1;
      if (Math.abs(lumaAt(img, x + 1, y) - l) > STROKE) across[k]! += 1;
      if (Math.abs(lumaAt(img, x, y + 1) - l) > STROKE) down[k]! += 1;
      if (l > 0.8) bright[k]! += 1;
      else if (l < 0.25) dark[k]! += 1;
    }
  }
  const like = count.map((c, k) => {
    const m = Math.max(1, c);
    return across[k]! / m > 0.08 && across[k]! >= 0.8 * down[k]! && bright[k]! / m > 0.04 && dark[k]! / m > 0.04;
  });
  return like.map((t, k) => t && ((k % cols > 0 && like[k - 1]!) || (k % cols < cols - 1 && like[k + 1]!)));
}

/** Share of each cell that is the subject in a matte frame. */
export function matteCells(matte: RgbaImage, cols: number, rows: number): number[] {
  const on = new Array<number>(cols * rows).fill(0);
  const count = new Array<number>(cols * rows).fill(0);
  for (let y = 0; y < matte.height; y += 1) {
    const r = Math.min(rows - 1, Math.floor((y * rows) / matte.height));
    for (let x = 0; x < matte.width; x += 1) {
      const k = r * cols + Math.min(cols - 1, Math.floor((x * cols) / matte.width));
      count[k]! += 1;
      if (matte.data[(y * matte.width + x) * 4]! >= SUBJECT) on[k]! += 1;
    }
  }
  return on.map((n, k) => n / Math.max(1, count[k]!));
}

/**
 * The head in a matte frame, shares of the frame: the subject's rows from
 * its topmost one down until they are 0.9 × as tall as they are wide (a
 * head is about as tall as it is wide), or to where the outline jumps out
 * (outstretched arms: a row 1.6 × wider than the head so far, once the head
 * is half as tall as wide); specks under 0.4 % of the frame are no subject.
 */
export function matteHead(matte: RgbaImage): AvoidBox | null {
  const { width: W, height: H } = matte;
  const rows: { x0: number; x1: number; n: number }[] = [];
  let total = 0;
  for (let y = 0; y < H; y += 1) {
    let x0 = -1;
    let x1 = -1;
    let n = 0;
    for (let x = 0; x < W; x += 1) {
      if (matte.data[(y * W + x) * 4]! < SUBJECT) continue;
      if (x0 < 0) x0 = x;
      x1 = x;
      n += 1;
    }
    rows.push({ x0, x1, n });
    total += n;
  }
  if (total < 0.004 * W * H) return null;
  // Top: the first row with a few subject pixels (strands of hair above it do not count).
  const minRow = Math.max(1, Math.round(0.01 * W));
  const top = rows.findIndex((r) => r.n >= minRow);
  if (top < 0) return null;
  let x0 = W;
  let x1 = -1;
  let bottom = top;
  for (let y = top; y < H; y += 1) {
    const r = rows[y]!;
    if (r.n === 0) break;
    const tall = y - top;
    const sofar = x1 - x0 + 1;
    if (x1 >= x0 && tall > 0.5 * sofar && r.x1 - r.x0 + 1 > 1.6 * sofar) break;
    x0 = Math.min(x0, r.x0);
    x1 = Math.max(x1, r.x1);
    bottom = y;
    if (tall >= 0.9 * (x1 - x0 + 1) && tall > 0.04 * H) break;
  }
  const w = (x1 - x0 + 1) / W;
  const h = (bottom - top + 1) / H;
  return { x: x0 / W + w / 2, y: top / H + h / 2, w, h };
}

/**
 * Cost of each cell: the picture, 0-0.5 (detail, and brightness: white
 * type on a white wall does not read), plus the subject's share, 0-1: type over a
 * body is clutter even where the shirt is calm and dark, so any clear patch
 * of background beats it.
 */
export function sceneCost(picture: RgbaImage | null, matte: RgbaImage | null, cols: number, rows: number, text?: readonly boolean[]): CostGrid | null {
  if (!picture && !matte) return null;
  const n = cols * rows;
  const p = picture ? pictureCells(picture, cols, rows) : null;
  const m = matte ? matteCells(matte, cols, rows) : null;
  const cells: number[] = [];
  // Burnt-in type costs like the subject: words over words do not read.
  for (let k = 0; k < n; k += 1) cells.push((p ? 0.25 * p.busy[k]! + 0.25 * p.luma[k]! : 0) + Math.max(m ? m[k]! : 0, text?.[k] ? 1 : 0));
  return { cols, rows, cells };
}

/** Mean cost of the cells a box (frame px) covers, weighted by how much of each it covers. */
export function boxCost(grid: CostGrid, box: { x: number; y: number; width: number; height: number }, W: number, H: number): number {
  const cw = W / grid.cols;
  const ch = H / grid.rows;
  let sum = 0;
  let area = 0;
  const c0 = Math.max(0, Math.floor(box.x / cw));
  const c1 = Math.min(grid.cols - 1, Math.floor((box.x + box.width) / cw));
  const r0 = Math.max(0, Math.floor(box.y / ch));
  const r1 = Math.min(grid.rows - 1, Math.floor((box.y + box.height) / ch));
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) {
      const w = Math.min(box.x + box.width, (c + 1) * cw) - Math.max(box.x, c * cw);
      const h = Math.min(box.y + box.height, (r + 1) * ch) - Math.max(box.y, r * ch);
      if (w <= 0 || h <= 0) continue;
      sum += grid.cells[r * grid.cols + c]! * w * h;
      area += w * h;
    }
  }
  return area > 0 ? sum / area : 1;
}
