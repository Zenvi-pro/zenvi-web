/**
 * Deterministic test images and image comparison, shared by the render tests
 * and the golden generators under `packages/engine/scripts/`. Not exported
 * from the package entry point.
 */

import { createPremul, type PremulImage } from "../pixels.js";

/** Small LCG so fixtures regenerate identically everywhere. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s >>> 8) / 16777216;
  };
}

/** Premultiplied noise: opaque, or ~30% opaque and the rest random alpha. */
export function noiseImage(width: number, height: number, seed: number, alpha: "opaque" | "mixed" = "opaque"): PremulImage {
  const rnd = lcg(seed);
  const img = createPremul(width, height);
  for (let i = 0; i < width * height; i += 1) {
    const a = alpha === "opaque" ? 255 : rnd() < 0.3 ? 255 : Math.floor(rnd() * 256);
    for (let c = 0; c < 3; c += 1) img.data[i * 4 + c] = Math.floor(rnd() * (a + 1));
    img.data[i * 4 + 3] = a;
  }
  return img;
}

/** Opaque smooth gradient with a little texture (resampling-sensitive, not noise). */
export function gradientImage(width: number, height: number): PremulImage {
  const img = createPremul(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      img.data[i] = Math.trunc((x * 255) / Math.max(1, width - 1));
      img.data[i + 1] = Math.trunc((y * 255) / Math.max(1, height - 1));
      img.data[i + 2] = ((x ^ y) * 7) & 255;
      img.data[i + 3] = 255;
    }
  }
  return img;
}

export interface ImageDiff {
  differing: number;
  maxDiff: number;
  /** Over all channels; Infinity when identical. */
  psnr: number;
}

/** Channel-wise comparison of two same-sized byte images. */
export function diffBytes(a: ArrayLike<number>, b: ArrayLike<number>): ImageDiff {
  if (a.length !== b.length) throw new RangeError(`size mismatch ${a.length} vs ${b.length}`);
  let differing = 0;
  let maxDiff = 0;
  let sq = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = Math.abs(a[i]! - b[i]!);
    if (d) {
      differing += 1;
      if (d > maxDiff) maxDiff = d;
      sq += d * d;
    }
  }
  const mse = sq / Math.max(1, a.length);
  return { differing, maxDiff, psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse) };
}

/** PSNR over RGB only (alpha ignored), the metric the parity report uses. */
export function psnrRgb(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sq = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const d = a[i + c]! - b[i + c]!;
      sq += d * d;
    }
    n += 3;
  }
  const mse = sq / Math.max(1, n);
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 without Node's Buffer (the engine has no Node imports). */
export function toBase64(bytes: Uint8Array | Uint8ClampedArray): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64[b0 >> 2]! + B64[((b0 & 3) << 4) | (b1 >> 4)]!;
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)]! : "=";
    out += i + 2 < bytes.length ? B64[b2 & 63]! : "=";
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (i + k < clean.length ? B64.indexOf(clean[i + k]!) : 0));
    const n = (v[0]! << 18) | (v[1]! << 12) | (v[2]! << 6) | v[3]!;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
