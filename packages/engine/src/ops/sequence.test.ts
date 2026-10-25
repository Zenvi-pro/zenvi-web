import { describe, expect, it } from "vitest";
import { addClip, closeGap, separateAudio, splitTransition } from "./clips.js";
import { alignedPositions, closeAllGaps } from "./arrange.js";
import { fitLengths, placeFiles } from "./add-to-timeline.js";
import { applyClipPreset, effectiveSpeed, repeatClip, repeatIsActive } from "./presets.js";
import { timeCurveIsReversed } from "./retime.js";
import { duplicateItems, plannedOverlaps, remapLayers, shiftAfter, trackEnd, transitionsBetween } from "./sequence.js";
import { addTransition } from "./transitions.js";
import { setTrackLocked } from "./tracks.js";
import { baseProject, expectRefused, imageFile, makeDoc, videoFile } from "./testkit.js";
import { listGaps } from "../timeline/queries.js";

const V1 = 1_000_000;
const V2 = 2_000_000;
const V3 = 3_000_000;
const TOL = 0.5 / 30;

/** Clips A 0-4, B 4-8 (crossfaded with C over 7.5-8), C 7.5-11.5 on track 1, and a fade over the crossfade. */
function docWithRun() {
  const doc = makeDoc();
  doc.transaction("setup", (tx) => {
    addClip(tx, { fileId: "VIDEO00001", position: 0, layer: V1, start: 0, end: 4, id: "A" });
    addClip(tx, { fileId: "VIDEO00001", position: 4, layer: V1, start: 0, end: 4, id: "B" });
    addClip(tx, { fileId: "VIDEO00001", position: 7.5, layer: V1, start: 0, end: 4, id: "C" });
    addTransition(tx, { layer: V1, position: 7.5, duration: 0.5, maskId: "common/fade", id: "T" });
  });
  return doc;
}

describe("trackEnd / listGaps", () => {
  it("finds where a track ends and its gaps after a time", () => {
    const doc = makeDoc();
    doc.transaction("setup", (tx) => {
      addClip(tx, { fileId: "VIDEO00001", position: 1, layer: V1, start: 0, end: 2, id: "A" });
      addClip(tx, { fileId: "VIDEO00001", position: 5, layer: V1, start: 0, end: 2, id: "B" });
    });
    expect(trackEnd(doc.project, V1)).toBe(7);
    expect(trackEnd(doc.project, V1, new Set(["B"]))).toBe(3);
    expect(trackEnd(doc.project, V2)).toBe(0);
    expect(listGaps(doc.project, V1)).toEqual([
      { start: 0, end: 1 },
      { start: 3, end: 5 },
    ]);
    expect(listGaps(doc.project, V1, 4)).toEqual([{ start: 3, end: 5 }]);
  });
});

describe("closeGap / closeAllGaps", () => {
  it("closes one gap, or packs the track with overlapping items moving together", () => {
    const doc = makeDoc();
    doc.transaction("setup", (tx) => {
      addClip(tx, { fileId: "VIDEO00001", position: 1, layer: V1, start: 0, end: 2, id: "A" });
      addClip(tx, { fileId: "VIDEO00001", position: 5, layer: V1, start: 0, end: 2, id: "B" });
      addClip(tx, { fileId: "VIDEO00001", position: 6.5, layer: V1, start: 0, end: 2, id: "C" });
      addTransition(tx, { layer: V1, position: 6.5, duration: 0.5, maskId: "common/fade", id: "T" });
    });
    const one = doc.transaction("gap", (tx) => closeGap(tx, V1, 3, 5));
    expect(new Set(one)).toEqual(new Set(["B", "C", "T"]));
    expect(doc.project.clips.map((c) => c.position)).toEqual([1, 3, 4.5]);
    doc.undo();
    const all = doc.transaction("gaps", (tx) => closeAllGaps(tx, V1, 0));
    expect(new Set(all)).toEqual(new Set(["A", "B", "C", "T"]));
    expect(doc.project.clips.map((c) => c.position)).toEqual([0, 2, 3.5]);
    expect(doc.project.effects[0]!.position).toBe(3.5);
  });
});

describe("shiftAfter", () => {
  it("moves everything starting at or after a time, never before 0, and refuses a locked track", () => {
    const doc = docWithRun();
    const moved = doc.transaction("ripple", (tx) => shiftAfter(tx, V1, 4, 2, new Set(["B"])));
    expect(new Set(moved)).toEqual(new Set(["C", "T"]));
    expect(doc.project.clips.map((c) => c.position)).toEqual([0, 4, 9.5]);
    expect(doc.transaction("none", (tx) => shiftAfter(tx, V1, 0, 0))).toEqual([]);
    doc.transaction("back", (tx) => shiftAfter(tx, V1, 0, -20));
    expect(doc.project.clips.map((c) => c.position)).toEqual([0, 0, 0]);
    doc.transaction("lock", (tx) => setTrackLocked(tx, V1, true));
    expectRefused(doc, "locked", (tx) => shiftAfter(tx, V1, 0, 1));
  });
});

describe("plannedOverlaps", () => {
  it("reports overlaps an edit creates or grows, not the crossfades already there", () => {
    const doc = docWithRun();
    const project = doc.project;
    expect(plannedOverlaps(project, new Map([["C", { layer: V1, start: 7.5, end: 11.5 }]]), [], TOL)).toEqual([]);
    const grown = plannedOverlaps(project, new Map([["C", { layer: V1, start: 7, end: 11 }]]), [], TOL);
    expect(grown).toEqual([{ clipId: "C", title: "clip.mp4", overlapsId: "B", overlapsTitle: "clip.mp4", layer: V1, seconds: 1 }]);
    const placed = plannedOverlaps(project, new Map(), [{ label: "new", layer: V1, start: 3, end: 5 }], TOL);
    expect(placed.map((h) => [h.overlapsId, h.seconds])).toEqual([
      ["A", 1],
      ["B", 1],
    ]);
    expect(plannedOverlaps(project, new Map(), [{ label: "new", layer: V2, start: 3, end: 5 }], TOL)).toEqual([]);
  });
});

describe("transitionsBetween", () => {
  it("keeps the crossfade inside a selection and leaves a clip's own crossfade with its neighbour", () => {
    const doc = docWithRun();
    expect(transitionsBetween(doc.project, ["B", "C"], TOL).map((t) => t.id)).toEqual(["T"]);
    expect(transitionsBetween(doc.project, ["C"], TOL)).toEqual([]);
    expect(transitionsBetween(doc.project, ["A", "B"], TOL)).toEqual([]);
  });
});

describe("remapLayers", () => {
  it("lands the top source track on the destination and keeps the stacking", () => {
    const project = baseProject();
    expect(remapLayers(project, [V1, V2], V3)).toEqual(new Map([[V1, V2], [V2, V3]]));
    expect(remapLayers(project, [V2], V2)).toEqual(new Map([[V2, V2]]));
    expect(remapLayers(project, [V1, V2], V1)).toBeNull();
    expect(remapLayers(project, [V1], 7)).toBeNull();
  });
});

describe("duplicateItems", () => {
  it("copies clips and transitions with new ids to the given places", () => {
    const doc = docWithRun();
    const result = doc.transaction("copy", (tx) =>
      duplicateItems(tx, {
        clips: [
          { id: "B", position: 20, layer: V2 },
          { id: "C", position: 23.5, layer: V2 },
        ],
        transitions: [{ id: "T", position: 23.5, layer: V2 }],
      }),
    );
    expect(result.clips.map((c) => [c.of, c.copy.position, c.copy.layer])).toEqual([
      ["B", 20, V2],
      ["C", 23.5, V2],
    ]);
    expect(result.clips.every((c) => !["B", "C"].includes(c.copy.id))).toBe(true);
    const copied = doc.project.effects.find((t) => t.id === result.transitionIds[0]);
    expect([copied?.position, copied?.layer]).toEqual([23.5, V2]);
    doc.transaction("lock", (tx) => setTrackLocked(tx, V3, true));
    expectRefused(doc, "locked", (tx) => duplicateItems(tx, { clips: [{ id: "A", position: 0, layer: V3 }] }));
  });
});

describe("alignedPositions", () => {
  it("lines up starts at the earliest, ends at the latest, or both at a time", () => {
    const items = [
      { id: "a", position: 2, start: 0, end: 4 },
      { id: "b", position: 5, start: 0, end: 2 },
    ];
    expect(alignedPositions(items, false)).toEqual(new Map([["a", 2], ["b", 2]]));
    expect(alignedPositions(items, true)).toEqual(new Map([["a", 3], ["b", 5]]));
    expect(alignedPositions(items, true, 10)).toEqual(new Map([["a", 6], ["b", 8]]));
  });
});

describe("placeFiles / fitLengths", () => {
  it("places files back to back, overlapping them for a transition", () => {
    const doc = makeDoc();
    const result = doc.transaction("place", (tx) =>
      placeFiles(tx, [{ fileId: "VIDEO00001", start: 0, end: 4 }, { fileId: "VIDEO00001", start: 2, end: 6 }, { fileId: "IMAGE00001" }], 1, V1, {
        transition: "common/fade",
        transitionLength: 1,
        imageLength: 3,
        transitionFirstClip: false,
      }),
    );
    const clips = result.clipIds.map((id) => doc.project.clips.find((c) => c.id === id)!);
    expect(clips.map((c) => [c.position, c.start, c.end])).toEqual([
      [1, 0, 4],
      [4, 2, 6],
      [7, 0, 3],
    ]);
    expect(doc.project.effects.map((t) => [t.position, t.end])).toEqual([
      [4, 1],
      [7, 1],
    ]);
    expect(doc.undoLabels).toEqual(["place"]);
  });

  it("trims the longest clips to one cap, keeping fixed and short ones", () => {
    expect(fitLengths([10, 2, 8], [false, false, true], [1, 1, 1], 20, 1 / 30, TOL)).toEqual([10, 2, 8]);
    const out = fitLengths([30, 2, 8], [false, false, true], [1, 1, 1], 20, 1 / 30, TOL)!;
    expect(out[1]).toBe(2);
    expect(out[2]).toBe(8);
    expect(Math.abs(out.reduce((a, b) => a + b, 0) - 20)).toBeLessThan(1e-6);
    expect(fitLengths([10, 10], [false, false], [6, 6], 10, 1 / 30, TOL)).toBeNull();
  });
});

describe("speed and repeat queries", () => {
  it("knows a reversed, sped-up or looped clip", () => {
    const doc = makeDoc();
    doc.transaction("setup", (tx) => addClip(tx, { fileId: "VIDEO00001", position: 0, layer: V1, start: 0, end: 6, id: "A" }));
    expect(effectiveSpeed(doc.project.clips[0]!)).toEqual({ speed: 1, direction: "forward" });
    doc.transaction("2x", (tx) => applyClipPreset(tx, "A", "time.forward", { speed: 2 }));
    expect(effectiveSpeed(doc.project.clips[0]!)).toEqual({ speed: 2, direction: "forward" });
    doc.transaction("rev", (tx) => applyClipPreset(tx, "A", "time.reverse"));
    expect(timeCurveIsReversed(doc.project.clips[0]!.time)).toBe(true);
    expect(effectiveSpeed(doc.project.clips[0]!).direction).toBe("backward");
    // Reverse is a toggle: a second Reverse resets the clip.
    doc.transaction("rev again", (tx) => applyClipPreset(tx, "A", "time.reverse"));
    expect(doc.project.clips[0]!.time.Points).toHaveLength(1);
    doc.transaction("loop", (tx) => repeatClip(tx, "A", { pattern: "loop", passes: 2 }));
    expect(repeatIsActive(doc.project.clips[0]!)).toBe(true);
    expect(effectiveSpeed(doc.project.clips[0]!)).toEqual({ speed: null, direction: "looped" });
  });

  it("ignores a repeat cache the clip's in/out no longer match (a desktop undo leaves one)", () => {
    const project = baseProject();
    const doc = makeDoc(project);
    doc.transaction("setup", (tx) => addClip(tx, { fileId: "VIDEO00001", position: 0, layer: V1, start: 1, end: 3, id: "A" }));
    doc.transaction("stale", (tx) => tx.update(["clips", { id: "A" }], { repeat_cache: { start: 1, end: 3, duration: 20, properties: {} } }));
    expect(repeatIsActive(doc.project.clips[0]!)).toBe(false);
    doc.transaction("reset", (tx) => applyClipPreset(tx, "A", "time.none"));
    const clip = doc.project.clips[0]!;
    expect(clip.repeat_cache).toBeUndefined();
    expect([clip.start, clip.end]).toEqual([1, 20]);
  });
});

describe("splitTransition / separateAudio to a track", () => {
  it("cuts a transition with ripple", () => {
    const doc = docWithRun();
    doc.transaction("cut", (tx) => splitTransition(tx, "T", 7.6, "left", { ripple: true }));
    const t = doc.project.effects[0]!;
    expect(t.end).toBeCloseTo(0.1 + 1 / 30, 9);
    // Nothing after the cut on the track but C, which started before it.
    expect(doc.project.clips.find((c) => c.id === "C")!.position).toBe(7.5);
    expectRefused(doc, "invalid_argument", (tx) => splitTransition(tx, "T", 20, "both"));
  });

  it("puts a separated track of sound where it is told, without creating a track", () => {
    const project = baseProject();
    project.files.push(videoFile("VIDEO00002", { path: "/media/b.mp4" }), imageFile("IMAGE00002"));
    const doc = makeDoc(project);
    doc.transaction("setup", (tx) => addClip(tx, { fileId: "VIDEO00002", position: 0, layer: V1, start: 0, end: 4, id: "A" }));
    const tracks = doc.project.layers.length;
    const [audio] = doc.transaction("sep", (tx) => separateAudio(tx, "A", { layer: V3 }));
    expect(audio!.layer).toBe(V3);
    expect(doc.project.layers).toHaveLength(tracks);
    expectRefused(doc, "invalid_argument", (tx) => separateAudio(tx, "A", { layer: V3, perChannel: true }));
  });
});
