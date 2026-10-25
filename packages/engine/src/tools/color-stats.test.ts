/**
 * Frame statistics, ported from zenvi-core develop
 * tests/test_editor_tools_effects_color_process.py (compute_stats cases) and
 * tests/test_editor_tools_effects_color_looks.py (green/blue screen helpers),
 * plus pixel_stats, frame_pixels and region checks on real pixels.
 */

import { describe, expect, it } from "vitest";
import { premultiply } from "../render/pixels.js";
import {
  AnalysisError,
  computeStats,
  framePixels,
  pixelStats,
  regionArg,
  scopeData,
  screenColorFromHistograms,
  screenFromScopes,
  screenFuzzFromHistograms,
  type ScopeData,
} from "./color-stats.js";
import { screenShot, solid } from "./test-support/pixel-host.js";

function hist(pairs: [number, number][]): number[] {
  const h = new Array<number>(256).fill(0);
  for (const [value, count] of pairs) h[value]! += count;
  return h;
}

function vec(size: number, points: [[number, number], number][]): number[] {
  const v = new Array<number>(size * size).fill(0);
  for (const [[x, y], n] of points) v[y * size + x]! += n;
  return v;
}

function cell(r: number, g: number, b: number) {
  return { red: hist([[r, 100]]), green: hist([[g, 100]]), blue: hist([[b, 100]]) };
}

describe("computeStats", () => {
  it("reads a gray frame: median, black and white, neutral, more contrast suggested", () => {
    const gray = hist([[128, 1000]]);
    const d: ScopeData = {
      luma: gray, red: gray, green: gray, blue: gray, vectorscope: vec(129, [[[64, 64], 1000]]), vectorscope_size: 129,
      clipped_shadows: 0, clipped_highlights: 0, total_pixels: 1000, width: 40, height: 25,
    };
    const s = computeStats(d);
    expect(s.luma!.p50).toBeCloseTo(0.502, 3);
    expect(s.gray_pct).toBe(100.0);
    expect(s.cast).toBe("neutral");
    expect(s.transparent_pct).toBe(0.0);
    expect(s.verdict).toContain("black and white");
    expect(s.suggested_grade).toEqual({ contrast: 0.2 });
  });

  it("reads a dark warm frame and suggests brighter and cooler", () => {
    const d: ScopeData = {
      luma: hist([[20, 900], [40, 100]]), red: hist([[50, 1000]]), green: hist([[25, 1000]]), blue: hist([[5, 1000]]),
      vectorscope: vec(129, [[[40, 80], 1000]]), vectorscope_size: 129, clipped_shadows: 100, clipped_highlights: 0,
      total_pixels: 2000, width: 50, height: 40,
    };
    const s = computeStats(d);
    expect(s.warmth as number).toBeGreaterThan(0.1);
    expect(String(s.cast)).toMatch(/^warm/);
    expect(s.verdict!.some((v) => v.startsWith("underexposed"))).toBe(true);
    expect(s.suggested_grade!.exposure!).toBeGreaterThan(1);
    expect(s.suggested_grade!.temperature!).toBeLessThan(0);
    expect(s.transparent_pct).toBe(50.0);
  });

  it("says when every pixel is transparent", () => {
    const empty = hist([]);
    const d: ScopeData = {
      luma: empty, red: empty, green: empty, blue: empty, vectorscope: [], vectorscope_size: 0, clipped_shadows: 0,
      clipped_highlights: 0, total_pixels: 100, width: 10, height: 10,
    };
    expect(computeStats(d)).toEqual({ transparent_pct: 100.0, note: "every pixel is transparent" });
  });

  it("measures real pixels: a blue cast on the neutral greys, and a transparent half", () => {
    const image = solid(64, 32, [120, 125, 150, 255]);
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) image.data.set([0, 0, 0, 0], (y * 64 + x) * 4);
    const pm = premultiply(image);
    const s = computeStats(scopeData(pm), pixelStats(framePixels(pm)));
    expect(s.transparent_pct).toBe(50.0);
    expect(s.cast).toBe("cool (blue)");
    expect(s.neutral_rgb).toEqual([0.471, 0.49, 0.588]);
    expect(s.neutral_warmth).toBe(-0.118);
    expect(s.suggested_grade!.temperature!).toBeGreaterThan(0);
  });
});

describe("regionArg", () => {
  it("takes fractions inside the frame and refuses the rest", () => {
    expect(regionArg(undefined)).toBeNull();
    expect(regionArg({})).toBeNull();
    expect(regionArg({ x: "0.1", y: 0.1, width: 0.5, height: 0.5 })).toEqual({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
    expect(() => regionArg({ x: 0.9, y: 0, width: 0.5, height: 1 })).toThrow("region must lie inside the frame");
    expect(() => regionArg({ x: 0.1 })).toThrow("region needs x, y, width, height as fractions 0-1 of the frame");
    expect(() => regionArg("left half")).toThrow(AnalysisError);
  });
});

describe("green and blue screens", () => {
  it("screen_color_from_histograms: medians and the screen kind", () => {
    const green = { red: hist([[20, 100]]), green: hist([[180, 100]]), blue: hist([[60, 100]]) };
    expect(screenColorFromHistograms([green, green])).toEqual(["#14b43c", "green"]);
    expect(screenColorFromHistograms([cell(120, 125, 118)])[1]).toBeNull();
  });

  it("screen_fuzz_from_histograms: an even screen keys at 20, a patchy one needs more", () => {
    const even = { red: hist([[20, 100]]), green: hist([[180, 100]]), blue: hist([[60, 100]]) };
    const patchy = { red: hist([[20, 100]]), green: [...new Array(120).fill(0), ...new Array(100).fill(50), ...new Array(36).fill(0)], blue: hist([[60, 100]]) };
    expect(screenFuzzFromHistograms([even])).toBe(20.0);
    const fuzz = screenFuzzFromHistograms([patchy]);
    expect(fuzz).toBeGreaterThanOrEqual(70);
    expect(fuzz).toBeLessThanOrEqual(80);
  });

  it("a screen that misses the frame edges is found in the frame grid", () => {
    const walls = new Array(4).fill(cell(200, 200, 205));
    const grid = [...new Array(14).fill(cell(46, 182, 58)), ...new Array(4).fill(cell(30, 60, 200)), ...new Array(6).fill(cell(200, 200, 205))];
    const [color, where, fuzz] = screenFromScopes(walls, grid)!;
    expect(color).toBe("#2eb63a");
    expect(where).toContain("green screen in 14 of 24 frame areas");
    expect(fuzz).toBe(20.0);
    expect(screenFromScopes(walls, grid, "blue")![0]).toBe("#1e3cc8");
    expect(screenFromScopes(walls, new Array(24).fill(cell(200, 200, 205)))).toBeNull();
    expect(screenFromScopes(new Array(4).fill(cell(20, 180, 60)), grid)![1]).toBe("green screen at the frame edges");
  });

  it("finds a real green screen's edges in rendered pixels", () => {
    const pm = premultiply(screenShot(120, 68, [30, 180, 60]));
    const edges = [
      { x: 0, y: 0, width: 0.08, height: 1 },
      { x: 0.92, y: 0, width: 0.08, height: 1 },
      { x: 0, y: 0, width: 1, height: 0.08 },
    ].map((r) => scopeData(pm, r));
    expect(screenColorFromHistograms(edges)).toEqual(["#1eb43c", "green"]);
  });
});
