import { describe, expect, it } from "vitest";
import type { Project } from "../model/types.js";
import { ProjectDocument } from "../history/document.js";
import { autoFitDuration, fitDuration, projectDuration } from "./duration.js";
import { pixelsPerSecond, snapEdges, snapTargets, snapTime, snapToleranceSeconds } from "./snap.js";

function project(): Project {
  return {
    id: "P",
    fps: { num: 30, den: 1 },
    clips: [
      { id: "A", layer: 1, position: 0, start: 0, end: 5 },
      { id: "B", layer: 1, position: 8, start: 1, end: 3 },
    ],
    effects: [{ id: "T", layer: 1, position: 4, start: 0, end: 1, type: "Mask", class_name: "Mask" }],
    markers: [{ id: "M", position: 12 }],
    layers: [{ id: "L1", number: 1, label: "", y: 0, lock: false }],
    files: [],
    duration: 300,
    scale: 15,
    tick_pixels: 100,
    history: { undo: [], redo: [] },
  } as unknown as Project;
}

describe("snapping", () => {
  it("collects edges, markers, timeline bounds and the playhead", () => {
    const targets = snapTargets(project(), { ignoreIds: ["B"], playhead: 7 });
    const kinds = targets.map((t) => `${t.kind}@${t.seconds}`);
    expect(kinds).toContain("clip-start@0");
    expect(kinds).toContain("clip-end@5");
    expect(kinds).not.toContain("clip-start@8");
    expect(kinds).toContain("transition-end@5");
    expect(kinds).toContain("marker@12");
    expect(kinds).toContain("timeline-end@300");
    expect(kinds).toContain("playhead@7");
  });

  it("uses a 12 px tolerance at the project zoom", () => {
    const p = project();
    expect(pixelsPerSecond(p)).toBeCloseTo(100 / 15, 10);
    expect(snapToleranceSeconds(pixelsPerSecond(p))).toBeCloseTo(1.8, 10);
  });

  it("snaps the nearest edge within tolerance", () => {
    const targets = snapTargets(project(), { ignoreIds: ["B"] });
    // Dragging B (8..10): left 8 is 3 s from 5, right 10 is 2 s from the marker at 12.
    expect(snapEdges([8, 10], targets, 1).target).toBeNull();
    const r = snapEdges([5.4, 7.4], targets, 1);
    expect(r.delta).toBeCloseTo(-0.4, 10);
    expect(r.edge).toBe(0);
    expect(snapTime(11.7, targets, 0.5)).toBe(12);
    expect(snapTime(11.7, targets, 0.1)).toBe(11.7);
  });

  it("keyframe targets use their own tolerance", () => {
    const targets = snapTargets(project(), { keyframes: [20], keyframeTolerance: 0.05 });
    expect(snapTime(20.2, targets, 1)).toBe(20.2);
    expect(snapTime(20.04, targets, 1)).toBe(20);
  });
});

describe("project duration", () => {
  it("grows to fit items (min 300 s, +10 s padding), never shrinks", () => {
    const p = project();
    expect(projectDuration(p)).toBe(300);
    const long = { ...p, clips: [...p.clips, { ...p.clips[0]!, id: "Z", position: 400 }] } as Project;
    expect(projectDuration(long)).toBe(415);
    expect(projectDuration({ ...long, duration: 900 } as Project)).toBe(900);
  });

  it("fits untracked, so undo history is untouched", () => {
    const doc = new ProjectDocument(project());
    autoFitDuration(doc);
    doc.transaction("move", (tx) => tx.update(["clips", { id: "A" }], { position: 500 }));
    expect(doc.project.duration).toBe(515);
    expect(doc.undoLabels).toEqual(["move"]);
    doc.undo();
    // The desktop never shrinks the duration after an undo either.
    expect(doc.project.duration).toBe(515);
    expect(fitDuration(doc)).toBe(false);
  });
});
