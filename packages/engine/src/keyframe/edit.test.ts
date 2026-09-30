import { describe, expect, it } from "vitest";
import { HandleType, Interpolation, type Keyframe } from "../model/types.js";
import {
  constantKeyframe,
  flipKeyframe,
  isConstantKeyframe,
  keepKeyframePointsInRange,
  keyframeConstantValue,
  keyframeFrames,
  makeKeyframePoint,
  mapKeyframeValues,
  normalizeKeyframe,
  openshotKeyframe,
  removeKeyframePoint,
  removeKeyframePointsInRange,
  reverseKeyframe,
  scaleKeyframe,
  setKeyframePoint,
  setKeyframePoints,
  setKeyframeValue,
  shiftKeyframe,
} from "./edit.js";
import { evaluate } from "./evaluate.js";

const lin = (x: number, y: number) => makeKeyframePoint(x, y, Interpolation.LINEAR);
const xs = (k: Keyframe) => k.Points.map((p) => p.co.X);
const ys = (k: Keyframe) => k.Points.map((p) => p.co.Y);

describe("keyframe points", () => {
  it("BEZIER points carry default handles, others do not (Point::JsonValue)", () => {
    expect(makeKeyframePoint(1, 2)).toEqual({
      co: { X: 1, Y: 2 },
      handle_left: { X: 0.5, Y: 1 },
      handle_right: { X: 0.5, Y: 0 },
      handle_type: HandleType.AUTO,
      interpolation: Interpolation.BEZIER,
    });
    expect(makeKeyframePoint(3, 4, Interpolation.LINEAR)).toEqual({ co: { X: 3, Y: 4 }, interpolation: 1 });
  });

  it("constantKeyframe keeps doubles; openshotKeyframe narrows to float", () => {
    expect(constantKeyframe(0.1).Points[0]!.co.Y).toBe(0.1);
    expect(openshotKeyframe(0.1).Points[0]!.co.Y).toBe(Math.fround(0.1));
  });
});

describe("keyframe edits", () => {
  const base: Keyframe = { Points: [lin(30, 3), lin(1, 1), lin(10, 2)] };

  it("never mutates the input", () => {
    const before = structuredClone(base);
    setKeyframePoint(base, lin(5, 9));
    shiftKeyframe(base, 3);
    scaleKeyframe(base, 2);
    reverseKeyframe(base);
    flipKeyframe(base);
    removeKeyframePoint(base, 10);
    expect(base).toEqual(before);
  });

  it("normalizeKeyframe sorts and resolves duplicates last-one-wins", () => {
    const k = normalizeKeyframe({ Points: [lin(10, 1), lin(1, 0), lin(10, 5)] });
    expect(xs(k)).toEqual([1, 10]);
    expect(ys(k)).toEqual([0, 5]);
  });

  it("setKeyframePoint inserts sorted and replaces same X (Keyframe::AddPoint)", () => {
    const k = setKeyframePoint(base, lin(10, 7));
    expect(xs(k)).toEqual([1, 10, 30]);
    expect(ys(k)).toEqual([1, 7, 3]);
    const k2 = setKeyframePoints(base, [lin(20, 0), lin(0.5, 4)]);
    expect(xs(k2)).toEqual([0.5, 1, 10, 20, 30]);
  });

  it("setKeyframeValue updates the point at that frame or inserts a LINEAR point", () => {
    const updated = setKeyframeValue(base, 10, 99);
    expect(ys(updated)).toEqual([1, 99, 3]);
    expect(updated.Points[1]!.interpolation).toBe(Interpolation.LINEAR);
    const inserted = setKeyframeValue(base, 20, 5);
    expect(xs(inserted)).toEqual([1, 10, 20, 30]);
    expect(inserted.Points[2]).toEqual({ co: { X: 20, Y: 5 }, interpolation: Interpolation.LINEAR });
    const constantChoice = setKeyframeValue(base, 10, 4, Interpolation.CONSTANT);
    expect(constantChoice.Points[1]!.interpolation).toBe(Interpolation.CONSTANT);
    const toBezier = setKeyframeValue(base, 10, 4, Interpolation.BEZIER);
    expect(toBezier.Points[1]!.handle_left).toEqual({ X: 0.5, Y: 1 });
  });

  it("remove helpers", () => {
    expect(xs(removeKeyframePoint(base, 10))).toEqual([1, 30]);
    expect(xs(removeKeyframePointsInRange(base, 1, 10))).toEqual([30]);
    expect(xs(keepKeyframePointsInRange(base, 5, 40))).toEqual([10, 30]);
  });

  it("shift moves every point", () => {
    expect(xs(shiftKeyframe(base, -0.5))).toEqual([0.5, 9.5, 29.5]);
  });

  it("scale defaults to the desktop rule: round((X-1)*f)+1", () => {
    const k: Keyframe = { Points: [lin(1, 0), lin(25, 8), lin(50, 2)] };
    // 25 → round(12)+1 = 13; 50 → round(24.5)+1 = 24+1 (half to even)
    expect(xs(scaleKeyframe(k, 0.5))).toEqual([1, 13, 25]);
  });

  it("desktop scale uses Python banker's rounding", () => {
    const k: Keyframe = { Points: [lin(1, 0), lin(50, 2)] };
    // (50-1)*0.5 = 24.5 → round half to even = 24 → X = 25
    expect(xs(scaleKeyframe(k, 0.5, "desktop"))).toEqual([1, 25]);
    // fps rule: round(50*0.5)=25 (exact), X=1 kept
    expect(xs(scaleKeyframe(k, 0.5, "fps"))).toEqual([1, 25]);
    // fps rule with a half: 45 * 0.5 = 22.5 → 22
    expect(xs(scaleKeyframe({ Points: [lin(1, 0), lin(45, 1)] }, 0.5, "fps"))).toEqual([1, 22]);
    // libopenshot ScalePoints: round half away from zero, first point untouched
    expect(xs(scaleKeyframe({ Points: [lin(1, 0), lin(45, 1)] }, 0.5, "libopenshot"))).toEqual([1, 23]);
  });

  it("scale matches libopenshot's Keyframe scaling test", () => {
    const k: Keyframe = {
      Points: [makeKeyframePoint(1, 1), makeKeyframePoint(25, 8), makeKeyframePoint(50, 2)],
    };
    const doubled = scaleKeyframe(k, 2, "libopenshot");
    expect(evaluate(doubled, 24)).toBeCloseTo(4.08, 2);
    expect(evaluate(doubled, 25)).toBeCloseTo(4.36, 2);
    expect(evaluate(doubled, 40)).toBeCloseTo(7.53, 2);
    expect(evaluate(doubled, 90)).toBeCloseTo(2.39, 2);
    const back = scaleKeyframe(doubled, 0.5, "libopenshot");
    expect(evaluate(back, 40)).toBeCloseTo(3.85, 2);
  });

  it("flip swaps Y end to end (FlipPoints)", () => {
    expect(ys(flipKeyframe(base))).toEqual([3, 2, 1]);
  });

  it("reverse mirrors X around min+max and swaps handles (_reverse_keyframes)", () => {
    const k: Keyframe = {
      Points: [
        makeKeyframePoint(1, 1, Interpolation.BEZIER, { handleRight: { X: 0.2, Y: 0.1 } }),
        makeKeyframePoint(16, -1, Interpolation.BEZIER, { handleLeft: { X: 0.8, Y: 0.9 } }),
      ],
    };
    const r = reverseKeyframe(k);
    expect(xs(r)).toEqual([1, 16]);
    expect(ys(r)).toEqual([-1, 1]);
    expect(r.Points[0]!.handle_right).toEqual({ X: 0.8, Y: 0.9 });
    expect(r.Points[1]!.handle_left).toEqual({ X: 0.2, Y: 0.1 });
  });

  it("isConstantKeyframe / keyframeConstantValue", () => {
    expect(isConstantKeyframe(constantKeyframe(2))).toBe(true);
    expect(isConstantKeyframe({ Points: [lin(1, 2), lin(9, 2)] })).toBe(true);
    expect(isConstantKeyframe(base)).toBe(false);
    expect(isConstantKeyframe({ Points: [] })).toBe(true);
    expect(keyframeConstantValue(constantKeyframe(2))).toBe(2);
    expect(keyframeConstantValue(base)).toBeNull();
    expect(keyframeConstantValue({ Points: [] })).toBeNull();
  });

  it("mapKeyframeValues and keyframeFrames", () => {
    expect(ys(mapKeyframeValues(base, (y) => y * 2))).toEqual([2, 4, 6]);
    expect(keyframeFrames(base)).toEqual([1, 10, 30]);
  });

  it("keeps unknown keys on the keyframe object", () => {
    const k = { Points: [lin(1, 1)], custom: "keep" } as Keyframe;
    expect(shiftKeyframe(k, 1).custom).toBe("keep");
  });
});
