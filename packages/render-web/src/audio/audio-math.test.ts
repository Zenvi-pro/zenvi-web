import { describe, expect, it } from "vitest";
import type { AudioSegment } from "@zenvi/engine/render";
import { gainAt, gainEvents, isUnityGain } from "./gain.js";
import { LinearResampler } from "./resample.js";
import { contextTimeOf, lateStart, segmentPiece, timelineTimeOf, windows } from "./schedule.js";

const segment = (overrides: Partial<AudioSegment> = {}): AudioSegment => ({
  clipId: "C1",
  fileId: "F1",
  path: "a.webm",
  timelineStart: 10,
  sourceStart: 2,
  duration: 5,
  rate: 1,
  gain: [],
  effects: [],
  ...overrides,
});

describe("gain envelopes", () => {
  const fade = [
    { t: 0, gain: 0 },
    { t: 1, gain: 1 },
    { t: 4, gain: 1 },
    { t: 5, gain: 0 },
  ];

  it("interpolates piecewise-linearly and holds past the ends", () => {
    expect(gainAt(fade, -1)).toBe(0);
    expect(gainAt(fade, 0.25)).toBeCloseTo(0.25, 12);
    expect(gainAt(fade, 2)).toBe(1);
    expect(gainAt(fade, 4.5)).toBeCloseTo(0.5, 12);
    expect(gainAt(fade, 9)).toBe(0);
    expect(gainAt([], 3)).toBe(1);
  });

  it("treats two points at the same time as a step, on either side of a window boundary", () => {
    const step = [
      { t: 0, gain: 0.5 },
      { t: 1, gain: 0.5 },
      { t: 1, gain: 1 },
      { t: 2, gain: 1 },
    ];
    expect(gainEvents(step, 0, 1)).toEqual([
      { kind: "set", t: 0, value: 0.5 },
      { kind: "ramp", t: 1, value: 0.5 },
    ]);
    expect(gainEvents(step, 1, 2)).toEqual([
      { kind: "set", t: 1, value: 1 },
      { kind: "ramp", t: 2, value: 1 },
    ]);
    expect(gainEvents(step, 0.5, 1.5)).toEqual([
      { kind: "set", t: 0.5, value: 0.5 },
      { kind: "ramp", t: 1, value: 0.5 },
      { kind: "ramp", t: 1, value: 1 },
      { kind: "ramp", t: 1.5, value: 1 },
    ]);
  });

  it("automates a piece: set at its start, ramps through inner points to its end", () => {
    expect(gainEvents(fade, 0.5, 4.5)).toEqual([
      { kind: "set", t: 0.5, value: 0.5 },
      { kind: "ramp", t: 1, value: 1 },
      { kind: "ramp", t: 4, value: 1 },
      { kind: "ramp", t: 4.5, value: 0.5 },
    ]);
    expect(isUnityGain(fade, 1.5, 3.5)).toBe(true);
    expect(isUnityGain(fade, 0, 3)).toBe(false);
  });
});

describe("segment pieces", () => {
  it("clips a segment to a window in source frames", () => {
    const piece = segmentPiece(segment(), 11, 12.5, 48000)!;
    expect(piece).toMatchObject({ timelineStart: 11, timelineEnd: 12.5, startFrame: 3 * 48000, endFrame: 4.5 * 48000, reversed: false, speed: 1 });
    expect(segmentPiece(segment(), 0, 10, 48000)).toBeNull();
    expect(segmentPiece(segment(), 15, 20, 48000)).toBeNull();
    expect(segmentPiece(segment({ rate: 0 }), 10, 15, 48000)).toBeNull();
  });

  it("maps speed changes and reverse playback", () => {
    const fast = segmentPiece(segment({ rate: 2 }), 10, 12, 1000)!;
    expect([fast.startFrame, fast.endFrame, fast.speed]).toEqual([2000, 6000, 2]);
    const back = segmentPiece(segment({ rate: -1, sourceStart: 5 }), 10, 12, 1000)!;
    expect([back.startFrame, back.endFrame, back.reversed]).toEqual([3000, 5000, true]);
  });

  it("covers a range with contiguous windows, the first one shorter", () => {
    expect(windows(0, 5, 2, 0.5)).toEqual([
      [0, 0.5],
      [0.5, 2.5],
      [2.5, 4.5],
      [4.5, 5],
    ]);
    // Adjacent windows produce adjacent sample ranges (no gaps, no overlaps).
    const pieces = windows(10, 15, 1.3, 0.2).map(([a, b]) => segmentPiece(segment(), a, b, 44100)!);
    for (let i = 1; i < pieces.length; i += 1) expect(pieces[i]!.startFrame).toBe(pieces[i - 1]!.endFrame);
  });
});

describe("clock mapping", () => {
  it("converts between timeline and context time at a rate", () => {
    const anchor = { timeline: 5, context: 100, rate: 2 };
    expect(contextTimeOf(anchor, 9)).toBe(102);
    expect(timelineTimeOf(anchor, 101)).toBe(7);
  });

  it("skips what should already have played when decoding finishes late", () => {
    expect(lateStart(10, 9, 2, 1)).toEqual({ when: 10, offset: 0, duration: 2 });
    expect(lateStart(10, 10.5, 2, 2)).toEqual({ when: 10.5, offset: 1, duration: 1 });
    expect(lateStart(10, 13, 2, 1)).toBeNull();
  });
});

describe("LinearResampler", () => {
  const ramp = (n: number) => Float32Array.from({ length: n }, (_, i) => i);

  it("interpolates linearly: a ramp stays a ramp at any speed", () => {
    const out = new LinearResampler(1, 0.5).process([ramp(5)])[0]!;
    expect([...out]).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
    const fast = new LinearResampler(1, 2).process([ramp(9)])[0]!;
    expect([...fast]).toEqual([0, 2, 4, 6, 8]);
  });

  it("produces the same samples chunked as in one buffer", () => {
    const signal = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i / 7));
    for (const speed of [0.37, 1, 1.5, 2.25]) {
      const whole = new LinearResampler(2, speed).process([signal, signal])[0]!;
      const chunked = new LinearResampler(2, speed);
      const parts: number[] = [];
      let offset = 0;
      for (const size of [1, 13, 250, 7, 400, 329]) {
        const slice = signal.subarray(offset, offset + size);
        offset += size;
        parts.push(...chunked.process([slice, slice])[0]!);
      }
      expect(parts.length).toBe(whole.length);
      parts.forEach((v, i) => expect(v).toBeCloseTo(whole[i]!, 6));
    }
  });
});
