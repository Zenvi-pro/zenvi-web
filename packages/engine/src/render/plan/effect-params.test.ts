import { describe, expect, it } from "vitest";
import { evaluateAnimatedCurve, evaluateEffectParams, sampleCurve } from "./effect-params.js";

const kf = (...points: [number, number, number?][]) => ({
  Points: points.map(([X, Y, interpolation = 1]) => ({ co: { X, Y }, interpolation })),
});

describe("evaluateEffectParams", () => {
  it("evaluates keyframes, colors and nested objects at the frame", () => {
    const params = evaluateEffectParams(
      {
        id: "E1",
        type: "Brightness",
        brightness: kf([1, 0], [11, 1]),
        color: { red: kf([1, 10]), green: kf([1, 20]), blue: kf([1, 30]), alpha: kf([1, 40]) },
        wheels: { enabled: true, global: { color: "#ff0000", amount_keyframes: kf([1, 0.25]) } },
        mask_reader: { type: "QtImageReader", path: "/m.png", fps: { num: 30, den: 1 } },
        resize: false,
        empty: { Points: [] },
      },
      6,
    );
    expect(params.brightness).toBeCloseTo(0.5, 12);
    expect(params.color).toEqual([10, 20, 30, 40]);
    expect(params.wheels).toEqual({ enabled: true, global: { color: "#ff0000", amount_keyframes: 0.25 } });
    expect(params.mask_reader).toEqual({ type: "QtImageReader", path: "/m.png", fps: { num: 30, den: 1 } });
    expect(params.resize).toBe(false);
    expect(params.empty).toBe(0);
  });

  it("treats a missing alpha channel as opaque", () => {
    const p = evaluateEffectParams({ c: { red: kf([1, 1]), green: kf([1, 2]), blue: kf([1, 3]) } }, 1);
    expect(p.c).toEqual([1, 2, 3, 255]);
  });
});

describe("AnimatedCurve", () => {
  it("defaults to the identity curve (AnimatedCurve.cpp:103-107)", () => {
    const c = evaluateAnimatedCurve({}, 1);
    expect(c.enabled).toBe(1);
    expect(c.table[0]).toBe(0);
    expect(c.table[255]).toBe(1);
    expect(c.table[128]).toBeCloseTo(128 / 255, 6);
  });

  it("builds points at float(x·255) and clamps to [0, 1]", () => {
    const c = evaluateAnimatedCurve(
      {
        enabled: kf([1, 1]),
        nodes: [
          { id: 0, x: kf([1, 0]), y: kf([1, 0.2]), interpolation: 1 },
          { id: 1, x: kf([1, 0.5]), y: kf([1, 1.5]), interpolation: 1 },
          { id: 2, x: kf([1, 1]), y: kf([1, 0.4]), interpolation: 2 },
        ],
      },
      1,
    );
    expect(c.table[0]).toBeCloseTo(0.2, 6);
    // Right-hand point decides interpolation: CONSTANT holds the left value until X.
    expect(c.table[200]).toBe(1);
    expect(c.table[255]).toBeCloseTo(0.4, 6);
    expect(sampleCurve(c, 0)).toBeCloseTo(0.2, 6);
  });

  it("samples the input unquantized when disabled", () => {
    const c = evaluateAnimatedCurve({ enabled: kf([1, 0]) }, 1);
    expect(sampleCurve(c, 0.3)).toBe(Math.fround(0.3));
    expect(sampleCurve(c, 1.7)).toBe(1);
  });

  it("orders nodes by x at the frame, ties by id", () => {
    const c = evaluateAnimatedCurve(
      {
        nodes: [
          { id: 5, x: kf([1, 1]), y: kf([1, 1]) },
          { id: 1, x: kf([1, 0]), y: kf([1, 1]) },
          { id: 0, x: kf([1, 0]), y: kf([1, 0]) },
        ],
      },
      1,
    );
    // Two nodes at x = 0: AddPoint keeps the later one in sorted order (id 1, y = 1).
    expect(c.table[0]).toBe(1);
  });
});
