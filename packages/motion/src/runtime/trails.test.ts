import { describe, expect, it } from "vitest";
import { drawTrail, measure, pointAlong, sampleCurve, slice } from "./trails.js";

const line = measure([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);

describe("pointAlong", () => {
  it("follows the path by length, with its heading", () => {
    expect(line.total).toBe(20);
    expect(pointAlong(line, 0.25)).toEqual({ x: 5, y: 0, angle: 0 });
    const p = pointAlong(line, 0.75);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(5);
    expect(p.angle).toBeCloseTo(Math.PI / 2);
    expect(pointAlong(line, 2)).toMatchObject({ x: 10, y: 10 });
  });
});

describe("slice", () => {
  it("cuts the polyline between two fractions, keeping inner vertices", () => {
    const s = slice(line, 0.25, 0.75);
    expect(s.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([[5, 0], [10, 0], [10, 5]]);
    expect(slice(line, 0.6, 0.4)).toEqual([]);
  });
});

describe("sampleCurve", () => {
  it("keeps each curve inside its radius", () => {
    for (const curve of [
      { kind: "spiral", turns: 3, inner: 0.1, rotate: 0 },
      { kind: "orbit", turns: 4, squash: 0.4, precession: 1, rotate: 0.3 },
      { kind: "lissajous", a: 3, b: 2, phase: 0.5 },
      { kind: "rose", k: 4, turns: 1, rotate: 0 },
    ] as const) {
      const pts = sampleCurve(curve, 100, 200, 50, 80, 400);
      expect(pts).toHaveLength(401);
      for (const p of pts) {
        expect(Math.abs(p.x - 100)).toBeLessThanOrEqual(80 + 1e-9);
        expect(Math.abs(p.y - 200)).toBeLessThanOrEqual(80 + 1e-9);
      }
    }
  });
});

describe("drawTrail", () => {
  /** A fake 2D context recording each stroke's alpha and width. */
  function recorder() {
    const strokes: { alpha: number; width: number }[] = [];
    const g = { globalAlpha: 1, lineWidth: 1, lineCap: "", lineJoin: "", strokeStyle: "", save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() { strokes.push({ alpha: g.globalAlpha, width: g.lineWidth }); } };
    return { g: g as unknown as CanvasRenderingContext2D, strokes };
  }

  it("fades and thins the tail toward its end", () => {
    const { g, strokes } = recorder();
    drawTrail(g, line, 0.8, { color: "#fff", width: 10, tail: 0.4 });
    expect(strokes.length).toBeGreaterThan(10);
    for (let i = 1; i < strokes.length; i += 1) {
      expect(strokes[i]!.alpha).toBeGreaterThan(strokes[i - 1]!.alpha);
      expect(strokes[i]!.width).toBeGreaterThan(strokes[i - 1]!.width);
    }
    expect(strokes[strokes.length - 1]).toEqual({ alpha: 1, width: 10 });
  });

  it("draws nothing before the head starts, and a solid line for an endless tail", () => {
    const a = recorder();
    drawTrail(a.g, line, 0, { color: "#fff", width: 4, tail: 0.3 });
    expect(a.strokes).toHaveLength(0);
    const b = recorder();
    drawTrail(b.g, line, 1, { color: "#fff", width: 4, tail: Infinity });
    expect(new Set(b.strokes.map((s) => `${s.alpha}/${s.width}`))).toEqual(new Set(["1/4"]));
  });
});
