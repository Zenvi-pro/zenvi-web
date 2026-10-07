import { describe, expect, it } from "vitest";
import { accumulatePeaks, evenlySpacedTimes } from "./peaks.js";

describe("accumulatePeaks", () => {
  it("takes the largest absolute sample per bucket across channels", () => {
    const peaks = new Float32Array(4);
    // 8 frames at 8 Hz over [0, 1): two frames per bucket.
    const left = Float32Array.from([0.1, -0.5, 0.2, 0.1, 0, 0, 0.9, -0.2]);
    const right = Float32Array.from([0, 0, -0.3, 0.05, 0.4, 0, 0, 0]);
    accumulatePeaks(peaks, [left, right], 0, 8, 0, 1);
    expect([...peaks].map((v) => Math.round(v * 100) / 100)).toEqual([0.5, 0.3, 0.4, 0.9]);
  });

  it("gives the same peaks whatever the block boundaries", () => {
    const signal = Float32Array.from({ length: 4410 }, (_, i) => Math.sin(i / 3) * (i / 4410));
    const whole = new Float32Array(37);
    accumulatePeaks(whole, [signal], 0.25, 44100, 0.25, 0.25 + 4410 / 44100);
    const pieces = new Float32Array(37);
    for (let at = 0; at < signal.length; at += 1024) {
      accumulatePeaks(pieces, [signal.subarray(at, at + 1024)], 0.25 + at / 44100, 44100, 0.25, 0.25 + 4410 / 44100);
    }
    expect([...pieces]).toEqual([...whole]);
    expect(whole[36]).toBeGreaterThan(0.9);
  });

  it("ignores samples outside the range", () => {
    const peaks = new Float32Array(2);
    accumulatePeaks(peaks, [Float32Array.from([1, 1, 0.2, 0.3, 1, 1])], 0, 2, 1, 2);
    expect([...peaks].map((v) => Math.round(v * 10) / 10)).toEqual([0.2, 0.3]);
  });
});

describe("evenlySpacedTimes", () => {
  it("places thumbnails at bucket centers", () => {
    expect(evenlySpacedTimes(4, 8)).toEqual([1, 3, 5, 7]);
    expect(evenlySpacedTimes(0, 8)).toEqual([]);
    expect(evenlySpacedTimes(2, 0)).toEqual([0, 0]);
  });
});
