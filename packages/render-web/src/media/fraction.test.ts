import { describe, expect, it } from "vitest";
import { approximateRational, frameRateToFraction, reduceFraction } from "./fraction.js";

describe("reduceFraction", () => {
  it("reduces like libopenshot Fraction::Reduce", () => {
    expect(reduceFraction(1920, 1080)).toEqual({ num: 16, den: 9 });
    expect(reduceFraction(720, 576)).toEqual({ num: 5, den: 4 });
    expect(reduceFraction(180, 35)).toEqual({ num: 36, den: 7 });
  });
});

describe("frameRateToFraction", () => {
  it.each([
    [30, { num: 30, den: 1 }],
    [25.0001, { num: 25, den: 1 }],
    [29.97002997002997, { num: 30000, den: 1001 }],
    [59.94005994005994, { num: 60000, den: 1001 }],
    [23.976023976023978, { num: 24000, den: 1001 }],
    [14.985014985014985, { num: 15000, den: 1001 }],
  ])("%s fps", (fps, expected) => {
    expect(frameRateToFraction(fps)).toEqual(expected);
  });

  it("uses the timebase for non-integer, non-NTSC rates", () => {
    expect(frameRateToFraction(12.5, 1000)).toEqual({ num: 25, den: 2 });
    expect(frameRateToFraction(7.5, 90000)).toEqual({ num: 15, den: 2 });
  });

  it("falls back to 30/1 for missing or invalid rates (FFmpegReader.cpp:653-662)", () => {
    expect(frameRateToFraction(null)).toEqual({ num: 30, den: 1 });
    expect(frameRateToFraction(0)).toEqual({ num: 30, den: 1 });
    expect(frameRateToFraction(Number.NaN)).toEqual({ num: 30, den: 1 });
  });

  it("approximates arbitrary rates with a small denominator", () => {
    const f = approximateRational(Math.PI, 1001);
    expect(f.den).toBeLessThanOrEqual(1001);
    expect(Math.abs(f.num / f.den - Math.PI)).toBeLessThan(1e-5);
  });
});
