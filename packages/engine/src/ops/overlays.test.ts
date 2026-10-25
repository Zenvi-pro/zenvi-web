import { describe, expect, it } from "vitest";
import { toStoredPaths } from "../io/paths.js";
import type { Effect } from "../model/types.js";
import { addClip } from "./clips.js";
import { addFile } from "./files.js";
import { placeOverlayClip, replaceClipEffects, useFileForClip } from "./overlays.js";
import { setTrackLocked } from "./tracks.js";
import { expectRefused, imageFile, makeDoc } from "./testkit.js";

const image = { path: "/media/title.svg", info: { ...imageFile(), path: "/media/title.svg" }, name: "title.svg" };

describe("placeOverlayClip", () => {
  it("places a file with its look set, creating a labelled track, as one edit", () => {
    const doc = makeDoc();
    const clip = doc.transaction("Add title", (tx) => {
      const file = addFile(tx, image, { mediaType: "image" });
      return placeOverlayClip(tx, {
        fileId: file.id,
        position: 2.01,
        duration: 3,
        layer: 6_000_000,
        newTrackLabel: "Titles",
        title: "Timer",
        props: { gravity: 2, zenvi_role: "timer", alpha: { Points: [{ co: { X: 1, Y: 0.5 }, interpolation: 0 }] } },
      });
    });
    expect(clip).toMatchObject({ position: 2, start: 0, end: 3, layer: 6_000_000, title: "Timer", gravity: 2, zenvi_role: "timer" });
    expect(doc.project.layers.find((l) => l.number === 6_000_000)?.label).toBe("Titles");
    expect(doc.undoLabels).toEqual(["Add title"]);
    doc.undo();
    expect(doc.project.clips).toEqual([]);
    expect(doc.project.layers.some((l) => l.number === 6_000_000)).toBe(false);
  });

  it("copies shared keyframes so the project stays a JSON tree", () => {
    const doc = makeDoc();
    const scale = { Points: [{ co: { X: 1, Y: 0.5 }, interpolation: 0 }] };
    const clip = doc.transaction("Add", (tx) => placeOverlayClip(tx, { fileId: "IMAGE00001", position: 0, duration: 1, layer: 1_000_000, props: { scale_x: scale, scale_y: scale } }));
    expect(clip.scale_x).toEqual(clip.scale_y);
    expect(clip.scale_x).not.toBe(clip.scale_y);
    expect(() => toStoredPaths(doc.project, "/projects")).not.toThrow();
  });

  it("refuses placement keys in props, locked tracks and missing files before recording", () => {
    const doc = makeDoc();
    expectRefused(doc, "invalid_argument", (tx) => placeOverlayClip(tx, { fileId: "IMAGE00001", position: 0, duration: 1, layer: 1_000_000, props: { layer: 2 } }));
    expectRefused(doc, "not_found", (tx) => placeOverlayClip(tx, { fileId: "NOPE", position: 0, duration: 1, layer: 1_000_000 }));
    expectRefused(doc, "invalid_argument", (tx) => placeOverlayClip(tx, { fileId: "IMAGE00001", position: 0, duration: 0, layer: 1_000_000 }));
    doc.transaction("lock", (tx) => setTrackLocked(tx, 1_000_000, true));
    expectRefused(doc, "locked", (tx) => placeOverlayClip(tx, { fileId: "IMAGE00001", position: 0, duration: 1, layer: 1_000_000 }));
  });
});

describe("replaceClipEffects", () => {
  it("replaces the effect list and records nothing when it is the same", () => {
    const doc = makeDoc();
    const id = doc.transaction("add", (tx) => addClip(tx, { fileId: "VIDEO00001", position: 0, layer: 1_000_000 }).id);
    const effect = { id: "EFFECT0001", class_name: "Caption", type: "Caption", caption_text: "" } as Effect;
    doc.transaction("captions", (tx) => replaceClipEffects(tx, id, [effect]));
    expect(doc.project.clips[0]!.effects).toEqual([effect]);
    doc.transaction("same", (tx) => replaceClipEffects(tx, id, [effect]));
    expect(doc.undoLabels).toEqual(["add", "captions"]);
    expectRefused(doc, "invalid_argument", (tx) => replaceClipEffects(tx, id, [{ class_name: "Blur" } as unknown as Effect]));
  });
});

describe("useFileForClip", () => {
  it("makes a clip play another file, its reader following", () => {
    const doc = makeDoc();
    const id = doc.transaction("add", (tx) => addClip(tx, { fileId: "VIDEO00001", position: 0, layer: 1_000_000 }).id);
    doc.transaction("swap", (tx) => useFileForClip(tx, id, "IMAGE00001"));
    expect(doc.project.clips[0]).toMatchObject({ file_id: "IMAGE00001", reader: { path: "/media/photo.png", id: "IMAGE00001" } });
    expectRefused(doc, "not_found", (tx) => useFileForClip(tx, id, "NOPE"));
  });
});
