import { describe, expect, it } from "vitest";
import { parseCubeLut } from "../render/kernels/cube-lut.js";
import { accentLut, bleachBypassLut, chromeLut, duotoneLut, hueOf, solarizeLut } from "./luts.js";
import { SHAPE_FEATHER_RANGE, polygonProblem, polygonRegions, shapeMaskSettings, shapeMaskSvg, vignetteSvg } from "./masks.js";

/** The LUT's entry nearest an input colour (red fastest). */
function at(cube: string, rgb: [number, number, number]): number[] {
  const lines = cube.trim().split("\n");
  const size = Number(/LUT_3D_SIZE (\d+)/.exec(cube)![1]);
  const [r, g, b] = rgb.map((v) => Math.round(v * (size - 1)));
  return lines[2 + r! + g! * size + b! * size * size]!.split(" ").map(Number);
}

describe("look LUTs", () => {
  it("are cubes the ColorMap kernel reads", () => {
    for (const cube of [solarizeLut(), chromeLut(), bleachBypassLut(), duotoneLut("#14123b", "#ffc845"), accentLut(0)]) expect(parseCubeLut(cube)).not.toBeNull();
  });

  it("solarize folds: black stays black, everything above the lower mids reverses, white lands dark", () => {
    const cube = solarizeLut();
    expect(at(cube, [0, 0, 0])[0]).toBeLessThan(0.02);
    expect(at(cube, [1, 1, 1])[0]).toBeLessThan(0.25);
    expect(at(cube, [0.45, 0.45, 0.45])[0]).toBeGreaterThan(0.97);
    expect(at(cube, [0.75, 0.75, 0.75])[0]).toBeLessThan(at(cube, [0.5, 0.5, 0.5])[0]!);
  });

  it("chrome is monochrome with a cold cast and folded highlights", () => {
    const cube = chromeLut();
    const red = at(cube, [1, 0, 0]);
    expect(Math.max(...red) - Math.min(...red)).toBeLessThan(0.06);
    const mid = at(cube, [0.6, 0.6, 0.6]);
    expect(mid[2]).toBeGreaterThan(mid[0]!);
    expect(at(cube, [1, 1, 1])[1]).toBeLessThan(at(cube, [0.7, 0.7, 0.7])[1]!);
  });

  it("duotone maps black to the shadow ink and white to the highlight ink", () => {
    const cube = duotoneLut("#000080", "#ffcc00");
    expect(at(cube, [0, 0, 0]).map((v) => Math.round(v * 255))).toEqual([0, 0, 128]);
    expect(at(cube, [1, 1, 1]).map((v) => Math.round(v * 255))).toEqual([255, 204, 0]);
  });

  it("accent keeps its hue and greys the rest; bleach bypass halves the saturation", () => {
    const red = accentLut(hueOf("#ff2020"));
    const kept = at(red, [1, 0, 0]);
    expect(kept[0]! - kept[1]!).toBeGreaterThan(0.8);
    const green = at(red, [0, 1, 0]);
    expect(Math.max(...green) - Math.min(...green)).toBeLessThan(1e-6);
    const bleach = at(bleachBypassLut(), [1, 0, 0]);
    expect(bleach[0]! - bleach[1]!).toBeLessThan(0.6);
  });
});

describe("mask images", () => {
  it("draw a vignette's falloff and shapes as distance fields", () => {
    expect(vignetteSvg(1920, 1080, 0.5)).toMatch(/<radialGradient id="v"[^>]*scale\(960 540\)/);
    const ellipse = shapeMaskSvg(1920, 1080, { shape: "ellipse", x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
    expect(ellipse).toMatch(/radialGradient id="e"/);
    const rect = shapeMaskSvg(1920, 1080, { shape: "rectangle", x: 0.5, y: 0.5, width: 0.5, height: 0.25 });
    expect(rect.match(/<polygon/g)).toHaveLength(4);
  });

  it("draw a convex polygon as the nearest side's ramp, so the field is the smallest distance to any side", () => {
    const W = 1920;
    const H = 1080;
    // A parallelogram window leaning right, listed anticlockwise on screen; the same field either winding.
    const quad: [number, number][] = [
      [600, 200],
      [400, 880],
      [1300, 880],
      [1500, 200],
    ];
    const range = 540;
    for (const pts of [quad, [...quad].reverse()]) {
      const regions = polygonRegions(W, H, pts, range);
      expect(regions).toHaveLength(4);
      // Grey along a region's ramp: 0.5 on its side, 0 `range` outside it, 1 `range` inside.
      const grey = (r: (typeof regions)[number], p: [number, number]) => {
        const dx = r.to[0] - r.from[0];
        const dy = r.to[1] - r.from[1];
        const t = ((p[0] - r.from[0]) * dx + (p[1] - r.from[1]) * dy) / (dx * dx + dy * dy);
        return Math.min(1, Math.max(0, t));
      };
      const inside = (poly: readonly (readonly [number, number])[], p: [number, number]) => {
        let sign = 0;
        for (let i = 0; i < poly.length; i += 1) {
          const a = poly[i]!;
          const b = poly[(i + 1) % poly.length]!;
          const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
          if (Math.abs(c) < 1e-6) continue;
          if (sign !== 0 && Math.sign(c) !== sign) return false;
          sign = Math.sign(c);
        }
        return true;
      };
      for (const p of [[950, 540], [610, 210], [300, 540], [1000, 100], [1700, 900], [960, 1000]] as [number, number][]) {
        const owners = regions.filter((r) => inside(r.region, p));
        expect(owners.length).toBeGreaterThan(0);
        const values = regions.map((r) => grey(r, p));
        // The owner's ramp is the smallest (nearest side) wherever the point is.
        for (const o of owners) expect(grey(o, p)).toBeCloseTo(Math.min(...values), 6);
      }
      // The middle is inside (above mid-grey), a point left of the slanted side outside.
      const at = (p: [number, number]) => grey(regions.find((r) => inside(r.region, p))!, p);
      expect(at([950, 540])).toBeGreaterThan(0.6);
      expect(at([380, 540])).toBeLessThan(0.5);
    }
    const svg = shapeMaskSvg(W, H, { shape: "polygon", x: 0, y: 0, width: 0, height: 0, points: quad.map(([x, y]) => ({ x: x / W, y: y / H })) });
    expect(svg.match(/<polygon/g)).toHaveLength(8);
    expect(svg.match(/<linearGradient/g)).toHaveLength(4);
  });

  it("refuse polygons that are not convex or cross themselves", () => {
    expect(polygonProblem([[0, 0], [10, 0]])).toMatch(/at least 3/);
    expect(polygonProblem([[0, 0], [100, 0], [100, 100], [50, 20], [0, 100]])).toMatch(/not convex/);
    const star: [number, number][] = [0, 2, 4, 1, 3].map((k) => [500 + 400 * Math.cos((2 * Math.PI * k) / 5), 500 + 400 * Math.sin((2 * Math.PI * k) / 5)]);
    expect(polygonProblem(star)).toMatch(/crosses itself/);
    expect(polygonProblem([[0, 0], [50, 0], [100, 0], [50, 80]])).toMatch(/on the line/);
    expect(polygonProblem([[0, 0], [100, 0], [50, 80]])).toBeNull();
  });

  it("turn feather and grow into the Mask effect's contrast and brightness", () => {
    // A 1/40 of the short side feather is the steepest the effect draws (contrast 19.5); the widest is contrast 0.
    expect(shapeMaskSettings(SHAPE_FEATHER_RANGE[0], 0).contrast).toBeCloseTo(19.5, 3);
    expect(shapeMaskSettings(SHAPE_FEATHER_RANGE[1], 0).contrast).toBeCloseTo(0, 3);
    expect(shapeMaskSettings(0.1, 0.25).brightness).toBeCloseTo(0.249, 2);
    expect(shapeMaskSettings(0.1, -0.5).brightness).toBeCloseTo(-0.498, 2);
  });
});
