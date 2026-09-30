import { describe, expect, it } from "vitest";
import { PcmCursor, type PcmSampleLike, type PcmSampleSink } from "./pcm-cursor.js";

/** A stream whose sample value encodes its global frame index: frame f has value f / 1e6. */
class FakeAudio implements PcmSampleSink<FakeChunk> {
  open = 0;
  iterators = 0;
  constructor(
    readonly sampleRate: number,
    readonly totalFrames: number,
    readonly chunk: number,
    readonly firstTimestamp = 0,
    readonly channels = 2,
    readonly decodeRate = sampleRate,
  ) {}
  async *samples(start = -Infinity): AsyncGenerator<FakeChunk, void, unknown> {
    this.iterators += 1;
    const ratio = this.decodeRate / this.sampleRate;
    for (let f = 0; f < this.totalFrames; f += this.chunk) {
      const ts = this.firstTimestamp + f / this.sampleRate;
      if (ts + this.chunk / this.sampleRate <= start) continue;
      const frames = Math.min(this.chunk, this.totalFrames - f);
      yield new FakeChunk(this, ts, f, Math.round(frames * ratio), this.decodeRate);
    }
  }
}

class FakeChunk implements PcmSampleLike {
  closed = false;
  readonly numberOfChannels: number;
  constructor(
    private readonly audio: FakeAudio,
    readonly timestamp: number,
    private readonly firstFrame: number,
    readonly numberOfFrames: number,
    readonly sampleRate: number,
  ) {
    this.numberOfChannels = audio.channels;
    audio.open += 1;
  }
  copyTo(destination: Float32Array, options: { planeIndex: number }) {
    const ratio = this.audio.decodeRate / this.audio.sampleRate;
    for (let i = 0; i < this.numberOfFrames; i += 1) {
      destination[i] = (this.firstFrame + i / ratio) / 1e6 + options.planeIndex;
    }
  }
  close() {
    if (this.closed) throw new Error("closed twice");
    this.closed = true;
    this.audio.open -= 1;
  }
}

const values = (channel: Float32Array) => [...channel].map((v) => Math.round(v * 1e6));

describe("PcmCursor", () => {
  it("reads exact frame ranges, continuing one decode across adjacent reads", async () => {
    const audio = new FakeAudio(1000, 5000, 64);
    const cursor = new PcmCursor(audio, { timeOffset: 0, sampleRate: 1000, channels: 2, preroll: 0.01 });
    const a = await cursor.read(100, 350);
    const b = await cursor.read(350, 1000);
    expect(values(a[0]!)).toEqual(Array.from({ length: 250 }, (_, i) => 100 + i));
    expect(values(b[0]!)).toEqual(Array.from({ length: 650 }, (_, i) => 350 + i));
    expect(values(b[1]!).slice(0, 2)).toEqual([1e6 + 350, 1e6 + 351]);
    expect(cursor.seeks).toBe(1);
    expect(audio.iterators).toBe(1);
    await cursor.close();
    expect(audio.open).toBe(0);
  });

  it("re-seeks for non-adjacent reads and pads silence outside the stream", async () => {
    const audio = new FakeAudio(1000, 1000, 100, 0.5, 1);
    const cursor = new PcmCursor(audio, { timeOffset: 0.5, sampleRate: 1000, channels: 2, preroll: 0.05 });
    const late = await cursor.read(900, 1100);
    expect(values(late[0]!).slice(0, 100)).toEqual(Array.from({ length: 100 }, (_, i) => 900 + i));
    expect(values(late[0]!).slice(100)).toEqual(new Array(100).fill(0));
    // Mono stream into a stereo cursor: channel 1 repeats channel 0.
    expect(values(late[1]!).slice(0, 3)).toEqual([900, 901, 902]);
    const early = await cursor.read(-50, 20);
    expect(values(early[0]!)).toEqual([...new Array(50).fill(0), ...Array.from({ length: 20 }, (_, i) => i)]);
    expect(cursor.seeks).toBe(2);
    await cursor.close();
    expect(audio.open).toBe(0);
  });

  it("stretches packets a decoder outputs at another rate onto the stream rate", async () => {
    const audio = new FakeAudio(1000, 2000, 100, 0, 1, 2000);
    const cursor = new PcmCursor(audio, { timeOffset: 0, sampleRate: 1000, channels: 1, preroll: 0 });
    const out = await cursor.read(0, 300);
    expect(values(out[0]!)).toEqual(Array.from({ length: 300 }, (_, i) => i));
    await cursor.close();
  });
});
