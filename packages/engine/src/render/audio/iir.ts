/**
 * `juce::IIRCoefficients` and `juce::IIRFilter` from libopenshot-audio
 * (JuceLibraryCode/modules/juce_audio_basics/utilities/juce_IIRFilter.cpp:46-55,
 * 298-336), the first/second-order sections behind Distortion's tone control
 * and ParametricEQ.
 *
 * Coefficients are normalised by `1/a0` in double and stored as float.
 * Processing is transposed direct form II in float; the arm64 build fuses
 * `c0*in + v1`, `c1*in - c3*out` and `c2*in - c4*out` (`fmadd` after an
 * `fnmul`), which `fmaf` reproduces. `JUCE_SNAP_TO_ZERO` is a no-op on arm64.
 */

import { f32, fmaf } from "./float.js";

/** `[c0..c4] = [b0, b1, b2, a1, a2] / a0` as floats (`IIRCoefficients(b0, b1, b2, a0, a1, a2)`). */
export function iirCoefficients(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Float32Array {
  const a = 1 / a0;
  return Float32Array.of(b0 * a, b1 * a, b2 * a, a1 * a, a2 * a);
}

export class IIRFilter {
  /** All zero until `setCoefficients` (the default `IIRCoefficients()`). */
  readonly coefficients = new Float32Array(5);
  v1 = 0;
  v2 = 0;
  /** `IIRFilter::active`: `processSamples` does nothing before the first `setCoefficients`. */
  active = false;

  setCoefficients(c: Float32Array): void {
    this.coefficients.set(c);
    this.active = true;
  }

  /** `processSingleSampleRaw(in)`. */
  processSample(input: number): number {
    const c = this.coefficients;
    const out = fmaf(c[0]!, input, this.v1);
    this.v1 = f32(this.v2 + fmaf(c[1]!, input, -f32(out * c[3]!)));
    this.v2 = fmaf(c[2]!, input, -f32(out * c[4]!));
    return out;
  }

  /** `processSamples(samples, n)`, in place. */
  processSamples(samples: Float32Array): void {
    if (!this.active) return;
    const c0 = this.coefficients[0]!;
    const c1 = this.coefficients[1]!;
    const c2 = this.coefficients[2]!;
    const c3 = this.coefficients[3]!;
    const c4 = this.coefficients[4]!;
    let lv1 = this.v1;
    let lv2 = this.v2;
    for (let i = 0; i < samples.length; i += 1) {
      const input = samples[i]!;
      const out = fmaf(c0, input, lv1);
      samples[i] = out;
      lv1 = f32(lv2 + fmaf(c1, input, -f32(out * c3)));
      lv2 = fmaf(c2, input, -f32(out * c4));
    }
    this.v1 = lv1;
    this.v2 = lv2;
  }
}
