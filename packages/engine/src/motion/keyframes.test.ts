import { describe, expect, it } from "vitest";
import { evaluate } from "../keyframe/evaluate.js";
import { Gravity, Interpolation, ScaleMode, type Keyframe } from "../model/types.js";
import { drawing, enter, key, mediaCard, pose } from "./elements.js";
import { elementLayer, keyframeThrough, planOf } from "./keyframes.js";
import type { MotionFrame, MotionMedia } from "./types.js";

const FRAME: MotionFrame = { width: 1080, height: 1920, fps: 30 };
const CLIP: MotionMedia = { fileId: "CLIP000001", kind: "video", width: 1280, height: 720, duration: 12 };

const points = (kf: unknown) => (kf as Keyframe).Points;

describe("keyframeThrough", () => {
  it("writes one point for a value that never changes", () => {
    expect(points(keyframeThrough([1, 10], [0.5, 0.5], ["out", "out"]))).toHaveLength(1);
  });

  it("gives each segment its easing: the end point's interpolation and handles, the start point's right handle", () => {
    const kf = keyframeThrough([1, 11, 21], [0, 1, 1], ["out", "out_back", "linear"]);
    const [a, b, c] = points(kf);
    expect(b!.interpolation).toBe(Interpolation.BEZIER);
    // Ease Out (Back): cubic-bezier(0.175, 0.885, 0.32, 1.275).
    expect(a!.handle_right).toEqual({ X: 0.175, Y: 0.885 });
    expect(b!.handle_left).toEqual({ X: 0.32, Y: 1.275 });
    // A flat segment is a bezier (so its start can carry the next segment's handle).
    expect(c!.interpolation).toBe(Interpolation.BEZIER);
    // Overshoot past 1 between the points, then exactly 1 on the key.
    expect(evaluate(kf, 6)).toBeGreaterThan(0.9);
    expect(evaluate(kf, 11)).toBe(1);
  });

  it("holds a value until the next key with `hold` (a blinking caret)", () => {
    const kf = keyframeThrough([1, 8, 15], [1, 0, 1], ["hold", "hold", "hold"]);
    expect(points(kf)[1]!.interpolation).toBe(Interpolation.CONSTANT);
    expect(evaluate(kf, 7)).toBe(1);
    expect(evaluate(kf, 8)).toBe(0);
    expect(evaluate(kf, 14)).toBe(0);
  });
});

describe("element layers", () => {
  it("draws an SVG at its largest pose and keeps scale points at most 1 (libopenshot sizes None clips by them)", () => {
    const el = drawing("logo", 0, 0, 60, { width: 200, height: 100 }, (d) => d.rect(0, 0, 200, 100, { fill: "#000000" }), [
      key(0, pose(540, 960, { s: 0.5, alpha: 0 })),
      key(10, pose(540, 960, { s: 1.2 }), "out_back"),
      key(20, pose(540, 960, { s: 1 }), "out"),
    ]);
    const layer = elementLayer(el, FRAME);
    expect(layer.props.scale).toBe(ScaleMode.NONE);
    expect(layer.props.gravity).toBe(Gravity.TOP_LEFT);
    expect(layer.source.kind === "svg" && layer.source.width).toBe(240);
    const sx = points(layer.props.scale_x).map((p) => p.co.Y);
    expect(Math.max(...sx)).toBe(1);
    // Centre at (540, 960) at every key: the top left is the centre minus half the scaled drawing.
    const lx = points(layer.props.location_x).map((p) => p.co.Y);
    expect(lx[1]! * 1080 + 120).toBeCloseTo(540, 2);
    expect(lx[2]! * 1080 + 100).toBeCloseTo(540, 2);
  });

  it("refuses a pose that stretches past the drawing's largest size", () => {
    const el = drawing("bar", 0, 0, 30, { width: 100, height: 10 }, () => {}, [key(0, pose(50, 50, { s: 0.5, sx: 3 }))]);
    expect(() => elementLayer(el, FRAME)).toThrow(/widest pose/);
  });

  it("counts a media clip's keyframes from its in-point, as libopenshot evaluates them", () => {
    const card = mediaCard("card", 0, 30, 120, CLIP, 30, { width: 800, radius: 30 }, enter(pose(540, 960), 30, { dy: 400, frames: 12 }));
    const layer = elementLayer(card, FRAME);
    expect(layer.source.kind).toBe("media");
    const start = layer.source.kind === "media" ? layer.source.start : 0;
    // A clip of 3 s from a 12 s file starts a third of the way into what it does not need.
    expect(start).toBeGreaterThan(2);
    // On the frame grid, so the offset is exact.
    expect(Math.abs(start * 30 - Math.round(start * 30))).toBeLessThan(1e-6);
    const xs = points(layer.props.location_y).map((p) => p.co.X);
    expect(xs[0]).toBe(1 + Math.round(start * 30));
    expect(xs[1]).toBe(13 + Math.round(start * 30));
    expect(layer.props.corner_radius).toBeDefined();
    expect(layer.props.scale).toBe(ScaleMode.FIT);
  });

  it("refuses overlapping clips on one track", () => {
    const a = drawing("a", 0, 0, 20, { width: 10, height: 10 }, () => {}, [key(0, pose(5, 5))]);
    const b = drawing("b", 0, 10, 30, { width: 10, height: 10 }, () => {}, [key(10, pose(5, 5))]);
    expect(() => planOf("test", 30, [a, b], [0], FRAME)).toThrow(/overlap/);
  });
});
