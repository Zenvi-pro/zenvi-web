import { describe, expect, it } from "vitest";
import { peakFrame, previewFrames, REST_FRAME_A } from "./motionPreview";

describe("motion transition previews", () => {
  it("rests untouched and plays the engine's plan across the cut", () => {
    expect(REST_FRAME_A).toMatchObject({ shot: "a", shiftX: 0, blurX: 0, wash: 0, invert: false });
    const frames = previewFrames("whip", "left", 30);
    expect(frames[0]).toBe(REST_FRAME_A);
    expect(frames.at(-1)!.shot).toBe("b");
    expect(frames.some((f) => f.shot === "a" && Math.abs(f.shiftX) > 0.1 && f.blurX > 0)).toBe(true);
  });

  it("whips the other way for the other direction", () => {
    expect(Math.sign(peakFrame("whip", "left", 30).shiftX)).toBe(-Math.sign(peakFrame("whip", "right", 30).shiftX));
  });

  it("shows a flash at its peak on the incoming shot", () => {
    expect(peakFrame("flash_white", undefined, 30)).toMatchObject({ shot: "b" });
    expect(peakFrame("flash_white", undefined, 30).wash).toBeGreaterThan(0.5);
    expect(peakFrame("flash_invert", undefined, 30).invert).toBe(true);
  });
});
