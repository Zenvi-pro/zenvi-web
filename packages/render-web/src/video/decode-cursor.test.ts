import { describe, expect, it } from "vitest";
import { DecodeCursor, type KeyframeIndex, type SampleSink } from "./decode-cursor.js";

class FakeSample {
  closed = false;
  constructor(
    readonly timestamp: number,
    readonly duration: number,
    private readonly sink: FakeSink,
  ) {
    sink.open += 1;
  }
  close() {
    if (this.closed) throw new Error(`picture ${this.timestamp} closed twice`);
    this.closed = true;
    this.sink.open -= 1;
  }
}

/** Mediabunny `samples()` semantics: decode from the keyframe at or before start; yield the last picture <= start first. */
class FakeSink implements SampleSink<FakeSample>, KeyframeIndex {
  open = 0;
  seeks = 0;
  decodes = 0;
  readonly frames: number[];
  constructor(
    count: number,
    readonly fps: number,
    readonly gop: number,
  ) {
    this.frames = Array.from({ length: count }, (_, i) => i / fps);
  }
  private keyIndexAtOrBefore(t: number): number {
    let k = 0;
    for (let i = 0; i < this.frames.length; i += this.gop) if (this.frames[i]! <= t) k = i;
    return k;
  }
  async nextKeyframeAfter(t: number): Promise<number | null> {
    const next = this.keyIndexAtOrBefore(t) + this.gop;
    return next < this.frames.length ? this.frames[next]! : null;
  }
  async *samples(start = -Infinity): AsyncGenerator<FakeSample, void, unknown> {
    this.seeks += 1;
    let held: FakeSample | null = null;
    try {
      for (let i = this.keyIndexAtOrBefore(start); i < this.frames.length; i += 1) {
        this.decodes += 1;
        const sample = new FakeSample(this.frames[i]!, 1 / this.fps, this);
        if (sample.timestamp <= start) {
          held?.close();
          held = sample;
          continue;
        }
        if (held) {
          const h: FakeSample = held;
          held = null;
          yield h;
        }
        yield sample;
      }
      if (held) {
        const h: FakeSample = held;
        held = null;
        yield h;
      }
    } finally {
      held?.close();
    }
  }
}

const cursorFor = (sink: FakeSink) => new DecodeCursor(sink, sink, 1 / sink.fps, () => 0);
const tsAt = (cursor: DecodeCursor<FakeSample>, t: number, mode: "seek" | "sequential" = "seek") =>
  cursor.at(t, mode, (sample) => {
    expect(sample?.closed).toBe(false);
    return sample?.timestamp ?? null;
  });

describe("DecodeCursor", () => {
  it("plays sequentially with a single seek and decodes every picture once", async () => {
    const sink = new FakeSink(90, 30, 30);
    const cursor = cursorFor(sink);
    for (let k = 0; k < 90; k += 1) {
      const t = k / 30 + 0.01;
      expect(await tsAt(cursor, t, "sequential")).toBeCloseTo(k / 30, 9);
      expect(sink.open).toBeLessThanOrEqual(2);
    }
    expect(sink.seeks).toBe(1);
    expect(sink.decodes).toBe(90);
    expect(cursor.skipped).toBe(0);
    await cursor.close();
    expect(sink.open).toBe(0);
  });

  it("drops pictures the clock has passed and closes them", async () => {
    const sink = new FakeSink(90, 30, 30);
    const cursor = cursorFor(sink);
    for (let k = 0; k < 90; k += 3) await tsAt(cursor, k / 30 + 0.001, "sequential");
    expect(sink.seeks).toBe(1);
    expect(cursor.skipped).toBe(58);
    await cursor.close();
    expect(sink.open).toBe(0);
  });

  it("random access walks forward inside a GOP and re-seeks past the next keyframe or backwards", async () => {
    const sink = new FakeSink(120, 30, 30);
    const cursor = cursorFor(sink);
    expect(await tsAt(cursor, 0.5)).toBeCloseTo(15 / 30, 9);
    expect(sink.seeks).toBe(1);
    expect(await tsAt(cursor, 0.9)).toBeCloseTo(27 / 30, 9); // same GOP: walk forward
    expect(sink.seeks).toBe(1);
    expect(await tsAt(cursor, 0.9)).toBeCloseTo(27 / 30, 9); // same picture: reuse
    expect(sink.seeks).toBe(1);
    expect(await tsAt(cursor, 2.5)).toBeCloseTo(75 / 30, 9); // past keyframe 1.0: re-seek at 2.0
    expect(sink.seeks).toBe(2);
    const decodesBefore = sink.decodes;
    expect(await tsAt(cursor, 0.1)).toBeCloseTo(3 / 30, 9); // backwards
    expect(sink.seeks).toBe(3);
    expect(sink.decodes - decodesBefore).toBeLessThan(10);
    await cursor.close();
    expect(sink.open).toBe(0);
  });

  it("freezes on the last picture past the end without re-seeking", async () => {
    const sink = new FakeSink(10, 10, 5);
    const cursor = cursorFor(sink);
    expect(await tsAt(cursor, 5)).toBeCloseTo(0.9, 9);
    const seeks = sink.seeks;
    expect(await tsAt(cursor, 7)).toBeCloseTo(0.9, 9);
    expect(await tsAt(cursor, 9, "sequential")).toBeCloseTo(0.9, 9);
    expect(sink.seeks).toBe(seeks);
    await cursor.close();
    expect(sink.open).toBe(0);
  });

  it("serializes calls so a picture is never closed while a caller is using it", async () => {
    const sink = new FakeSink(60, 30, 30);
    const cursor = cursorFor(sink);
    const slowUse = cursor.at(0.2, "seek", async (sample) => {
      await new Promise((r) => setTimeout(r, 20));
      expect(sample!.closed).toBe(false);
      return sample!.timestamp;
    });
    const next = tsAt(cursor, 1.5, "seek");
    expect(await slowUse).toBeCloseTo(6 / 30, 9);
    expect(await next).toBeCloseTo(45 / 30, 9);
    await cursor.close();
    expect(sink.open).toBe(0);
  });
});
