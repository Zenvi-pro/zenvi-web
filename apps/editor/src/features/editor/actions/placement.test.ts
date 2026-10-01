// @vitest-environment node
import { addClip, addFile, createProject, findProfile, ProjectDocument, type ReaderInfo } from "@zenvi/engine";
import { describe, expect, it } from "vitest";
import { desktopPlacement, placeAtDefaults } from "./placement";

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
    expect(doc.undoLabels.at(-1)).toBe("place");
  });
});
