/**
 * libopenshot `FrameScope` video analysis (src/FrameScope.cpp,
 * `analyze_video` and `SetVideoRegionNormalized`): the numbers behind the
 * Histogram, Waveform and Vectorscope docks, which zenvi-core's colour tools
 * read (editor_tools/effects_color_analysis.py `scope_data`, tool_handlers.py
 * `_framescope_from_frame`).
 *
 * Input is a premultiplied frame, like a libopenshot `Frame` image
 * (`Format_RGBA8888_Premultiplied`); transparent pixels are skipped and the
 * others un-premultiplied in float, as the C++ does. The float32 arithmetic
 * is reproduced with `Math.fround`, with the fused multiply-adds libopenshot's
 * build uses for the vectorscope (goldens: scripts/parity/frame_scope_goldens.py).
 * The luma waveform is not computed: no tool reads it.
 */

import type { PremulImage } from "./pixels.js";

const f32 = Math.fround;
/** `fmaf`: the float product is exact in double, so one rounding to float remains. */
const fma = (a: number, b: number, c: number): number => f32(a * b + c);
const INV_255 = f32(1 / 255);
const U_MAX = f32(0.436);
const V_MAX = f32(0.615);
const K_R = f32(0.299);
const K_G = f32(0.587);
const K_B = f32(0.114);
const U_R = f32(-0.14713);
const U_G = f32(0.28886);
const U_B = f32(0.436);
const V_R = f32(0.615);
const V_G = f32(0.51499);
const V_B = f32(0.10001);

/** `inv_alpha_lut`: 255 / alpha as float. */
const INV_ALPHA = Float32Array.from({ length: 256 }, (_, i) => (i === 0 ? 0 : f32(255 / i)));

/** A normalized region of interest (fractions of the frame, origin top-left). */
export interface ScopeRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameScopeOptions {
  /** `SetVectorscopeSize` (default 256). */
  vectorscopeSize?: number;
  /** `SetVideoRegionNormalized`. */
  region?: ScopeRegion;
}

export interface FrameScopeVideo {
  /** Analyzed width and height (the region's, when there is one). */
  width: number;
  height: number;
  /** 256-bin histograms of the opaque-enough pixels. */
  luma: Uint32Array;
  red: Uint32Array;
  green: Uint32Array;
  blue: Uint32Array;
  /** `vectorscopeSize`² counts, row-major, V up. */
  vectorscope: Uint32Array;
  vectorscopeSize: number;
  avgLuma: number;
  clippedShadows: number;
  clippedHighlights: number;
  clippedRed: number;
  clippedGreen: number;
  clippedBlue: number;
  /** Pixels counted (alpha > 0). */
  pixelCount: number;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** `(int)(v)` for the non-negative values FrameScope truncates. */
function trunc(v: number): number {
  return v < 0 ? Math.ceil(v) : Math.floor(v);
}

/** Analyze one frame's picture; null when it has no pixels (`HasVideo()` false). */
export function analyzeFrameScope(image: PremulImage, options: FrameScopeOptions = {}): FrameScopeVideo | null {
  const width = image.width;
  const height = image.height;
  if (width <= 0 || height <= 0) return null;
  const size = Math.max(1, Math.trunc(options.vectorscopeSize ?? 256));

  let startX = 0;
  let endX = width;
  let startY = 0;
  let endY = height;
  const region = options.region;
  if (region) {
    const rx = f32(Math.max(0, Math.min(1, f32(region.x))));
    const ry = f32(Math.max(0, Math.min(1, f32(region.y))));
    const rw = f32(Math.max(0, Math.min(f32(1 - rx), f32(region.width))));
    const rh = f32(Math.max(0, Math.min(f32(1 - ry), f32(region.height))));
    if (rw > 0 && rh > 0) {
      startX = clampInt(Math.floor(f32(rx * width)), 0, width - 1);
      startY = clampInt(Math.floor(f32(ry * height)), 0, height - 1);
      endX = clampInt(Math.ceil(f32(f32(rx + rw) * width)), startX + 1, width);
      endY = clampInt(Math.ceil(f32(f32(ry + rh) * height)), startY + 1, height);
    }
  }

  const luma = new Uint32Array(256);
  const red = new Uint32Array(256);
  const green = new Uint32Array(256);
  const blue = new Uint32Array(256);
  const vectorscope = new Uint32Array(size * size);
  const center = f32((size - 1) * 0.5);
  const scale = center;
  let lumaSum = 0;
  let count = 0;
  let clippedShadows = 0;
  let clippedHighlights = 0;
  let clippedRed = 0;
  let clippedGreen = 0;
  let clippedBlue = 0;
  const d = image.data;

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const i = (y * width + x) * 4;
      const alpha = d[i + 3]!;
      if (alpha <= 0) continue;
      const r = d[i]!;
      const g = d[i + 1]!;
      const b = d[i + 2]!;
      let rf: number;
      let gf: number;
      let bf: number;
      let ri: number;
      let gi: number;
      let bi: number;
      if (alpha === 255) {
        rf = f32(r * INV_255);
        gf = f32(g * INV_255);
        bf = f32(b * INV_255);
        ri = r;
        gi = g;
        bi = b;
      } else {
        const invA = INV_ALPHA[alpha]!;
        rf = Math.min(1, f32(f32(r * invA) * INV_255));
        gf = Math.min(1, f32(f32(g * invA) * INV_255));
        bf = Math.min(1, f32(f32(b * invA) * INV_255));
        ri = trunc(f32(f32(rf * 255) + 0.5));
        gi = trunc(f32(f32(gf * 255) + 0.5));
        bi = trunc(f32(f32(bf * 255) + 0.5));
      }
      const l = f32(f32(f32(K_R * rf) + f32(K_G * gf)) + f32(K_B * bf));
      const li = trunc(f32(f32(l * 255) + 0.5));
      // libopenshot's build contracts these two into fused multiply-adds (checked against its vectorscope).
      const u = fma(U_B, bf, fma(-U_G, gf, f32(U_R * rf)));
      const v = fma(-V_B, bf, fma(-V_G, gf, f32(V_R * rf)));
      const nu = f32(u / U_MAX);
      const nv = f32(v / V_MAX);
      const vx = clampInt(trunc(f32(f32(center + f32(nu * scale)) + 0.5)), 0, size - 1);
      const vy = clampInt(trunc(f32(f32(center - f32(nv * scale)) + 0.5)), 0, size - 1);
      luma[li]! += 1;
      red[ri]! += 1;
      green[gi]! += 1;
      blue[bi]! += 1;
      vectorscope[vy * size + vx]! += 1;
      lumaSum += l;
      count += 1;
      if (li <= 2) clippedShadows += 1;
      if (li >= 253) clippedHighlights += 1;
      if (ri >= 253) clippedRed += 1;
      if (gi >= 253) clippedGreen += 1;
      if (bi >= 253) clippedBlue += 1;
    }
  }

  return {
    width: Math.max(1, endX - startX),
    height: Math.max(1, endY - startY),
    luma,
    red,
    green,
    blue,
    vectorscope,
    vectorscopeSize: size,
    avgLuma: count > 0 ? lumaSum / count : 0,
    clippedShadows,
    clippedHighlights,
    clippedRed,
    clippedGreen,
    clippedBlue,
    pixelCount: count,
  };
}
