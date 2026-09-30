import { describe, expect, it } from "vitest";
import { Interpolation, type Keyframe } from "../model/types.js";
import {
  compileKeyframe,
  evaluate,
  evaluateAtX,
  getDelta,
  getInt,
  getLength,
  getLong,
  getMaxPoint,
  interpolateBetween,
  isIncreasing,
} from "./evaluate.js";
import { makeKeyframePoint } from "./edit.js";
import { resolvePoint } from "./points.js";

const kf = (...points: [number, number, Interpolation?][]): Keyframe => ({
  Points: points.map(([x, y, i]) => makeKeyframePoint(x, y, i ?? Interpolation.BEZIER)),
});

// Golden values from libopenshot tests/KeyFrame.cpp:84-187.
describe("evaluate (libopenshot tests/KeyFrame.cpp)", () => {
  it("bezier, 2 points", () => {
    const k = kf([1, 1], [50, 4]);
    expect(evaluate(k, -1)).toBeCloseTo(1, 4);
    expect(evaluate(k, 0)).toBeCloseTo(1, 4);
    expect(evaluate(k, 1)).toBeCloseTo(1, 4);
    expect(evaluate(k, 9)).toBeCloseTo(1.12414, 4);
    expect(evaluate(k, 20)).toBeCloseTo(1.8637, 4);
    expect(evaluate(k, 40)).toBeCloseTo(3.79733, 4);
    expect(evaluate(k, 50)).toBeCloseTo(4, 4);
    expect(getLength(k)).toBe(50);
  });

  it("bezier, 5 points", () => {
    const k = kf([1, 1], [50, 4], [100, 10], [150, 0], [200, 3]);
    expect(evaluate(k, 27)).toBeCloseTo(2.68197, 4);
    expect(evaluate(k, 77)).toBeCloseTo(7.47719, 4);
    expect(evaluate(k, 127)).toBeCloseTo(4.20468, 4);
    expect(evaluate(k, 177)).toBeCloseTo(1.7386, 4);
    expect(evaluate(k, 200)).toBeCloseTo(3, 4);
    expect(getLength(k)).toBe(200);
  });

  it("linear, 3 points", () => {
    const k = kf([1, 1, Interpolation.LINEAR], [25, 8, Interpolation.LINEAR], [50, 2, Interpolation.LINEAR]);
    expect(evaluate(k, 9)).toBeCloseTo(3.33333, 4);
    expect(evaluate(k, 20)).toBeCloseTo(6.54167, 4);
    expect(evaluate(k, 40)).toBeCloseTo(4.4, 4);
    expect(evaluate(k, 50)).toBe(2);
  });

  it("constant, 3 points: the jump happens exactly at the right point", () => {
    const k = kf([1, 1, Interpolation.CONSTANT], [25, 8, Interpolation.CONSTANT], [50, 2, Interpolation.CONSTANT]);
    expect(evaluate(k, 24)).toBe(1);
    expect(evaluate(k, 25)).toBe(8);
    expect(evaluate(k, 40)).toBe(8);
    expect(evaluate(k, 49)).toBe(8);
    expect(evaluate(k, 50)).toBe(2);
  });

  it("GetInt / GetLong / GetDelta / IsIncreasing", () => {
    const k = kf([1, 500], [400, 100], [500, 500]);
    expect(getInt(k, 1)).toBe(500);
    expect(isIncreasing(k, 1)).toBe(false);
    expect(getDelta(k, 1)).toBe(500);
    expect(getInt(k, 24)).toBe(498);
    expect(isIncreasing(k, 24)).toBe(false);
    expect(Math.abs(getDelta(k, 24) - -0.1622)).toBeLessThan(1e-4);
    expect(getLong(k, 390)).toBe(100);
    expect(isIncreasing(k, 390)).toBe(false);
    expect(Math.abs(getDelta(k, 390) - -0.0732)).toBeLessThan(1e-4);
    expect(getLong(k, 391)).toBe(100);
    expect(isIncreasing(k, 391)).toBe(false);
    expect(Math.abs(getDelta(k, 388) - -0.0886)).toBeLessThan(1e-4);
  });

  it("GetMaxPoint: last point with the largest Y", () => {
    const k = kf([1, 1], [2, 0], [3, 2], [4, 1], [5, 2]);
    expect(getMaxPoint(k)?.x).toBe(5);
    expect(getMaxPoint({ Points: [] })).toBeNull();
  });
});

describe("evaluate edge cases", () => {
  it("empty keyframe is 0; absent keyframe uses the fallback", () => {
    expect(evaluate({ Points: [] }, 10)).toBe(0);
    expect(evaluate(undefined, 10)).toBe(0);
    expect(evaluate(undefined, 10, 1)).toBe(1);
    expect(evaluate(null, 10, 0.5)).toBe(0.5);
    // A present-but-empty keyframe is not "absent".
    expect(evaluate({ Points: [] }, 10, 1)).toBe(0);
  });

  it("a bare number is one constant point narrowed to float", () => {
    expect(evaluate(0.1, 50)).toBe(Math.fround(0.1));
  });

  it("truncates fractional frames like the C++ int64 parameter", () => {
    const k = kf([1, 0, Interpolation.LINEAR], [11, 10, Interpolation.LINEAR]);
    expect(evaluate(k, 5.9)).toBe(4);
    expect(evaluateAtX(k, 5.5)).toBe(4.5);
  });

  it("unsorted and duplicate points load like libopenshot (sorted, last duplicate wins)", () => {
    const k: Keyframe = {
      Points: [
        makeKeyframePoint(20, 20, Interpolation.LINEAR),
        makeKeyframePoint(1, 0, Interpolation.LINEAR),
        makeKeyframePoint(20, 40, Interpolation.LINEAR),
      ],
    };
    expect(evaluate(k, 20)).toBe(40);
    expect(evaluate(k, 11)).toBeCloseTo(21.052631579, 6);
  });

  it("bezier with non-monotonic handles terminates (iteration cap)", () => {
    const left = resolvePoint({ co: { X: 1, Y: 0 }, handle_right: { X: 3, Y: 0 }, interpolation: 0 });
    const right = resolvePoint({ co: { X: 10, Y: 1 }, handle_left: { X: -2, Y: 1 }, interpolation: 0 });
    const value = interpolateBetween(left, right, 5);
    expect(Number.isFinite(value)).toBe(true);
  });

  it("missing point fields take libopenshot Point() defaults", () => {
    const p = resolvePoint({});
    expect(p).toMatchObject({ x: 1, y: 0, interpolation: Interpolation.BEZIER, leftX: 0.5, leftY: 1, rightX: 0.5, rightY: 0 });
  });

  it("compiled keyframes give the same answers", () => {
    const k = kf([1, 1], [50, 4], [100, 10]);
    const c = compileKeyframe(k);
    for (let f = -3; f < 110; f += 1) expect(c.value(f)).toBe(evaluate(k, f));
    expect(c.length).toBe(100);
    expect(c.count).toBe(3);
  });

  it("IsIncreasing clamps its index and defaults to true for flat curves", () => {
    const flat = kf([1, 3], [10, 3]);
    expect(isIncreasing(flat, 5)).toBe(true);
    const down = kf([1, 10, Interpolation.LINEAR], [10, 0, Interpolation.LINEAR]);
    expect(isIncreasing(down, -5)).toBe(false);
    expect(isIncreasing(down, 500)).toBe(false);
  });

  it("GetDelta past the end is 1.0 and before frame 1 is 0", () => {
    const k = kf([1, 5, Interpolation.LINEAR], [10, 50, Interpolation.LINEAR]);
    expect(getDelta(k, 0)).toBe(0);
    expect(getDelta(k, 11)).toBe(1);
    expect(getDelta(k, 5)).toBe(5);
  });
});
