import { describe, expect, it } from "vitest";
import { edgeDistance, flatten, insideEvenOdd, mapCommands, parsePathData, polylineLength, rotation } from "./path-data.js";

describe("parsePathData", () => {
  it("reads relative, shorthand and implicit commands as absolute lines and curves", () => {
    const c = parsePathData("m10 10 h20 v20 H10 z M0,0 l5-5 5 5 q5 5 10 0 t10 0 c1 1 2 2 3 3 s4 4 5 5");
    expect(c.slice(0, 5)).toEqual([
      { type: "M", x: 10, y: 10 },
      { type: "L", x: 30, y: 10 },
      { type: "L", x: 30, y: 30 },
      { type: "L", x: 10, y: 30 },
      { type: "Z" },
    ]);
    // The implicit second l pair continues from the first.
    expect(c[7]).toEqual({ type: "L", x: 10, y: 0 });
    // T reflects the last quadratic control point.
    expect(c[9]).toEqual({ type: "Q", x1: 25, y1: -5, x: 30, y: 0 });
    // S reflects the last cubic's second control point.
    expect(c[11]).toMatchObject({ type: "C", x1: 34, y1: 4 });
  });

  it("turns arcs into cubics that reach the arc's end on its circle", () => {
    const c = parsePathData("M 0 0 A 50 50 0 0 1 100 0");
    expect(c.at(-1)).toMatchObject({ x: 100, y: 0 });
    const [line] = flatten(c, 1);
    // A half circle of radius 50.
    expect(polylineLength(line!)).toBeCloseTo(Math.PI * 50, 0);
    for (let i = 0; i < line!.points.length; i += 2) expect(Math.hypot(line!.points[i]! - 50, line!.points[i + 1]!)).toBeCloseTo(50, 0);
  });

  it("reads arc flags written without separators, as svgo writes them", () => {
    expect(parsePathData("M0 0a5 5 0 0110 0")).toEqual(parsePathData("M0 0 a5 5 0 0 1 10 0"));
    expect(parsePathData("M0 0A5 5 0 01.5 0").at(-1)).toMatchObject({ x: 0.5, y: 0 });
    expect(() => parsePathData("M0 0 A5 5 0 2 1 10 0")).toThrow(/flags of 0 or 1/);
  });

  it("refuses data that is not a path", () => {
    expect(() => parsePathData("L 0 0")).toThrow(/start with M/);
    expect(() => parsePathData("M 0 0 L 5")).toThrow(/missing a number/);
    expect(() => parsePathData("M 0 0 url(#x)")).toThrow(/not path commands/);
  });
});

describe("contour geometry", () => {
  const square = flatten(parsePathData("M0 0 H100 V100 H0 Z M25 25 H75 V75 H25 Z"));

  it("keeps a counter solid by the even-odd rule and measures the distance to the nearest edge", () => {
    expect(insideEvenOdd(square, 10, 50)).toBe(true);
    expect(insideEvenOdd(square, 50, 50)).toBe(false);
    expect(edgeDistance(square, 10, 50)).toBeCloseTo(10, 6);
  });

  it("rotates commands clockwise on screen", () => {
    const [p] = mapCommands([{ type: "M", x: 10, y: 0 }], rotation(90));
    expect(p).toMatchObject({ x: expect.closeTo(0, 9), y: expect.closeTo(10, 9) });
  });
});
