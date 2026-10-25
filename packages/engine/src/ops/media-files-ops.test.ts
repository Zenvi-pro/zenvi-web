/**
 * The ops behind the Project Files and transition editor tools: a file's
 * record saved with its clips refreshed (project_files.save_file_and_sync_clips),
 * sub-clip files (Split Clip), exact clip timing (crossfade handles) and the
 * transition curve rules of zenvi-core develop transition_ops.py
 * (tests/test_transition_ops.py).
 */

import { describe, expect, it } from "vitest";
import type { Keyframe, Transition } from "../model/types.js";
import { addClip, setClipTiming } from "./clips.js";
import { addSubclipFiles, writeFile } from "./files.js";
import {
  addMaskTransition,
  maskDefaultCurves,
  maskReader,
  rescaledTransitionCurves,
  reversedTransitionCurves,
  transitionDirection,
  usesStaticMask,
  writeTransition,
} from "./transitions.js";
import { setTrackLocked } from "./tracks.js";
import { expectRefused, expectUndoRedo, makeDoc } from "./testkit.js";

const V1 = 1_000_000;
const FPS = { num: 30, den: 1 };
const pts = (kf: Keyframe | undefined) => (kf?.Points ?? []).map((p) => [p.co.X, p.co.Y]);

function withClip(end = 20) {
  const doc = makeDoc();
  doc.transaction("clip", (tx) => addClip(tx, { fileId: "VIDEO00001", position: 0, layer: V1, id: "C1", end }));
  return doc;
}

describe("writeFile (File Properties accept)", () => {
  it("saves the record, deletes keys it lost and refreshes the clips that play it", () => {
    const doc = withClip(20);
    doc.transaction("in/out", (tx) => tx.update(["files", { id: "VIDEO00001" }], { start: 1, end: 3 }));
    const before = doc.project;
    const file = doc.project.files[0]!;
    const { start: _s, end: _e, ...rest } = file;
    const next = { ...rest, duration: 6, name: "Short" };
    const result = doc.transaction("write", (tx) => writeFile(tx, "VIDEO00001", next));
    expect(result.updatedClipIds).toEqual(["C1"]);
    expect(result.renamedClipIds).toEqual([]);
    const saved = doc.project.files[0]!;
    expect(saved).not.toHaveProperty("start");
    expect(saved).not.toHaveProperty("end");
    expect(saved.name).toBe("Short");
    const clip = doc.project.clips[0]!;
    expect([clip.end, clip.duration, clip.reader.duration]).toEqual([6, 6, 6]);
    expect((clip.reader as Record<string, unknown>).name).toBe("Short");
    expect(doc.undoLabels).toHaveLength(3);
    expectUndoRedo(doc, before);
  });

  it("can relabel the clips too, and follows the file onto locked tracks like the desktop", () => {
    const doc = withClip();
    doc.transaction("lock", (tx) => setTrackLocked(tx, V1, true));
    const next = { ...doc.project.files[0]!, name: "Intro" };
    const result = doc.transaction("write", (tx) => writeFile(tx, "VIDEO00001", next, { clipTitle: "Intro" }));
    expect(result.renamedClipIds).toEqual(["C1"]);
    expect(doc.project.clips[0]!.title).toBe("Intro");
  });

  it("refuses another id", () => {
    const doc = withClip();
    expectRefused(doc, "invalid_argument", (tx) => writeFile(tx, "VIDEO00001", { ...doc.project.files[0]!, id: "OTHER" }));
    expectRefused(doc, "not_found", (tx) => writeFile(tx, "NOPE", { id: "NOPE" }));
  });
});

describe("addSubclipFiles (Split Clip)", () => {
  it("copies the record without its name and id, with the range and the new name", () => {
    const doc = makeDoc();
    doc.transaction("meta", (tx) => tx.update(["files", { id: "VIDEO00001" }], { name: "Interview", tags: "talk", ai_metadata: { analyzed: false } }));
    const before = doc.project;
    const [hook, demo] = doc.transaction("subclips", (tx) =>
      addSubclipFiles(tx, "VIDEO00001", [
        { start: 5, end: 12, name: "Hook", aiMetadata: {} },
        { start: 15, end: 18.5, name: "Demo" },
      ]),
    );
    const source = doc.project.files.find((f) => f.id === "VIDEO00001")!;
    expect(hook).toMatchObject({ start: 5, end: 12, name: "Hook", path: source.path, tags: "talk", ai_metadata: {} });
    expect(demo).toMatchObject({ start: 15, end: 18.5, name: "Demo", ai_metadata: { analyzed: false } });
    expect(hook!.id).not.toBe(source.id);
    // The desktop's dict order: the source's keys, then name, then the id File.save() adds.
    expect(Object.keys(hook!).slice(-2)).toEqual(["name", "id"]);
    expect(doc.project.clips).toEqual([]);
    expectUndoRedo(doc, before);
  });

  it("refuses an empty list or an empty range before adding anything", () => {
    const doc = makeDoc();
    expectRefused(doc, "invalid_argument", (tx) => addSubclipFiles(tx, "VIDEO00001", []));
    expectRefused(doc, "invalid_argument", (tx) => addSubclipFiles(tx, "VIDEO00001", [{ start: 1, end: 2, name: "a" }, { start: 3, end: 3, name: "b" }]));
    expectRefused(doc, "not_found", (tx) => addSubclipFiles(tx, "NOPE", [{ start: 1, end: 2, name: "a" }]));
  });
});

describe("setClipTiming", () => {
  it("writes position and in/out exactly, between frames too", () => {
    const doc = withClip(10);
    doc.transaction("timing", (tx) => setClipTiming(tx, "C1", { position: 4.533333, start: 9.493333, end: 10 }));
    expect(doc.project.clips[0]).toMatchObject({ position: 4.533333, start: 9.493333, end: 10 });
    expectRefused(doc, "invalid_argument", (tx) => setClipTiming(tx, "C1", { start: 11 }));
    doc.transaction("lock", (tx) => setTrackLocked(tx, V1, true));
    expectRefused(doc, "locked", (tx) => setClipTiming(tx, "C1", { position: 1 }));
  });
});

describe("transition curve rules (transition_ops.py)", () => {
  function fade(duration = 1): Transition {
    const doc = withClip();
    return doc.transaction("t", (tx) => addMaskTransition(tx, { layer: V1, position: 10, duration, reader: maskReader("@transitions/common/fade.svg") }));
  }

  it("builds the desktop's new_mask_transition: default curves, no resource, audio hint only when asked", () => {
    const t = fade(1);
    expect(pts(t.brightness)).toEqual([
      [1, 1],
      [31, -1],
    ]);
    expect(pts(t.contrast)).toEqual([[1, 3]]);
    expect(t).toMatchObject({ type: "Mask", title: "Transition", start: 0, end: 1, replace_image: false });
    expect(t).not.toHaveProperty("resource");
    expect(t).not.toHaveProperty("fade_audio_hint");
    const doc = withClip();
    const crossfade = doc.transaction("t", (tx) =>
      addMaskTransition(tx, { layer: V1, position: 2, duration: 0.5, reader: maskReader("@transitions/common/fade.svg"), title: "fade", fadeAudio: true }),
    );
    expect([crossfade.title, crossfade.fade_audio_hint]).toEqual(["fade", true]);
  });

  it("reads the direction from the brightness curve", () => {
    const t = fade();
    expect(transitionDirection(t)).toBe("default");
    expect(transitionDirection({ ...t, ...reversedTransitionCurves(t) })).toBe("reversed");
    expect(transitionDirection({ brightness: { Points: [{ co: { X: 1, Y: 0 } }] } })).toBeNull();
    expect(transitionDirection({})).toBeNull();
  });

  it("mirrors points and swaps their handles on reverse", () => {
    const kf = {
      Points: [
        { co: { X: 1, Y: 1.0 }, handle_left: { X: 0.1, Y: 0.1 }, handle_right: { X: 0.9, Y: 0.9 }, interpolation: 0 },
        { co: { X: 31, Y: -1.0 }, handle_left: { X: 0.2, Y: 0.2 }, handle_right: { X: 0.8, Y: 0.8 }, interpolation: 0 },
      ],
    } as unknown as Keyframe;
    const reversed = reversedTransitionCurves({ brightness: kf });
    expect(pts(reversed.brightness)).toEqual([
      [1, -1],
      [31, 1],
    ]);
    expect(reversed.brightness!.Points[0]!.handle_left).toEqual({ X: 0.8, Y: 0.8 });
    expect(reversedTransitionCurves({})).toEqual({});
  });

  it("fits a still mask's curves to a new length, end points pinned; animated masks keep theirs", () => {
    const t = fade(1);
    expect(pts(rescaledTransitionCurves(t, 1.0, 0.5, FPS).brightness)).toEqual([
      [1, 1],
      [16, -1],
    ]);
    expect(pts(rescaledTransitionCurves(t, 1.0, 2.0, FPS).brightness)).toEqual([
      [1, 1],
      [61, -1],
    ]);
    const animated = { ...t, reader: { path: "/m/wipe.mp4", has_single_image: false, media_type: "video" } };
    expect(usesStaticMask(animated)).toBe(false);
    expect(rescaledTransitionCurves(animated, 1.0, 2.0, FPS)).toEqual({});
  });

  it("resets timing and curves for the kind of mask (set_mask_defaults)", () => {
    const t = fade(1);
    expect(maskDefaultCurves({ ...t, start: 0, end: 2 }, FPS)).toMatchObject({ start: 0, end: 2, duration: 2 });
    expect(pts(maskDefaultCurves({ ...t, end: 2 }, FPS).brightness)).toEqual([
      [1, 1],
      [61, -1],
    ]);
    const animated = maskDefaultCurves({ ...t, start: 1, end: 3, reader: { path: "/m/wipe.mp4", has_single_image: false } }, FPS);
    expect(animated).toMatchObject({ start: 1, end: 3, duration: 2 });
    expect([pts(animated.brightness), pts(animated.contrast)]).toEqual([[[1, 0]], [[1, 0]]]);
  });

  it("writes a whole transition: changed keys, removed keys deleted, one undo step", () => {
    const doc = withClip();
    const t = doc.transaction("t", (tx) => addMaskTransition(tx, { layer: V1, position: 10, duration: 1, reader: maskReader("@transitions/common/fade.svg") }));
    doc.transaction("hint", (tx) => tx.update(["effects", { id: t.id }], { mask_reader: { path: "/old.png" }, resource: "/old.png" }));
    const before = doc.project;
    const current = doc.project.effects[0]!;
    const { mask_reader: _m, resource: _r, ...rest } = current;
    const written = doc.transaction("write", (tx) => writeTransition(tx, t.id, { ...rest, title: "circle", mask_invert: true }));
    expect(written).not.toHaveProperty("mask_reader");
    expect(written).not.toHaveProperty("resource");
    expect([written.title, written.mask_invert]).toEqual(["circle", true]);
    expectUndoRedo(doc, before);
    expectRefused(doc, "invalid_argument", (tx) => writeTransition(tx, t.id, { ...written, id: "OTHER" }));
    doc.transaction("lock", (tx) => setTrackLocked(tx, V1, true));
    expectRefused(doc, "locked", (tx) => writeTransition(tx, t.id, { ...written, title: "x" }));
  });
});
