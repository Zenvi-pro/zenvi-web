import { describe, expect, it } from "vitest";
import type { RgbaImage } from "../render/types.js";
import { detectCircles } from "./circles.js";

/** A frame with soft noise and discs drawn with anti-aliased edges (radius in pixels). */
function frame(width: number, height: number, discs: Array<{ x: number; y: number; r: number; luma: number }>, seed = 7): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  let state = seed;
  const noise = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state / 0x7fffffff - 0.5) * 16;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // A dim gradient background, like a dark table top.
      let v = 30 + (x / width) * 25;
      for (const d of discs) {
        const coverage = Math.min(1, Math.max(0, d.r - Math.hypot(x + 0.5 - d.x, y + 0.5 - d.y) + 0.5));
        v = v * (1 - coverage) + d.luma * coverage;
      }
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v + noise();
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

describe("detectCircles", () => {
  it("finds a disc's centre and radius to within a couple of pixels", () => {
    for (const disc of [
      { x: 640, y: 360, r: 120, luma: 220 },
      { x: 300, y: 250, r: 60, luma: 200 },
      { x: 960, y: 420, r: 220, luma: 180 },
    ]) {
      const [best] = detectCircles(frame(1280, 720, [disc]));
      expect(best).toBeDefined();
      expect(Math.abs(best!.cx * 1280 - disc.x)).toBeLessThan(3);
      expect(Math.abs(best!.cy * 720 - disc.y)).toBeLessThan(3);
      expect(Math.abs(best!.r * 720 - disc.r)).toBeLessThan(3);
      expect(best!.score).toBeGreaterThan(0.7);
      // The box is the circle's bounding box on the frame.
      expect(best!.box.w * 1280).toBeCloseTo(best!.box.h * 720, 6);
    }
  });

  it("prefers the outer silhouette over a ring inside it (iris, not pupil)", () => {
    const eye = frame(1280, 720, [
      { x: 600, y: 380, r: 200, luma: 150 },
      { x: 600, y: 380, r: 70, luma: 10 },
    ]);
    const [best, ...rest] = detectCircles(eye);
    expect(Math.abs(best!.r * 720 - 200)).toBeLessThan(4);
    // The pupil is still offered as a candidate.
    expect(rest.some((c) => Math.abs(c.r * 720 - 70) < 4)).toBe(true);
  });

  it("finds a circle on a portrait frame and respects the radius range", () => {
    const image = frame(540, 960, [{ x: 270, y: 300, r: 150, luma: 230 }]);
    const [best] = detectCircles(image);
    expect(Math.abs(best!.cx * 540 - 270)).toBeLessThan(3);
    expect(Math.abs(best!.cy * 960 - 300)).toBeLessThan(3);
    expect(detectCircles(image, { maxRadius: 0.1 })).toEqual([]);
  });

  it("finds nothing on a frame without circles", () => {
    expect(detectCircles(frame(640, 360, []))).toEqual([]);
  });
});
