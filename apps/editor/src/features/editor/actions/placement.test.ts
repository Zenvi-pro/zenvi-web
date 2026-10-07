// @vitest-environment node
import { addClip, addFile, createProject, findProfile, ProjectDocument, type ReaderInfo } from "@zenvi/engine";
import { describe, expect, it } from "vitest";
import { desktopPlacement, freeTrack, overlayTrack, placeAtDefaults } from "./placement";

const base: ReaderInfo = {
  type: "FFmpegReader",
  path: "x",
  has_video: true,
  has_audio: true,
  has_single_image: false,
  duration: 4,
  width: 640,
  height: 360,
  fps: { num: 30, den: 1 },
  video_length: 120,
  pixel_ratio: { num: 1, den: 1 },
  display_ratio: { num: 16, den: 9 },
  sample_rate: 48000,
  channels: 2,
  channel_layout: 3,
};

function setup() {
  const doc = new ProjectDocument(createProject({ profile: findProfile("HD 1080p 30 fps")! }));
  const files = doc.transaction("files", (tx) => ({
    video: addFile(tx, { path: "media/a/video.webm", info: base, name: "video.webm" }),
    music: addFile(tx, { path: "media/b/music.ogg", info: { ...base, has_video: false, width: 0, height: 0, media_type: "audio" }, name: "music.ogg" }),
  }));
  return { doc, ...files };
}

describe("desktop add-to-timeline defaults (tool_handlers _do_add)", () => {
  it("puts video on the bottom track, after the last clip plus one frame", () => {
    const { doc, video } = setup();
    const bottom = Math.min(...doc.project.layers.map((l) => l.number));
    expect(desktopPlacement(doc.project, video, null)).toEqual({ layer: bottom, position: 0 });
    doc.transaction("add", (tx) => addClip(tx, { fileId: video.id, position: 0, layer: bottom }));
    expect(desktopPlacement(doc.project, video, null)).toEqual({ layer: bottom, position: 4 + 1 / 30 });
  });

  it("uses the selected clip's track for video", () => {
    const { doc, video } = setup();
    const top = Math.max(...doc.project.layers.map((l) => l.number));
    expect(desktopPlacement(doc.project, video, top)?.layer).toBe(top);
  });

  it("puts audio-only files on the bottom track at 0 s, whatever is selected", () => {
    const { doc, music } = setup();
    const bottom = Math.min(...doc.project.layers.map((l) => l.number));
    const top = Math.max(...doc.project.layers.map((l) => l.number));
    expect(desktopPlacement(doc.project, music, top)).toEqual({ layer: bottom, position: 0 });
  });

  it("places several files in one transaction", () => {
    const { doc, video, music } = setup();
    const clips = doc.transaction("place", (tx) => placeAtDefaults(tx, [video, video, music], null));
    expect(clips.map((c) => c.position)).toEqual([0, 4 + 1 / 30, 0]);
    expect(doc.undoLabels).toEqual(["files", "place"]);
  });
});

describe("the Add-to-timeline gesture never stacks clips", () => {
  it("puts music under the video when the video's track is the bottom one (adding a track, one undo step)", () => {
    const { doc, video, music } = setup();
    const layers = doc.project.layers.length;
    const [clipA] = doc.transaction("video", (tx) => placeAtDefaults(tx, [video], null));
    const [bed] = doc.transaction("music", (tx) => placeAtDefaults(tx, [music], null));
    expect(bed!.position).toBe(0);
    // No track below the video was free, so the gesture added one under it.
    expect(bed!.layer).not.toBe(clipA!.layer);
    const picture = doc.project.clips.find((c) => c.id === clipA!.id)!;
    expect(bed!.layer).toBeLessThan(picture.layer);
    expect(doc.project.layers.length).toBe(layers + 1);
    expect(doc.undoLabels.at(-1)).toBe("music");
    doc.undo();
    expect(doc.project.layers.length).toBe(layers);
    expect(doc.project.clips).toHaveLength(1);
  });

  it("takes the lowest free track and prefers tracks below the picture for audio", () => {
    const { doc, video } = setup();
    const sorted = [...doc.project.layers].sort((a, b) => a.number - b.number).map((l) => l.number);
    doc.transaction("mid", (tx) => addClip(tx, { fileId: video.id, position: 0, layer: sorted[1]! }));
    expect(freeTrack(doc.project, sorted[1]!, 0, 2, true)).toBe(sorted[0]);
    // Nothing free below the picture: no track (the gesture adds one at the bottom).
    doc.transaction("low", (tx) => addClip(tx, { fileId: video.id, position: 0, layer: sorted[0]! }));
    expect(freeTrack(doc.project, sorted[0]!, 0, 2, true)).toBeNull();
    expect(freeTrack(doc.project, sorted[1]!, 0, 2, false)).toBe(sorted[2]);
    expect(freeTrack(doc.project, sorted[1]!, 10, 12, false)).toBe(sorted[1]);
  });
});

describe("titles go over the picture", () => {
  it("uses the lowest free track above what plays, adding one on top when needed", () => {
    const { doc, video } = setup();
    const sorted = [...doc.project.layers].sort((a, b) => a.number - b.number).map((l) => l.number);
    doc.transaction("v", (tx) => addClip(tx, { fileId: video.id, position: 0, layer: sorted[1]! }));
    expect(doc.transaction("t", (tx) => overlayTrack(tx, 1, 3))).toBe(sorted[2]);
    const top = sorted[sorted.length - 1]!;
    doc.transaction("top", (tx) => addClip(tx, { fileId: video.id, position: 0, layer: top }));
    const layers = doc.project.layers.length;
    const added = doc.transaction("t2", (tx) => overlayTrack(tx, 1, 3));
    expect(added).toBeGreaterThan(top);
    expect(doc.project.layers.length).toBe(layers + 1);
  });
});
