import { describe, expect, it } from "vitest";
import { bandScore, closestToTarget, gradeSpread, outOfBand, solveUnifyKnobs, unifyGap, unifyTarget } from "./color-unify.js";

const profile = (avg_luma: number, warm_cool = 0, extra: Record<string, number> = {}): Record<string, unknown> => ({
  present: true,
  avg_luma,
  warm_cool,
  green_magenta: 0,
  sat_proxy: 0.2,
  contrast_span: 0.45,
  clipped_highlights: 0,
  clipped_shadows: 0,
  ...extra,
});

describe("unifyTarget", () => {
  it("takes each key's median and pulls it into the neutral band", () => {
    const target = unifyTarget([profile(0.1, 0.2), profile(0.15, 0.15), profile(0.8, 0.1), { present: false }]);
    // Median luma 0.15 is too dark for a shared plate: the band's floor. Median warmth 0.15 is clamped to 0.06.
    expect(target).toMatchObject({ present: true, avg_luma: 0.38, warm_cool: 0.06, contrast_span: 0.45 });
  });

  it("never aims for clipping", () => {
    const target = unifyTarget([profile(0.5, 0, { clipped_highlights: 0.2 }), profile(0.5, 0, { clipped_highlights: 0.3 })]);
    expect(target.clipped_highlights).toBe(0.02);
  });

  it("is absent without measured clips", () => {
    expect(unifyTarget([{ present: false }]).present).toBe(false);
  });
});

describe("the band", () => {
  it("names the keys outside the tolerance", () => {
    const target = profile(0.5);
    expect(outOfBand(profile(0.53), target)).toEqual([]);
    expect(outOfBand(profile(0.3, 0.05), target)).toEqual(["avg_luma", "warm_cool"]);
    expect(unifyGap(profile(0.3), target).avg_luma).toBe(0.2);
  });

  it("scores distance in tolerances and finds the clip closest to the target", () => {
    const target = profile(0.5);
    expect(bandScore(target, target)).toBe(0);
    expect(bandScore(profile(0.58), target)).toBeCloseTo(4);
    expect(closestToTarget([profile(0.2), profile(0.48), { present: false }, profile(0.9)], target)).toBe(1);
    expect(closestToTarget([{ present: false }], target)).toBe(-1);
  });

  it("measures how far apart the clips are", () => {
    expect(gradeSpread([profile(0.2, -0.05), profile(0.7, 0.05), { present: false }])).toEqual({
      avg_luma: 0.5,
      warm_cool: 0.1,
      green_magenta: 0,
      contrast_span: 0,
    });
  });
});

describe("solveUnifyKnobs", () => {
  const neutral = { exposure: 0, contrast: 0, temperature: 0, tint: 0 };

  it("solves exposure from the luma ratio, contrast from the span after the gain, and a cast through both", () => {
    const next = solveUnifyKnobs(profile(0.25, 0.05, { contrast_span: 0.3 }), profile(0.5, 0, { contrast_span: 0.45 }), neutral, 1);
    // Twice as bright is one stop; the span doubles with it (0.6), so contrast comes down to 0.45 / 0.6.
    expect(next.exposure).toBeCloseTo(1);
    expect(next.contrast).toBeCloseTo(-0.25);
    // -0.05 of warmth at 0.125 per channel, scaled by the gain (2) and contrast (0.75).
    expect(next.temperature).toBeCloseTo(-0.05 / (0.25 * 1.5));
    expect(next.tint).toBe(0);
  });

  it("steps from the knobs the clip has, damped, and within each knob's per-pass limit and range", () => {
    const next = solveUnifyKnobs(profile(0.05), profile(0.5), { ...neutral, exposure: 1.5 }, 1);
    expect(next.exposure).toBe(2);
    const damped = solveUnifyKnobs(profile(0.25), profile(0.5), neutral, 0.5);
    expect(damped.exposure).toBeCloseTo(0.5);
    const tinted = solveUnifyKnobs(profile(0.5, 0, { green_magenta: 0.1 }), profile(0.5), neutral, 1);
    // Tint pulls green down at 0.15 per unit, limited to 0.35 a pass.
    expect(tinted.tint).toBeCloseTo(0.35);
  });

  it("leaves a clip already on target alone", () => {
    expect(solveUnifyKnobs(profile(0.5), profile(0.51), neutral)).toEqual(neutral);
  });
});
