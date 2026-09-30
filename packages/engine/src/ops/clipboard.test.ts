import { describe, expect, it } from "vitest";
import { findClip } from "../model/query.js";
import { addClip, setClipProperty } from "./clips.js";
import { addEffect } from "./effects.js";
import { copyItems, pasteItems, pasteOnto } from "./clipboard.js";
import { setTrackLocked } from "./tracks.js";
import { expectRefused, expectUndoRedo, makeDoc } from "./testkit.js";

const V1 = 1_000_000;
const V2 = 2_000_000;
const V3 = 3_000_000;

function setup() {
  const doc = makeDoc();
  doc.transaction("clips", (tx) => {
    addClip(tx, { fileId: "VIDEO00001", position: 2, layer: V2, id: "A", end: 4 });
    addClip(tx, { fileId: "VIDEO00001", position: 3, layer: V1, id: "B", end: 4 });
    addEffect(tx, "A", "Blur", {}, { id: "FXA" });
    tx.insert(["effects"], { id: "T", layer: V2, position: 5, start: 0, end: 1, type: "Mask", class_name: "Mask" });
  });
  return doc;
}

describe("copyItems", () => {
  it("copies whole items with the selection's anchor", () => {
    const doc = setup();
    const data = copyItems(doc.project, ["B", "A", "T"]);
    expect(data.clips.map((c) => c.id)).toEqual(["A", "B"]);
    expect(data.transitions.map((t) => t.id)).toEqual(["T"]);
    expect(data.origin).toEqual({ position: 2, layer: V2 });
    // A deep copy: later edits do not leak into the clipboard.
    doc.transaction("edit", (tx) => setClipProperty(tx, "A", "alpha", 0.5));
    expect(data.clips[0]!.alpha.Points[0]!.co.Y).toBe(1);
  });

  it("copies one property group", () => {
    const doc = setup();
    const data = copyItems(doc.project, ["A"], { part: "scale" });
    expect(Object.keys(data.clips[0]!).sort()).toEqual(["gravity", "id", "scale_x", "scale_y"]);
    expect(() => copyItems(doc.project, ["NOPE"])).toThrow(/No clip or transition/);
    expect(() => copyItems(doc.project, [])).toThrow();
  });
});

describe("pasteItems", () => {
  it("keeps offsets, maps tracks from the target down, new ids", () => {
    const doc = setup();
    const data = copyItems(doc.project, ["A", "B", "T"]);
    const before = doc.project;
    const r = doc.transaction("paste", (tx) => pasteItems(tx, data, { position: 10, layer: V3 }));
    expect(r.clipIds).toHaveLength(2);
    const [a, b] = r.clipIds.map((id) => findClip(doc.project, id)!);
    expect([a!.position, a!.layer]).toEqual([10, V3]);
    expect([b!.position, b!.layer]).toEqual([11, V2]);
    expect(a!.effects[0]!.id).not.toBe("FXA");
    const t = doc.project.effects.find((e) => e.id === r.transitionIds[0])!;
    expect([t.position, t.layer]).toEqual([13, V3]);
    expect(doc.undoLabels.at(-1)).toBe("paste");
    expectUndoRedo(doc, before);
  });

  it("keeps each item's track without a target track, and creates missing tracks below", () => {
    const doc = setup();
    const data = copyItems(doc.project, ["A", "B"]);
    const same = doc.transaction("same", (tx) => pasteItems(tx, data, { position: 0 }));
    expect(same.clipIds.map((id) => findClip(doc.project, id)!.layer)).toEqual([V2, V1]);
    const low = doc.transaction("low", (tx) => pasteItems(tx, data, { position: 0, layer: V1 }));
    const layers = low.clipIds.map((id) => findClip(doc.project, id)!.layer);
    expect(layers[0]).toBe(V1);
    expect(layers[1]).toBe(500_000);
  });

  it("refuses partial data, bad targets and locked tracks", () => {
    const doc = setup();
    expectRefused(doc, "invalid_argument", (tx) => pasteItems(tx, copyItems(doc.project, ["A"], { part: "alpha" }), { position: 0 }));
    expectRefused(doc, "invalid_argument", (tx) => pasteItems(tx, copyItems(doc.project, ["A"]), { position: -1 }));
    doc.transaction("lock", (tx) => setTrackLocked(tx, V1, true));
    expectRefused(doc, "locked", (tx) => pasteItems(tx, copyItems(doc.project, ["A", "B"]), { position: 0, layer: V2 }));
  });
});

describe("pasteOnto", () => {
  it("applies copied keyframes and merges effects by class", () => {
    const doc = setup();
    doc.transaction("alpha", (tx) => setClipProperty(tx, "A", "alpha", 0.25));
    const alpha = copyItems(doc.project, ["A"], { part: "alpha" });
    const changed = doc.transaction("paste alpha", (tx) => pasteOnto(tx, alpha, ["B"]));
    expect(changed).toEqual(["B"]);
    expect(findClip(doc.project, "B")!.alpha.Points[0]!.co.Y).toBe(0.25);
    expect(findClip(doc.project, "B")!.position).toBe(3);
    const effects = copyItems(doc.project, ["A"], { part: "effects" });
    doc.transaction("fx", (tx) => pasteOnto(tx, effects, ["B"]));
    doc.transaction("fx2", (tx) => pasteOnto(tx, effects, ["B"]));
    const fx = findClip(doc.project, "B")!.effects;
    expect(fx).toHaveLength(1);
    expect(fx[0]!.class_name).toBe("Blur");
    expect(fx[0]!.id).not.toBe("FXA");
    expectRefused(doc, "not_found", (tx) => pasteOnto(tx, alpha, ["NOPE"]));
  });
});
