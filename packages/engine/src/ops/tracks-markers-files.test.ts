import { describe, expect, it } from "vitest";
import { addTrack, removeTrack, renameTrack, setTrackLocked, trackDisplayName } from "./tracks.js";
import { addMarker, moveMarker, removeMarker } from "./markers.js";
import { addFile, detectMediaType, removeFile, updateFile } from "./files.js";
import { addClip } from "./clips.js";
import { expectRefused, expectUndoRedo, makeDoc, reader } from "./testkit.js";

const numbers = (doc: ReturnType<typeof makeDoc>) => doc.project.layers.map((l) => l.number).sort((a, b) => a - b);

describe("tracks (main_window.py add/remove/rename/lock)", () => {
  it("adds on top with the next 1,000,000 step", () => {
    const doc = makeDoc();
    const before = doc.project;
    const t = doc.transaction("add", (tx) => addTrack(tx, { label: "Music" }));
    expect(t).toMatchObject({ number: 6_000_000, label: "Music", lock: false, y: 0 });
    expect(t.id).toHaveLength(10);
    expectUndoRedo(doc, before);
  });

  it("inserts above/below at the gap midpoint", () => {
    const doc = makeDoc();
    expect(doc.transaction("a", (tx) => addTrack(tx, { above: 1_000_000 })).number).toBe(1_500_000);
    expect(doc.transaction("b", (tx) => addTrack(tx, { below: 1_000_000 })).number).toBe(500_000);
    expect(doc.transaction("c", (tx) => addTrack(tx, { above: 5_000_000 })).number).toBe(6_000_000);
  });

  it("renumbers every track (and its items) when the gap is too small, in one undo step", () => {
    const doc = makeDoc();
    doc.transaction("tight", (tx) => {
      tx.update(["layers", { id: "L2" }], { number: 1_000_002 });
    });
    doc.transaction("clip", (tx) => addClip(tx, { fileId: "VIDEO00001", position: 0, layer: 1_000_002, id: "C2" }));
    const before = doc.project;
    const t = doc.transaction("insert", (tx) => addTrack(tx, { above: 1_000_000 }));
    expect(t.number).toBe(2_000_000);
    expect(numbers(doc)).toEqual([1_000_000, 2_000_000, 3_000_000, 4_000_000, 5_000_000, 6_000_000]);
    // The clip followed its track (old L2 is now 3,000,000).
    expect(doc.project.clips[0]!.layer).toBe(3_000_000);
    expect(doc.undoLabels.at(-1)).toBe("insert");
    expectUndoRedo(doc, before);
  });

  it("removes a track with its clips and transitions; keeps at least one", () => {
    const doc = makeDoc();
    doc.transaction("clip", (tx) => addClip(tx, { fileId: "VIDEO00001", position: 0, layer: 2_000_000, id: "C" }));
    const r = doc.transaction("rm", (tx) => removeTrack(tx, 2_000_000));
    expect(r.removedClipIds).toEqual(["C"]);
    expect(numbers(doc)).toEqual([1_000_000, 3_000_000, 4_000_000, 5_000_000]);
    for (const n of [1_000_000, 3_000_000, 4_000_000]) doc.transaction("rm", (tx) => removeTrack(tx, n));
    expectRefused(doc, "conflict", (tx) => removeTrack(tx, 5_000_000));
    expectRefused(doc, "not_found", (tx) => removeTrack(tx, 42));
  });

  it("renames and locks; no-op edits record nothing", () => {
    const doc = makeDoc();
    doc.transaction("r", (tx) => renameTrack(tx, 1_000_000, "Voice"));
    expect(trackDisplayName(doc.project, 1_000_000)).toBe("Voice");
    expect(trackDisplayName(doc.project, 2_000_000)).toBe("Track 2");
    doc.transaction("l", (tx) => setTrackLocked(tx, 1_000_000, true));
    expect(doc.project.layers.find((l) => l.number === 1_000_000)!.lock).toBe(true);
    const labels = doc.undoLabels.length;
    doc.transaction("same", (tx) => setTrackLocked(tx, 1_000_000, true));
    doc.transaction("same2", (tx) => renameTrack(tx, 1_000_000, "Voice"));
    expect(doc.undoLabels.length).toBe(labels);
    expectRefused(doc, "invalid_argument", (tx) => setTrackLocked(tx, 1_000_000, "yes" as never));
  });
});

describe("markers", () => {
  it("adds (desktop icon/vector), moves and removes", () => {
    const doc = makeDoc();
    const before = doc.project;
    const m = doc.transaction("add", (tx) => addMarker(tx, 2.5, "Beat"));
    expect(m).toMatchObject({ position: 2.5, icon: "blue.png", vector: "blue", label: "Beat" });
    expectUndoRedo(doc, before);
    doc.transaction("move", (tx) => moveMarker(tx, m.id, 4));
    expect(doc.project.markers[0]!.position).toBe(4);
    doc.transaction("rm", (tx) => removeMarker(tx, m.id));
    expect(doc.project.markers).toEqual([]);
    expectRefused(doc, "invalid_argument", (tx) => addMarker(tx, -1));
    expectRefused(doc, "not_found", (tx) => removeMarker(tx, "NOPE"));
  });
});

describe("files (files_model.py add_files)", () => {
  it("adds with the importer's media type; dedupes by path", () => {
    const doc = makeDoc();
    const before = doc.project;
    const f = doc.transaction("import", (tx) =>
      addFile(tx, { path: "/media/new.mov", info: reader({ path: "/media/new.mov" }), name: "Interview" }),
    );
    expect(f).toMatchObject({ path: "/media/new.mov", media_type: "video", name: "Interview" });
    expectUndoRedo(doc, before);
    const again = doc.transaction("again", (tx) => addFile(tx, { path: "/media/new.mov", info: reader() }));
    expect(again.id).toBe(f.id);
    expect(doc.undoLabels.at(-1)).toBe("import");
  });

  it("audio-only media loses has_video and takes the project size", () => {
    const doc = makeDoc();
    const f = doc.transaction("import", (tx) =>
      addFile(tx, { path: "/media/cover.mp3", info: reader({ path: "/media/cover.mp3", width: 720, height: 480 }) }),
    );
    expect(f).toMatchObject({ media_type: "audio", has_video: false, width: 1280, height: 720 });
  });

  it("uses the original name for extension-less paths", () => {
    expect(detectMediaType({ path: "opfs:abc", info: reader(), name: "still.png" })).toBe("image");
  });

  it("removes a file and its clips; updates fields", () => {
    const doc = makeDoc();
    doc.transaction("clip", (tx) => addClip(tx, { fileId: "VIDEO00001", position: 0, layer: 1_000_000, id: "C" }));
    expectRefused(doc, "conflict", (tx) => removeFile(tx, "VIDEO00001", { removeClips: false }));
    const r = doc.transaction("rm", (tx) => removeFile(tx, "VIDEO00001"));
    expect(r.removedClipIds).toEqual(["C"]);
    expect(doc.project.clips).toEqual([]);
    const u = doc.transaction("name", (tx) => updateFile(tx, "AUDIO00001", { name: "Song" }));
    expect(u.name).toBe("Song");
    expectRefused(doc, "invalid_argument", (tx) => updateFile(tx, "AUDIO00001", { id: "X" }));
    expectRefused(doc, "not_found", (tx) => updateFile(tx, "NOPE", { name: "x" }));
  });
});
