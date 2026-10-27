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
