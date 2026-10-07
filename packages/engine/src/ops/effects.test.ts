import { describe, expect, it } from "vitest";
import { Interpolation, type Keyframe } from "../model/types.js";
import { findClip } from "../model/query.js";
import { addClip } from "./clips.js";
import { addEffect, moveEffect, removeEffect, setEffectProperty } from "./effects.js";
import { setTrackLocked } from "./tracks.js";
import { expectRefused, expectUndoRedo, makeDoc } from "./testkit.js";

function setup() {
  const doc = makeDoc();
  doc.transaction("add", (tx) => addClip(tx, { fileId: "VIDEO00001", position: 1, layer: 1_000_000, id: "CLIP" }));
  return doc;
}

const effects = (doc: ReturnType<typeof makeDoc>) => findClip(doc.project, "CLIP")!.effects;

describe("addEffect", () => {
  it("appends libopenshot's default JSON with a project id", () => {
    const doc = setup();
    const before = doc.project;
    const e = doc.transaction("blur", (tx) => addEffect(tx, "CLIP", "blur", { sigma: 5 }));
    expect(e).toMatchObject({ class_name: "Blur", type: "Blur", apply_before_clip: true });
    expect(e.id).toHaveLength(10);
    expect((e.sigma as Keyframe).Points[0]!.co.Y).toBe(5);
    expect((e.horizontal_radius as Keyframe).Points[0]!.co.Y).toBe(6);
    expectUndoRedo(doc, before);
  });

  it("inserts at an index", () => {
    const doc = setup();
    doc.transaction("a", (tx) => addEffect(tx, "CLIP", "Blur", {}, { id: "E1" }));
    doc.transaction("b", (tx) => addEffect(tx, "CLIP", "Negate", {}, { id: "E0", index: 0 }));
    expect(effects(doc).map((e) => e.id)).toEqual(["E0", "E1"]);
  });

  it("refuses unknown effects/params, dialog effects and locked tracks", () => {
    const doc = setup();
    expectRefused(doc, "invalid_argument", (tx) => addEffect(tx, "CLIP", "Sparkle"));
    expectRefused(doc, "invalid_argument", (tx) => addEffect(tx, "CLIP", "Blur", { nope: 1 }));
    expectRefused(doc, "invalid_argument", (tx) => addEffect(tx, "CLIP", "Blur", { sigma: "x" }));
    expectRefused(doc, "unsupported", (tx) => addEffect(tx, "CLIP", "Tracker"));
    expectRefused(doc, "not_found", (tx) => addEffect(tx, "NOPE", "Blur"));
    expectRefused(doc, "invalid_argument", (tx) => addEffect(tx, "CLIP", "Blur", {}, { index: 5 }));
    doc.transaction("lock", (tx) => setTrackLocked(tx, 1_000_000, true));
    expectRefused(doc, "locked", (tx) => addEffect(tx, "CLIP", "Blur"));
  });
});

describe("setEffectProperty / removeEffect / moveEffect", () => {
  it("keyframes, colors and plain parameters", () => {
    const doc = setup();
    doc.transaction("fx", (tx) => addEffect(tx, "CLIP", "Glow", {}, { id: "GLOW" }));
    let e = doc.transaction("op", (tx) => setEffectProperty(tx, "GLOW", "opacity", 0.8));
    expect((e.opacity as Keyframe).Points).toHaveLength(1);
    // Timeline 2 s on a clip at 1 s → clip frame 31.
    e = doc.transaction("op2", (tx) => setEffectProperty(tx, "GLOW", "opacity", 0.2, { time: 2 }));
    expect((e.opacity as Keyframe).Points.map((p) => p.co.X)).toEqual([1, 31]);
    expect((e.opacity as Keyframe).Points[1]!.interpolation).toBe(Interpolation.LINEAR);
    e = doc.transaction("color", (tx) => setEffectProperty(tx, "GLOW", "color", "#00ff00"));
    expect(((e.color as Record<string, Keyframe>).green!).Points[0]!.co.Y).toBe(255);
    e = doc.transaction("mode", (tx) => setEffectProperty(tx, "GLOW", "mode", 1));
    expect(e.mode).toBe(1);
    expectRefused(doc, "invalid_argument", (tx) => setEffectProperty(tx, "GLOW", "mode", 7));
    expectRefused(doc, "invalid_argument", (tx) => setEffectProperty(tx, "GLOW", "nope", 1));
    expectRefused(doc, "invalid_argument", (tx) => setEffectProperty(tx, "GLOW", "id", "X"));
    expectRefused(doc, "invalid_argument", (tx) => setEffectProperty(tx, "GLOW", "mode", 1, { frame: 3 }));
    expectRefused(doc, "not_found", (tx) => setEffectProperty(tx, "NOPE", "mode", 1));
  });

  it("removes and reorders", () => {
    const doc = setup();
    doc.transaction("fx", (tx) => {
      addEffect(tx, "CLIP", "Blur", {}, { id: "A" });
      addEffect(tx, "CLIP", "Negate", {}, { id: "B" });
      addEffect(tx, "CLIP", "Hue", {}, { id: "C" });
    });
    const before = doc.project;
    doc.transaction("up", (tx) => moveEffect(tx, "C", "up"));
    expect(effects(doc).map((e) => e.id)).toEqual(["A", "C", "B"]);
    expectUndoRedo(doc, before);
    doc.transaction("top", (tx) => moveEffect(tx, "B", 0));
    expect(effects(doc).map((e) => e.id)).toEqual(["B", "A", "C"]);
    const labels = doc.undoLabels.length;
    doc.transaction("noop", (tx) => moveEffect(tx, "B", "up"));
    expect(doc.undoLabels.length).toBe(labels);
    const r = doc.transaction("rm", (tx) => removeEffect(tx, "A"));
    expect(r).toEqual({ clipId: "CLIP", effectId: "A" });
    expect(effects(doc).map((e) => e.id)).toEqual(["B", "C"]);
    expectRefused(doc, "invalid_argument", (tx) => moveEffect(tx, "B", 9));
    expectRefused(doc, "not_found", (tx) => removeEffect(tx, "A"));
  });

  it("renumbers order when effects carry distinct order values", () => {
    const doc = setup();
    doc.transaction("fx", (tx) => {
      addEffect(tx, "CLIP", "Blur", {}, { id: "A" });
      addEffect(tx, "CLIP", "Negate", {}, { id: "B" });
      tx.update(["clips", { id: "CLIP" }], {
        effects: effects({ project: tx.project } as never).map((e, i) => ({ ...e, order: i })),
      });
    });
    doc.transaction("swap", (tx) => moveEffect(tx, "B", 0));
    expect(effects(doc).map((e) => [e.id, e.order])).toEqual([
      ["B", 1],
      ["A", 0],
    ]);
  });
});
