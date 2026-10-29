import { describe, expect, it } from "vitest";
import type { PictureSeries } from "../tools/types.js";
import type { Shot } from "./render.js";
import { onsetRatios, rhythmReview, shotPictures } from "./rhythm.js";

const shotsOf = (lengths: readonly number[]): Shot[] => {
  let t = 0;
  return lengths.map((l, i) => {
    const s = { index: i + 1, start: t, end: t + l, mid: t + l / 2 };
    t += l;
    return s;
  });
};

/** A 15 fps series where `at(t)` gives luma, u, v and motion. */
function series(duration: number, at: (t: number) => [number, number, number, number]): PictureSeries {
  const t = Array.from({ length: Math.round(duration * 15) }, (_, i) => Math.round((i / 15) * 1000) / 1000);
  const rows = t.map(at);
  return { fps: 15, t, luma: rows.map((r) => r[0]), u: rows.map((r) => r[1]), v: rows.map((r) => r[2]), motion: rows.map((r) => r[3]) };
}

describe("rhythmReview", () => {
  it("leaves a slow edit alone", () => {
    const shots = shotsOf([4, 4, 4, 4]);
    expect(rhythmReview(shots, 16, series(16, () => [0.5, 0, 0, 0]), [0, 0, 0]).problems).toEqual([]);
  });

  it("flags a metronome cut, a shot that goes still, flat brightness and hue, and silent cuts", () => {
    const shots = shotsOf([1, 1, 1, 1, 1, 1, 1, 1]);
    // Every shot the same dark blue; shot 3 stops moving after its first 0.2 s.
    const pic = series(8, (t) => [0.15, 0.3, -0.1, t >= 2.2 && t < 3 ? 0 : 0.02]);
    const review = rhythmReview(shots, 8, pic, [9, 1, 9, 9, 9, 9, 2]);
    expect(review.fastCut).toBe(true);
    expect(review.problems.map((p) => p.kind)).toEqual(["uniform_shot_lengths", "static_shot", "flat_brightness", "flat_hue", "cut_without_sound"]);
    expect(review.problems.find((p) => p.kind === "static_shot")!.at).toBe(2);
    expect(review.weakCuts).toEqual([2, 7]);
    expect(review.problems.every((p) => p.severity === "warning")).toBe(true);
  });

  it("passes a varied cut with a value rhythm, colour and a sound on every cut; the final hold may be still", () => {
    const shots = shotsOf([0.5, 1, 2, 0.5, 1, 4]);
    const pic = series(9, (t) => (t < 1.5 ? [0.1, 0.3, 0, 0.02] : t < 3.5 ? [0.9, 0, 0, 0.02] : t < 5 ? [0.3, -0.2, 0.3, 0.02] : [0.2, 0, -0.3, 0]));
    const review = rhythmReview(shots, 9, pic, [8, 8, 8, 8, 8]);
    expect(review.problems).toEqual([]);
    expect(review.pictures).toHaveLength(6);
  });

  it("does not read hue into grey shots and skips stills already reported as frozen", () => {
    const shots = shotsOf([1, 0.5, 1, 2, 0.5]);
    const pic = series(5, (t) => [t < 2 ? 0.1 : 0.8, 0.001, 0.001, t >= 1.5 && t < 2.5 ? 0 : 0.02]);
    const review = rhythmReview(shots, 5, pic, null, [{ start: 1.5, end: 2.5 }]);
    expect(review.pictures.every((p) => p.hue === null)).toBe(true);
    expect(review.problems).toEqual([]);
    expect(review.weakCuts).toBeNull();
  });
});

describe("shotPictures", () => {
  it("measures the hue of a shot's mean chroma", () => {
    const [p] = shotPictures(series(1, () => [0.5, 0, 0.5, 0.01]), shotsOf([1]));
    expect(p).toMatchObject({ luma: 0.5, hue: 90, chroma: 0.5, longestStill: 0 });
  });
});

describe("onsetRatios", () => {
  it("finds a click at a cut and nothing between", () => {
    const sr = 8000;
    const x = new Float32Array(sr * 2);
    for (let i = 0; i < x.length; i += 1) x[i] = 0.01 * Math.sin(i * 0.3) + (i >= sr && i < sr + 400 ? 0.8 : 0);
    const [atClick, between] = onsetRatios(x, sr, [1, 0.5]);
    expect(atClick).toBeGreaterThan(4);
    expect(between).toBeLessThan(4);
    expect(onsetRatios(new Float32Array(sr), sr, [0.5])).toEqual([0]);
  });
});
