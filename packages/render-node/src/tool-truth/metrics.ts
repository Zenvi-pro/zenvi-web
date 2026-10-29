/**
 * What a tool truth case measures: picture metrics on a composited frame
 * (premultiplied over black, the export's background) and sound metrics on
 * the mixed PCM. Every metric is a plain number so a case can say which way
 * a parameter must move it.
 */

import type { MixPcm, RgbaImage } from "@zenvi/engine";

export type PictureMetric =
  | "luma"
  | "contrast"
  | "saturation"
  | "red"
  | "green"
  | "blue"
  | "sharpness"
  | "coverage"
  | "centroid_x"
  | "centroid_y"
  | "width"
  | "height";

export type SoundMetric = "rms" | "rms_left" | "rms_right" | "balance" | "brightness" | "tail" | "onset";

/** RGB over black, 0..255 per channel. */
function rgbAt(image: RgbaImage, i: number): [number, number, number] {
  const a = image.data[i + 3]! / 255;
  return [image.data[i]! * a, image.data[i + 1]! * a, image.data[i + 2]! * a];
}

const lumaOf = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Every picture metric of one frame. */
export function pictureMetrics(image: RgbaImage): Record<PictureMetric, number> {
  const { width, height } = image;
  const n = width * height;
  const luma = new Float32Array(n);
  let sumL = 0;
  let sumL2 = 0;
  let sumS = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let lit = 0;
  let cx = 0;
  let cy = 0;
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const [r, g, b] = rgbAt(image, p * 4);
      const l = lumaOf(r, g, b);
      luma[p] = l;
      sumL += l;
      sumL2 += l * l;
      sumS += Math.max(r, g, b) - Math.min(r, g, b);
      sumR += r;
      sumG += g;
      sumB += b;
      cx += l * (x + 0.5);
      cy += l * (y + 0.5);
      if (l > 8) {
        lit += 1;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  let lap = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      lap += Math.abs(4 * luma[p]! - luma[p - 1]! - luma[p + 1]! - luma[p - width]! - luma[p + width]!);
    }
  }
  const mean = sumL / n;
  return {
    luma: mean,
    contrast: Math.sqrt(Math.max(0, sumL2 / n - mean * mean)),
    saturation: sumS / n,
    red: sumR / n,
    green: sumG / n,
    blue: sumB / n,
    sharpness: lap / Math.max(1, (width - 2) * (height - 2)),
    coverage: lit / n,
    centroid_x: sumL > 0 ? cx / sumL / width : 0.5,
    centroid_y: sumL > 0 ? cy / sumL / height : 0.5,
    width: maxX >= minX ? (maxX - minX + 1) / width : 0,
    height: maxY >= minY ? (maxY - minY + 1) / height : 0,
  };
}

export interface PictureDiff {
  /** Mean absolute RGB difference, 0..255. */
  meanAbs: number;
  /** Share of pixels where some channel moved more than 8 levels. */
  changed: number;
}

export function pictureDiff(a: RgbaImage, b: RgbaImage): PictureDiff {
  if (a.width !== b.width || a.height !== b.height) return { meanAbs: 255, changed: 1 };
  let sum = 0;
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const pa = rgbAt(a, i);
    const pb = rgbAt(b, i);
    const d0 = Math.abs(pa[0] - pb[0]);
    const d1 = Math.abs(pa[1] - pb[1]);
    const d2 = Math.abs(pa[2] - pb[2]);
    sum += d0 + d1 + d2;
    if (Math.max(d0, d1, d2) > 8) changed += 1;
  }
  const n = a.width * a.height;
  return { meanAbs: sum / (3 * n), changed: changed / n };
}

/** A parameter "did something" to the picture: the frame visibly moved. */
export function pictureChanged(diff: PictureDiff): boolean {
  return diff.meanAbs >= 0.5 || diff.changed >= 0.002;
}

/**
 * Pearson correlation of two renderers' per-pixel, per-channel changes
 * (variant − base): near 1 when both moved the same pixels the same way,
 * near 0 or below when one renderer reads the parameter differently.
 * Channels, not luma: a white-balance change barely moves luma.
 */
export function changeCorrelation(baseA: RgbaImage, variantA: RgbaImage, baseB: RgbaImage, variantB: RgbaImage): number {
  const n = baseA.width * baseA.height;
  if (baseB.width * baseB.height !== n) return 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let p = 0; p < n; p += 1) {
    const i = p * 4;
    const va = rgbAt(variantA, i);
    const ba = rgbAt(baseA, i);
    const vb = rgbAt(variantB, i);
    const bb = rgbAt(baseB, i);
    for (let c = 0; c < 3; c += 1) {
      const x = va[c]! - ba[c]!;
      const y = vb[c]! - bb[c]!;
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
    }
  }
  const m = 3 * n;
  const cov = sxy / m - (sx / m) * (sy / m);
  const vx = sxx / m - (sx / m) ** 2;
  const vy = syy / m - (sy / m) ** 2;
  return vx > 1e-9 && vy > 1e-9 ? cov / Math.sqrt(vx * vy) : 0;
}

const SILENT = 10 ** (-50 / 20);

function rmsOf(samples: Float32Array): number {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / Math.max(1, samples.length));
}

/** Every sound metric of a mix; levels are dBFS, times seconds. */
export function soundMetrics(mix: MixPcm): Record<SoundMetric, number> {
  const left = mix.channels[0] ?? new Float32Array();
  const right = mix.channels[1] ?? left;
  const mono = new Float32Array(left.length);
  for (let i = 0; i < left.length; i += 1) mono[i] = (left[i]! + (right[i] ?? 0)) / 2;
  const db = (v: number): number => 20 * Math.log10(Math.max(v, 1e-6));
  let diff = 0;
  for (let i = 1; i < mono.length; i += 1) diff += (mono[i]! - mono[i - 1]!) ** 2;
  const rms = rmsOf(mono);
  let onset = -1;
  let tail = 0;
  for (let i = 0; i < mono.length; i += 1) {
    if (Math.abs(mono[i]!) > SILENT) {
      if (onset < 0) onset = i;
      tail = i;
    }
  }
  return {
    rms: db(rms),
    rms_left: db(rmsOf(left)),
    rms_right: db(rmsOf(right)),
    balance: db(rmsOf(right)) - db(rmsOf(left)),
    // RMS of the first difference over RMS: rises with high-frequency content.
    brightness: rms > 0 ? Math.sqrt(diff / Math.max(1, mono.length - 1)) / rms : 0,
    tail: onset < 0 ? 0 : tail / mix.sampleRate,
    onset: onset < 0 ? -1 : onset / mix.sampleRate,
  };
}

/** Energy of the difference between two mixes relative to the first, in dB (−∞ when identical). */
export function soundResidualDb(a: MixPcm, b: MixPcm): number {
  let num = 0;
  let den = 0;
  const channels = Math.max(a.channels.length, b.channels.length);
  for (let c = 0; c < channels; c += 1) {
    const x = a.channels[c] ?? new Float32Array();
    const y = b.channels[c] ?? new Float32Array();
    const len = Math.max(x.length, y.length);
    for (let i = 0; i < len; i += 1) {
      const p = x[i] ?? 0;
      const q = y[i] ?? 0;
      num += (p - q) ** 2;
      den += p * p;
    }
  }
  if (num === 0) return -Infinity;
  return 10 * Math.log10(num / Math.max(den, 1e-12));
}

/** A parameter "did something" to the sound: the mix moved by more than −30 dB of its own energy. */
export function soundChanged(residualDb: number): boolean {
  return residualDb > -30;
}
