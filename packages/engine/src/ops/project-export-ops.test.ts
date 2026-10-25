/**
 * The ops behind the project-export tools: the reframe plan and the profile
 * switch (project.ts), pointing files at collected media (media-collect.ts)
 * and dropping stored waveform data (waveforms.ts).
 */

import { describe, expect, it } from "vitest";
import { findProfile } from "../model/profiles.js";
import { addClip } from "./clips.js";
import { applyMediaRepoint, mediaRepoint } from "./media-collect.js";
import { applyProfile, applyReframe, planReframe, profileDiffers } from "./project.js";
import { baseProject, expectUndoRedo, makeDoc } from "./testkit.js";
import { clearWaveformData } from "./waveforms.js";

const L1 = 1_000_000;

function timeline() {
  const doc = makeDoc();
  const ids = doc.transaction("setup", (tx) => ({
    video: addClip(tx, { fileId: "VIDEO00001", position: 0, layer: L1 }).id,
    audio: addClip(tx, { fileId: "AUDIO00001", position: 0, layer: 2_000_000 }).id,
    image: addClip(tx, { fileId: "IMAGE00001", position: 20, layer: L1, end: 5 }).id,
  }));
  return { doc, ...ids };
}

describe("planReframe", () => {
  it("fills or fits full-frame clips of another shape, centred; keep lists the letterboxed ones", () => {
    const { doc, video, image } = timeline();
    const fill = planReframe(doc.project, "fill", 1080, 1920);
    expect(fill.changes).toEqual([
      { id: video, scale: 0, gravity: 4 },
      { id: image, scale: 0, gravity: 4 },
    ]);
    expect(fill.videoClips).toBe(2);
    expect(planReframe(doc.project, "fit", 1080, 1920).changes).toEqual([]);
    expect(planReframe(doc.project, "keep", 1080, 1920).letterboxed).toEqual([video, image]);
    // Same shape: nothing to do.
    expect(planReframe(doc.project, "fill", 1280, 720).changes).toEqual([]);
  });

  it("skips titles, moved or scaled clips and locked tracks", () => {
    const { doc, video, image } = timeline();
    doc.transaction("pip", (tx) => tx.update(["clips", { id: video }], { location_x: { Points: [{ co: { X: 1, Y: 0.2 }, interpolation: 1 }] } }));
    doc.transaction("svg", (tx) => tx.update(["clips", { id: image }], { reader: { ...doc.project.clips.find((c) => c.id === image)!.reader, path: "/t/title.svg" } }));
    const plan = planReframe(doc.project, "fill", 1080, 1920);
    expect(plan.changes).toEqual([]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(["resized or moved (picture-in-picture) clip kept", "title (SVG) kept as designed"]);
    const locked = makeDoc(baseProject());
    const id = locked.transaction("setup", (tx) => addClip(tx, { fileId: "VIDEO00001", position: 0, layer: L1 }).id);
    locked.setUntracked(["layers", { number: L1 }, "lock"], true);
    expect(planReframe(locked.project, "fill", 1080, 1920).skipped).toEqual([{ timeline_clip_id: id, reason: "track is locked" }]);
  });

  it("switches the profile and reframes in one undoable transaction", () => {
    const { doc, video } = timeline();
    const before = doc.project;
    const profile = findProfile("FHD Vertical 1080p 30 fps")!;
    expect(profileDiffers(doc.project, profile)).toBe(true);
    doc.transaction("format", (tx) => {
      expect(applyProfile(tx, profile)).toBe(true);
      applyReframe(tx, planReframe(tx.project, "fill", profile.width, profile.height));
    });
    expect([doc.project.width, doc.project.height, doc.project.clips.find((c) => c.id === video)!.scale]).toEqual([1080, 1920, 0]);
    expect(profileDiffers(doc.project, profile)).toBe(false);
    expectUndoRedo(doc, before);
    expect(doc.transaction("again", (tx) => applyProfile(tx, profile))).toBe(false);
  });
});

describe("mediaRepoint", () => {
  it("points files and clip readers at the copies, remembering the original", () => {
    const { doc, video } = timeline();
    const moves = [{ fileId: "VIDEO00001", from: "/media/clip.mp4", to: "/p/x_assets/media/clip.mp4" }];
    const repoint = mediaRepoint(doc.project, moves, true);
    expect(repoint.files).toEqual([{ id: "VIDEO00001", path: "/p/x_assets/media/clip.mp4", original_path: "/media/clip.mp4" }]);
    expect(repoint.clips.map((c) => [c.id, c.reader.path])).toEqual([[video, "/p/x_assets/media/clip.mp4"]]);
    const before = doc.project;
    doc.transaction("collect", (tx) => applyMediaRepoint(tx, repoint));
    expectUndoRedo(doc, before);
    // Back to the original: the recorded original stays.
    const back = mediaRepoint(doc.project, [{ fileId: "", from: "/p/x_assets/media/clip.mp4", to: "/media/clip.mp4" }], false);
    expect(back.files).toEqual([{ id: "VIDEO00001", path: "/media/clip.mp4", original_path: "/media/clip.mp4" }]);
    expect(mediaRepoint(doc.project, [], true)).toEqual({ files: [], clips: [] });
  });
});

describe("clearWaveformData", () => {
  it("drops stored waveform samples from files and clips, keeping the rest of ui", () => {
    const { doc, audio } = timeline();
    doc.transaction("ui", (tx) => {
      tx.update(["files", { id: "AUDIO00001" }], { ui: { audio_data: [0.2], audio_data_rate: 20, audio_data_rms: true, other: 1 } });
      tx.update(["clips", { id: audio }], { ui: { audio_data: [0.2] } });
    });
    const before = doc.project;
    const counts = doc.transaction("clear", (tx) => clearWaveformData(tx));
    expect(counts).toEqual({ files: 1, clips: 1 });
    expect(doc.project.files.find((f) => f.id === "AUDIO00001")!.ui).toEqual({ other: 1 });
    expect(doc.project.clips.find((c) => c.id === audio)!.ui).toEqual({});
    expectUndoRedo(doc, before);
    expect(doc.transaction("again", (tx) => clearWaveformData(tx))).toEqual({ files: 0, clips: 0 });
  });
});
