import { describe, expect, it } from "vitest";
import { detectActions, type LumaFrames } from "./action.js";

const W = 96;
const H = 54;

/** Frames of a dark, slightly noisy background with boxes drawn on each (`draw` gets the frame index). */
function film(count: number, draw: (f: number, box: (x: number, y: number, w: number, h: number, v?: number) => void) => void, background = (_f: number) => 30): LumaFrames {
  let seed = 3;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 4 - 2;
  const frames: Uint8Array[] = [];
  for (let f = 0; f < count; f += 1) {
    const img = new Uint8Array(W * H);
    for (let p = 0; p < img.length; p += 1) img[p] = background(f) + rand();
    draw(f, (x, y, w, h, v = 230) => {
      for (let r = Math.max(0, Math.round(y)); r < Math.min(H, Math.round(y + h)); r += 1) for (let c = Math.max(0, Math.round(x)); c < Math.min(W, Math.round(x + w)); c += 1) img[r * W + c] = v;
    });
    frames.push(img);
  }
  return { fps: 30, width: W, height: H, startSeconds: 2, frames };
}

describe("detectActions", () => {
  it("puts an object that falls and lands on the frame it stops", () => {
    // A box falls 4 px a frame from frame 0 and lands at frame 10, then sits still.
    const clip = film(30, (f, box) => box(40, 2 + 4 * Math.min(f, 10), 14, 12));
    const events = detectActions(clip);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ frame: 10, kind: "impact" });
    expect(events[0]!.timeSec).toBeCloseTo(2 + 10 / 30, 3);
    expect(events[0]!.strength).toBeGreaterThan(0.8);
    // The box is a little right of centre, low in the frame when it lands.
    expect(events[0]!.x).toBeGreaterThan(-0.2);
  });

  it("calls a small, brief move that stops a tap, and ignores a cut", () => {
    const clip = film(
      40,
      (f, box) => {
        box(30, 2 + 4 * Math.min(f, 8), 14, 12);
        // A fingertip moves 3 frames and stops at frame 22.
        box(70, 30 + 2 * Math.max(0, Math.min(f, 22) - 19), 4, 4);
      },
      // The whole picture brightens at frame 30: a cut, not an action.
      (f) => (f >= 30 ? 160 : 30),
    );
    const events = detectActions(clip, { sensitivity: "high" });
    expect(events.map((e) => [e.frame, e.kind])).toEqual([
      [8, "impact"],
      [22, "tap"],
    ]);
  });

  it("finds a fast wide swipe that eases out as a swipe on its fastest frame", () => {
    const speeds = [0, 0, 4, 9, 16, 22, 16, 9, 4, 2, 1, 0, 0, 0];
    let x = 0;
    const xs = speeds.map((s) => (x += s));
    const clip = film(speeds.length, (f, box) => box(xs[f]!, 0, 26, H));
    const events = detectActions(clip);
    expect(events.map((e) => e.kind)).toEqual(["swipe"]);
    expect(events[0]!.frame).toBe(5);
  });

  it("turns steady stops low in the frame into steps", () => {
    // A foot comes down every 15 frames (0.5 s) at the bottom of the frame: down in 4 frames, a rest, then lifted over 6.
    const clip = film(80, (f, box) => {
      const phase = f % 15;
      const drop = phase <= 4 ? phase * 3 : phase <= 8 ? 12 : 12 - (phase - 8) * 2;
      box(20 + Math.floor(f / 15) * 12, 34 + drop, 10, 6);
    });
    const events = detectActions(clip, { sensitivity: "normal" });
    const steps = events.filter((e) => e.kind === "step");
    expect(steps.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < steps.length; i += 1) expect(steps[i]!.frame - steps[i - 1]!.frame).toBe(15);
  });

  it("calls an object that slows into its resting place a contact, not an impact", () => {
    // A cup set down: 6, 5, 4, 3, 2 px a frame, still from frame 6.
    const ys = [10, 16, 21, 25, 28, 30, 30];
    const clip = film(20, (f, box) => box(40, ys[Math.min(f, 6)]!, 16, 14));
    expect(detectActions(clip).map((e) => [e.frame, e.kind])).toEqual([[5, "contact"]]);
  });

  it("does not take a lift pausing at its top for a contact", () => {
    // The box rises 4 px a frame and stops at frame 10 at the top, then holds.
    const clip = film(30, (f, box) => box(40, 40 - 3 * Math.min(f, 10), 14, 12));
    expect(detectActions(clip)).toEqual([]);
  });

  it("finds nothing in a still picture", () => {
    expect(detectActions(film(20, (_f, box) => box(10, 10, 20, 20)))).toEqual([]);
  });
});
