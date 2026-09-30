import { describe, expect, it } from "vitest";
import { Interpolation, ScaleMode, type Clip, type Keyframe } from "../model/types.js";
import { libopenshotClipDefaults } from "../model/defaults.js";
import { evaluate } from "../keyframe/evaluate.js";
import { findClip } from "../model/query.js";
import {
  addClip,
  deleteClips,
  duplicateClip,
  fadeClip,
  moveClip,
  removeGap,
  setClipKeyframes,
  setClipProperty,
  setClipSpeed,
  setClipVolume,
  sliceAllAt,
  splitClip,
  trimClip,
  trimClipEdge,
} from "./clips.js";
import { setTrackLocked } from "./tracks.js";
import { baseProject, expectRefused, expectUndoRedo, makeDoc } from "./testkit.js";

const V1 = 1_000_000;
const V2 = 2_000_000;

function docWithClip(position = 1, id = "CLIP000001") {
  const doc = makeDoc();
  doc.transaction("add", (tx) => addClip(tx, { fileId: "VIDEO00001", position, layer: V1, id }));
  return doc;
}

const clip = (doc: ReturnType<typeof makeDoc>, id = "CLIP000001"): Clip => findClip(doc.project, id)!;
const xs = (kf: Keyframe) => kf.Points.map((p) => p.co.X);
const ys = (kf: Keyframe) => kf.Points.map((p) => p.co.Y);

describe("addClip", () => {
  it("adds a full libopenshot clip with the file as reader", () => {
    const doc = makeDoc();
    const before = doc.project;
    const c = doc.transaction("add", (tx) => addClip(tx, { fileId: "VIDEO00001", position: 1.01, layer: V1 }));
    for (const key of Object.keys(libopenshotClipDefaults())) expect(c).toHaveProperty(key);
    expect(c).toMatchObject({ file_id: "VIDEO00001", title: "clip.mp4", layer: V1, start: 0, end: 20, duration: 20 });
    expect(c.position).toBeCloseTo(1, 12); // snapped to the 30 fps grid
    expect(c.reader.path).toBe("/media/clip.mp4");
    expect(doc.undoLabels).toEqual(["add"]);
    expectUndoRedo(doc, before);
  });

  it("images last 10 s and audio-only media gets the overrides", () => {
    const doc = makeDoc();
    const img = doc.transaction("img", (tx) => addClip(tx, { fileId: "IMAGE00001", position: 0, layer: V1 }));
    expect(img.end).toBe(10);
    const song = doc.transaction("song", (tx) => addClip(tx, { fileId: "AUDIO00001", position: 0, layer: V2 }));
    expect(song.has_video.Points[0]).toEqual({ co: { X: 1, Y: 0 }, interpolation: Interpolation.CONSTANT });
    expect(song.scale).toBe(ScaleMode.NONE);
    expect(song.reader.has_video).toBe(false);
  });

  it("clamps the range to the media and creates a missing track in the same step", () => {
    const doc = makeDoc();
    const before = doc.project;
    const c = doc.transaction("add", (tx) =>
      addClip(tx, { fileId: "VIDEO00001", position: 0, layer: 9_000_000, start: 15, end: 99 }),
    );
    expect([c.start, c.end]).toEqual([15, 20]);
    expect(doc.project.layers.some((l) => l.number === 9_000_000)).toBe(true);
    doc.undo();
    expect(doc.project).toEqual(before);
  });

  it("refuses bad input without touching history", () => {
    const doc = makeDoc();
    expectRefused(doc, "not_found", (tx) => addClip(tx, { fileId: "NOPE", position: 0, layer: V1 }));
    expectRefused(doc, "invalid_argument", (tx) => addClip(tx, { fileId: "VIDEO00001", position: -1, layer: V1 }));
    expectRefused(doc, "invalid_argument", (tx) => addClip(tx, { fileId: "VIDEO00001", position: 0, layer: 0 }));
    expectRefused(doc, "invalid_argument", (tx) =>
      addClip(tx, { fileId: "VIDEO00001", position: 0, layer: V1, start: 5, end: 5 }),
    );
    expectRefused(doc, "invalid_argument", (tx) =>
      addClip(tx, { fileId: "VIDEO00001", position: 0, layer: V1, start: 25 }),
    );
    doc.transaction("lock", (tx) => setTrackLocked(tx, V1, true));
    expectRefused(doc, "locked", (tx) => addClip(tx, { fileId: "VIDEO00001", position: 0, layer: V1 }));
    doc.transaction("add", (tx) => addClip(tx, { fileId: "VIDEO00001", position: 0, layer: V2, id: "DUP" }));
    expectRefused(doc, "conflict", (tx) => addClip(tx, { fileId: "VIDEO00001", position: 0, layer: V2, id: "DUP" }));
  });
});

describe("moveClip / trimClip / trimClipEdge", () => {
  it("moves in time and across tracks, snapped to frames", () => {
    const doc = docWithClip();
    const before = doc.project;
    const c = doc.transaction("move", (tx) => moveClip(tx, "CLIP000001", { position: 3.004, layer: V2 }));
    expect(c.position).toBeCloseTo(3, 12);
    expect(c.layer).toBe(V2);
    expectUndoRedo(doc, before);
  });

  it("moving nowhere records nothing", () => {
    const doc = docWithClip();
    doc.transaction("noop", (tx) => moveClip(tx, "CLIP000001", { position: 1 }));
    expect(doc.undoLabels).toEqual(["add"]);
  });

  it("refuses unknown clips, unknown or locked tracks", () => {
    const doc = docWithClip();
    expectRefused(doc, "not_found", (tx) => moveClip(tx, "NOPE", { position: 1 }));
    expectRefused(doc, "not_found", (tx) => moveClip(tx, "CLIP000001", { layer: 42 }));
    expectRefused(doc, "invalid_argument", (tx) => moveClip(tx, "CLIP000001", { position: Number.NaN }));
    doc.transaction("lock", (tx) => setTrackLocked(tx, V2, true));
    expectRefused(doc, "locked", (tx) => moveClip(tx, "CLIP000001", { layer: V2 }));
    doc.transaction("lock1", (tx) => setTrackLocked(tx, V1, true));
    expectRefused(doc, "locked", (tx) => moveClip(tx, "CLIP000001", { position: 5 }));
  });

  it("trimClip changes source in/out, clamped to the media", () => {
    const doc = docWithClip();
    const before = doc.project;
    const c = doc.transaction("trim", (tx) => trimClip(tx, "CLIP000001", { start: 2, end: 50 }));
    expect([c.position, c.start, c.end, c.duration]).toEqual([1, 2, 20, 18]);
    expectUndoRedo(doc, before);
    expectRefused(doc, "invalid_argument", (tx) => trimClip(tx, "CLIP000001", { start: 8, end: 8 }));
  });

  it("trimClipEdge left keeps content in place; right moves the end", () => {
    const doc = docWithClip(1);
    const left = doc.transaction("left", (tx) => trimClipEdge(tx, "CLIP000001", "left", 3));
    expect([left.position, left.start, left.end]).toEqual([3, 2, 20]);
    // Dragging past the media start stops at source 0.
    const back = doc.transaction("left2", (tx) => trimClipEdge(tx, "CLIP000001", "left", -10));
    expect([back.position, back.start]).toEqual([1, 0]);
    const right = doc.transaction("right", (tx) => trimClipEdge(tx, "CLIP000001", "right", 5));
    expect([right.start, right.end, right.duration]).toEqual([0, 4, 4]);
    // Past the media end clamps to the media duration.
    const long = doc.transaction("right2", (tx) => trimClipEdge(tx, "CLIP000001", "right", 99));
    expect(long.end).toBe(20);
    // Never shorter than one frame.
    const short = doc.transaction("right3", (tx) => trimClipEdge(tx, "CLIP000001", "right", 0));
    expect(short.end).toBeCloseTo(1 / 30, 12);
    expectRefused(doc, "invalid_argument", (tx) => trimClipEdge(tx, "CLIP000001", "middle" as never, 2));
  });
});

describe("splitClip / sliceAllAt", () => {
  it("keep both: the original becomes the left part, a new clip the right part", () => {
    const doc = docWithClip(1);
    doc.transaction("fx", (tx) => {
      tx.update(["clips", { id: "CLIP000001" }], {
        effects: [{ id: "EFFECT0001", class_name: "Blur", type: "Blur" }],
        alpha: { Points: [{ co: { X: 1, Y: 0 }, interpolation: 1 }, { co: { X: 300, Y: 1 }, interpolation: 1 }] },
      });
    });
    const before = doc.project;
    const r = doc.transaction("split", (tx) => splitClip(tx, "CLIP000001", 5));
    expect(r.leftId).toBe("CLIP000001");
    const left = clip(doc);
    const right = clip(doc, r.rightId!);
    expect([left.position, left.start, left.end]).toEqual([1, 0, 4]);
    expect([right.position, right.start, right.end, right.duration]).toEqual([5, 4, 20, 16]);
    expect(right.effects[0]!.id).not.toBe("EFFECT0001");
    // Keyframes are in source frames: both halves keep them unchanged.
    expect(right.alpha).toEqual(left.alpha);
    expect(doc.undoLabels.at(-1)).toBe("split");
    expectUndoRedo(doc, before);
  });

  it("keep left includes the frame at the cut; keep right moves the clip start", () => {
    const doc = docWithClip(1);
    doc.transaction("left", (tx) => splitClip(tx, "CLIP000001", 5, "left"));
    expect(clip(doc).end).toBeCloseTo(4 + 1 / 30, 12);
    const doc2 = docWithClip(1);
    const r = doc2.transaction("right", (tx) => splitClip(tx, "CLIP000001", 5, "right"));
    expect(r).toEqual({ leftId: null, rightId: "CLIP000001" });
    expect([clip(doc2).position, clip(doc2).start, clip(doc2).end]).toEqual([5, 4, 20]);
  });

  it("refuses a cut outside the clip", () => {
    const doc = docWithClip(1);
    expectRefused(doc, "invalid_argument", (tx) => splitClip(tx, "CLIP000001", 1));
    expectRefused(doc, "invalid_argument", (tx) => splitClip(tx, "CLIP000001", 21));
    expectRefused(doc, "invalid_argument", (tx) => splitClip(tx, "CLIP000001", 5, "middle" as never));
  });

  it("sliceAllAt cuts every clip and transition under the time, skipping locked tracks", () => {
    const doc = docWithClip(0);
    doc.transaction("more", (tx) => {
      addClip(tx, { fileId: "VIDEO00001", position: 2, layer: V2, id: "CLIP000002" });
      addClip(tx, { fileId: "VIDEO00001", position: 0, layer: 3_000_000, id: "CLIP000003" });
      tx.insert(["effects"], { id: "TRANS00001", layer: V2, position: 2, start: 0, end: 5, type: "Mask", class_name: "Mask" });
    });
    doc.transaction("lock", (tx) => setTrackLocked(tx, 3_000_000, true));
    const r = doc.transaction("slice all", (tx) => sliceAllAt(tx, 4));
    expect(r.clips.map((c) => c.clipId).sort()).toEqual(["CLIP000001", "CLIP000002"]);
    expect(r.transitions.map((t) => t.transitionId)).toEqual(["TRANS00001"]);
    expect(doc.project.clips).toHaveLength(5);
    expect(doc.project.effects).toHaveLength(2);
    const [a, b] = doc.project.effects;
    expect([a!.position, a!.start, a!.end]).toEqual([2, 0, 2]);
    expect([b!.position, b!.start, b!.end]).toEqual([4, 2, 5]);
    expect(doc.undoLabels.at(-1)).toBe("slice all");
    // Nothing under the time records nothing.
    doc.transaction("empty", (tx) => sliceAllAt(tx, 200));
    expect(doc.undoLabels.at(-1)).toBe("slice all");
  });
});

describe("deleteClips / duplicateClip / removeGap", () => {
  it("deletes, with optional ripple", () => {
    const doc = docWithClip(0, "A");
    doc.transaction("b", (tx) => addClip(tx, { fileId: "VIDEO00001", position: 20, layer: V1, id: "B", end: 5 }));
    const before = doc.project;
    doc.transaction("ripple", (tx) => deleteClips(tx, ["A"], { ripple: true }));
    expect(doc.project.clips.map((c) => [c.id, c.position])).toEqual([["B", 0]]);
    expectUndoRedo(doc, before);
    expectRefused(doc, "not_found", (tx) => deleteClips(tx, ["B", "NOPE"]));
    doc.transaction("lock", (tx) => setTrackLocked(tx, V1, true));
    expectRefused(doc, "locked", (tx) => deleteClips(tx, ["B"]));
  });

  it("duplicates with fresh clip and effect ids", () => {
    const doc = docWithClip(0);
    doc.transaction("fx", (tx) => tx.update(["clips", { id: "CLIP000001" }], { effects: [{ id: "E1", class_name: "Blur", type: "Blur" }] }));
    const copy = doc.transaction("dup", (tx) => duplicateClip(tx, "CLIP000001"));
    expect(copy.id).not.toBe("CLIP000001");
    expect(copy.position).toBe(20);
    expect(copy.effects[0]!.id).not.toBe("E1");
    expectRefused(doc, "not_found", (tx) => duplicateClip(tx, "CLIP000001", { layer: 77 }));
  });

  it("removeGap closes the gap and reports its size; no gap records nothing", () => {
    const doc = docWithClip(0, "A");
    doc.transaction("b", (tx) => addClip(tx, { fileId: "VIDEO00001", position: 25, layer: V1, id: "B", end: 5 }));
    const size = doc.transaction("gap", (tx) => removeGap(tx, V1, 22));
    expect(size).toBe(5);
    expect(clip(doc, "B").position).toBe(20);
    const labels = doc.undoLabels.length;
    expect(doc.transaction("none", (tx) => removeGap(tx, V1, 22))).toBe(0);
    expect(doc.undoLabels.length).toBe(labels);
  });
});

describe("setClipProperty / setClipKeyframes", () => {
  it("constant value without a frame; insert/update a LINEAR point at a frame or time", () => {
    const doc = docWithClip(1);
    const before = doc.project;
    let c = doc.transaction("alpha", (tx) => setClipProperty(tx, "CLIP000001", "alpha", 0.5));
    expect(c.alpha.Points).toHaveLength(1);
    expect(evaluate(c.alpha, 100)).toBe(0.5);
    c = doc.transaction("alpha at", (tx) => setClipProperty(tx, "CLIP000001", "alpha", 1, { frame: 31 }));
    expect(xs(c.alpha)).toEqual([1, 31]);
    expect(c.alpha.Points[1]).toEqual({ co: { X: 31, Y: 1 }, interpolation: Interpolation.LINEAR });
    // Timeline time 3 s → clip frame round((3 - 1 + 0) * 30) + 1 = 61.
    c = doc.transaction("alpha t", (tx) => setClipProperty(tx, "CLIP000001", "alpha", 0.25, { time: 3 }));
    expect(xs(c.alpha)).toEqual([1, 31, 61]);
    c = doc.transaction("alpha t2", (tx) => setClipProperty(tx, "CLIP000001", "alpha", 0.75, { time: 3 }));
    expect(ys(c.alpha)).toEqual([0.5, 1, 0.75]);
    doc.undo(4);
    expect(doc.project).toEqual(before);
  });

  it("choice keyframes are CONSTANT and validated; scale is clamped like the desktop", () => {
    const doc = docWithClip(1);
    const c = doc.transaction("hv", (tx) => setClipProperty(tx, "CLIP000001", "has_video", 0, { frame: 10 }));
    expect(c.has_video.Points.at(-1)!.interpolation).toBe(Interpolation.CONSTANT);
    expectRefused(doc, "invalid_argument", (tx) => setClipProperty(tx, "CLIP000001", "has_video", 5));
    // 1280×720 project: max = round(2000*50/1280) = 78.
    const big = doc.transaction("scale", (tx) => setClipProperty(tx, "CLIP000001", "scale_x", 1000));
    expect(big.scale_x.Points[0]!.co.Y).toBe(78);
  });

  it("plain properties, colors, timing delegation and unknown names", () => {
    const doc = docWithClip(1);
    expect(doc.transaction("g", (tx) => setClipProperty(tx, "CLIP000001", "gravity", 0)).gravity).toBe(0);
    expectRefused(doc, "invalid_argument", (tx) => setClipProperty(tx, "CLIP000001", "gravity", 9));
    expect(doc.transaction("t", (tx) => setClipProperty(tx, "CLIP000001", "title", "Intro")).title).toBe("Intro");
    const w = doc.transaction("w", (tx) => setClipProperty(tx, "CLIP000001", "wave_color", "#ff0000"));
    expect(ys(w.wave_color.red)).toEqual([255]);
    expect(ys(w.wave_color.green)).toEqual([0]);
    expect(doc.transaction("p", (tx) => setClipProperty(tx, "CLIP000001", "position", 4)).position).toBe(4);
    expectRefused(doc, "invalid_argument", (tx) => setClipProperty(tx, "CLIP000001", "nope", 1));
    expectRefused(doc, "invalid_argument", (tx) => setClipProperty(tx, "CLIP000001", "gravity", 1, { frame: 3 }));
  });

  it("setClipKeyframes replaces or merges points", () => {
    const doc = docWithClip(1);
    const c = doc.transaction("kf", (tx) =>
      setClipKeyframes(tx, "CLIP000001", "location_x", [
        { frame: 31, value: 1, interpolation: Interpolation.LINEAR },
        { frame: 1, value: -1 },
      ]),
    );
    expect(xs(c.location_x)).toEqual([1, 31]);
    const merged = doc.transaction("kf2", (tx) =>
      setClipKeyframes(tx, "CLIP000001", "location_x", [{ time: 3, value: 0 }], { mode: "merge" }),
    );
    expect(xs(merged.location_x)).toEqual([1, 31, 61]);
    expectRefused(doc, "invalid_argument", (tx) => setClipKeyframes(tx, "CLIP000001", "location_x", []));
    expectRefused(doc, "invalid_argument", (tx) => setClipKeyframes(tx, "CLIP000001", "gravity", [{ frame: 1, value: 1 }]));
    expectRefused(doc, "invalid_argument", (tx) =>
      setClipKeyframes(tx, "CLIP000001", "alpha", [{ frame: 1, time: 2, value: 1 }]),
    );
  });
});

describe("setClipSpeed (retime_clip)", () => {
  it("2x halves the length and builds a linear time curve", () => {
    const doc = docWithClip(1);
    const before = doc.project;
    const c = doc.transaction("2x", (tx) => setClipSpeed(tx, "CLIP000001", 2));
    expect([c.start, c.end, c.duration, c.position]).toEqual([0, 10, 10, 1]);
    expect(c.time.Points.map((p) => [p.co.X, p.co.Y, p.interpolation])).toEqual([
      [1, 1, Interpolation.LINEAR],
      [301, 600, Interpolation.LINEAR],
    ]);
    expectUndoRedo(doc, before);
  });

  it("backward mirrors the time curve", () => {
    const doc = docWithClip(1);
    const c = doc.transaction("rev", (tx) => setClipSpeed(tx, "CLIP000001", 1, { direction: "backward" }));
    // retime.py: X spans start_x..start_x + new frames (1..601), Y the source frames 600 → 1.
    expect(c.time.Points.map((p) => [p.co.X, p.co.Y])).toEqual([
      [1, 600],
      [601, 1],
    ]);
    expect(c.end).toBe(20);
  });

  it("refuses out-of-range factors", () => {
    const doc = docWithClip(1);
    expectRefused(doc, "invalid_argument", (tx) => setClipSpeed(tx, "CLIP000001", 0));
    expectRefused(doc, "invalid_argument", (tx) => setClipSpeed(tx, "CLIP000001", 100));
  });
});

describe("fadeClip", () => {
  it("fades alpha and volume in and out like the desktop Fade menu", () => {
    const doc = docWithClip(1);
    const before = doc.project;
    const c = doc.transaction("fade", (tx) => fadeClip(tx, "CLIP000001", { fadeIn: 1, fadeOut: 1 }));
    for (const kf of [c.alpha, c.volume]) {
      expect(kf.Points.map((p) => [p.co.X, p.co.Y])).toEqual([
        [1, 0],
        [31, 1],
        [571, 1],
        [601, 0],
      ]);
      expect(kf.Points.every((p) => p.interpolation === Interpolation.BEZIER)).toBe(true);
    }
    expectUndoRedo(doc, before);
  });

  it("fade-out alone keeps the existing start point; 0 removes a fade", () => {
    const doc = docWithClip(1);
    const out = doc.transaction("out", (tx) => fadeClip(tx, "CLIP000001", { fadeOut: 1, audio: false }));
    expect(xs(out.alpha)).toEqual([1, 571, 601]);
    expect(out.volume.Points).toHaveLength(1);
    const cleared = doc.transaction("clear", (tx) => fadeClip(tx, "CLIP000001", { fadeOut: 0, audio: false }));
    expect(xs(cleared.alpha)).toEqual([1]);
    expectRefused(doc, "invalid_argument", (tx) => fadeClip(tx, "CLIP000001", { fadeIn: 30 }));
    expectRefused(doc, "invalid_argument", (tx) => fadeClip(tx, "CLIP000001", {}));
  });
});

describe("setClipVolume", () => {
  it("sets a flat level for the whole clip", () => {
    const doc = docWithClip(1);
    const r = doc.transaction("vol", (tx) => setClipVolume(tx, "CLIP000001", { level: 0.5 }));
    expect(r.before).toBe(1);
    expect(r.target).toBe(0.5);
    expect(r.clip.volume.Points).toEqual([{ co: { X: 1, Y: 0.5 }, interpolation: Interpolation.LINEAR }]);
  });

  it("windows ramp in and out; dB input", () => {
    const doc = docWithClip(1);
    const r = doc.transaction("duck", (tx) => setClipVolume(tx, "CLIP000001", { levelDb: -6, start: 5, end: 8 }));
    expect(r.points).toBe(4);
    const ys2 = ys(r.clip.volume);
    expect(ys2[0]).toBe(1);
    expect(ys2[3]).toBe(1);
    expect(ys2[1]).toBeCloseTo(0.501187, 5);
  });

  it("refuses clips without audio and bad arguments", () => {
    const doc = makeDoc(baseProject());
    doc.transaction("img", (tx) => addClip(tx, { fileId: "IMAGE00001", position: 0, layer: V1, id: "IMG" }));
    expectRefused(doc, "invalid_argument", (tx) => setClipVolume(tx, "IMG", { level: 0.5 }));
    const doc2 = docWithClip(1);
    expectRefused(doc2, "invalid_argument", (tx) => setClipVolume(tx, "CLIP000001", { level: 0.5, levelDb: -3 }));
    expectRefused(doc2, "invalid_argument", (tx) => setClipVolume(tx, "CLIP000001", {}));
    expectRefused(doc2, "invalid_argument", (tx) => setClipVolume(tx, "CLIP000001", { level: 0.5, start: 50, end: 60 }));
  });
});
