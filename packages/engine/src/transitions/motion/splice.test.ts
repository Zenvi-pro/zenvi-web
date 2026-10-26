import { describe, expect, it } from "vitest";
import { makeKeyframePoint } from "../../keyframe/edit.js";
import { evaluate } from "../../keyframe/evaluate.js";
import { Interpolation, type Keyframe } from "../../model/types.js";
import { spliceFrames, splitKeyframeAt, unspliceKeyframe } from "./splice.js";

/** A Ken Burns style curve: ease-in-out bezier 1 → 1.2 over frames 1-90, then a linear tail. */
function kenBurns(): Keyframe {
  const a = makeKeyframePoint(1, 1, Interpolation.BEZIER, { handleRight: { X: 0.42, Y: 0 } });
  const b = makeKeyframePoint(90, 1.2, Interpolation.BEZIER, { handleLeft: { X: 0.58, Y: 1 } });
  const c = makeKeyframePoint(120, 1.1, Interpolation.LINEAR);
  return { Points: [a, b, c] };
}

describe("splitKeyframeAt", () => {
  it("keeps every frame of a bezier segment", () => {
    const kf = kenBurns();
    for (const at of [17, 45, 89, 100]) {
      const split = splitKeyframeAt(kf, at, 1);
      expect(split.Points.length).toBe(4);
      for (let f = 1; f <= 130; f += 1) expect(evaluate(split, f), `split at ${at}, frame ${f}`).toBeCloseTo(evaluate(kf, f), 3);
    }
  });

  it("holds the end values outside the points and never touches the input", () => {
    const kf = kenBurns();
    const copy = structuredClone(kf);
    const before = splitKeyframeAt(kf, -5, 1);
    expect(before.Points[0]!.co).toEqual({ X: -5, Y: 1 });
    const after = splitKeyframeAt(kf, 200, 1);
    expect(evaluate(after, 200)).toBeCloseTo(1.1, 9);
    expect(splitKeyframeAt(undefined, 4, 0.5).Points).toEqual([makeKeyframePoint(4, 0.5, Interpolation.LINEAR)]);
    expect(kf).toEqual(copy);
  });

  it("splits constant segments as steps", () => {
    const kf: Keyframe = { Points: [makeKeyframePoint(1, 0, Interpolation.CONSTANT), makeKeyframePoint(10, 1, Interpolation.CONSTANT)] };
    const split = splitKeyframeAt(kf, 5, 0);
    for (let f = 1; f <= 12; f += 1) expect(evaluate(split, f)).toBe(evaluate(kf, f));
  });
});

describe("spliceFrames / unspliceKeyframe", () => {
  it("writes the window and plays the curve outside it unchanged", () => {
    const kf = kenBurns();
    const out = spliceFrames(kf, 80, [81, 82, 83], [1.3, 1.5, 1.9], 1);
    for (let f = 1; f <= 80; f += 1) expect(evaluate(out, f)).toBeCloseTo(evaluate(kf, f), 3);
    expect([81, 82, 83].map((f) => evaluate(out, f))).toEqual([1.3, 1.5, 1.9]);
  });

  it("restores the original exactly when nothing changed since", () => {
    const kf = kenBurns();
    const after = spliceFrames(kf, 80, [81, 82, 83], [1.3, 1.5, 1.9], 1);
    expect(unspliceKeyframe(after, kf, after, 80, 83)).toEqual(kf);
  });

  it("keeps edits made outside the window since", () => {
    const kf = kenBurns();
    const after = spliceFrames(kf, 80, [81, 82, 83], [1.3, 1.5, 1.9], 1);
    const edited: Keyframe = { Points: [...after.Points, makeKeyframePoint(110, 2, Interpolation.LINEAR)] };
    const restored = unspliceKeyframe(edited, kf, after, 80, 83)!;
    expect(restored.Points.map((p) => p.co.X)).toEqual([1, 90, 110, 120]);
    expect(restored.Points[0]).toEqual(kf.Points[0]);
    expect(restored.Points[1]).toEqual(kf.Points[1]);
  });

  it("gives back null for a property that did not exist", () => {
    const after = spliceFrames(undefined, 10, [11, 12], [2, 3], 1);
    expect(unspliceKeyframe(after, null, after, 10, 12)).toBeNull();
  });
});
