/**
 * Sample-accurate reads of a source's decoded audio.
 *
 * Positions are integer frames of source time at the stream's sample rate
 * (frame 0 = source time 0 = the media's `timeOffset`). Reads that continue
 * where the previous one ended keep pulling from the same Mediabunny
 * `samples()` iterator, so a clip plays as one continuous decode: no seams,
 * no decoder restarts. Other reads re-seek with a short pre-roll, because
 * codecs such as AAC produce a transient on their first packet.
 *
 * It reads Mediabunny `AudioSample`s (`AudioSampleSink`) rather than
 * `AudioBuffer`s: planar floats are what audio kernels and resampling work on,
 * and `AudioBuffer` does not exist in Workers. Voices build their
 * `AudioBuffer` from these planes when they schedule.
 */

export interface PcmSampleLike {
  readonly timestamp: number;
  readonly numberOfFrames: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  copyTo(destination: Float32Array, options: { planeIndex: number; format: "f32-planar"; frameOffset?: number; frameCount?: number }): void;
  close(): void;
}

/** The part of Mediabunny's `AudioSampleSink` a cursor uses. */
export interface PcmSampleSink<S extends PcmSampleLike> {
  samples(startTimestamp?: number, endTimestamp?: number): AsyncGenerator<S, void, unknown>;
}

export interface PcmCursorOptions {
  /** Container timestamp of source time 0. */
  timeOffset: number;
  sampleRate: number;
  channels: number;
  /** Seconds decoded and discarded before a seek target. Default 0.1. */
  preroll?: number;
}

interface Carry {
  startFrame: number;
  data: Float32Array[];
}

export class PcmCursor<S extends PcmSampleLike> {
  readonly sampleRate: number;
  readonly channels: number;
  private readonly timeOffset: number;
  private readonly preroll: number;
  private iterator: AsyncGenerator<S, void, unknown> | null = null;
  private ended = false;
  private nextFrame: number | null = null;
  private carry: Carry | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  /** Number of times the cursor had to restart decoding (diagnostics, tests). */
  seeks = 0;

  constructor(
    private readonly sink: PcmSampleSink<S>,
    options: PcmCursorOptions,
  ) {
    this.sampleRate = options.sampleRate;
    this.channels = Math.max(1, options.channels);
    this.timeOffset = options.timeOffset;
    this.preroll = options.preroll ?? 0.1;
  }

  /** Planar samples of frames `[startFrame, endFrame)`; silence where the stream has none. */
  read(startFrame: number, endFrame: number): Promise<Float32Array[]> {
    const run = this.tail.then(() => this.readNow(Math.round(startFrame), Math.round(endFrame)));
    this.tail = run.catch(() => undefined);
    return run;
  }

  async close(): Promise<void> {
    await this.tail;
    await this.reset();
  }

  private async readNow(startFrame: number, endFrame: number): Promise<Float32Array[]> {
    const length = Math.max(0, endFrame - startFrame);
    const out = Array.from({ length: this.channels }, () => new Float32Array(length));
    if (length === 0) return out;
    if (this.nextFrame !== startFrame) await this.seek(startFrame);

    let covered = startFrame;
    if (this.carry) {
      covered = Math.max(covered, this.place(out, startFrame, endFrame, this.carry.startFrame, this.carry.data));
      this.carry = this.carryAfter(this.carry.startFrame, this.carry.data, endFrame);
    }
    while (covered < endFrame && !this.ended) {
      const result = await this.iterator!.next();
      if (result.done) {
        this.ended = true;
        break;
      }
      const sample = result.value;
      try {
        const data = this.planar(sample);
        const sampleStart = Math.round((sample.timestamp - this.timeOffset) * this.sampleRate);
        covered = Math.max(covered, this.place(out, startFrame, endFrame, sampleStart, data));
        const rest = this.carryAfter(sampleStart, data, endFrame);
        if (rest) this.carry = rest;
      } finally {
        sample.close();
      }
    }
    this.nextFrame = endFrame;
    return out;
  }

  /** Copy the overlap of `data` (starting at `dataStart`) into `out`; returns the frame after it. */
  private place(out: Float32Array[], start: number, end: number, dataStart: number, data: Float32Array[]): number {
    const frames = data[0]?.length ?? 0;
    const from = Math.max(start, dataStart);
    const to = Math.min(end, dataStart + frames);
    if (to <= from) return dataStart + frames <= start ? start : from;
    for (let c = 0; c < this.channels; c += 1) {
      out[c]!.set(data[c]!.subarray(from - dataStart, to - dataStart), from - start);
    }
    return to;
  }

  private carryAfter(dataStart: number, data: Float32Array[], end: number): Carry | null {
    const frames = data[0]?.length ?? 0;
    if (dataStart + frames <= end) return null;
    const skip = Math.max(0, end - dataStart);
    return { startFrame: dataStart + skip, data: data.map((channel) => channel.subarray(skip)) };
  }

  /** The sample as planar floats at the cursor's rate and channel count. */
  private planar(sample: S): Float32Array[] {
    const frames = sample.numberOfFrames;
    const decoded: Float32Array[] = [];
    for (let c = 0; c < sample.numberOfChannels; c += 1) {
      const plane = new Float32Array(frames);
      sample.copyTo(plane, { planeIndex: c, format: "f32-planar" });
      decoded.push(plane);
    }
    // Fewer channels than the stream advertises: repeat the last one; more: drop extras.
    const mapped = Array.from({ length: this.channels }, (_, c) => decoded[Math.min(c, decoded.length - 1)] ?? new Float32Array(frames));
    if (sample.sampleRate === this.sampleRate || !(sample.sampleRate > 0)) return mapped;
    // A decoder that outputs another rate than the container says (HE-AAC):
    // stretch this packet onto the stream's rate.
    const ratio = sample.sampleRate / this.sampleRate;
    const outFrames = Math.round(frames / ratio);
    return mapped.map((channel) => {
      const resampled = new Float32Array(outFrames);
      for (let i = 0; i < outFrames; i += 1) {
        const p = i * ratio;
        const k = Math.floor(p);
        const a = channel[k] ?? 0;
        const b = channel[k + 1] ?? a;
        resampled[i] = a + (b - a) * (p - k);
      }
      return resampled;
    });
  }

  private async seek(startFrame: number): Promise<void> {
    await this.reset();
    this.seeks += 1;
    const seconds = startFrame / this.sampleRate - this.preroll;
    this.iterator = this.sink.samples(this.timeOffset + seconds);
  }

  private async reset(): Promise<void> {
    const iterator = this.iterator;
    this.iterator = null;
    this.ended = false;
    this.carry = null;
    this.nextFrame = null;
    await iterator?.return();
  }
}
