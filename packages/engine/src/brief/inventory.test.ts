import { describe, expect, it } from "vitest";
import type { RgbaImage } from "../render/types.js";
import { dominantColors, motionLevel, orientationOf, soundLevel } from "./inventory.js";

function image(pixels: [number, number, number][]): RgbaImage {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((p, i) => data.set([...p, 255], i * 4));
  return { width: pixels.length, height: 1, data };
}

describe("media inventory measures", () => {
  it("dominant colours: the biggest areas first, near-duplicates merged", () => {
    const sky: [number, number, number] = [40, 90, 200];
    const nearSky: [number, number, number] = [44, 94, 196];
    const sand: [number, number, number] = [220, 190, 120];
    const colors = dominantColors(image([...Array(6).fill(sky), ...Array(3).fill(nearSky), ...Array(4).fill(sand)]));
    expect(colors).toHaveLength(2);
    expect(colors[1]).toBe("#dcbe78");
  });

  it("orientation with a square band", () => {
    expect(orientationOf(1080, 1920)).toBe("portrait");
    expect(orientationOf(1920, 1080)).toBe("landscape");
    expect(orientationOf(1000, 1020)).toBe("square");
    expect(orientationOf(null, 1080)).toBeNull();
  });

  it("sound energy: a loud bed is high, a quiet room is low, drums over a quiet bed punch up", () => {
    expect(soundLevel(Array(100).fill(0.3))).toBe("high");
    expect(soundLevel(Array(100).fill(0.01))).toBe("low");
    expect(soundLevel(Array.from({ length: 100 }, (_, i) => (i % 10 === 0 ? 0.4 : 0.05)))).toBe("high");
    expect(soundLevel(Array(100).fill(0))).toBeNull();
    expect(motionLevel(0.01)).toBe("low");
    expect(motionLevel(0.2)).toBe("high");
  });
});
