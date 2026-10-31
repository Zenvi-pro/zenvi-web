/**
 * Grey images for the tracker: luma as floats, image pyramids and bilinear
 * sampling. Pure; frames come from whatever host renders them.
 */

import type { RgbaImage } from "../render/types.js";

export interface GrayImage {
  width: number;
  height: number;
  /** Luma 0-255, row-major. */
  data: Float32Array;
}

/** BT.601 luma of `image`, lightly blurred ([1 2 1]²) so Lucas-Kanade sees smooth gradients. */
export function toGray(image: RgbaImage): GrayImage {
  const { width, height } = image;
  const luma = new Float32Array(width * height);
  for (let i = 0, p = 0; i < luma.length; i += 1, p += 4) {
    luma[i] = 0.299 * image.data[p]! + 0.587 * image.data[p + 1]! + 0.114 * image.data[p + 2]!;
  }
  return blur121({ width, height, data: luma });
}

function blur121(img: GrayImage): GrayImage {
  const { width: w, height: h, data } = img;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      const l = data[row + Math.max(0, x - 1)]!;
      const r = data[row + Math.min(w - 1, x + 1)]!;
      tmp[row + x] = (l + 2 * data[row + x]! + r) / 4;
    }
  }
  for (let y = 0; y < h; y += 1) {
    const up = Math.max(0, y - 1) * w;
    const down = Math.min(h - 1, y + 1) * w;
    const row = y * w;
    for (let x = 0; x < w; x += 1) out[row + x] = (tmp[up + x]! + 2 * tmp[row + x]! + tmp[down + x]!) / 4;
  }
  return { width: w, height: h, data: out };
}

/** Half size, each pixel the mean of a 2×2 block of the (already smooth) level above. */
function halve(img: GrayImage): GrayImage {
  const w = Math.max(1, Math.floor(img.width / 2));
  const h = Math.max(1, Math.floor(img.height / 2));
  const out = new Float32Array(w * h);
  const src = img.data;
  const sw = img.width;
  for (let y = 0; y < h; y += 1) {
    const r0 = 2 * y * sw;
    const r1 = Math.min(img.height - 1, 2 * y + 1) * sw;
    for (let x = 0; x < w; x += 1) {
      const x0 = 2 * x;
      const x1 = Math.min(sw - 1, x0 + 1);
      out[y * w + x] = (src[r0 + x0]! + src[r0 + x1]! + src[r1 + x0]! + src[r1 + x1]!) / 4;
    }
  }
  return blur121({ width: w, height: h, data: out });
}

/** Level 0 is `img`; each next level is half the size. Stops before a side drops under 16 px. */
export function pyramid(img: GrayImage, levels: number): GrayImage[] {
  const out = [img];
  while (out.length < levels) {
    const top = out[out.length - 1]!;
    if (top.width < 32 || top.height < 32) break;
    out.push(halve(top));
  }
  return out;
}

/** Bilinear sample, clamped at the borders. */
export function sample(img: GrayImage, x: number, y: number): number {
  const w = img.width;
  const h = img.height;
  const cx = Math.min(Math.max(x, 0), w - 1);
  const cy = Math.min(Math.max(y, 0), h - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const d = img.data;
  const top = d[y0 * w + x0]! + (d[y0 * w + x1]! - d[y0 * w + x0]!) * fx;
  const bottom = d[y1 * w + x0]! + (d[y1 * w + x1]! - d[y1 * w + x0]!) * fx;
  return top + (bottom - top) * fy;
}

/** Central-difference gradients (half the difference of the neighbours). */
export function gradients(img: GrayImage): { gx: GrayImage; gy: GrayImage } {
  const { width: w, height: h, data } = img;
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const up = Math.max(0, y - 1) * w;
    const down = Math.min(h - 1, y + 1) * w;
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      gx[row + x] = (data[row + Math.min(w - 1, x + 1)]! - data[row + Math.max(0, x - 1)]!) / 2;
      gy[row + x] = (data[down + x]! - data[up + x]!) / 2;
    }
  }
  return { gx: { width: w, height: h, data: gx }, gy: { width: w, height: h, data: gy } };
}
