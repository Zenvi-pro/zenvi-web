import { describe, expect, it } from "vitest";
import { COPY_KEYFRAME_GROUPS, curvePlateau, curvePoints, defaultKeyframeValue, editorPoint, keyframeValue, maxTransformMultiple } from "../keyframe/rules.js";
import { Interpolation, type Keyframe } from "../model/types.js";
import { addClip } from "./clips.js";
import { curveWithoutPoints, retimeCurvePoints, setColorCurveValue, setCurveValue, updateClipValues } from "./clip-props.js";
import { expectRefused, expectUndoRedo, makeDoc } from "./testkit.js";

const V1 = 1_000_000;
const curve = (pairs: [number, number][], interpolation: Interpolation = Interpolation.LINEAR): Keyframe => ({
  Points: pairs.map(([X, Y]) => ({ co: { X, Y }, interpolation })),
});
const xy = (kf: unknown) => (kf as Keyframe).Points.map((p) => [p.co.X, p.co.Y]);

describe("keyframe rules (keyframe_rules.py)", () => {
  it("copy groups carry gravity with scale, rotation and location", () => {
    expect(COPY_KEYFRAME_GROUPS.scale).toEqual(["gravity", "scale_x", "scale_y"]);
    expect(COPY_KEYFRAME_GROUPS.all).toHaveLength(11);
  });

  it("defaults after the last keyframe is removed", () => {
    expect([defaultKeyframeValue("alpha"), defaultKeyframeValue("origin_x"), defaultKeyframeValue("has_audio")]).toEqual([1, 0.5, -1]);
    expect(defaultKeyframeValue("wave_color", "green")).toBe(123);
    expect(defaultKeyframeValue("alpha", "red")).toBeUndefined();
    expect(defaultKeyframeValue("corner_radius")).toBeUndefined();
  });

  it("limits scale and shear by project size (50x, 15x for SVG)", () => {
    expect(maxTransformMultiple(1920, 1080)).toBe(52);
    expect(maxTransformMultiple(1280, 720)).toBe(78);
    expect(maxTransformMultiple(1920, 1080, true)).toBe(16);
    expect(maxTransformMultiple(0, 0)).toBe(50);
  });

  it("evaluates curves like libopenshot, with a fallback for empty ones", () => {
    expect(keyframeValue(curve([[1, 0], [31, 1]]), 16)).toBeCloseTo(0.5, 12);
    expect(keyframeValue({ Points: [] }, 5, 7)).toBe(7);
    expect(keyframeValue(0.25, 5)).toBe(0.25);
    // The last of two points at one X wins, like Keyframe::AddPoint.
    expect(keyframeValue({ Points: [{ co: { X: 1, Y: 2 } }, { co: { X: 1, Y: 3 } }] }, 1)).toBe(3);
  });

  it("the plateau is the highest level across the visible frames", () => {
    expect(curvePlateau(curve([[1, 0], [91, 0.8], [511, 0.8], [601, 0]]), 1, 601)).toBe(0.8);
    expect(curvePlateau(undefined, 1, 601)).toBe(1);
    expect(curvePlateau(curve([[1, 0.3]]), 1, 601)).toBeCloseTo(0.3, 12);
  });

  it("sorts points by X, keeping their order at one X; editor points carry handles", () => {
    const sorted = curvePoints({ Points: [{ co: { X: 5, Y: 1 } }, { co: { X: 1, Y: 2 } }, "junk", { co: { X: 1, Y: 3 } }] });
    expect(sorted.map((p) => [p.co.X, p.co.Y])).toEqual([[1, 2], [1, 3], [5, 1]]);
    expect(editorPoint(3, 0.5, Interpolation.CONSTANT)).toEqual({
      co: { X: 3, Y: 0.5 },
      interpolation: 2,
      handle_type: 0,
      handle_left: { X: 0.5, Y: 1 },
      handle_right: { X: 0.5, Y: 0 },
    });
  });
});

describe("setCurveValue (_set_curve_value)", () => {
  it("a static value replaces the curve with one point and counts what it flattened", () => {
    const edit = setCurveValue(curve([[1, 0], [31, 1]]), 0.5, null, Interpolation.BEZIER);
    expect(xy(edit.curve)).toEqual([[1, 0.5]]);
    expect([edit.flattened, edit.changed]).toEqual([2, true]);
    const same = setCurveValue(curve([[10, 0.5]]), 0.5, null, Interpolation.BEZIER);
    expect([same.changed, same.flattened]).toEqual([false, 0]);
  });

  it("a keyframe updates the point at that frame or adds one in order", () => {
    const base = curve([[1, 1], [61, 2]]);
    expect(xy(setCurveValue(base, 3, 61, Interpolation.BEZIER).curve)).toEqual([[1, 1], [61, 3]]);
    const added = setCurveValue(base, 1.5, 31, Interpolation.CONSTANT);
    expect(xy(added.curve)).toEqual([[1, 1], [31, 1.5], [61, 2]]);
    expect((added.curve as Keyframe).Points[1]!.interpolation).toBe(Interpolation.CONSTANT);
    expect(setCurveValue(base, 2, 61, Interpolation.BEZIER).changed).toBe(false);
    expect(xy(base)).toEqual([[1, 1], [61, 2]]); // untouched
  });

  it("a colour writes every channel", () => {
    const edit = setColorCurveValue(undefined, [255, 136, 0, 255], null);
    const out = edit.curve as Record<string, Keyframe>;
    expect([xy(out.red), xy(out.green), xy(out.blue), xy(out.alpha)]).toEqual([[[1, 255]], [[1, 136]], [[1, 0]], [[1, 255]]]);
  });
});

describe("curveWithoutPoints (_without_points)", () => {
  it("removes the points in a frame range", () => {
    const r = curveWithoutPoints(curve([[1, 0], [61, 0.5], [121, 0], [181, 0.5]]), 46, 121, "location_x");
    expect(xy(r.curve)).toEqual([[1, 0], [181, 0.5]]);
    expect([r.removed, r.resetTo]).toEqual([2, undefined]);
  });

  it("a curve left empty holds the dock default (or its first value)", () => {
    const r = curveWithoutPoints(curve([[1, 1], [301, 1.2]]), null, null, "scale_x");
    expect([xy(r.curve), r.removed, r.resetTo]).toEqual([[[1, 1]], 2, 1]);
    const noDefault = curveWithoutPoints(curve([[1, 0.2], [31, 0.4]]), null, null, "corner_radius");
    expect(noDefault.resetTo).toBe(0.2);
  });

  it("a lone point at the default is not animation", () => {
    expect(curveWithoutPoints(curve([[1, 1]]), null, null, "alpha").removed).toBe(0);
    expect(curveWithoutPoints(curve([[1, 0.5]]), null, null, "alpha").removed).toBe(1);
  });
});

describe("retimeCurvePoints (_retime_points)", () => {
  const src = { first: 1, end: 301 };
  it("stretches onto the target's length, offsets or copies exactly", () => {
    const points = curve([[1, 1], [301, 1.2]]).Points;
    expect(retimeCurvePoints(points, src, { first: 61, end: 211 }, "stretch").map((p) => p.co.X)).toEqual([61, 211]);
    expect(retimeCurvePoints(points, src, { first: 61, end: 211 }, "offset").map((p) => p.co.X)).toEqual([61, 361]);
    expect(retimeCurvePoints(points, src, { first: 61, end: 211 }, "exact").map((p) => p.co.X)).toEqual([1, 301]);
  });

  it("replaces points outside the source's visible part by the curve's value at its edges", () => {
    const points = curve([[1, 1], [661, 2]]).Points;
    const out = retimeCurvePoints(points, { first: 61, end: 361 }, { first: 1, end: 301 }, "offset");
    expect(out.map((p) => p.co.X)).toEqual([1, 301]);
    expect(out[0]!.co.Y).toBeCloseTo(1 + 60 / 660, 12);
    expect(out[1]!.co.Y).toBeCloseTo(1 + 360 / 660, 12);
    expect(out[1]!.interpolation).toBe(Interpolation.LINEAR);
  });

  it("points squeezed onto one frame: the first keeps the target's start, later ones win elsewhere", () => {
    const points = curve([[61, 0], [62, 0.5], [1061, 0.2], [1062, 0.4], [3061, 1]]).Points;
    const out = retimeCurvePoints(points, { first: 61, end: 3061 }, { first: 1, end: 31 }, "stretch");
    expect(xy({ Points: out })).toEqual([[1, 0], [11, 0.4], [31, 1]]);
  });
});

describe("updateClipValues (save_clip_values)", () => {
  it("merges values into the clip as one undo step and refuses a locked track", () => {
    const doc = makeDoc();
    doc.transaction("add", (tx) => addClip(tx, { fileId: "VIDEO00001", position: 0, layer: V1, id: "C" }));
    const before = doc.project;
    doc.transaction("set", (tx) => updateClipValues(tx, "C", { gravity: 2, alpha: curve([[1, 0.5]]) }));
    expect(doc.project.clips[0]!.gravity).toBe(2);
    expectUndoRedo(doc, before);
    doc.transaction("lock", (tx) => tx.update(["layers", { number: V1 }], { lock: true }));
    expectRefused(doc, "locked", (tx) => updateClipValues(tx, "C", { gravity: 4 }));
  });
});
