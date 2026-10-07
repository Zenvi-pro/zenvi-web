import { describe, expect, it } from "vitest";
import { cursorAction, decodeTimestamp, spanCovers, spanEnd } from "./frame-lookup.js";

/** libopenshot's frame number for a picture at `pts` (FFmpegReader frame mapping). */
function libopenshotFrame(pts: number, first: number, fps: number): number {
  const x = (pts - first) * fps;
  return Math.sign(x) * Math.floor(Math.abs(x) + 0.5) + 1;
}

/** Mediabunny semantics: last picture whose timestamp is <= t. */
function lastAtOrBefore(pts: number[], t: number): number | undefined {
  let found: number | undefined;
  for (const p of pts) if (p <= t) found = p;
  return found;
}

describe("decodeTimestamp", () => {
  it("selects the same picture libopenshot numbers as frame k, despite pts jitter", () => {
    const fps = 30000 / 1001;
    const first = 0.0667; // e.g. an MP4 whose first picture is not at 0
    // Timestamps quantized to a 1/90000 timebase, with ±1 tick of jitter.
    const pts = Array.from({ length: 120 }, (_, i) => first + Math.round(((i / fps) * 90000 + ((i % 3) - 1))) / 90000);
    for (let k = 1; k <= 120; k += 1) {
      const t = decodeTimestamp((k - 1) / fps, first, 1 / fps);
      const picked = lastAtOrBefore(pts, t)!;
      expect(libopenshotFrame(picked, first, fps)).toBe(k);
    }
  });

  it("absorbs millisecond timebases (WebM) where exact 'at or before' would pick the previous frame", () => {
    const fps = 30;
    const pts = Array.from({ length: 90 }, (_, i) => Math.round((i / fps) * 1000) / 1000);
    for (let k = 1; k <= 90; k += 1) {
      expect(lastAtOrBefore(pts, decodeTimestamp((k - 1) / fps, 0, 1 / fps))).toBe(pts[k - 1]);
      expect(lastAtOrBefore(pts, decodeTimestamp((k - 1) / fps, 0, null))).toBe(pts[k - 1]);
    }
  });

  it("picks the frame at or before t for variable frame rate media", () => {
    const pts = [0, 0.04, 0.1, 0.13];
    expect(lastAtOrBefore(pts, decodeTimestamp(0.09, 0, 1 / 30))).toBe(0.1);
    expect(lastAtOrBefore(pts, decodeTimestamp(0.07, 0, 1 / 30))).toBe(0.04);
  });

  it("clamps negative source times and tolerates unknown fps", () => {
    expect(decodeTimestamp(-1, 2, 1 / 25)).toBeCloseTo(2 + 0.02, 5);
    expect(decodeTimestamp(1, 0, null)).toBeCloseTo(1.002, 5);
  });
});

describe("spans", () => {
  it("prefers the next picture's start, then the duration, then one frame", () => {
    expect(spanEnd(1, 0.04, 1.033, 1 / 30)).toBe(1.033);
    expect(spanEnd(1, 0.04, null, 1 / 30)).toBe(1.04);
    expect(spanEnd(1, 0, null, 0.5)).toBe(1.5);
    expect(spanCovers({ start: 1, end: 2 }, 1)).toBe(true);
    expect(spanCovers({ start: 1, end: 2 }, 2)).toBe(false);
  });
});

describe("cursorAction", () => {
  const current = { start: 1, end: 1.04 };
  it("reuses a covering picture", () => {
    expect(cursorAction(current, 2, 1.02)).toBe("reuse");
  });
  it("advances when no keyframe lies before the target", () => {
    expect(cursorAction(current, 2, 1.5)).toBe("advance");
    expect(cursorAction(current, null, 30)).toBe("advance");
  });
  it("reseeks backwards, past the next keyframe, or without a cursor", () => {
    expect(cursorAction(current, 2, 0.5)).toBe("reseek");
    expect(cursorAction(current, 2, 2)).toBe("reseek");
    expect(cursorAction(null, null, 1)).toBe("reseek");
  });
});
