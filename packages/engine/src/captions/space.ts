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
 *
 * A cell's cost is 0 (calm, dark, empty) to 1; the caption builder picks,
 * among the spots that stay clear of the head, the cheapest one.
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
 * The head in a matte frame, shares of the frame: the subject's extent in a
 * band from its topmost row down 0.9 × the width it has there (a head is
 * about as tall as it is wide), ignoring specks under 0.4 % of the frame.
 */
export function matteHead(matte: RgbaImage): AvoidBox | null {
  const { width: W, height: H } = matte;
  const rowsOn: number[] = [];
  for (let y = 0; y < H; y += 1) {
    let n = 0;
    for (let x = 0; x < W; x += 1) if (matte.data[(y * W + x) * 4]! >= SUBJECT) n += 1;
    rowsOn.push(n);
  }
  const total = rowsOn.reduce((a, b) => a + b, 0);
  if (total < 0.004 * W * H) return null;
  // Top: the first row with a few subject pixels (strands of hair above it do not count).
  const minRow = Math.max(1, Math.round(0.01 * W));
  const top = rowsOn.findIndex((n) => n >= minRow);
  if (top < 0) return null;
  // Width near the top settles a few rows down; grow the band until it is ~0.9 × that width tall.
  let x0 = W;
  let x1 = -1;
  let bottom = top;
  for (let y = top; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (matte.data[(y * W + x) * 4]! < SUBJECT) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
    }
    bottom = y;
    // Square pixels: the band is as tall as the head is wide, about.
    if (x1 >= x0 && y - top >= 0.9 * (x1 - x0 + 1) && y - top > 0.04 * H) break;
  }
  if (x1 < x0) return null;
  const w = (x1 - x0 + 1) / W;
  const h = (bottom - top + 1) / H;
  return { x: x0 / W + w / 2, y: top / H + h / 2, w, h };
}

/**
 * Cost of each cell: busy and bright picture, and the subject. Weights: the
 * subject counts most (type over a body is clutter even where it is calm),
 * then detail, then brightness (white type).
 */
export function sceneCost(picture: RgbaImage | null, matte: RgbaImage | null, cols: number, rows: number): CostGrid | null {
  if (!picture && !matte) return null;
  const n = cols * rows;
  const p = picture ? pictureCells(picture, cols, rows) : null;
  const m = matte ? matteCells(matte, cols, rows) : null;
  const cells: number[] = [];
  for (let k = 0; k < n; k += 1) {
    const parts: [number, number][] = [];
    if (p) parts.push([p.busy[k]!, 0.45], [p.luma[k]!, 0.25]);
    if (m) parts.push([m[k]!, 0.6]);
    const weight = parts.reduce((s, [, w]) => s + w, 0);
    cells.push(parts.reduce((s, [v, w]) => s + v * w, 0) / weight);
  }
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
