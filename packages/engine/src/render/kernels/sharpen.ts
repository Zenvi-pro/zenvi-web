/**
 * Sharpen, ported from libopenshot src/effects/Sharpen.cpp:98-366: an
 * unsharp mask (or high-pass blend) over a 3-box Gaussian approximation, on
 * straight-alpha color.
 *
 * Divergence (docs/PARITY.md): libopenshot converts the frame to straight
 * ARGB32 in place (Sharpen.cpp:235-236) and never converts back, even on its
 * early return, so later effects read the wrong byte order. This port runs
 * the same math and returns premultiplied RGBA like every other effect.
 */

import { roundHalfAway } from "../../model/rounding.js";
import { byteMul, type PremulImage } from "../pixels.js";
import { unpremultiplyNeon } from "../qt/convert.js";
import { int, num } from "./params.js";
import type { KernelSpec, Params } from "./types.js";

const f32 = Math.fround;

/** boxes_for_gauss(sigma, 3) (Sharpen.cpp:98-111). */
export function boxesForGauss(sigma: number): [number, number, number] {
  const n = 3;
  const wi = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wi);
  if (!(wl & 1)) wl -= 1;
  const wu = wl + 2;
  const mi = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.trunc(roundHalfAway(mi));
  const b: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < n; i += 1) b[i] = i < m ? wl : wu;
  return b;
}

/**
 * blur_axis: sliding window of radius r on the three color planes of a
 * straight BGR-ordered buffer (the ARGB32 byte order), clamp-to-edge.
 */
function blurAxis(src: Float64Array[], dst: Float64Array[], w: number, h: number, r: number, vertical: boolean): void {
  if (r <= 0) {
    for (let c = 0; c < 3; c += 1) dst[c]!.set(src[c]!);
    return;
  }
  const invW = f32(1 / (2 * r + 1));
  for (let c = 0; c < 3; c += 1) {
    const s = src[c]!;
    const o = dst[c]!;
    if (!vertical) {
      for (let y = 0; y < h; y += 1) {
        const row = y * w;
        let sum = s[row]! * (r + 1);
        for (let x = 1; x <= r; x += 1) sum += s[row + Math.min(x, w - 1)]!;
        for (let x = 0; x < w; x += 1) {
          o[row + x] = Math.trunc(f32(sum * invW + 0.5)) & 255;
          sum += s[row + Math.min(x + r + 1, w - 1)]! - s[row + Math.max(x - r, 0)]!;
        }
      }
    } else {
      for (let x = 0; x < w; x += 1) {
        let sum = s[x]! * (r + 1);
        for (let y = 1; y <= r; y += 1) sum += s[Math.min(y, h - 1) * w + x]!;
        for (let y = 0; y < h; y += 1) {
          o[y * w + x] = Math.trunc(f32(sum * invW + 0.5)) & 255;
          sum += s[Math.min(y + r + 1, h - 1) * w + x]! - s[Math.max(y - r, 0) * w + x]!;
        }
      }
    }
  }
}

/** gauss_blur: three box passes, each horizontal then vertical (odd boxes, so integer radii). */
function gaussBlur(planes: Float64Array[], w: number, h: number, sigma: number): Float64Array[] {
  const boxes = boxesForGauss(sigma);
  const t1 = [0, 1, 2].map(() => new Float64Array(w * h));
  const t2 = [0, 1, 2].map(() => new Float64Array(w * h));
  let src = planes;
  for (const b of boxes) {
    const r = Math.floor(0.5 * (b - 1));
    blurAxis(src, t1, w, h, r, false);
    blurAxis(t1, t2, w, h, r, true);
    src = t2;
  }
  return src;
}

const W_B = f32(0.114);
const W_G = f32(0.587);
const W_R = f32(0.299);

/** 0.114·dB + 0.587·dG + 0.299·dR as the arm64 build fuses it: fma(dR, wR, fma(dB, wB, dG·wG)). */
function lumaDetail(dB: number, dG: number, dR: number): number {
  return f32(dR * W_R + f32(dB * W_B + f32(dG * W_G)));
}

export const sharpen: KernelSpec = {
  type: "Sharpen",
  supported: true,
  customMaskBlend: true,
  run(image: PremulImage, params: Params): void {
    const W = image.width;
    const H = image.height;
    if (W <= 0 || H <= 0) return;
    const amt = num(params, "amount", 10);
    const rpx = num(params, "radius", 3);
    const thrUI = num(params, "threshold", 0);
    const mode = int(params, "mode", 0);
    const channel = int(params, "channel", 1);
    if (amt === 0 || rpx <= 0) return;
    const sigma = Math.max(0.1, (rpx * H) / 720);

    // Straight BGR planes (ARGB32 memory order: B, G, R), converted like
    // `convertToFormat(Format_ARGB32)` on arm64 (Sharpen.cpp:235-236).
    const n = W * H;
    const d = image.data;
    const straight = unpremultiplyNeon(image);
    const planes = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
    const alpha = new Uint8Array(n);
    for (let p = 0; p < n; p += 1) {
      alpha[p] = d[p * 4 + 3]!;
      planes[0]![p] = straight[p * 4 + 2]!;
      planes[1]![p] = straight[p * 4 + 1]!;
      planes[2]![p] = straight[p * 4]!;
    }
    const blurred = gaussBlur(planes, W, H, sigma);

    let maxDY = 0;
    if (thrUI > 0) {
      for (let p = 0; p < n; p += 1) {
        const dB = f32(planes[0]![p]! - blurred[0]![p]!);
        const dG = f32(planes[1]![p]! - blurred[1]![p]!);
        const dR = f32(planes[2]![p]! - blurred[2]![p]!);
        const dY = Math.abs(lumaDetail(dB, dG, dR));
        if (dY > maxDY) maxDY = dY;
      }
    }
    const thr = f32(f32(thrUI) * maxDY);
    const famt = f32(amt);
    const wB = W_B;
    const wG = W_G;
    const wR = W_R;
    const halo = (v: number): number => f32(f32(255 - Math.abs(v)) * f32(1 / 255));
    const outC = [0, 0, 0];
    for (let p = 0; p < n; p += 1) {
      const sB = planes[0]![p]!;
      const sG = planes[1]![p]!;
      const sR = planes[2]![p]!;
      const bB = blurred[0]![p]!;
      const bG = blurred[1]![p]!;
      const bR = blurred[2]![p]!;
      const dB = f32(sB - bB);
      const dG = f32(sG - bG);
      const dR = f32(sR - bR);
      const dY = lumaDetail(dB, dG, dR);
      if (Math.abs(dY) < thr) continue;
      if (mode === 1) {
        if (channel === 1) {
          const inc = f32(famt * dY);
          outC[0] = f32(bB + f32(inc * wB));
          outC[1] = f32(bG + f32(inc * wG));
          outC[2] = f32(bR + f32(inc * wR));
        } else if (channel === 2) {
          outC[0] = f32(bB + f32(famt * f32(dB - f32(dY * wB))));
          outC[1] = f32(bG + f32(famt * f32(dG - f32(dY * wG))));
          outC[2] = f32(bR + f32(famt * f32(dR - f32(dY * wR))));
        } else {
          outC[0] = f32(bB + f32(famt * dB));
          outC[1] = f32(bG + f32(famt * dG));
          outC[2] = f32(bR + f32(famt * dR));
        }
      } else if (channel === 1) {
        const inc = f32(f32(famt * dY) * halo(dY));
        outC[0] = f32(sB + inc);
        outC[1] = f32(sG + inc);
        outC[2] = f32(sR + inc);
      } else if (channel === 2) {
        const cB = f32(dB - dY);
        const cG = f32(dG - dY);
        const cR = f32(dR - dY);
        outC[0] = f32(sB + f32(f32(famt * cB) * halo(cB)));
        outC[1] = f32(sG + f32(f32(famt * cG) * halo(cG)));
        outC[2] = f32(sR + f32(f32(famt * cR) * halo(cR)));
      } else {
        outC[0] = f32(sB + f32(f32(famt * dB) * halo(dB)));
        outC[1] = f32(sG + f32(f32(famt * dG) * halo(dG)));
        outC[2] = f32(sR + f32(f32(famt * dR) * halo(dR)));
      }
      planes[0]![p] = Math.trunc(f32(Math.min(255, Math.max(0, outC[0]!)) + 0.5));
      planes[1]![p] = Math.trunc(f32(Math.min(255, Math.max(0, outC[1]!)) + 0.5));
      planes[2]![p] = Math.trunc(f32(Math.min(255, Math.max(0, outC[2]!)) + 0.5));
    }
    // Back to premultiplied RGBA (what drawing the ARGB32 frame would produce).
    for (let p = 0; p < n; p += 1) {
      const a = alpha[p]!;
      d[p * 4] = byteMul(planes[2]![p]!, a);
      d[p * 4 + 1] = byteMul(planes[1]![p]!, a);
      d[p * 4 + 2] = byteMul(planes[0]![p]!, a);
    }
  },
};
