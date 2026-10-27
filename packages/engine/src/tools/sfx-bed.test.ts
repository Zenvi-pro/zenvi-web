import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../history/document.js";
import { createProject } from "../model/defaults.js";
import type { Clip } from "../model/types.js";
import { addClip, setClipKeyframes } from "../ops/clips.js";
import { addFile } from "../ops/files.js";
import { applyBedDips, readBedMark, restoreBed, withoutBedDips } from "./sfx-bed.js";
import { curvePoints, evaluateVolumeCurve } from "./audio-mix.js";
import { audioInfo, media } from "./test-support/fixture.js";

/** A 10 s music clip at 0 s (source frame = timeline frame + 1 at 30 fps). */
function bedProject(): ProjectDocument {
  const doc = new ProjectDocument(createProject({ id: "BEDPROJ001" }));
  doc.transaction("fixture", (tx) => {
    addFile(tx, media("/media/song.mp3", audioInfo("/media/song.mp3", 10)), { id: "SONGXXXXXX" });
    addClip(tx, { fileId: "SONGXXXXXX", position: 0, layer: tx.project.layers[0]!.number, start: 0, end: 10, id: "MUSICCLIP1" });
  });
  return doc;
}

const bed = (doc: ProjectDocument): Clip => doc.project.clips.find((c) => c.id === "MUSICCLIP1")!;
const gainAt = (doc: ProjectDocument, frame: number) => evaluateVolumeCurve(curvePoints(bed(doc)), frame, 1);
const db = (x: number) => 20 * Math.log10(x);

describe("applyBedDips", () => {
  it("holds the deeper of two overlapping dips instead of popping back up between them", () => {
    const doc = bedProject();
    const fps = doc.project.fps;
    // A hero's room dip (2.0-2.25 s, -4 dB) running into the next hero's pre-hit duck (2.18-2.30 s, -10 dB).
    doc.transaction("dips", (tx) => {
      applyBedDips(tx, "MUSICCLIP1", [
        { from: 2, to: 2.25, db: -4, reason: "room" },
        { from: 2.18, to: 2.3, db: -10, reason: "pre-hit" },
      ], fps);
    });
    // Frames 61..67 are the room dip, 66..69 the duck: never back at full volume in between.
    for (let frame = 61; frame <= 69; frame += 1) expect(gainAt(doc, frame)).toBeLessThan(0.7);
    expect(db(gainAt(doc, 63))).toBeCloseTo(-4, 1);
    expect(db(gainAt(doc, 68))).toBeCloseTo(-10, 1);
    expect(gainAt(doc, 60)).toBeCloseTo(1, 6);
    expect(gainAt(doc, 70)).toBeCloseTo(1, 6);
  });

  it("brings the curve's own points inside a dip down with it, and puts the curve back exactly", () => {
    const doc = bedProject();
    const fps = doc.project.fps;
    doc.transaction("fade", (tx) => {
      setClipKeyframes(tx, "MUSICCLIP1", "volume", [{ frame: 1, value: 1 }, { frame: 91, value: 0.5 }, { frame: 300, value: 0.5 }], { mode: "replace" });
    });
    const before = structuredClone(bed(doc).volume);
    doc.transaction("dip", (tx) => {
      applyBedDips(tx, "MUSICCLIP1", [{ from: 2.8, to: 3.4, db: -18, reason: "suck-out before the drop" }], fps);
    });
    // Frame 91 (3.0 s) is a point of the curve inside the window: dipped too.
    expect(db(gainAt(doc, 91) / 0.5)).toBeCloseTo(-18, 1);
    expect(gainAt(doc, 200)).toBeCloseTo(0.5, 6);
    doc.transaction("restore", (tx) => {
      expect(restoreBed(tx, bed(doc))).toBe("restored");
    });
    expect(bed(doc).volume).toEqual(before);
    expect(readBedMark(bed(doc))).toBeNull();
  });

  it("measures a rerun against the bed without the last run's dips, and leaves an edited curve as it is", () => {
    const doc = bedProject();
    const before = structuredClone(bed(doc).volume);
    doc.transaction("dip", (tx) => {
      applyBedDips(tx, "MUSICCLIP1", [{ from: 1, to: 1.5, db: -10, reason: "room" }], doc.project.fps);
    });
    const dipped = doc.project;
    expect(withoutBedDips(dipped).clips.find((c) => c.id === "MUSICCLIP1")!.volume).toEqual(before);
    // The project itself is untouched.
    expect(bed(doc).volume).not.toEqual(before);
    doc.transaction("edit", (tx) => {
      setClipKeyframes(tx, "MUSICCLIP1", "volume", [{ frame: 1, value: 0.3 }], { mode: "replace" });
    });
    expect(withoutBedDips(doc.project).clips.find((c) => c.id === "MUSICCLIP1")!.volume).toEqual(bed(doc).volume);
  });
});
