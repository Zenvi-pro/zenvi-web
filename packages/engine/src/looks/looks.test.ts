import { describe, expect, it } from "vitest";
import { parseCubeLut } from "../render/kernels/cube-lut.js";
import { accentLut, bleachBypassLut, chromeLut, duotoneLut, hueOf, solarizeLut } from "./luts.js";
import { SHAPE_FEATHER_RANGE, shapeMaskSettings, shapeMaskSvg, vignetteSvg } from "./masks.js";

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

  it("solarize folds: black stays black, the highlights fold down below a bright upper-mid", () => {
    const cube = solarizeLut();
    expect(at(cube, [0, 0, 0])[0]).toBeLessThan(0.02);
    expect(at(cube, [1, 1, 1])[0]).toBeLessThan(0.62);
    expect(at(cube, [0.625, 0.625, 0.625])[0]).toBeGreaterThan(0.99);
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

  it("turn feather and grow into the Mask effect's contrast and brightness", () => {
    // A 1/40 of the short side feather is the steepest the effect draws (contrast 19.5); the widest is contrast 0.
    expect(shapeMaskSettings(SHAPE_FEATHER_RANGE[0], 0).contrast).toBeCloseTo(19.5, 3);
    expect(shapeMaskSettings(SHAPE_FEATHER_RANGE[1], 0).contrast).toBeCloseTo(0, 3);
    expect(shapeMaskSettings(0.1, 0.25).brightness).toBeCloseTo(0.249, 2);
    expect(shapeMaskSettings(0.1, -0.5).brightness).toBeCloseTo(-0.498, 2);
  });
});
