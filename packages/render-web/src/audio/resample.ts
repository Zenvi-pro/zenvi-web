/**
 * Streaming linear resampler for speed changes ahead of audio effects.
 *
 * libopenshot runs audio effects on clip audio after time remapping
 * (libopenshot-semantics §4.4), and its speed change is JUCE
 * `ResamplingAudioSource`: linear interpolation (§2.6). When a segment has
 * effects and a speed other than 1, render-web time-stretches the decoded
 * audio with this resampler first, so kernels see what libopenshot's see.
 *
 * Output frame n reads input position n·speed. Positions are computed from
 * the integer output count and global input indices, so a stream fed in
 * chunks resamples exactly like one long buffer.
 */

export class LinearResampler {
  /** Input frames received before the current chunk. */
  private consumed = 0;
  /** Output frames produced so far. */
  private produced = 0;
  /** Last input frame of the previous chunk, per channel. */
  private last: Float32Array;

  /** `speed` input frames are consumed per output frame (2 = twice as fast). */
  constructor(
    readonly channels: number,
    readonly speed: number,
  ) {
    if (!(speed > 0) || !Number.isFinite(speed)) throw new RangeError("speed must be a positive number");
    this.last = new Float32Array(channels);
  }

  /** Resample the next chunk of planar input (one array per channel, equal lengths). */
  process(input: readonly Float32Array[]): Float32Array[] {
    const length = input[0]?.length ?? 0;
    const available = this.consumed + length;
    const outputs: number[][] = Array.from({ length: this.channels }, () => []);
    for (;;) {
      const position = this.produced * this.speed;
      const index = Math.floor(position);
      const fraction = position - index;
      // Interpolating needs the next input frame, which may not have arrived.
      if ((fraction > 0 ? index + 1 : index) >= available) break;
      for (let c = 0; c < this.channels; c += 1) {
        const a = this.sample(input, c, index);
        const b = fraction > 0 ? this.sample(input, c, index + 1) : a;
        outputs[c]!.push(a + (b - a) * fraction);
      }
      this.produced += 1;
    }
    if (length > 0) {
      for (let c = 0; c < this.channels; c += 1) this.last[c] = input[c]?.[length - 1] ?? 0;
    }
    this.consumed = available;
    return outputs.map((samples) => Float32Array.from(samples));
  }

  private sample(input: readonly Float32Array[], channel: number, globalIndex: number): number {
    const local = globalIndex - this.consumed;
    // Only the frame just before this chunk is ever read from the previous one.
    return local >= 0 ? (input[channel]?.[local] ?? 0) : (this.last[channel] ?? 0);
  }
}
