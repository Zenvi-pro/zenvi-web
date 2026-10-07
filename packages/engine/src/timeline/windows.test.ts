import { describe, expect, it } from "vitest";
import {
  clipFrameAtTime,
  durationF32,
  endClipFrame,
  firstClipFrame,
  frameWindow,
  itemEnd,
  localFrame,
  nearbyEndFrame,
  timeOfClipFrame,
  timelineFrameOf,
  windowContains,
} from "./windows.js";

const fps30 = { num: 30, den: 1 };

describe("frame windows (Timeline::GetFrame)", () => {
  it("covers llround(position*fps)+1 .. llround((position+duration)*fps)", () => {
    // A 2 s clip at 1 s, trimmed to source 3..5 s.
    const w = frameWindow({ position: 1, start: 3, end: 5 }, fps30);
    expect(w).toEqual({ startFrame: 31, endFrame: 90, localStartFrame: 91 });
    expect(windowContains(w, 30)).toBe(false);
    expect(windowContains(w, 31)).toBe(true);
    expect(windowContains(w, 90)).toBe(true);
    expect(windowContains(w, 91)).toBe(false);
    expect(localFrame(w, 31)).toBe(91);
    expect(localFrame(w, 40)).toBe(100);
    expect(timelineFrameOf(w, 100)).toBe(40);
    expect(nearbyEndFrame({ position: 1, start: 3, end: 5 }, fps30)).toBe(91);
  });

  it("uses float32 clip times like ClipBase", () => {
    // 0.1 is not exact in float: fround(0.1) = 0.10000000149…; 0.1*30 = 3.0000000447 → 3.
    const w = frameWindow({ position: 0.1, start: 0, end: 0.2 }, fps30);
    expect(w.startFrame).toBe(4);
    expect(durationF32({ position: 0, start: 0.1, end: 0.3 })).toBe(Math.fround(Math.fround(0.3) - Math.fround(0.1)));
  });

  it("an item shorter than half a frame is empty", () => {
    const w = frameWindow({ position: 0, start: 0, end: 0.01 }, fps30);
    expect(w.endFrame).toBeLessThan(w.startFrame);
  });

  it("clipFrameAtTime follows the desktop Properties panel (Python rounding, clamped)", () => {
    const clip = { position: 10, start: 2, end: 6 };
    // 12 s timeline = 4 s source → frame 121
    expect(clipFrameAtTime(clip, 12, fps30)).toBe(121);
    // before the clip clamps to its first frame, after it to its last
    expect(clipFrameAtTime(clip, 0, fps30)).toBe(61);
    expect(clipFrameAtTime(clip, 100, fps30)).toBe(180);
    expect(clipFrameAtTime(clip, 0, fps30, false)).toBe(-239);
    expect(timeOfClipFrame(clip, 121, fps30)).toBeCloseTo(12, 10);
  });

  it("desktop start/end frames and item ends", () => {
    const clip = { position: 10, start: 2, end: 6 };
    expect(firstClipFrame(clip, fps30)).toBe(61);
    expect(endClipFrame(clip, fps30)).toBe(181);
    expect(itemEnd(clip)).toBe(14);
  });
});
