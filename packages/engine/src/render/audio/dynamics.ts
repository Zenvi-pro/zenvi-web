/**
 * Compressor and Expander, ported from libopenshot
 * src/audio_effects/Compressor.cpp:48-113 and Expander.cpp:52-119.
 *
 * Per sample on the mono mix `x` of all channels: a level in dB, a static
 * gain curve above (Compressor) or below (Expander) `threshold`, one-pole
 * attack/release smoothing of the gain reduction, then every channel is
 * scaled by `10^((makeup_gain - yl) / 20)`. `attack`/`release` are seconds
 * (the UI says ms): `alpha = powf(1/e, (1/sr) / t)`, 0 when t = 0.
 * Float math follows the arm64 disassembly: `powf(x, 2.0f)` is `x*x`,
 * `powf(10.0f, x)` is `__exp10f(x)`, and `fmaf` marks each fused `fmadd`.
 */

import type { AudioKernel } from "../types.js";
import { num } from "../kernels/params.js";
import type { Params } from "../kernels/types.js";
import { exp10f, powf } from "./apple-libm.js";
import { f32, fmaf } from "./float.js";
import { log10f } from "./libm.js";

/** `1.0f / M_E`. */
const INV_E = f32(1 / Math.E);
const LEVEL_FLOOR = f32(1e-6);
const POINT_05 = f32(0.05);
/** Expander level smoothing: `0.9999f` and `1.0f - 0.9999f`. */
const AVERAGE = f32(0.9999);
const AVERAGE_REST = f32(1 - AVERAGE);

/** `calculateAttackOrRelease` (Compressor.cpp:107-113). */
function attackOrRelease(seconds: number, inverseSampleRate: number): number {
  const v = f32(seconds);
  return v === 0 ? 0 : powf(INV_E, f32(inverseSampleRate / v));
}

/**
 * `mixed_down_input`: `AudioBuffer::addFrom` with gain `1/C` per channel —
 * `vDSP_vsmul` for the first channel, `vDSP_vsma` (a fused multiply-add:
 * checked on 2^20 inputs against `fmaf`) for the rest, a copy when there is
 * one channel.
 */
function mixDown(channels: Float32Array[], n: number, out: Float32Array): void {
  const count = channels.length;
  if (count === 1) {
    out.set(channels[0]!.subarray(0, n));
    return;
  }
  const g = f32(1 / count);
  const first = channels[0]!;
  for (let i = 0; i < n; i += 1) out[i] = first[i]! * g;
  for (let c = 1; c < count; c += 1) {
    const ch = channels[c]!;
    for (let i = 0; i < n; i += 1) out[i] = fmaf(ch[i]!, g, out[i]!);
  }
}

class DynamicsState {
  /** Expander only: the smoothed squared level. */
  inputLevel = 0;
  ylPrev = 0;
  mono = new Float32Array(0);
}

function stateOf(state: Map<string, unknown>, key: string): DynamicsState {
  const s = state.get(key);
  if (s instanceof DynamicsState) return s;
  const fresh = new DynamicsState();
  state.set(key, fresh);
  return fresh;
}

interface Settings {
  threshold: number;
  ratio: number;
  alphaA: number;
  alphaR: number;
  gain: number;
}

/** Shared preamble: bypass, the mono mix and the per-frame parameters. Returns null when bypassed. */
function prepare(channels: Float32Array[], sampleRate: number, p: Params, st: DynamicsState): Settings | null {
  if (num(p, "bypass", 0) !== 0) return null;
  const n = channels[0]?.length ?? 0;
  if (st.mono.length < n) st.mono = new Float32Array(n);
  mixDown(channels, n, st.mono);
  const inverseSampleRate = f32(1 / f32(sampleRate));
  return {
    threshold: f32(num(p, "threshold", -10)),
    ratio: f32(num(p, "ratio", 1)),
    alphaA: attackOrRelease(num(p, "attack", 1), inverseSampleRate),
    alphaR: attackOrRelease(num(p, "release", 1), inverseSampleRate),
    gain: f32(num(p, "makeup_gain", 1)),
  };
}

function applyControl(channels: Float32Array[], i: number, control: number): void {
  for (const ch of channels) ch[i] = ch[i]! * control;
}

/** libopenshot `Compressor`. */
export const compressor: AudioKernel = (channels, sampleRate, params, state) => {
  const st = stateOf(state, "Compressor");
  const s = prepare(channels, sampleRate, params, st);
  if (!s) return;
  const n = channels[0]?.length ?? 0;
  const mono = st.mono;
  let ylPrev = st.ylPrev;
  for (let i = 0; i < n; i += 1) {
    const m = mono[i]!;
    const level = f32(m * m);
    const xg = level <= LEVEL_FLOOR ? -60 : f32(10 * log10f(level));
    const yg = xg < s.threshold ? xg : f32(f32(f32(xg - s.threshold) / s.ratio) + s.threshold);
    const xl = f32(xg - yg);
    const alpha = xl > ylPrev ? s.alphaA : s.alphaR;
    // alpha·yl_prev + (1 − alpha)·xl: the first product is fused into the sum.
    const yl = fmaf(alpha, ylPrev, f32(f32(1 - alpha) * xl));
    const control = exp10f(f32(f32(s.gain - yl) * POINT_05));
    ylPrev = yl;
    applyControl(channels, i, control);
  }
  st.ylPrev = ylPrev;
};

/** libopenshot `Expander`. */
export const expander: AudioKernel = (channels, sampleRate, params, state) => {
  const st = stateOf(state, "Expander");
  const s = prepare(channels, sampleRate, params, st);
  if (!s) return;
  const n = channels[0]?.length ?? 0;
  const mono = st.mono;
  let level = st.inputLevel;
  let ylPrev = st.ylPrev;
  for (let i = 0; i < n; i += 1) {
    const m = mono[i]!;
    // 0.9999f·level + (1 − 0.9999f)·x², the first product fused; persists across frames.
    level = fmaf(level, AVERAGE, f32(f32(m * m) * AVERAGE_REST));
    const xg = level <= LEVEL_FLOOR ? -60 : f32(10 * log10f(level));
    // T + (xg − T)·R, fused.
    const yg = xg > s.threshold ? xg : fmaf(f32(xg - s.threshold), s.ratio, s.threshold);
    const xl = f32(xg - yg);
    const alpha = xl < ylPrev ? s.alphaA : s.alphaR;
    const yl = fmaf(alpha, ylPrev, f32(f32(1 - alpha) * xl));
    const control = exp10f(f32(f32(s.gain - yl) * POINT_05));
    ylPrev = yl;
    applyControl(channels, i, control);
  }
  st.inputLevel = level;
  st.ylPrev = ylPrev;
};
