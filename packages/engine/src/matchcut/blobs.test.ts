import { describe, expect, it } from "vitest";
import type { RgbaImage } from "../render/types.js";
import { detectBlobs } from "./blobs.js";

function frame(width: number, height: number, paint: (x: number, y: number) => number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.set([paint(x, y), paint(x, y), paint(x, y), 255], (y * width + x) * 4);
  return { width, height, data };
}

describe("detectBlobs", () => {
  it("finds a bright window on a dark wall: centroid, box and tone", () => {
    const image = frame(640, 360, (x, y) => (x >= 100 && x < 260 && y >= 60 && y < 300 ? 230 : 25 + ((x + y) % 7)));
    const [best] = detectBlobs(image);
    expect(best!.tone).toBe("bright");
    expect(best!.cx).toBeCloseTo(180 / 640, 2);
    expect(best!.cy).toBeCloseTo(180 / 360, 2);
    expect(best!.box.x).toBeCloseTo(100 / 640, 1);
    expect(best!.box.w).toBeCloseTo(160 / 640, 1);
    expect(best!.score).toBeGreaterThan(0.6);
  });

  it("drops the background and specks, and ranks a large contrasting region over a small one", () => {
    const image = frame(640, 360, (x, y) => {
      if (Math.hypot(x - 450, y - 180) < 90) return 20;
      if (Math.hypot(x - 100, y - 60) < 6) return 20;
      return 210;
    });
    const found = detectBlobs(image);
    expect(found[0]!.tone).toBe("dark");
    expect(found[0]!.cx).toBeCloseTo(450 / 640, 2);
    expect(found[0]!.r).toBeCloseTo(90 / 360, 1);
    // The sky (touching every edge) is never a candidate.
    expect(found.every((b) => b.box.w < 0.9)).toBe(true);
  });

  it("returns nothing for a flat frame", () => {
    expect(detectBlobs(frame(64, 64, () => 128))).toEqual([]);
  });
});
