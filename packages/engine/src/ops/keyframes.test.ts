import { describe, expect, it } from "vitest";
import { Interpolation, type Keyframe } from "../model/types.js";
import { findClip } from "../model/query.js";
import { addClip, setClipKeyframes, setClipProperty } from "./clips.js";
import { addEffect, setEffectProperty } from "./effects.js";
import { addTransition } from "./transitions.js";
import { KEYFRAME_BEZIER_PRESETS, removeKeyframe, setKeyframeInterpolation } from "./keyframes.js";
import { expectRefused, expectUndoRedo, makeDoc } from "./testkit.js";

function setup() {
  const doc = makeDoc();
  doc.transaction("add", (tx) => {
    addClip(tx, { fileId: "VIDEO00001", position: 0, layer: 1_000_000, id: "C" });
    setClipKeyframes(tx, "C", "alpha", [
      { frame: 1, value: 0, interpolation: Interpolation.BEZIER },
      { frame: 31, value: 1, interpolation: Interpolation.LINEAR },
      { frame: 61, value: 0.5, interpolation: Interpolation.LINEAR },
    ]);
  });
  return doc;
}
const alpha = (doc: ReturnType<typeof makeDoc>): Keyframe => findClip(doc.project, "C")!.alpha;

describe("setKeyframeInterpolation", () => {
  it("sets the segment ending at the next keyframe, with bezier handles", () => {
    const doc = setup();
    const before = doc.project;
    const ease = KEYFRAME_BEZIER_PRESETS.find((p) => p.name === "Ease In/Out")!.handles;
    doc.transaction("bezier", (tx) => setKeyframeInterpolation(tx, { clipId: "C" }, "alpha", { frame: 15 }, Interpolation.BEZIER, ease));
    const pts = alpha(doc).Points;
    // Segment 1..31: point 31 becomes BEZIER with handle_left (x2, y2); point 1 (BEZIER) gets handle_right (x1, y1).
    expect(pts[1]).toMatchObject({ interpolation: Interpolation.BEZIER, handle_left: { X: 0.58, Y: 1.0 } });
    expect(pts[0]!.handle_right).toEqual({ X: 0.42, Y: 0.0 });
    expectUndoRedo(doc, before);
    doc.transaction("constant", (tx) => setKeyframeInterpolation(tx, { clipId: "C" }, "alpha", { time: 1.5 }, Interpolation.CONSTANT));
    expect(alpha(doc).Points[2]!.interpolation).toBe(Interpolation.CONSTANT);
    expect(KEYFRAME_BEZIER_PRESETS).toHaveLength(28);
  });

  it("works on effects and transitions; validates", () => {
    const doc = setup();
    doc.transaction("fx", (tx) => {
      addEffect(tx, "C", "Blur", {}, { id: "FX" });
      setEffectProperty(tx, "FX", "sigma", 9, { frame: 40 });
      addTransition(tx, { layer: 1_000_000, position: 0, duration: 1, maskId: "fade", id: "T" });
    });
    const fx = doc.transaction("fx", (tx) => setKeyframeInterpolation(tx, { effectId: "FX" }, "sigma", { frame: 20 }, Interpolation.CONSTANT));
    expect((fx.sigma as Keyframe).Points[1]!.interpolation).toBe(Interpolation.CONSTANT);
    const t = doc.transaction("t", (tx) => setKeyframeInterpolation(tx, { transitionId: "T" }, "brightness", { frame: 5 }, Interpolation.LINEAR));
    expect((t.brightness as Keyframe).Points[1]!.interpolation).toBe(Interpolation.LINEAR);
    expectRefused(doc, "invalid_argument", (tx) => setKeyframeInterpolation(tx, { clipId: "C" }, "gravity", { frame: 1 }, Interpolation.LINEAR));
    expectRefused(doc, "invalid_argument", (tx) => setKeyframeInterpolation(tx, { clipId: "C" }, "alpha", {}, Interpolation.LINEAR));
    expectRefused(doc, "not_found", (tx) => setKeyframeInterpolation(tx, { effectId: "NOPE" }, "sigma", { frame: 1 }, Interpolation.LINEAR));
  });
});

describe("removeKeyframe", () => {
  it("removes the point at the frame, else the closest one after it", () => {
    const doc = setup();
    doc.transaction("rm", (tx) => removeKeyframe(tx, { clipId: "C" }, "alpha", { frame: 31 }));
    expect(alpha(doc).Points.map((p) => p.co.X)).toEqual([1, 61]);
    doc.transaction("rm2", (tx) => removeKeyframe(tx, { clipId: "C" }, "alpha", { frame: 40 }));
    expect(alpha(doc).Points.map((p) => p.co.X)).toEqual([1]);
  });

  it("puts the desktop default back when the last point goes", () => {
    const doc = setup();
    doc.transaction("one", (tx) => setClipProperty(tx, "C", "rotation", 45));
    doc.transaction("rm", (tx) => removeKeyframe(tx, { clipId: "C" }, "rotation", { frame: 10 }));
    expect(findClip(doc.project, "C")!.rotation.Points).toEqual([{ co: { X: 10, Y: 0 }, interpolation: Interpolation.LINEAR }]);
    doc.transaction("color", (tx) => removeKeyframe(tx, { clipId: "C" }, "wave_color", { frame: 1 }));
    const wave = findClip(doc.project, "C")!.wave_color;
    expect([wave.red.Points[0]!.co.Y, wave.green.Points[0]!.co.Y, wave.blue.Points[0]!.co.Y]).toEqual([0, 123, 255]);
  });
});
