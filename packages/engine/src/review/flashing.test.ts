import { describe, expect, it } from "vitest";
import { fitsFlashLimit, flashViolations, flashingOf, isFlashChange, luminanceChanges, relativeLuminance, type GreyFrames } from "./flashing.js";

/** A luminance series at `fps` for `seconds`: `rate` flashes a second between `lo` and `hi`, each lit for `lit` frames. */
function strobe(rate: number, seconds = 2, fps = 30, lo = 0.01, hi = 0.9, lit = 2): number[] {
  const period = fps / rate;
  return Array.from({ length: Math.round(seconds * fps) }, (_, i) => (i % period < lit ? hi : lo));
}

describe("WCAG 2.3.1 general flashes", () => {
  it("counts a change of 10 % or more whose darker side is under 0.80", () => {
    expect(isFlashChange(0.02, 0.5)).toBe(true);
    expect(isFlashChange(0.5, 0.58)).toBe(false);
    // Light grey to white: both bright, not a flash.
    expect(isFlashChange(0.82, 1)).toBe(false);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBe(0);
  });

  it("finds two changes per flash, once per monotonic run (a fade counts once)", () => {
    // Lit on the first frame: its rise is before the series, so two flashes are three changes.
    expect(luminanceChanges(strobe(2, 1), 30)).toHaveLength(3);
    const fade = [0.01, 0.2, 0.4, 0.6, 0.8, 0.8, 0.6, 0.3, 0.05];
    expect(luminanceChanges(fade, 30)).toHaveLength(2);
    // Grain that wobbles under 1 % is no flash.
    expect(luminanceChanges(Array.from({ length: 60 }, (_, i) => 0.3 + (i % 2) * 0.008), 30)).toHaveLength(0);
  });

  it("passes 3 flashes a second and fails 4 or more", () => {
    expect(flashViolations(luminanceChanges(strobe(3), 30))).toEqual([]);
    const fails = flashViolations(luminanceChanges(strobe(5), 30));
    expect(fails).toHaveLength(1);
    expect(fails[0]!.flashes).toBeGreaterThanOrEqual(4);
    expect(fails[0]!.start).toBeLessThan(0.1);
    // Same strobe between two bright greys: no flash at all.
    expect(flashViolations(luminanceChanges(strobe(10, 2, 30, 0.85, 1), 30))).toEqual([]);
  });

  it("budgets new flashes against the ones already there", () => {
    const kept = [0, 0.1, 0.3, 0.4, 0.6, 0.7];
    expect(fitsFlashLimit(kept, [0.8, 0.9])).toBe(false);
    expect(fitsFlashLimit(kept, [1.2, 1.3])).toBe(true);
    // A strobe far away does not block a flash here.
    expect(fitsFlashLimit([...kept, 0.15, 0.2, 0.25, 0.35], [5, 5.1])).toBe(true);
  });

  it("measures a strobe in one corner of the frame, not just the frame's mean", () => {
    const w = 48;
    const h = 27;
    const fps = 30;
    const frames = Array.from({ length: 60 }, (_, f) => {
      const on = f % 6 < 2;
      const frame = new Uint8Array(w * h).fill(40);
      for (let y = 0; y < 9; y += 1) for (let x = 0; x < 16; x += 1) frame[y * w + x] = on ? 250 : 20;
      return frame;
    });
    const picture: GreyFrames = { fps, width: w, height: h, startSeconds: 3, frames };
    const found = flashingOf(picture);
    expect(found).toHaveLength(1);
    expect(found[0]!.start).toBeGreaterThanOrEqual(3);
    expect(found[0]!.flashes).toBeGreaterThanOrEqual(4);
    expect(flashingOf({ ...picture, frames: frames.map((_, f) => new Uint8Array(w * h).fill(f % 30 < 2 ? 250 : 20)) })).toEqual([]);
  });
});
