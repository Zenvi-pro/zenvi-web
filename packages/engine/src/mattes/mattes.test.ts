import { describe, expect, it } from "vitest";
import { applyCubeLut } from "../render/kernels/color-map.js";
import { parseCubeLut } from "../render/kernels/cube-lut.js";
import type { PremulImage } from "../render/pixels.js";
import { gradientMapLut, rampColor, solidLut, THERMAL_RAMP } from "./luts.js";
import { bigTextSvg, gradientSvg, letterboxBarHeight, letterboxSvg } from "./svg.js";

function pixel(rgb: [number, number, number]): PremulImage {
  return { width: 1, height: 1, data: new Uint8ClampedArray([...rgb, 255]) } as PremulImage;
}

describe("generated LUTs", () => {
  it("a solid LUT maps every colour to the fill, through ColorMap's own loader", () => {
    const lut = parseCubeLut(solidLut("#ff8000"))!;
    expect(lut.kind).toBe("3d");
    for (const rgb of [[0, 0, 0], [255, 255, 255], [12, 200, 90]] as [number, number, number][]) {
      const image = pixel(rgb);
      applyCubeLut(image, lut, 1, 1, 1, 1);
      expect([...image.data]).toEqual([255, 128, 0, 255]);
    }
  });

  it("a gradient map follows luminance: black is the cold end, white the hot end", () => {
    const lut = parseCubeLut(gradientMapLut("t", THERMAL_RAMP, 17))!;
    expect(lut.size).toBe(17);
    const dark = pixel([0, 0, 0]);
    const bright = pixel([255, 255, 255]);
    applyCubeLut(dark, lut, 1, 1, 1, 1);
    applyCubeLut(bright, lut, 1, 1, 1, 1);
    expect([...dark.data.slice(0, 3)]).toEqual([5, 0, 58]);
    expect([...bright.data.slice(0, 3)]).toEqual([255, 255, 255]);
    expect(rampColor([{ at: 0, color: "#000000" }, { at: 1, color: "#ffffff" }], 0.5)).toEqual([0.5, 0.5, 0.5]);
  });
});

describe("layer SVGs", () => {
  it("letterbox bars leave a band of the asked aspect", () => {
    expect(letterboxBarHeight(1920, 1080, 2.4)).toBe(140);
    expect(letterboxBarHeight(1080, 1920, 2.4)).toBe(735);
    const svg = letterboxSvg(1920, 1080, 2.4, "#000000");
    expect(svg).toContain('<rect x="0" y="0" width="1920" height="140" fill="#000000"/>');
    expect(svg).toContain('<rect x="0" y="940" width="1920" height="140" fill="#000000"/>');
  });

  it("gradients are flat bands from top to bottom colour", () => {
    const svg = gradientSvg(100, 40, "#000000", "#ffffff", 4);
    const fills = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
    expect(fills).toHaveLength(10);
    expect([fills[0], fills[9]]).toEqual(["#000000", "#ffffff"]);
  });

  it("big text is escaped, centred and fits the width", () => {
    const svg = bigTextSvg(1280, 720, { text: "R&D <now>", color: "#ffffff", y: 0.4 });
    expect(svg).toContain(">R&amp;D &lt;now&gt;</tspan>");
    expect(svg).toContain('text-anchor="middle"');
    const size = Number(/font-size="([\d.]+)"/.exec(svg)![1]);
    expect(size).toBeGreaterThan(100);
    expect(size).toBeLessThanOrEqual(720 * 0.45);
  });
});
