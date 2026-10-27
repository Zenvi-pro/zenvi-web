import { describe, expect, it } from "vitest";
import { ProjectDocument, type Transaction } from "../history/document.js";
import { openshotPoint } from "../keyframe/edit.js";
import { createProject } from "../model/defaults.js";
import { Interpolation, type Clip } from "../model/types.js";
import { addClip } from "../ops/clips.js";
import { addFile, updateFile } from "../ops/files.js";
import { media, videoInfo } from "../tools/test-support/fixture.js";
import { KINETIC_CAPTIONS_KEY } from "./moments.js";
import { spotHitPoints } from "./spot.js";

/** A project at 30 fps with shots AA/BB (10 s each) in the bin; `build` places clips. */
function project(build: (tx: Transaction, layer: number) => void): ProjectDocument {
  const doc = new ProjectDocument(createProject({ id: "SPOTPROJ01" }));
  doc.transaction("fixture", (tx) => {
    for (const name of ["aa", "bb"]) addFile(tx, media(`/media/${name}.mp4`, videoInfo(`/media/${name}.mp4`, 10)), { id: `SHOT${name.toUpperCase()}XXXX` });
    build(tx, tx.project.layers.map((l) => l.number).sort((a, b) => b - a)[0]!);
  });
  return doc;
}

const shot = (i: number) => (i % 2 === 0 ? "SHOTAAXXXX" : "SHOTBBXXXX");

describe("spotHitPoints", () => {
  it("makes a flash run one hit point: its first and last cut, an accent every third, the rest dry", () => {
    // Two 1 s shots, then eight 0.1 s shots (a flash run), then a 2 s shot.
    const doc = project((tx, layer) => {
      const lengths = [1, 1, ...Array<number>(8).fill(0.1), 2];
      let at = 0;
      lengths.forEach((len, i) => {
        addClip(tx, { fileId: shot(i), position: at, layer, start: 0, end: len });
        at += len;
      });
    });
    const points = spotHitPoints(doc.project).filter((p) => p.kind === "cut");
    const run = points.filter((p) => p.t > 1.5);
    expect(run.map((p) => p.t)).toEqual([2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8].map((t) => Math.round(t * 30) / 30));
    expect(run[0]!.needsCue).toBe(true);
    expect(run.at(-1)!.needsCue).toBe(true);
    expect(run.at(-1)!.role).toBe("hero");
    expect(run[3]!.label).toMatch(/flash run accent/);
    expect(run.filter((p) => !p.needsCue).every((p) => p.dry === "inside a flash run")).toBe(true);
    expect(run.filter((p) => p.needsCue)).toHaveLength(4);
  });

  it("spots emphasis caption words and leaves connectors dry", () => {
    const doc = project((tx, layer) => {
      addClip(tx, { fileId: "SHOTAAXXXX", position: 0, layer: layer - 1, start: 0, end: 4 });
      ["we", "made", "MILLIONS"].forEach((word, i) => {
        const clip = addClip(tx, { fileId: "SHOTBBXXXX", position: 0.5 + i * 0.4, layer, start: 0, end: 1, title: `Captions creator g0w${i}` });
        tx.update(["clips", { id: clip.id }], { [KINETIC_CAPTIONS_KEY]: { source_clip_ids: [], style: "creator", role: "caption", said: [0.5, 1.3], word, ...(i === 2 ? { emphasis: true } : {}) } });
      });
    });
    const words = spotHitPoints(doc.project).filter((p) => p.kind === "word");
    expect(words.map((p) => [p.label, p.needsCue, p.role])).toEqual([
      ["word 'we'", false, "micro"],
      ["word 'made'", false, "micro"],
      ["word 'MILLIONS' (emphasis)", true, "slam"],
    ]);
    // Caption clips are words, not title entrances.
    expect(spotHitPoints(doc.project).some((p) => p.kind === "title")).toBe(false);
  });

  it("whooshes a keyframed fly-in at its velocity peak, panned where it is, and lands its hard stop", () => {
    const doc = project((tx, layer) => {
      addClip(tx, { fileId: "SHOTAAXXXX", position: 0, layer: layer - 1, start: 0, end: 3 });
      const clip = addClip(tx, { fileId: "SHOTBBXXXX", position: 0, layer, start: 0, end: 3 });
      // From off the left edge to the right third in 12 frames, linear: full speed until it stops dead.
      tx.update(["clips", { id: clip.id }], { location_x: { Points: [openshotPoint(31, -1, Interpolation.LINEAR), openshotPoint(43, 0.3, Interpolation.LINEAR)] } } as Partial<Clip>);
    });
    const points = spotHitPoints(doc.project);
    const move = points.find((p) => p.kind === "move")!;
    expect(move.event).toBe("whoosh");
    expect(move.needsCue).toBe(true);
    expect(move.t).toBeGreaterThan(1);
    expect(move.t).toBeLessThan(1.45);
    expect(move.lead).toBeGreaterThan(0);
    const land = points.find((p) => p.kind === "land")!;
    expect(land.t).toBeCloseTo(1.4, 1);
    expect(land.x).toBeCloseTo(0.6, 1);
  });

  it("maps motion block events onto the timeline through the clip's trim, and lands the climax on a reveal", () => {
    const doc = project((tx, layer) => {
      addClip(tx, { fileId: "SHOTAAXXXX", position: 0, layer: layer - 1, start: 0, end: 6 });
      addClip(tx, { fileId: "SHOTBBXXXX", position: 2, layer, start: 0.5, end: 4.5 });
      updateFile(tx, "SHOTBBXXXX", {
        zenvi_link: {
          kind: "zenvi-motion",
          motion: {
            block: "toggle_panel",
            events: [
              { t: 0.2, kind: "pop", weight: 0.4, x: 0.5, y: 0.5 },
              { t: 1, kind: "toggle", weight: 0.35, x: 0.75, y: 0.4 },
              { t: 3.5, kind: "reveal", weight: 0.9, x: 0.5, y: 0.5 },
              { t: 5, kind: "pop", weight: 0.4, x: 0.5, y: 0.5 },
            ],
          },
        },
      });
    });
    const points = spotHitPoints(doc.project, { climax: 5.2 });
    const block = points.filter((p) => p.kind === "block");
    // The pop before the trim and the one after the out point are not on screen.
    expect(block.map((p) => [p.t, p.event, p.role])).toEqual([
      [2.5, "toggle", "ui"],
      [5, "reveal", "hero"],
    ]);
    expect(block[0]!.x).toBeCloseTo(0.5, 6);
    // The climax snaps to the reveal 200 ms before it: no separate climax point.
    expect(points.some((p) => p.kind === "climax")).toBe(false);
    expect(block[1]!.climax).toBe(true);
    expect(block[1]!.weight).toBe(1);
  });

  it("maps block events through the clip's time curve: slowed, reversed, and never shown", () => {
    const events = [
      { t: 0.5, kind: "toggle", weight: 0.4, x: 0.5, y: 0.5 },
      { t: 1.5, kind: "click", weight: 0.4, x: 0.5, y: 0.5 },
    ];
    // 2 s on the timeline (frames 1-60) showing source frames 1-31 at half speed, or 61 down to 1 reversed.
    const ramped = (curve: [number, number][]) =>
      project((tx, layer) => {
        const clip = addClip(tx, { fileId: "SHOTBBXXXX", position: 0, layer, start: 0, end: 2 });
        tx.update(["clips", { id: clip.id }], { time: { Points: curve.map(([x, y]) => openshotPoint(x, y, Interpolation.LINEAR)) } } as Partial<Clip>);
        updateFile(tx, "SHOTBBXXXX", { zenvi_link: { kind: "zenvi-motion", motion: { block: "toggle_panel", events } } });
      });
    const blockTimes = (doc: ProjectDocument) => spotHitPoints(doc.project).filter((p) => p.kind === "block").map((p) => [p.t, p.event]);
    // Half speed: source 0.5 s (frame 16) first shows on clip frame 30 (GetLong(15.5) = 16), 29 frames in; 1.5 s is never reached.
    expect(blockTimes(ramped([[1, 1], [61, 31]]))).toEqual([[29 / 30, "toggle"]]);
    // Reversed: source 1.5 s (frame 46) shows on clip frame 16, 0.5 s in, and 0.5 s (frame 16) on frame 46.
    expect(blockTimes(ramped([[1, 61], [61, 1]]))).toEqual([
      [0.5, "click"],
      [1.5, "toggle"],
    ]);
  });

  it("gives one cue to one event, and keeps heroes 250 ms apart", () => {
    const doc = project((tx, layer) => {
      [0, 2, 2.1].forEach((at, i) => addClip(tx, { fileId: shot(i), position: at, layer, start: 0, end: i === 2 ? 2 : at === 0 ? 2 : 0.1 }));
      updateFile(tx, "SHOTBBXXXX", { zenvi_link: { kind: "zenvi-motion", motion: { block: "logo_build", events: [{ t: 0, kind: "reveal", weight: 0.9, x: 0.5, y: 0.5 }] } } });
    });
    const points = spotHitPoints(doc.project);
    const at2 = points.filter((p) => Math.abs(p.t - 2) < 0.01);
    expect(at2).toHaveLength(1);
    expect(at2[0]!.role).toBe("hero");
    expect(at2[0]!.label).toMatch(/reveal/);
    const heroes = points.filter((p) => p.role === "hero");
    for (let i = 1; i < heroes.length; i += 1) expect(heroes[i]!.t - heroes[i - 1]!.t).toBeGreaterThanOrEqual(0.25);
  });

  it("hears a cut under a cropped grid tile, and the tile's entrance", () => {
    const doc = project((tx, layer) => {
      [0, 1].forEach((at, i) => addClip(tx, { fileId: shot(i), position: at, layer: layer - 1, start: 0, end: 1 }));
      const tile = addClip(tx, { fileId: "SHOTAAXXXX", position: 0.5, layer, start: 0, end: 1.5 });
      const edge = (y: number) => ({ Points: [openshotPoint(1, y, Interpolation.LINEAR)] });
      tx.update(["clips", { id: tile.id }], { effects: [{ id: "CROP000001", class_name: "Crop", type: "Crop", left: edge(0), right: edge(0.8), top: edge(0), bottom: edge(0) }] } as Partial<Clip>);
    });
    const points = spotHitPoints(doc.project);
    expect(points.map((p) => [p.t, p.kind])).toEqual([
      [0.5, "title"],
      [1, "cut"],
    ]);
  });

  it("marks points under speech", () => {
    const doc = project((tx, layer) => [0, 1, 2].forEach((at, i) => addClip(tx, { fileId: shot(i), position: at, layer, start: 0, end: 1 })));
    const points = spotHitPoints(doc.project, { speech: [[0.8, 1.5]] });
    expect(points.map((p) => [p.t, p.speech])).toEqual([
      [1, true],
      [2, false],
    ]);
  });
});
