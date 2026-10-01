/**
 * DenoiseImage, ported from libopenshot 1.0 src/effects/DenoiseImage.cpp:
 * two-scale box decomposition with soft shrinkage (:79-116 tables, :160-291
 * blurs, :293-299 shrink, :344-540 per pixel) and a temporal blend with the
 * previous frame's *input*.
 *
 * Float32 on un-premultiplied 0..255 values. The arm64 build fuses the
 * table builds, `shrink`'s `threshold*keep + (|v| - threshold)`, luma
 * (`fma(0.114, b, fma(0.299, r, 0.587*g))`) and the temporal lerps; the box
 * blurs are plain float sums (checked in the disassembly).
 *
 * State (`ctx.state`): the previous input and the frame it belonged to. The
 * blend runs only when that frame was exactly `frame - 1` at the same size.
 * History resets when strength <= 0 or temporal == 0; libopenshot also
 * resets it on every `SetJson` (:584), which renderers mirror by clearing
 * `ctx.state` when the effect's JSON changes.
 */

import type { PremulImage } from "../pixels.js";
import { DENOISE_RESPONSE_NODES, evaluateAnimatedCurve } from "../plan/effect-params.js";
import type { KernelContext } from "../types.js";
import { num, numbers, record } from "./params.js";
import type { KernelSpec, Params } from "./types.js";

const f32 = Math.fround;
const INV_255 = f32(1 / 255);
const INV_255_THIRD = f32(INV_255 / 3);
const LUMA_R = f32(0.299);
const LUMA_G = f32(0.587);
const LUMA_B = f32(0.114);

/** DenoiseImage's default response curve (shared with the planner, which keeps it for `nodes: []`). */
export { DENOISE_RESPONSE_NODES };

function fmaf(a: number, b: number, c: number): number {
  return f32(a * b + c);
}

function clamp01(v: number): number {
  return v < 1 ? (v > 0 ? v : 0) : 1;
}

function clampByte(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return Math.trunc(f32(v + 0.5));
}

function luma(r: number, g: number, b: number): number {
  return fmaf(LUMA_B, b, fmaf(r, LUMA_R, f32(LUMA_G * g)));
}

/** `shrink_detail` (DenoiseImage.cpp:293-299). */
function shrink(value: number, threshold: number, keep: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= threshold) return f32(value * keep);
  const kept = fmaf(threshold, keep, f32(magnitude - threshold));
  return value < 0 ? -kept : kept;
}

/** `smoothstep` (DenoiseImage.cpp:42-47). */
function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01(f32(f32(value - edge0) / f32(edge1 - edge0)));
  return f32(f32(t * t) * fmaf(t, -2, 3));
}

let defaultResponse: readonly number[] | undefined;

/**
 * `build_response_lut` (DenoiseImage.cpp:53-64) from the evaluated
 * `response_curve`: `{ enabled, table }`, or a partial object / nothing when
 * the JSON had no nodes (libopenshot then keeps its default nodes).
 */
function responseLut(params: Params): Float32Array {
  const lut = new Float32Array(256);
  const curve = record(params, "response_curve");
  const enabled = curve ? num(curve, "enabled", 1) : 1;
  if (enabled < 0.5) return lut.fill(1);
  let table = curve ? numbers(curve, "table") : undefined;
  if (!table || table.length < 256) {
    defaultResponse ??= evaluateAnimatedCurve(undefined, 1, [...DENOISE_RESPONSE_NODES]).table;
    table = defaultResponse as number[];
  }
  for (let i = 0; i < 256; i += 1) lut[i] = f32(table[i]!);
  return lut;
}

interface PixelLut {
  fineThreshold: Float32Array;
  midThreshold: Float32Array;
  fineKeep: Float32Array;
  midKeep: Float32Array;
  chromaFineThresholdRB: Float32Array;
  chromaFineThresholdG: Float32Array;
  chromaMidThreshold: Float32Array;
  chromaFineKeep: Float32Array;
  chromaMidKeep: Float32Array;
  temporalMixBase: Float32Array;
}

/** `build_pixel_lut` (DenoiseImage.cpp:79-116). */
function buildPixelLut(responses: Float32Array, strength: number, detail: number, temporal: number, colorNoise: number): PixelLut {
  const lut: PixelLut = {
    fineThreshold: new Float32Array(256),
    midThreshold: new Float32Array(256),
    fineKeep: new Float32Array(256),
    midKeep: new Float32Array(256),
    chromaFineThresholdRB: new Float32Array(256),
    chromaFineThresholdG: new Float32Array(256),
    chromaMidThreshold: new Float32Array(256),
    chromaFineKeep: new Float32Array(256),
    chromaMidKeep: new Float32Array(256),
    temporalMixBase: new Float32Array(256),
  };
  const overdrive = f32(strength * fmaf(f32(f32(0.85) * strength), strength, 1));
  const structuralKeep = f32(detail * fmaf(detail, f32(0.34), f32(0.62)));
  const fineKeepFloor = f32(f32(f32(detail * detail) * detail) * f32(0.35));
  const inverseDetail = f32(1 - detail);
  const fineThresholdScale = fmaf(inverseDetail, 42, 24);
  const midThresholdScale = fmaf(inverseDetail, 20, 9);
  const fineKeepScale = fmaf(inverseDetail, f32(0.24), f32(0.95));
  const midKeepScale = fmaf(inverseDetail, f32(0.22), f32(0.46));
  const chromaScaleRB = fmaf(colorNoise, f32(0.55), f32(0.75));
  const chromaScaleG = fmaf(colorNoise, f32(0.45), f32(0.8));
  const chromaMidScale = fmaf(colorNoise, f32(0.45), f32(0.85));
  const temporalScale = f32(strength * temporal);
  for (let i = 0; i < 256; i += 1) {
    const response = responses[i]!;
    const noise = f32(overdrive * response);
    const fineThreshold = fmaf(noise, fineThresholdScale, 4);
    const midThreshold = fmaf(noise, midThresholdScale, 2);
    const fineCandidate = fmaf(-noise, fineKeepScale, 1);
    const fineKeep = fineCandidate > fineKeepFloor ? fineCandidate : fineKeepFloor;
    const midCandidate = fmaf(-noise, midKeepScale, 1);
    const midKeep = midCandidate > structuralKeep ? midCandidate : structuralKeep;
    // `fine_keep - (cn * noise * 0.55f)`: the product cn*noise rounds, the 0.55 is fused.
    const noiseColor = f32(-noise * colorNoise);
    const chromaFineKeep = fmaf(f32(0.55), noiseColor, fineKeep);
    const chromaMidKeep = fmaf(0.25, noiseColor, midKeep);
    lut.fineThreshold[i] = fineThreshold;
    lut.midThreshold[i] = midThreshold;
    lut.fineKeep[i] = fineKeep;
    lut.midKeep[i] = midKeep;
    lut.chromaFineThresholdRB[i] = f32(fineThreshold * chromaScaleRB);
    lut.chromaFineThresholdG[i] = f32(fineThreshold * chromaScaleG);
    lut.chromaMidThreshold[i] = f32(midThreshold * chromaMidScale);
    lut.chromaFineKeep[i] = chromaFineKeep > 0 ? chromaFineKeep : 0;
    lut.chromaMidKeep[i] = chromaMidKeep > 0 ? chromaMidKeep : 0;
    lut.temporalMixBase[i] = f32(response * temporalScale);
  }
  return lut;
}

/**
 * Float planes reused across calls (grow-only), like the C++
 * `thread_local DenoiseScratch` (DenoiseImage.cpp:118-144, :409-419): one
 * 1080p frame needs ~80 MB of planes, too much to reallocate per frame.
 * Kernels run synchronously, so one set per module instance is enough.
 */
type Planes = [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array];

const scratch = { capacity: 0, planes: [] as Float32Array[] };

/** Center r/g/b, blur tmp, fine r/g/b, base r/g/b. */
function scratchPlanes(count: number): Planes {
  if (count > scratch.capacity) {
    scratch.capacity = count;
    scratch.planes = Array.from({ length: 10 }, () => new Float32Array(count));
  }
  return scratch.planes.map((plane) => plane.subarray(0, count)) as Planes;
}

/** `read_unpremultiplied_rgb` (DenoiseImage.cpp:146-158) for every pixel, into planes. */
function unpremultiplyInto(data: Uint8ClampedArray, count: number, r: Float32Array, g: Float32Array, b: Float32Array): void {
  for (let p = 0; p < count; p += 1) {
    const i = p * 4;
    const a = data[i + 3]!;
    if (a === 255) {
      r[p] = data[i]!;
      g[p] = data[i + 1]!;
      b[p] = data[i + 2]!;
    } else {
      const u = a > 0 ? f32(255 / a) : 0;
      r[p] = f32(data[i]! * u);
      g[p] = f32(data[i + 1]! * u);
      b[p] = f32(data[i + 2]! * u);
    }
  }
}

/**
 * One plane of `box_blur_image_rgb` / `box_blur_rgb` (DenoiseImage.cpp:160-291):
 * separable clamp-to-edge running sums, horizontal into `tmp`, then vertical.
 */
function boxBlur(src: Float32Array, dst: Float32Array, tmp: Float32Array, width: number, height: number, radius: number): void {
  if (radius <= 0) {
    dst.set(src);
    return;
  }
  const invWindow = f32(1 / (radius * 2 + 1));
  const lead = radius + 1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = f32(src[row]! * lead);
    for (let i = 1; i <= radius; i += 1) sum = f32(sum + src[row + Math.min(i, width - 1)]!);
    for (let x = 0; x < width; x += 1) {
      tmp[row + x] = f32(sum * invWindow);
      const add = src[row + Math.min(x + radius + 1, width - 1)]!;
      const sub = src[row + Math.max(x - radius, 0)]!;
      sum = f32(sum + f32(add - sub));
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = f32(tmp[x]! * lead);
    for (let i = 1; i <= radius; i += 1) sum = f32(sum + tmp[Math.min(i, height - 1) * width + x]!);
    for (let y = 0; y < height; y += 1) {
      dst[y * width + x] = f32(sum * invWindow);
      const add = tmp[Math.min(y + radius + 1, height - 1) * width + x]!;
      const sub = tmp[Math.max(y - radius, 0) * width + x]!;
      sum = f32(sum + f32(add - sub));
    }
  }
}

interface DenoiseHistory {
  /** Premultiplied bytes of the previous frame's input, or null. */
  previous: Uint8ClampedArray | null;
  width: number;
  height: number;
  /** `last_frame_`; -1 when reset. */
  lastFrame: number;
}

const STATE_KEY = "DenoiseImage";

function history(ctx: KernelContext): DenoiseHistory {
  const existing = ctx.state?.get(STATE_KEY) as DenoiseHistory | undefined;
  if (existing) return existing;
  const fresh: DenoiseHistory = { previous: null, width: 0, height: 0, lastFrame: -1 };
  ctx.state?.set(STATE_KEY, fresh);
  return fresh;
}

/** `reset_temporal_history` (DenoiseImage.cpp:338-342). */
function resetHistory(h: DenoiseHistory): void {
  h.previous = null;
  h.lastFrame = -1;
}

export const denoiseImage: KernelSpec = {
  type: "DenoiseImage",
  supported: true,
  run(image: PremulImage, params: Params, ctx: KernelContext): void {
    const state = history(ctx);
    const strength = clamp01(f32(num(params, "strength", 0.78)));
    const width = image.width;
    const height = image.height;
    if (strength <= 0 || width <= 0 || height <= 0) {
      resetHistory(state);
      return;
    }
    const detail = clamp01(f32(num(params, "detail", 0.5)));
    const temporal = clamp01(f32(num(params, "temporal", 0.35)));
    const motionSafety = clamp01(f32(num(params, "motion_safety", 0.7)));
    const colorNoise = clamp01(f32(num(params, "color_noise", 0.7)));
    const frame = ctx.frame;

    const data = image.data;
    let inputCopy: Uint8ClampedArray | null = null;
    if (temporal > 0) inputCopy = new Uint8ClampedArray(data);
    else resetHistory(state);
    const prev =
      temporal > 0 && state.lastFrame >= 0 && frame === state.lastFrame + 1 && state.width === width && state.height === height
        ? state.previous
        : null;

    const lut = buildPixelLut(responseLut(params), strength, detail, temporal, colorNoise);
    const inverseDetail = f32(1 - detail);
    const gateScale = fmaf(inverseDetail, f32(0.55), f32(0.45));
    const lumaScale = fmaf(inverseDetail, f32(0.28), f32(0.32));
    const chromaScale = fmaf(colorNoise, f32(0.35), f32(0.65));
    const looseness = f32(1 - motionSafety);
    const motionLow = fmaf(looseness, f32(0.08), f32(0.02));
    const motionHigh = fmaf(looseness, f32(0.1), f32(motionLow + f32(0.055)));

    // Radii (DenoiseImage.cpp:421-428), compared in float.
    const fineRadius = 1 + (strength >= 0.75 && detail <= f32(0.45) ? 1 : 0);
    let coarseRadius = 3;
    if (strength >= f32(0.95) && detail <= f32(0.15)) coarseRadius = 8;
    else if (strength >= f32(0.8) && detail <= f32(0.35)) coarseRadius = 6;
    else if (strength >= f32(0.65) && detail <= f32(0.55)) coarseRadius = 5;

    const count = width * height;
    const [cr, cg, cb, tmp, fineR, fineG, fineB, baseR, baseG, baseB] = scratchPlanes(count);
    unpremultiplyInto(data, count, cr, cg, cb);
    boxBlur(cr, fineR, tmp, width, height, fineRadius);
    boxBlur(cg, fineG, tmp, width, height, fineRadius);
    boxBlur(cb, fineB, tmp, width, height, fineRadius);
    boxBlur(fineR, baseR, tmp, width, height, coarseRadius);
    boxBlur(fineG, baseG, tmp, width, height, coarseRadius);
    boxBlur(fineB, baseB, tmp, width, height, coarseRadius);

    // Each pixel reads only its own input bytes before writing them, so in place is safe.
    for (let p = 0; p < count; p += 1) {
      const i = p * 4;
      const centerR = cr[p]!;
      const centerG = cg[p]!;
      const centerB = cb[p]!;
      const fr = fineR[p]!;
      const fg = fineG[p]!;
      const fb = fineB[p]!;
      const br = baseR[p]!;
      const bg = baseG[p]!;
      const bb = baseB[p]!;
      const centerY = luma(centerR, centerG, centerB);
      const fineY = luma(fr, fg, fb);
      const baseY = luma(br, bg, bb);
      const k = clampByte(centerY);
      const chromaMidThreshold = lut.chromaMidThreshold[k]!;
      const chromaFineKeep = lut.chromaFineKeep[k]!;
      const chromaMidKeep = lut.chromaMidKeep[k]!;

      let outY = f32(
        f32(baseY + shrink(f32(fineY - baseY), lut.midThreshold[k]!, lut.midKeep[k]!)) +
          shrink(f32(centerY - fineY), lut.fineThreshold[k]!, lut.fineKeep[k]!),
      );
      let outR = f32(
        f32(br + shrink(f32(fr - br), chromaMidThreshold, chromaMidKeep)) +
          shrink(f32(centerR - fr), lut.chromaFineThresholdRB[k]!, chromaFineKeep),
      );
      let outG = f32(
        f32(bg + shrink(f32(fg - bg), chromaMidThreshold, chromaMidKeep)) +
          shrink(f32(centerG - fg), lut.chromaFineThresholdG[k]!, chromaFineKeep),
      );
      let outB = f32(
        f32(bb + shrink(f32(fb - bb), chromaMidThreshold, chromaMidKeep)) +
          shrink(f32(centerB - fb), lut.chromaFineThresholdRB[k]!, chromaFineKeep),
      );
      const correction = f32(outY - luma(outR, outG, outB));
      outR = f32(outR + correction);
      outG = f32(outG + correction);
      outB = f32(outB + correction);

      if (prev) {
        // The previous input, un-premultiplied like read_unpremultiplied_rgb (:485-495).
        const pa = prev[i + 3]!;
        const pu = pa === 255 ? 1 : pa > 0 ? f32(255 / pa) : 0;
        const prevR = pa === 255 ? prev[i]! : f32(prev[i]! * pu);
        const prevG = pa === 255 ? prev[i + 1]! : f32(prev[i + 1]! * pu);
        const prevB = pa === 255 ? prev[i + 2]! : f32(prev[i + 2]! * pu);
        const prevY = luma(prevR, prevG, prevB);
        const lumaMotion = f32(Math.abs(f32(centerY - prevY)) * INV_255);
        const colorMotion = f32(
          f32(f32(Math.abs(f32(centerR - prevR)) + Math.abs(f32(centerG - prevG))) + Math.abs(f32(centerB - prevB))) * INV_255_THIRD,
        );
        const colorMotionWeighted = f32(colorMotion * 0.75);
        const motion = lumaMotion < colorMotionWeighted ? colorMotionWeighted : lumaMotion;
        const gate = f32(1 - smoothstep(motionLow, motionHigh, motion));
        const blend = f32(f32(lut.temporalMixBase[k]! * gate) * gateScale);
        const mix = blend < f32(0.35) ? blend : f32(0.35);
        const lumaMix = f32(lumaScale * mix);
        const chromaMix = f32(chromaScale * mix);
        const chromaR = f32(outR - outY);
        const chromaG = f32(outG - outY);
        const chromaB = f32(outB - outY);
        outY = fmaf(f32(prevY - outY), lumaMix, outY);
        outR = f32(outY + fmaf(f32(f32(prevR - prevY) - chromaR), chromaMix, chromaR));
        outG = f32(outY + fmaf(f32(f32(prevG - prevY) - chromaG), chromaMix, chromaG));
        outB = f32(outY + fmaf(f32(f32(prevB - prevY) - chromaB), chromaMix, chromaB));
      }

      const a = data[i + 3]!;
      if (a === 255) {
        data[i] = clampByte(outR);
        data[i + 1] = clampByte(outG);
        data[i + 2] = clampByte(outB);
      } else {
        const premultiply = f32(a * INV_255);
        data[i] = clampByte(f32(premultiply * outR));
        data[i + 1] = clampByte(f32(premultiply * outG));
        data[i + 2] = clampByte(f32(premultiply * outB));
      }
    }

    if (temporal > 0) {
      state.previous = inputCopy;
      state.width = width;
      state.height = height;
    }
    state.lastFrame = frame;
  },
};
