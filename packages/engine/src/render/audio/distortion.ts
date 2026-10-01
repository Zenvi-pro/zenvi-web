/**
 * Distortion, ported from libopenshot src/audio_effects/Distortion.cpp:47-161.
 *
 * Per sample: input gain (`int(input_gain)` dB), a waveshaper picked by
 * `distortion_type`, a first-order high shelf at ω = 0.01π with gain
 * `10^(tone/20)` (new, zeroed filters every frame, so its state never
 * crosses a frame boundary), then output gain (`int(output_gain)` dB).
 * The shelf coefficients are fused double multiply-adds on arm64.
 */

import type { AudioKernel } from "../types.js";
import { int, num } from "../kernels/params.js";
import { exp10f, expf } from "./apple-libm.js";
import { f32, fma64, fmaf } from "./float.js";
import { IIRFilter, iirCoefficients } from "./iir.js";
import { exp10 } from "./libm.js";

export const HARD_CLIPPING = 0;
export const SOFT_CLIPPING = 1;
export const EXPONENTIAL = 2;
export const FULL_WAVE_RECTIFIER = 3;
export const HALF_WAVE_RECTIFIER = 4;

const POINT_05 = f32(0.05);
const THIRD = f32(1 / 3);
const TWO_THIRDS = f32(2 / 3);
/** `tan(discrete_frequency / 2)` for `discrete_frequency = M_PI * 0.01`. */
const TAN_HALF_WC = Math.tan((Math.PI * 0.01) / 2);

/** `Distortion::Filter::updateCoefficients(M_PI * 0.01, gain)` (Distortion.cpp:133-161). */
export function toneCoefficients(toneDb: number): Float32Array {
  const gain = exp10(f32(toneDb) * 0.05);
  const sqrtGain = Math.sqrt(gain);
  return iirCoefficients(
    fma64(sqrtGain, TAN_HALF_WC, gain),
    fma64(sqrtGain, TAN_HALF_WC, -gain),
    0,
    fma64(sqrtGain, TAN_HALF_WC, 1),
    fma64(sqrtGain, TAN_HALF_WC, -1),
    0,
  );
}

/**
 * The waveshaper (Distortion.cpp:72-122). libopenshot leaves `out`
 * uninitialized for an unknown type (it keeps whatever the register held);
 * here an unknown type passes the sample through.
 */
function shape(type: number, x: number): number {
  switch (type) {
    case HARD_CLIPPING:
      return x > 0.5 ? 0.5 : x < -0.5 ? -0.5 : x;
    case SOFT_CLIPPING: {
      let out: number;
      if (x > TWO_THIRDS) out = 1;
      else if (x > THIRD) {
        const t = fmaf(x, -3, 2);
        out = f32(1 + f32(f32(t * t) / -3));
      } else if (x < -TWO_THIRDS) out = -1;
      else if (x < -THIRD) {
        const t = fmaf(x, 3, 2);
        out = f32(f32(f32(t * t) / 3) - 1);
      } else out = f32(x + x);
      return f32(out * 0.5);
    }
    case EXPONENTIAL:
      return x > 0 ? f32(1 - expf(-x)) : f32(expf(x) - 1);
    case FULL_WAVE_RECTIFIER:
      return Math.abs(x);
    case HALF_WAVE_RECTIFIER:
      return x > 0 ? x : 0;
    default:
      return x;
  }
}

/** libopenshot `Distortion`. */
export const distortion: AudioKernel = (channels, _sampleRate, params) => {
  const type = int(params, "distortion_type", HARD_CLIPPING);
  const inputGain = exp10f(f32(Math.trunc(num(params, "input_gain", 10)) * POINT_05));
  const outputGain = exp10f(f32(Math.trunc(num(params, "output_gain", -10)) * POINT_05));
  const coefficients = toneCoefficients(num(params, "tone", 5));
  for (const data of channels) {
    const filter = new IIRFilter();
    filter.setCoefficients(coefficients);
    for (let i = 0; i < data.length; i += 1) {
      const filtered = filter.processSample(shape(type, f32(data[i]! * inputGain)));
      data[i] = f32(filtered * outputGain);
    }
  }
};
