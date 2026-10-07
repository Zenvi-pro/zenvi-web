import { describe, expect, it } from "vitest";
import { bucketSize } from "./size-bucket.js";

describe("bucketSize", () => {
  const natural = { width: 1920, height: 1080 };

  it("never goes below the requested size and at most ~19% above it", () => {
    for (let w = 100; w <= 1920; w += 37) {
      const h = Math.round((w * 9) / 16);
      const b = bucketSize({ width: w, height: h }, natural);
      expect(b.width).toBeGreaterThanOrEqual(w - 1);
      expect(b.width).toBeLessThanOrEqual(Math.ceil(w * 1.19) + 1);
    }
  });

  it("maps a slow zoom onto a few sizes", () => {
    const sizes = new Set<string>();
    for (let i = 0; i < 120; i += 1) {
      const w = 960 * (1 + i / 400);
      const b = bucketSize({ width: w, height: (w * 9) / 16 }, natural);
      sizes.add(`${b.width}x${b.height}`);
    }
    expect(sizes.size).toBeLessThanOrEqual(3);
  });

  it("caps rasters at natural size but lets vectors grow", () => {
    expect(bucketSize({ width: 3840, height: 2160 }, natural)).toEqual(natural);
    expect(bucketSize({ width: 3840, height: 2160 }, natural, { allowUpscale: true })).toEqual({ width: 3840, height: 2160 });
  });

  it("quantizes each axis for stretched draws and handles unknown natural sizes", () => {
    const b = bucketSize({ width: 1920, height: 540 }, natural);
    expect(b).toEqual({ width: 1920, height: 540 });
    expect(bucketSize({ width: 10.2, height: 5.5 }, { width: 0, height: 0 })).toEqual({ width: 11, height: 6 });
  });
});
