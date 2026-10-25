import { describe, expect, it } from "vitest";
import { findClip, findTransition } from "../model/query.js";
import { addClip, moveClip } from "./clips.js";
import {
  addAutoTransition,
  addTransition,
  applyTransitionBetween,
  applyTransitionToClip,
  findMissingTransition,
  inferDropSide,
  moveTransition,
  removeTransition,
  rescaleTransitionKeyframes,
  resolveTransitionMask,
  reverseTransition,
  setTransitionProperty,
  trimTransition,
} from "./transitions.js";
import { setTrackLocked } from "./tracks.js";
import { expectRefused, expectUndoRedo, makeDoc } from "./testkit.js";

const V1 = 1_000_000;
const V2 = 2_000_000;
const pts = (t: { brightness: { Points: { co: { X: number; Y: number } }[] } }) =>
  t.brightness.Points.map((p) => [p.co.X, p.co.Y]);

function twoClips() {
  const doc = makeDoc();
  doc.transaction("clips", (tx) => {
    addClip(tx, { fileId: "VIDEO00001", position: 0, layer: V1, id: "A", end: 5 });
    addClip(tx, { fileId: "VIDEO00001", position: 5, layer: V1, id: "B", end: 5 });
  });
  return doc;
}

describe("mask lookup", () => {
  it("resolves ids, stored paths and fuzzy names like the desktop tools", () => {
    expect(resolveTransitionMask("common/fade")?.path).toBe("@transitions/common/fade.svg");
    expect(resolveTransitionMask("Fade")?.title).toBe("fade");
    expect(resolveTransitionMask("wipe left")?.path).toBe("@transitions/common/wipe_left_to_right.svg");
    expect(resolveTransitionMask("extra/barr_ripple_1")?.path).toBe("@transitions/extra/barr_ripple_1.jpg");
    expect(resolveTransitionMask("@transitions/common/fade.svg")?.title).toBe("fade");
    expect(resolveTransitionMask("sparkles")).toBeUndefined();
  });
});

describe("addTransition", () => {
  it("adds the desktop's sparse Mask with default keyframes, oriented by drop side", () => {
    const doc = twoClips();
    const before = doc.project;
    // At the left edge of clip B: fade in (1 → -1).
    const t = doc.transaction("add", (tx) => addTransition(tx, { layer: V1, position: 5, duration: 1, maskId: "common/fade" }));
    expect(t).toMatchObject({ type: "Mask", class_name: "Mask", title: "Transition", start: 0, end: 1, resource: "@transitions/common/fade.svg" });
    expect(pts(t)).toEqual([
      [1, 1],
      [31, -1],
    ]);
    expect(t.reader).toMatchObject({ type: "QtImageReader", path: "@transitions/common/fade.svg", has_single_image: true, width: 720, height: 576 });
    expectUndoRedo(doc, before);
    // At the right edge of clip A: fade out (-1 → 1).
    const out = doc.transaction("out", (tx) => addTransition(tx, { layer: V1, position: 4, duration: 0.9, maskId: "fade" }));
    expect(pts(out).map(([, y]) => y)).toEqual([-1, 1]);
    expect(inferDropSide(doc.project.clips, V1, 4, 0.9)).toBe("right");
  });

  it("refuses bad input", () => {
    const doc = twoClips();
    expectRefused(doc, "not_found", (tx) => addTransition(tx, { layer: V1, position: 0, duration: 1, maskId: "sparkles" }));
    expectRefused(doc, "invalid_argument", (tx) => addTransition(tx, { layer: V1, position: 0, duration: 0, maskId: "fade" }));
    expectRefused(doc, "invalid_argument", (tx) => addTransition(tx, { layer: V1, position: 0, duration: 1 }));
    doc.transaction("lock", (tx) => setTrackLocked(tx, V1, true));
    expectRefused(doc, "locked", (tx) => addTransition(tx, { layer: V1, position: 0, duration: 1, maskId: "fade" }));
  });

  it("creates the track it goes on when there is none, like the desktop's drop", () => {
    const doc = twoClips();
    doc.transaction("add", (tx) => addTransition(tx, { layer: 9_000_000, position: 0, duration: 1, maskId: "fade" }));
    expect(doc.project.layers.some((l) => l.number === 9_000_000)).toBe(true);
  });
});

describe("applyTransitionBetween / applyTransitionToClip", () => {
  it("moves clip B back to overlap and covers the overlap, in one undo step", () => {
    const doc = twoClips();
    const before = doc.project;
    const r = doc.transaction("between", (tx) => applyTransitionBetween(tx, "A", "B", "fade", 1));
    expect(r.movedClip?.position).toBe(4);
    expect(findClip(doc.project, "B")!.position).toBe(4);
    expect(r.transition).toMatchObject({ layer: V1, position: 4, end: 1, title: "fade" });
    expect(r.transition.resource).toBeUndefined();
    expect(doc.undoLabels.at(-1)).toBe("between");
    expectUndoRedo(doc, before);
  });

  it("uses the higher track and never moves B before 0", () => {
    const doc = makeDoc();
    doc.transaction("clips", (tx) => {
      addClip(tx, { fileId: "VIDEO00001", position: 0, layer: V1, id: "A", end: 5 });
      addClip(tx, { fileId: "VIDEO00001", position: 0.5, layer: V2, id: "B", end: 5 });
    });
    const r = doc.transaction("between", (tx) => applyTransitionBetween(tx, "A", "B", "wipe", 2));
    expect(r.transition.layer).toBe(V2);
    expect(r.transition.position).toBe(0);
  });

  it("start fades in, end fades out", () => {
    const doc = twoClips();
    const start = doc.transaction("s", (tx) => applyTransitionToClip(tx, "B", "fade", "start", 1));
    expect([start.position, ...pts(start).map(([, y]) => y)]).toEqual([5, 1, -1]);
    const end = doc.transaction("e", (tx) => applyTransitionToClip(tx, "B", "fade", "end", 1));
    expect([end.position, ...pts(end).map(([, y]) => y)]).toEqual([9, -1, 1]);
    expectRefused(doc, "invalid_argument", (tx) => applyTransitionToClip(tx, "B", "fade", "middle" as never, 1));
    expectRefused(doc, "not_found", (tx) => applyTransitionToClip(tx, "B", "nope", "start", 1));
    expectRefused(doc, "invalid_argument", (tx) => applyTransitionBetween(tx, "A", "A", "fade", 1));
  });
});

describe("move / trim / reverse / remove / properties", () => {
  function withTransition() {
    const doc = twoClips();
    doc.transaction("t", (tx) => addTransition(tx, { layer: V1, position: 5, duration: 1, maskId: "fade", id: "T" }));
    return doc;
  }

  it("moves and trims, rescaling static-mask keyframes to the new length", () => {
    const doc = withTransition();
    const moved = doc.transaction("m", (tx) => moveTransition(tx, "T", { position: 6 }));
    expect(moved.position).toBe(6);
    const longer = doc.transaction("r", (tx) => trimTransition(tx, "T", "right", 8));
    expect([longer.position, longer.end]).toEqual([6, 2]);
    expect(pts(longer)).toEqual([
      [1, 1],
      [61, -1],
    ]);
    const left = doc.transaction("l", (tx) => trimTransition(tx, "T", "left", 7));
    expect([left.position, left.end]).toEqual([7, 1]);
    expect(pts(left)).toEqual([
      [1, 1],
      [31, -1],
    ]);
    expect(rescaleTransitionKeyframes({ Points: [{ co: { X: 1, Y: 1 }, interpolation: 0 }] }, 30, 60).Points[0]!.co.X).toBe(1);
  });

  it("reverses, edits keyframes and flags, swaps the mask, removes", () => {
    const doc = withTransition();
    const before = doc.project;
    const r = doc.transaction("rev", (tx) => reverseTransition(tx, "T"));
    expect(pts(r).map(([, y]) => y)).toEqual([-1, 1]);
    expectUndoRedo(doc, before);
    const b = doc.transaction("b", (tx) => setTransitionProperty(tx, "T", "brightness", 0, { frame: 16 }));
    expect(pts(b).map(([x]) => x)).toEqual([1, 16, 31]);
    expectRefused(doc, "invalid_argument", (tx) => setTransitionProperty(tx, "T", "brightness", 5));
    const flag = doc.transaction("f", (tx) => setTransitionProperty(tx, "T", "replace_image", true));
    expect(flag.replace_image).toBe(true);
    const swapped = doc.transaction("mask", (tx) => setTransitionProperty(tx, "T", "mask", "common/circle_in_to_out"));
    expect(swapped.reader.path).toBe("@transitions/common/circle_in_to_out.svg");
    expect(pts(swapped)).toEqual([
      [1, 1],
      [31, -1],
    ]);
    expectRefused(doc, "invalid_argument", (tx) => setTransitionProperty(tx, "T", "nope", 1));
    doc.transaction("rm", (tx) => removeTransition(tx, "T"));
    expect(findTransition(doc.project, "T")).toBeUndefined();
    expectRefused(doc, "not_found", (tx) => removeTransition(tx, "T"));
  });
});

describe("automatic transitions (add_missing_transition)", () => {
  it("adds a fade over a new overlap of at least 0.5 s, once", () => {
    const doc = twoClips();
    // Move B back by 1 s: it overlaps A by 1 s.
    doc.transaction("drag", (tx) => moveClip(tx, "B", { position: 4, autoTransition: true }));
    expect(findMissingTransition(doc.project, "B")).toBeNull();
    expect(doc.project.effects).toHaveLength(1);
    const t = doc.project.effects[0]!;
    expect(t).toMatchObject({ layer: V1, position: 4, start: 0, end: 1, fade_audio_hint: true, title: "Transition" });
    expect(t.reader.path).toBe("@transitions/common/fade.svg");
    expect(doc.undoLabels.at(-1)).toBe("drag");
    doc.undo();
    expect(doc.project.effects).toEqual([]);
    expect(findClip(doc.project, "B")!.position).toBe(5);
  });

  it("ignores short overlaps and clips that do not overlap", () => {
    const doc = twoClips();
    doc.transaction("nudge", (tx) => moveClip(tx, "B", { position: 4.8, autoTransition: true }));
    expect(doc.project.effects).toEqual([]);
    expect(findMissingTransition(doc.project, "A")).toBeNull();
    expect(doc.transaction("none", (tx) => addAutoTransition(tx, "A"))).toBeNull();
  });
});
