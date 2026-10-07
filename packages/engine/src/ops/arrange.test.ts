import { describe, expect, it } from "vitest";
import { findClip } from "../model/query.js";
import { addClip } from "./clips.js";
import { alignItems, nudgeItems, removeAllGaps, setClipCrop } from "./arrange.js";
import { setTrackLocked } from "./tracks.js";
import { expectRefused, expectUndoRedo, makeDoc } from "./testkit.js";

const V1 = 1_000_000;

function setup() {
  const doc = makeDoc();
  doc.transaction("clips", (tx) => {
    addClip(tx, { fileId: "VIDEO00001", position: 0, layer: V1, id: "A", end: 2 });
    addClip(tx, { fileId: "VIDEO00001", position: 5, layer: V1, id: "B", end: 2 });
    addClip(tx, { fileId: "VIDEO00001", position: 6, layer: V1, id: "C", end: 2 });
    addClip(tx, { fileId: "VIDEO00001", position: 12, layer: V1, id: "D", end: 1 });
    tx.insert(["effects"], { id: "T", layer: V1, position: 6.5, start: 0, end: 1, type: "Mask", class_name: "Mask" });
  });
  return doc;
}
const pos = (doc: ReturnType<typeof makeDoc>, id: string) => findClip(doc.project, id)!.position;

describe("nudge / align", () => {
  it("nudges by frames, never before 0", () => {
    const doc = setup();
    const before = doc.project;
    doc.transaction("nudge", (tx) => nudgeItems(tx, ["A", "B", "T"], -15));
    expect([pos(doc, "A"), pos(doc, "B")]).toEqual([0, 4.5]);
    expect(doc.project.effects[0]!.position).toBe(6);
    expectUndoRedo(doc, before);
    expectRefused(doc, "invalid_argument", (tx) => nudgeItems(tx, ["A"], 0.5));
    expectRefused(doc, "not_found", (tx) => nudgeItems(tx, ["NOPE"], 1));
  });

  it("aligns left and right edges", () => {
    const doc = setup();
    doc.transaction("left", (tx) => alignItems(tx, ["B", "D"], "left"));
    expect([pos(doc, "B"), pos(doc, "D")]).toEqual([5, 5]);
    doc.transaction("right", (tx) => alignItems(tx, ["A", "C"], "right"));
    // Right-most edge is C's (6 + 2 = 8); A (length 2) moves to 6.
    expect([pos(doc, "A"), pos(doc, "C")]).toEqual([6, 6]);
  });
});

describe("removeAllGaps", () => {
  it("closes every gap, moving overlapping items together", () => {
    const doc = setup();
    const before = doc.project;
    const removed = doc.transaction("gaps", (tx) => removeAllGaps(tx, V1));
    // Gaps: 2..5 (3 s) and 8..12 (4 s). B, C and T move together.
    expect(removed).toBe(7);
    expect([pos(doc, "A"), pos(doc, "B"), pos(doc, "C"), pos(doc, "D")]).toEqual([0, 2, 3, 5]);
    expect(doc.project.effects[0]!.position).toBe(3.5);
    expectUndoRedo(doc, before);
    const labels = doc.undoLabels.length;
    expect(doc.transaction("again", (tx) => removeAllGaps(tx, V1))).toBe(0);
    expect(doc.undoLabels.length).toBe(labels);
  });

  it("starts from a time and respects locks", () => {
    const doc = setup();
    doc.transaction("gaps", (tx) => removeAllGaps(tx, V1, 9));
    expect([pos(doc, "B"), pos(doc, "D")]).toEqual([5, 9]);
    doc.transaction("lock", (tx) => setTrackLocked(tx, V1, true));
    expectRefused(doc, "locked", (tx) => removeAllGaps(tx, V1));
  });
});

describe("setClipCrop", () => {
  it("adds, updates and removes the Crop effect", () => {
    const doc = setup();
    const crop = doc.transaction("crop", (tx) => setClipCrop(tx, "A", "resize"));
    expect(crop).toMatchObject({ class_name: "Crop", resize: true });
    doc.transaction("crop2", (tx) => setClipCrop(tx, "A", "crop"));
    expect(findClip(doc.project, "A")!.effects).toHaveLength(1);
    expect(findClip(doc.project, "A")!.effects[0]!.resize).toBe(false);
    expect(doc.transaction("none", (tx) => setClipCrop(tx, "A", "none"))).toBeNull();
    expect(findClip(doc.project, "A")!.effects).toEqual([]);
  });
});
