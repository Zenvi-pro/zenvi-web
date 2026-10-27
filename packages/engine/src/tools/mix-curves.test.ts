import { describe, expect, it } from "vitest";
import { Interpolation } from "../model/types.js";
import { shapeVolume } from "./mix-curves.js";

describe("shapeVolume", () => {
  const clip = { position: 0, start: 0, end: 10 };
  const at = (points: { co: { X: number; Y: number } }[], x: number) => points.find((p) => p.co.X === x)?.co.Y;

  it("writes a constant step at its own level: libopenshot holds the left value until the point, then takes the point's", () => {
    const { points } = shapeVolume(clip, 30, [{ t: 2, db: 0 }, { t: 4, db: -12, curve: "constant" }, { t: 6, db: -12 }], "absolute");
    expect(at(points, 61)).toBeCloseTo(1, 6);
    expect(at(points, 121)).toBeCloseTo(10 ** (-12 / 20), 6);
    expect(points.find((p) => p.co.X === 121)!.interpolation).toBe(Interpolation.CONSTANT);
    expect(at(points, 181)).toBeCloseTo(10 ** (-12 / 20), 6);
  });
});

describe("evaluateVolumeCurve", () => {
  it("reads bezier and constant segments the way libopenshot plays them", async () => {
    const { evaluateVolumeCurve } = await import("./audio-mix.js");
    const { evaluate } = await import("../keyframe/evaluate.js");
    const bez = [
      { co: { X: 1, Y: 1 }, interpolation: Interpolation.BEZIER, handle_right: { X: 0.5, Y: 0 }, handle_left: { X: 0.5, Y: 1 } },
      { co: { X: 31, Y: 0 }, interpolation: Interpolation.BEZIER, handle_right: { X: 0.5, Y: 0 }, handle_left: { X: 0.5, Y: 1 } },
    ];
    // An ease: a quarter of the way in it is still near the top, not at the linear 0.75.
    expect(evaluateVolumeCurve(bez, 8)).toBeCloseTo(evaluate({ Points: bez }, 8), 9);
    expect(evaluateVolumeCurve(bez, 8)).toBeGreaterThan(0.85);
    const step = [
      { co: { X: 1, Y: 1 }, interpolation: Interpolation.LINEAR },
      { co: { X: 31, Y: 0.25 }, interpolation: Interpolation.CONSTANT },
    ];
    expect(evaluateVolumeCurve(step, 30)).toBe(1);
    expect(evaluateVolumeCurve(step, 31)).toBe(0.25);
  });
});
