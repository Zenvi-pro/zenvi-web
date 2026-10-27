/**
 * A 64-bit difference hash of a frame (dHash: is each of 8 × 8 cells
 * brighter than its right neighbour, on a 9 × 8 luma grid), to tell two
 * stock clips that show the same picture apart from different ones without
 * looking: re-encodes, crops and grades move a few bits, another shot moves
 * about half. Pure.
 */

import type { PremulImage } from "../render/pixels.js";

/** Bits that may differ for two frames to count as the same picture. */
export const NEAR_DUPLICATE_BITS = 10;

/** Cells must span this much luma (0-255) for the hash to mean anything: a black or flat frame matches every other one. */
const MIN_CONTRAST = 8;

/** The 64 comparison bits, row by row; null for a frame too flat to compare. */
export function frameHash(image: PremulImage): boolean[] | null {
  const cols = 9;
  const rows = 8;
  const luma = new Float64Array(cols * rows);
  const count = new Float64Array(cols * rows);
  for (let y = 0; y < image.height; y += 1) {
    const r = Math.min(rows - 1, Math.floor((y * rows) / image.height));
    for (let x = 0; x < image.width; x += 1) {
      const c = Math.min(cols - 1, Math.floor((x * cols) / image.width));
      const i = (y * image.width + x) * 4;
      luma[r * cols + c]! += 0.299 * image.data[i]! + 0.587 * image.data[i + 1]! + 0.114 * image.data[i + 2]!;
      count[r * cols + c]! += 1;
    }
  }
  const means = Array.from(luma, (v, i) => v / Math.max(1, count[i]!));
  if (Math.max(...means) - Math.min(...means) < MIN_CONTRAST) return null;
  const bits: boolean[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c + 1 < cols; c += 1) {
      bits.push(means[r * cols + c]! > means[r * cols + c + 1]!);
    }
  }
  return bits;
}

export function hashDistance(a: readonly boolean[], b: readonly boolean[]): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) d += 1;
  return d + Math.abs(a.length - b.length);
}
