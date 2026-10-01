/**
 * The short-time Fourier transform framework behind Robotization and
 * Whisperization, ported from libopenshot src/audio_effects/STFT.cpp.
 *
 * Per channel and sample: write the input into a circular buffer of N =
 * fft size samples, output (and clear) the next sample of a circular
 * overlap-add buffer, and every `hop = N / overlap` samples window the last
 * N inputs (analysis window only), transform, modify, inverse-transform and
 * accumulate `real · scale` into the output buffer, `scale = 1/overlap/Σw·N`.
 * Frames come out N samples late (output starts after the first `hop`
 * samples, which are silent). Quirks kept from libopenshot:
 * - a new fft size resets the buffers and positions but not `hop` (it is
 *   only recomputed when the overlap changes), and a new overlap moves the
 *   synthesis write position to `hop % N` without touching the others;
 * - an unknown window type keeps the previous window (zeros at first).
 * libopenshot runs this under `ScopedNoDenormals` (flush-to-zero), which
 * only matters for subnormal samples (below 1.2e-38).
 */

import { cosf } from "./apple-libm.js";
import { RealFft } from "./fft.js";
import { f32, fmaf } from "./float.js";

export const RECTANGULAR = 0;
export const BART_LETT = 1;
export const HANN = 2;
export const HAMMING = 3;

const TWO_PI = 2 * Math.PI;
const HAMMING_A = f32(0.54);
const HAMMING_B = f32(-0.46);

export abstract class Stft {
  protected numChannels = 1;
  /** Impossible initial values: the first `updateParameters` always initializes (libopenshot leaves them uninitialized). */
  protected fftSize = -1;
  protected overlap = -1;
  protected hopSize = 0;
  protected windowScale = 0;
  protected window = new Float32Array(0);
  protected fft: RealFft = new RealFft(1);
  /** The windowed frame and its resynthesis (`time_domain_buffer`, whose imaginary parts are zero). */
  protected frame = new Float32Array(0);
  /** Bins 0..N/2 of `frequency_domain_buffer` (the other half mirrors them). */
  protected binRe = new Float32Array(0);
  protected binIm = new Float32Array(0);
  private input: Float32Array[] = [];
  private output: Float32Array[] = [];
  private inputWrite = 0;
  private outputWrite = 0;
  private outputRead = 0;
  private sinceLastFft = 0;
  private currentInputWrite = 0;
  private currentOutputWrite = 0;

  /** `STFT::setup`. */
  setup(channels: number): void {
    this.numChannels = channels > 0 ? channels : 1;
  }

  /** `STFT::updateParameters(fft size, overlap, window type)`. */
  updateParameters(fftSize: number, overlap: number, windowType: number): void {
    this.updateFftSize(fftSize);
    this.updateHopSize(overlap);
    this.updateWindow(windowType);
  }

  private updateFftSize(size: number): void {
    if (size === this.fftSize) return;
    this.fftSize = size;
    this.fft = new RealFft(size);
    this.input = [];
    this.output = [];
    this.window = new Float32Array(size);
    this.frame = new Float32Array(size);
    this.binRe = new Float32Array((size >> 1) + 1);
    this.binIm = new Float32Array((size >> 1) + 1);
    this.inputWrite = 0;
    this.outputWrite = 0;
    this.outputRead = 0;
    this.sinceLastFft = 0;
  }

  private updateHopSize(overlap: number): void {
    if (overlap === this.overlap) return;
    this.overlap = overlap;
    if (overlap !== 0) {
      this.hopSize = Math.trunc(this.fftSize / overlap);
      this.outputWrite = this.hopSize % this.fftSize;
    }
  }

  /** `STFT::updateWindow` (STFT.cpp:107-141): symmetric windows over N − 1, then the overlap-add scale. */
  private updateWindow(type: number): void {
    const n = this.fftSize;
    const w = this.window;
    const last = f32(n - 1);
    const arg = (i: number): number => f32((f32(i) * TWO_PI) / last);
    switch (type) {
      case RECTANGULAR:
        w.fill(1);
        break;
      case BART_LETT:
        for (let i = 0; i < n; i += 1) w[i] = f32(1 - Math.abs(f32(f32(f32(i + i) / last) - 1)));
        break;
      case HANN:
        for (let i = 0; i < n; i += 1) w[i] = fmaf(cosf(arg(i)), -0.5, 0.5);
        break;
      case HAMMING:
        for (let i = 0; i < n; i += 1) w[i] = fmaf(cosf(arg(i)), HAMMING_B, HAMMING_A);
        break;
      default:
        break;
    }
    let sum = 0;
    for (let i = 0; i < n; i += 1) sum = f32(sum + w[i]!);
    this.windowScale = this.overlap !== 0 && sum !== 0 ? f32(f32(f32(1 / f32(this.overlap)) / sum) * f32(n)) : 0;
  }

  private channelBuffer(list: Float32Array[], channel: number): Float32Array {
    while (list.length <= channel) list.push(new Float32Array(this.fftSize));
    return list[channel]!;
  }

  /** `STFT::process(block)`: in place, channel by channel. */
  process(channels: Float32Array[]): void {
    const n = this.fftSize;
    const count = Math.min(this.numChannels, channels.length);
    let inputWrite = this.inputWrite;
    let outputWrite = this.outputWrite;
    let outputRead = this.outputRead;
    let since = this.sinceLastFft;
    for (let c = 0; c < count; c += 1) {
      const data = channels[c]!;
      const input = this.channelBuffer(this.input, c);
      const output = this.channelBuffer(this.output, c);
      inputWrite = this.inputWrite;
      outputWrite = this.outputWrite;
      outputRead = this.outputRead;
      since = this.sinceLastFft;
      for (let s = 0; s < data.length; s += 1) {
        input[inputWrite] = data[s]!;
        if (++inputWrite >= n) inputWrite = 0;
        data[s] = output[outputRead]!;
        output[outputRead] = 0;
        if (++outputRead >= n) outputRead = 0;
        if (++since >= this.hopSize) {
          since = 0;
          this.currentInputWrite = inputWrite;
          this.currentOutputWrite = outputWrite;
          this.analysis(input);
          this.modification();
          this.synthesis(output);
          outputWrite = this.currentOutputWrite;
        }
      }
    }
    this.inputWrite = inputWrite;
    this.outputWrite = outputWrite;
    this.outputRead = outputRead;
    this.sinceLastFft = since;
  }

  /** Window × the last N inputs, oldest first (STFT.cpp:145-155). */
  private analysis(input: Float32Array): void {
    const n = this.fftSize;
    let index = this.currentInputWrite;
    for (let k = 0; k < n; k += 1) {
      this.frame[k] = this.window[k]! * input[index]!;
      if (++index >= n) index = 0;
    }
  }

  /** Forward FFT of `frame` into the bins, change them, inverse FFT back into `frame`. */
  protected abstract modification(): void;

  /** Overlap-add `real · scale` (fused) at the synthesis position (STFT.cpp:177-192). */
  private synthesis(output: Float32Array): void {
    const n = this.fftSize;
    let index = this.currentOutputWrite;
    for (let k = 0; k < n; k += 1) {
      output[index] = fmaf(this.frame[k]!, this.windowScale, output[index]!);
      if (++index >= n) index = 0;
    }
    this.currentOutputWrite += this.hopSize;
    if (this.currentOutputWrite >= n) this.currentOutputWrite = 0;
  }
}
