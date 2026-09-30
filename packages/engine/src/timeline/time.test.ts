import { describe, expect, it } from "vitest";
import {
  fpsFloat,
  fpsFromRate,
  frameContaining,
  frameSampleOffset,
  frameToSeconds,
  limitDenominator,
  parseFps,
  sameFps,
  samplesPerFrame,
  secondsToFrame,
  snapToFrame,
} from "./time.js";

const ntsc = { num: 30000, den: 1001 };

describe("fps math", () => {
  it("frames are 1-based: frame n starts at (n-1)/fps", () => {
    const fps = { num: 30, den: 1 };
    expect(secondsToFrame(0, fps)).toBe(1);
    expect(secondsToFrame(1, fps)).toBe(31);
    expect(frameToSeconds(31, fps)).toBe(1);
    expect(frameToSeconds(1, ntsc)).toBe(0);
    expect(fpsFloat(ntsc)).toBeCloseTo(29.97003, 5);
  });

  it("secondsToFrame rounds half away from zero like llround", () => {
    const fps = { num: 2, den: 1 };
    expect(secondsToFrame(0.25, fps)).toBe(2); // 0.5 → 1, +1
    expect(secondsToFrame(0.75, fps)).toBe(3); // 1.5 → 2, +1
  });

  it("frameContaining floors with tolerance for float noise", () => {
    const fps = { num: 30, den: 1 };
    expect(frameContaining(0.999999999999, fps)).toBe(31);
    expect(frameContaining(0.98, fps)).toBe(30);
  });

  it("snapToFrame", () => {
    expect(snapToFrame(1.01, { num: 30, den: 1 })).toBeCloseTo(1, 10);
    expect(snapToFrame(1.02, { num: 30, den: 1 })).toBeCloseTo(31 / 30, 10);
  });

  it("samplesPerFrame matches libopenshot Frame::GetSamplesPerFrame vectors", () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => samplesPerFrame(n, ntsc, 48000, 2))).toEqual([1600, 1602, 1602, 1602, 1602, 1600]);
    expect([1, 2, 3, 4, 5].map((n) => samplesPerFrame(n, { num: 24, den: 1 }, 44100, 2))).toEqual([1836, 1838, 1838, 1838, 1836]);
    expect(samplesPerFrame(10, { num: 30, den: 1 }, 44100, 2)).toBe(1470);
    let total = 0;
    for (let n = 1; n <= 6; n += 1) {
      expect(frameSampleOffset(n, ntsc, 48000, 2)).toBe(total);
      total += samplesPerFrame(n, ntsc, 48000, 2);
    }
  });

  it("fpsFromRate follows set_project_setting (NTSC snapping, limit_denominator(1001))", () => {
    expect(fpsFromRate(23.976)).toEqual({ num: 24000, den: 1001 });
    expect(fpsFromRate(29.97)).toEqual({ num: 30000, den: 1001 });
    expect(fpsFromRate(59.94)).toEqual({ num: 60000, den: 1001 });
    expect(fpsFromRate(25)).toEqual({ num: 25, den: 1 });
    expect(fpsFromRate(12.5)).toEqual({ num: 25, den: 2 });
  });

  it("limitDenominator matches CPython Fraction.limit_denominator", () => {
    // Values computed with CPython 3 fractions.Fraction(x).limit_denominator(1001).
    const cases: [number, number, number][] = [
      [47.952, 5994, 125],
      [29.97002997, 30000, 1001],
      [14.985, 2997, 200],
      [7.5, 15, 2],
      [0.1, 1, 10],
      [1 / 3, 1, 3],
      [23.98, 1199, 50],
      [25.1234, 21581, 859],
    ];
    for (const [x, num, den] of cases) expect(limitDenominator(x, 1001), String(x)).toEqual({ num, den });
  });

  it("parseFps accepts fractions, strings and numbers", () => {
    expect(parseFps({ num: 30, den: 1 })).toEqual({ num: 30, den: 1 });
    expect(parseFps("30000/1001")).toEqual(ntsc);
    expect(parseFps("29.97")).toEqual(ntsc);
    expect(parseFps(24)).toEqual({ num: 24, den: 1 });
    expect(parseFps("abc")).toBeNull();
    expect(parseFps(-1)).toBeNull();
    expect(parseFps({ num: 0, den: 1 })).toBeNull();
  });

  it("sameFps compares rationally", () => {
    expect(sameFps({ num: 60, den: 2 }, { num: 30, den: 1 })).toBe(true);
    expect(sameFps(ntsc, { num: 30, den: 1 })).toBe(false);
  });
});
