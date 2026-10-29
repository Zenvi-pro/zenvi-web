/**
 * A speaker's head when nobody says where it is: the largest skin-coloured
 * blob in the upper part of the frame (YCbCr skin box, Chai & Ngan, "Face
 * segmentation using skin-color map", 1999), cut to a head-shaped box at its
 * top. A cheap fallback for auto reframing, not a face detector: agents that
 * can see the frame should pass the face box.
 */

import type { RgbaImage } from "../render/types.js";
import type { Box } from "./activity.js";

const GRID = 48;

export function findSkinHead(image: RgbaImage): { box: Box; share: number } | null {
  const { width: w, height: h, data } = image;
  const cols = GRID;
  const rows = Math.max(1, Math.round((GRID * h) / w));
  const counts = new Float64Array(cols * rows);
  const area = new Float64Array(cols * rows);
  for (let y = 0; y < h; y += 1) {
    const r = Math.min(rows - 1, Math.floor((y * rows) / h));
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const R = data[i]!;
      const G = data[i + 1]!;
      const B = data[i + 2]!;
      const Y = 0.299 * R + 0.587 * G + 0.114 * B;
      const cb = 128 - 0.168736 * R - 0.331264 * G + 0.5 * B;
      const cr = 128 + 0.5 * R - 0.418688 * G - 0.081312 * B;
      const cell = r * cols + Math.min(cols - 1, Math.floor((x * cols) / w));
      area[cell]! += 1;
      if (Y > 40 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) counts[cell]! += 1;
    }
  }
  const on = new Uint8Array(cols * rows);
  for (let i = 0; i < on.length; i += 1) on[i] = area[i]! > 0 && counts[i]! / area[i]! > 0.45 ? 1 : 0;
  const seen = new Uint8Array(cols * rows);
  let best: { score: number; cells: number; c0: number; c1: number; r0: number; r1: number } | null = null;
  for (let start = 0; start < on.length; start += 1) {
    if (!on[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let cells = 0;
    let rowSum = 0;
    let c0 = cols;
    let c1 = -1;
    let r0 = rows;
    let r1 = -1;
    while (stack.length) {
      const i = stack.pop()!;
      const c = i % cols;
      const r = (i / cols) | 0;
      cells += 1;
      rowSum += r;
      c0 = Math.min(c0, c);
      c1 = Math.max(c1, c);
      r0 = Math.min(r0, r);
      r1 = Math.max(r1, r);
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
        const j = rr * cols + cc;
        if (on[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    // Big and high in the frame wins: heads sit in the upper half.
    const score = cells * (1.25 - rowSum / cells / rows);
    if (!best || score > best.score) best = { score, cells, c0, c1, r0, r1 };
  }
  if (!best || best.cells < 4) return null;
  const bw = (best.c1 - best.c0 + 1) / cols;
  // A head is about 1.3 times as tall as wide; neck and shoulders below are cut off.
  const headH = Math.min((best.r1 - best.r0 + 1) / rows, ((bw * w) / h) * 1.3);
  return { box: { x: best.c0 / cols, y: best.r0 / rows, w: bw, h: headH }, share: best.cells / (cols * rows) };
}
