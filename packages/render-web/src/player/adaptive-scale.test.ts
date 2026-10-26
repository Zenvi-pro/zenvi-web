import { describe, expect, it } from "vitest";
import { AdaptiveScale, PLAYBACK_SCALES } from "./adaptive-scale.js";

const BUDGET = 1000 / 30;

/** Frames whose cost is `fullMs` at scale 1 and follows the pixel count below it. */
function run(scale: AdaptiveScale, fullMs: number, frames: number): number[] {
  const seen: number[] = [];
  for (let i = 0; i < frames; i += 1) {
    scale.record(fullMs * scale.scale ** 2, BUDGET);
    seen.push(scale.scale);
  }
  return seen;
}

describe("AdaptiveScale", () => {
  it("stays at full resolution while frames fit the budget", () => {
    const scale = new AdaptiveScale();
    expect(run(scale, 20, 40).every((s) => s === 1)).toBe(true);
  });

  it("jumps to the largest scale predicted to fit, after a few frames", () => {
    const scale = new AdaptiveScale();
    const seen = run(scale, 4 * BUDGET, 20);
    // 4× over budget: half the linear size is a quarter of the pixels.
    expect(seen.slice(0, 3)).toEqual([1, 1, 1]);
    expect(seen.at(-1)).toBe(0.5);
  });

  it("never goes below the smallest scale, however slow frames are", () => {
    const scale = new AdaptiveScale();
    expect(run(scale, 100 * BUDGET, 40).at(-1)).toBe(PLAYBACK_SCALES.at(-1));
  });

  it("grows back once frames get cheap, without oscillating", () => {
    const scale = new AdaptiveScale();
    run(scale, 4 * BUDGET, 20);
    expect(scale.scale).toBe(0.5);
    const seen = run(scale, 0.5 * BUDGET, 40);
    expect(seen.at(-1)).toBe(1);
    // Monotonic on the way up.
    expect(seen.every((s, i) => i === 0 || s >= seen[i - 1]!)).toBe(true);
    // Just over budget at 1 but fine at 0.75: settles there instead of flipping.
    const settled = run(scale, 1.5 * BUDGET, 60).slice(20);
    expect(new Set(settled)).toEqual(new Set([0.75]));
  });

  it("ignores nonsense timings", () => {
    const scale = new AdaptiveScale();
    for (let i = 0; i < 10; i += 1) scale.record(Number.NaN, BUDGET);
    for (let i = 0; i < 10; i += 1) scale.record(1000, 0);
    expect(scale.scale).toBe(1);
  });
});
