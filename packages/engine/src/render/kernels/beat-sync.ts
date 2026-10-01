/**
 * BeatSync, ported from libopenshot 1.0 src/effects/BeatSync.cpp:28-209.
 *
 * Band-limited energy of this frame's audio (difference of two one-pole
 * low-passes, RMS and peak) → attack/decay envelope → threshold → response
 * curve → a solid color between `low_color` and `high_color` that
 * *replaces* the frame image.
 *
 * The envelope and the last frame number are per-instance state
 * (`ctx.state`): a jump of two or more frames resets the envelope like the
 * desktop's preview seek (:158-161). Without `ctx.state` every frame starts
 * from a fresh effect.
 *
 * Float steps follow the arm64 build (`scratchpad/disfn.sh 8BeatSync8GetFrame`):
 * the filters are fused `lp += a*(x - lp)`, the envelope is
 * `fma(coef, env, raw*(1 - coef))`, `blend = int(fma(r, 256, 0.5))`, and only
 * the coefficient of the taken branch is computed (one `expf`).
 */

import { byteMul, createPremul, fillPremul, type PremulImage } from "../pixels.js";
import { fmaf } from "../qt/fma.js";
import { evaluateAnimatedCurve, sampleCurve, type EvaluatedCurve } from "../plan/effect-params.js";
import type { EvaluatedParam, KernelContext, RGBA } from "../types.js";
import { bool, color, getInt, num, record } from "./params.js";
import type { KernelSpec, Params } from "./types.js";

const f32 = Math.fround;
const TWO_PI_F = f32(2 * f32(Math.PI));
const ONE_24TH = f32(1 / 24);
const MS = f32(0.001);

function clampf(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** `normalized_frequency_to_hz`: `20 * powf(1000, clamp01(v))` (:44-49). */
function normalizedToHz(v: number): number {
  return f32(20 * f32(Math.pow(1000, clampf(v, 0, 1))));
}

/** Planar audio of this frame: one array per channel, all the same length. */
interface FrameAudio {
  sampleRate: number;
  channels: readonly Float32Array[];
}

function sampleCount(audio: FrameAudio | undefined): number {
  return audio && audio.channels.length > 0 ? audio.channels[0]!.length : 0;
}

/** `band_energy` (:63-108): bandpass RMS/peak of the channel mean, scaled by gain, clamped to 0..1. */
export function bandEnergy(audio: FrameAudio | undefined, lowHz: number, highHz: number, gain: number): number {
  const samples = sampleCount(audio);
  const channels = audio ? audio.channels.length : 0;
  if (!audio || samples <= 0 || channels <= 0) return 0;
  const sampleRate = Math.max(1, Math.trunc(audio.sampleRate));
  const nyquist = f32(sampleRate * 0.5);
  const low = clampf(lowHz, 0, f32(nyquist - 1));
  const high = clampf(highHz, f32(low + 1), nyquist);
  const dt = f32(1 / sampleRate);
  const alphaHi = f32(dt / f32(dt + f32(1 / f32(TWO_PI_F * high))));
  const alphaLo = low > 1 ? f32(dt / f32(dt + f32(1 / f32(TWO_PI_F * low)))) : 0;
  const ch = audio.channels;
  let lpHi = 0;
  let lpLo = 0;
  let sumSq = 0;
  let peak = 0;
  for (let s = 0; s < samples; s += 1) {
    let x = 0;
    for (let c = 0; c < channels; c += 1) x = f32(x + ch[c]![s]!);
    x = f32(x / channels);
    lpHi = fmaf(alphaHi, f32(x - lpHi), lpHi);
    lpLo = fmaf(alphaLo, f32(x - lpLo), lpLo);
    const filtered = f32(lpHi - lpLo);
    sumSq += f32(filtered * filtered);
    const absV = Math.abs(filtered);
    if (peak < absV) peak = absV;
  }
  const rms = f32(Math.sqrt(f32(sumSq / samples)));
  const a = f32(rms * f32(3.6));
  const b = f32(peak * f32(1.15));
  const combined = a < b ? b : a;
  return clampf(f32(gain * combined), 0, 1);
}

function isCurve(v: EvaluatedParam | undefined): v is { enabled: number; table: number[] } & { [key: string]: EvaluatedParam } {
  return typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.enabled === "number" && Array.isArray(v.table);
}

/**
 * The evaluated `response_curve`, or the constructor default: the identity
 * curve (AnimatedCurve.cpp:103-107), which still quantizes to 256 steps.
 */
function responseCurve(params: Params, frame: number): EvaluatedCurve {
  const v = record(params, "response_curve");
  if (!isCurve(v)) return evaluateAnimatedCurve({}, frame);
  return { enabled: v.enabled, table: v.table.map((x) => (typeof x === "number" ? x : 0)) };
}

/** `blend_channel` (:39-41). */
function blendChannel(low: number, high: number, inv: number, blend: number): number {
  return (clampf(low, 0, 255) * inv + clampf(high, 0, 255) * blend) >> 8;
}

const ENVELOPE = "BeatSync.envelope";
const LAST_FRAME = "BeatSync.lastFrame";

export const beatSync: KernelSpec = {
  type: "BeatSync",
  supported: true,
  run(image: PremulImage, params: Params, ctx: KernelContext): PremulImage {
    const frame = ctx.frame;
    let width = Math.max(1, image.width);
    let height = Math.max(1, image.height);
    if (width <= 1 || height <= 1) {
      const tw = Math.trunc(ctx.timelineWidth ?? ctx.canvasWidth);
      const th = Math.trunc(ctx.timelineHeight ?? ctx.canvasHeight);
      if (tw > 1 && th > 1) {
        width = tw;
        height = th;
      }
    }

    // Seek reset (:158-161).
    const state = ctx.state;
    let envelope = typeof state?.get(ENVELOPE) === "number" ? (state.get(ENVELOPE) as number) : 0;
    const lastFrame = typeof state?.get(LAST_FRAME) === "number" ? (state.get(LAST_FRAME) as number) : -1;
    if (lastFrame >= 0 && Math.abs(frame - lastFrame) >= 2) envelope = 0;

    const lowHz = normalizedToHz(f32(num(params, "frequency_low", 0)));
    const highHz = Math.max(f32(lowHz + 1), normalizedToHz(f32(num(params, "frequency_high", 1))));
    const gain = Math.max(f32(0.01), f32(num(params, "intensity", 2)));
    const audio = ctx.audio;
    const raw = bandEnergy(audio, lowHz, highHz, gain);

    // Envelope follower (:172-184): only the taken branch's coefficient.
    const samples = sampleCount(audio);
    const sampleRate = Math.max(1, Math.trunc(audio?.sampleRate ?? 0));
    const frameSec = samples > 0 ? f32(samples / sampleRate) : ONE_24TH;
    const ms = f32(raw > envelope ? num(params, "attack_ms", 10) : num(params, "decay_ms", 200));
    const tau = ms < 1 ? MS : f32(clampf(ms, 1, 5000) * MS);
    const coef = f32(Math.exp(f32(-frameSec / tau)));
    envelope = fmaf(coef, envelope, f32(raw * f32(1 - coef)));
    if (state) {
      state.set(ENVELOPE, envelope);
      state.set(LAST_FRAME, frame);
    }

    // Threshold, invert, response curve (:187-198).
    const thr = clampf(f32(num(params, "threshold", 0.1)), 0, 1);
    let energy = 0;
    if (envelope > thr) energy = clampf(f32(f32(envelope - thr) / Math.max(f32(1 - thr), MS)), 0, 1);
    if (bool(params, "invert", false)) energy = f32(1 - energy);
    const response = clampf(sampleCurve(responseCurve(params, frame), energy), 0, 1);
    const blend = clampf(Math.trunc(fmaf(response, 256, 0.5)), 0, 256);
    const inv = 256 - blend;

    const low = color(params, "low_color", [0, 0, 0, 255]);
    const high = color(params, "high_color", [255, 255, 255, 255]);
    const ch = (i: number): number => blendChannel(getInt((low as RGBA)[i]!), getInt((high as RGBA)[i]!), inv, blend);
    const r = ch(0);
    const g = ch(1);
    const b = ch(2);
    const a = ch(3);
    // QImage::fill(QColor) on RGBA8888_Premultiplied: 8-bit qPremultiply.
    const out = createPremul(width, height);
    fillPremul(out, byteMul(r, a), byteMul(g, a), byteMul(b, a), a);
    return out;
  },
};
