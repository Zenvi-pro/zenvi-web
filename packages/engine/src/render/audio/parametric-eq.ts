/**
 * Parametric EQ, ported from libopenshot src/audio_effects/ParametricEQ.cpp:47-171:
 * one `juce::IIRFilter` per channel, created on the first frame and kept
 * (state carries across frames), with coefficients recomputed every frame
 * from `filter_type`, `frequency` (Hz), `gain` (dB) and `q_factor`.
 *
 * Parity divergence: libopenshot calls `updateFilters(frame_number,
 * num_samples)` (ParametricEQ.cpp:64), passing the frame's sample count where
 * the sample rate belongs, so its filters run at ω = 2πf / samples_per_frame
 * (e.g. a 500 Hz low-pass becomes ω ≈ 2 rad at 1600 samples per frame). This
 * kernel uses the real sample rate, ω = 2πf / sampleRate. Called with the
 * frame's sample count as `sampleRate` it reproduces the desktop bit for bit
 * (the parity test does exactly that).
 */

import type { AudioKernel } from "../types.js";
import { int, num } from "../kernels/params.js";
import { fma64 } from "./float.js";
import { IIRFilter, iirCoefficients } from "./iir.js";
import { exp10 } from "./libm.js";

export const LOW_PASS = 0;
export const HIGH_PASS = 1;
export const LOW_SHELF = 2;
export const HIGH_SHELF = 3;
export const BAND_PASS = 4;
export const BAND_STOP = 5;
export const PEAKING_NOTCH = 6;

const BANDWIDTH_LIMIT = Math.PI * 0.99;

/**
 * `ParametricEQ::Filter::updateCoefficients` (ParametricEQ.cpp:81-160):
 * bilinear first-order shelves/passes and second-order band filters.
 * Returns null for an unknown type (libopenshot then keeps the previous
 * coefficients).
 */
export function eqCoefficients(type: number, discreteFrequency: number, q: number, gain: number): Float32Array | null {
  const ratio = discreteFrequency / q;
  // jmin(ω/Q, 0.99π): a NaN ratio stays NaN.
  const bandwidth = BANDWIDTH_LIMIT < ratio ? BANDWIDTH_LIMIT : ratio;
  const twoCosWc = -2 * Math.cos(discreteFrequency);
  const tanHalfBw = Math.tan(bandwidth * 0.5);
  const tanHalfWc = Math.tan(discreteFrequency * 0.5);
  const sqrtGain = Math.sqrt(gain);
  switch (type) {
    case LOW_PASS:
      return iirCoefficients(tanHalfWc, tanHalfWc, 0, tanHalfWc + 1, tanHalfWc - 1, 0);
    case HIGH_PASS:
      return iirCoefficients(1, -1, 0, tanHalfWc + 1, tanHalfWc - 1, 0);
    case LOW_SHELF:
      return iirCoefficients(fma64(gain, tanHalfWc, sqrtGain), fma64(gain, tanHalfWc, -sqrtGain), 0, tanHalfWc + sqrtGain, tanHalfWc - sqrtGain, 0);
    case HIGH_SHELF:
      return iirCoefficients(
        fma64(sqrtGain, tanHalfWc, gain),
        fma64(sqrtGain, tanHalfWc, -gain),
        0,
        fma64(sqrtGain, tanHalfWc, 1),
        fma64(sqrtGain, tanHalfWc, -1),
        0,
      );
    case BAND_PASS:
      return iirCoefficients(tanHalfBw, 0, -tanHalfBw, 1 + tanHalfBw, twoCosWc, 1 - tanHalfBw);
    case BAND_STOP:
      return iirCoefficients(1, twoCosWc, 1, 1 + tanHalfBw, twoCosWc, 1 - tanHalfBw);
    case PEAKING_NOTCH: {
      const b1 = twoCosWc * sqrtGain;
      return iirCoefficients(fma64(gain, tanHalfBw, sqrtGain), b1, fma64(-gain, tanHalfBw, sqrtGain), sqrtGain + tanHalfBw, b1, sqrtGain - tanHalfBw);
    }
    default:
      return null;
  }
}

class EqState {
  readonly filters: IIRFilter[] = [];

  /** libopenshot creates the filters for the first frame's channels; later extra channels (undefined behavior there) get fresh ones. */
  filter(channel: number): IIRFilter {
    while (this.filters.length <= channel) this.filters.push(new IIRFilter());
    return this.filters[channel]!;
  }
}

/** libopenshot `ParametricEQ` with the intended ω = 2πf / sampleRate (see the module comment). */
export const parametricEq: AudioKernel = (channels, sampleRate, params, state) => {
  let st = state.get("ParametricEQ");
  if (!(st instanceof EqState)) {
    st = new EqState();
    state.set("ParametricEQ", st);
  }
  const eq = st as EqState;
  const discreteFrequency = (2 * Math.PI * num(params, "frequency", 500)) / sampleRate;
  const q = num(params, "q_factor", 0);
  const gain = exp10(num(params, "gain", 0) * 0.05);
  const coefficients = eqCoefficients(int(params, "filter_type", LOW_PASS), discreteFrequency, q, gain);
  for (let c = 0; c < channels.length; c += 1) {
    const filter = eq.filter(c);
    // setCoefficients(coefficients) runs for every type; an unknown type re-applies the old ones.
    filter.setCoefficients(coefficients ?? filter.coefficients);
    filter.processSamples(channels[c]!);
  }
};
