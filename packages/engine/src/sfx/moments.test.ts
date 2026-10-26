import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../history/document.js";
import { createProject } from "../model/defaults.js";
import { addClip, moveClip } from "../ops/clips.js";
import { addFile } from "../ops/files.js";
import { applyMotionTransition } from "../ops/motion-transitions.js";
import { addTrack } from "../ops/tracks.js";
import { imageInfo, media, videoInfo } from "../tools/test-support/fixture.js";
import { soundMoments } from "./moments.js";

/** A-roll on the bottom track, plus whatever `build` adds on the tracks above. */
function edit(build: (tx: Parameters<Parameters<ProjectDocument["transaction"]>[1]>[0], top: number) => void): ProjectDocument {
  const doc = new ProjectDocument(createProject({ id: "MOMENTS001" }));
  doc.transaction("fixture", (tx) => {
    for (const name of ["a", "b", "c"]) addFile(tx, media(`/m/${name}.mp4`, videoInfo(`/m/${name}.mp4`, 30)), { id: `FILE${name.toUpperCase()}XXXXX` });
    addFile(tx, media("/m/reel-flash.svg", imageInfo("/m/reel-flash.svg")), { id: "FLASHXXXXX" });
    addFile(tx, media("/m/title.svg", imageInfo("/m/title.svg")), { id: "TITLEXXXXX" });
    const bottom = Math.min(...tx.project.layers.map((l) => l.number));
    const top = addTrack(tx, {}).number;
    addClip(tx, { fileId: "FILEAXXXXX", position: 0, layer: bottom, start: 0, end: 10 });
    build(tx, top);
  });
  return doc;
}

const times = (doc: ProjectDocument, kind: string) => soundMoments(doc.project).filter((m) => m.kind === kind).map((m) => Math.round(m.time * 100) / 100);

describe("soundMoments", () => {
  it("finds the cut into a B-roll insert and the cut back to the A-roll", () => {
    const doc = edit((tx, top) => addClip(tx, { fileId: "FILEBXXXXX", position: 3, layer: top, start: 0, end: 2 }));
    expect(times(doc, "cut")).toEqual([3, 5]);
    const back = soundMoments(doc.project).find((m) => m.time === 5)!;
    expect(back.before).toBeCloseTo(2, 6);
  });

  it("ignores a cut hidden under a shot covering it", () => {
    const doc = edit((tx, top) => {
      addClip(tx, { fileId: "FILEBXXXXX", position: 0, layer: top, start: 0, end: 4 });
      addClip(tx, { fileId: "FILECXXXXX", position: 4, layer: top, start: 0, end: 6 });
    });
    // Only the top track's cut shows; the A-roll underneath never changes on screen.
    expect(times(doc, "cut")).toEqual([4]);
  });

  it("tells flashes and titles from shots, and enters a many-element title once", () => {
    const doc = edit((tx, top) => {
      addClip(tx, { fileId: "FLASHXXXXX", position: 2, layer: top, start: 0, end: 0.1 });
      const above = addTrack(tx, {}).number;
      addClip(tx, { fileId: "TITLEXXXXX", position: 6, layer: above, start: 0, end: 2 });
      addClip(tx, { fileId: "TITLEXXXXX", position: 6.1, layer: above + 1, start: 0, end: 2 });
    });
    expect(times(doc, "flash")).toEqual([2]);
    expect(times(doc, "title")).toEqual([6]);
    expect(times(doc, "cut")).toEqual([]);
  });

  it("hears a whip as a move through its cut, and a glitch as a cut", () => {
    const doc = edit((tx, top) => {
      const a = addClip(tx, { fileId: "FILEBXXXXX", position: 0, layer: top, start: 0, end: 3 });
      const b = addClip(tx, { fileId: "FILECXXXXX", position: 3, layer: top, start: 0, end: 3 });
      const c = addClip(tx, { fileId: "FILEBXXXXX", position: 6, layer: top, start: 5, end: 8 });
      applyMotionTransition(tx, { outClipId: a.id, inClipId: b.id, preset: "whip", frames: 8 });
      applyMotionTransition(tx, { outClipId: b.id, inClipId: c.id, preset: "glitch", frames: 6 });
    });
    expect(times(doc, "transition")).toEqual([3]);
    // 9: the insert ends on the A-roll.
    expect(times(doc, "cut")).toEqual([6, 9]);
  });

  it("hears a whip where its cut is now, after the clips moved", () => {
    const doc = edit((tx, top) => {
      const a = addClip(tx, { fileId: "FILEBXXXXX", position: 0, layer: top, start: 0, end: 3 });
      const b = addClip(tx, { fileId: "FILECXXXXX", position: 3, layer: top, start: 0, end: 3 });
      applyMotionTransition(tx, { outClipId: a.id, inClipId: b.id, preset: "whip", frames: 8 });
      moveClip(tx, b.id, { position: 5 });
      moveClip(tx, a.id, { position: 2 });
    });
    expect(times(doc, "transition")).toEqual([5]);
    // In and out of the pair over the A-roll; the whip's cut is not a cut too.
    expect(times(doc, "cut")).toEqual([2, 8]);
  });
});
