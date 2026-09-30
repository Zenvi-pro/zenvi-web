import { describe, expect, it } from "vitest";
import { pyRound, roundHalfAway, truncInt } from "./rounding.js";

describe("rounding", () => {
  it("roundHalfAway matches C++ round()", () => {
    expect(roundHalfAway(0.5)).toBe(1);
    expect(roundHalfAway(1.5)).toBe(2);
    expect(roundHalfAway(2.5)).toBe(3);
    expect(roundHalfAway(-0.5)).toBe(-1);
    expect(roundHalfAway(-2.5)).toBe(-3);
    expect(roundHalfAway(0.49999999999999994)).toBe(0);
    expect(Object.is(roundHalfAway(-0.2), 0)).toBe(true);
    expect(roundHalfAway(1e16 + 2)).toBe(1e16 + 2);
  });

  it("pyRound matches Python 3 round() (values checked in CPython)", () => {
    const cases: [number, number][] = [
      [0.5, 0],
      [1.5, 2],
      [2.5, 2],
      [-0.5, 0],
      [-1.5, -2],
      [-2.5, -2],
      [2.675, 3],
      [0.49999999999999994, 0],
      [24.5, 24],
      [25.5, 26],
    ];
    for (const [x, expected] of cases) expect(pyRound(x), String(x)).toBe(expected);
    expect(Object.is(pyRound(-0.4), 0)).toBe(true);
  });

  it("truncInt truncates toward zero", () => {
    expect(truncInt(2.9)).toBe(2);
    expect(truncInt(-2.9)).toBe(-2);
    expect(Object.is(truncInt(-0.3), 0)).toBe(true);
  });
});
