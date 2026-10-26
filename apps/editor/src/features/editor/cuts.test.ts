import { addClip, addFile, createProject, findProfile, ProjectDocument, type ReaderInfo } from "@zenvi/engine";
import { describe, expect, it } from "vitest";
import { targetCut, tinyGapTrack } from "./cuts";

const video: ReaderInfo = {
  type: "FFmpegReader",
  path: "media/x/clip.webm",
  has_video: true,
  has_audio: false,
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

/** Three 2 s clips back to back (cuts at 2 s and 4 s) and a lone clip on the next track. */
function project() {
  const doc = new ProjectDocument(createProject({ profile: findProfile("HD 1080p 30 fps")! }));
  const ids = doc.transaction("Add", (tx) => {
    const file = addFile(tx, { path: video.path, info: video, name: "clip.webm" });
    const [l1, l2] = tx.project.layers.map((l) => l.number);
    const seq = [0, 2, 4].map((p) => addClip(tx, { fileId: file.id, position: p, start: 0, end: 2, layer: l1! }).id);
    const lone = addClip(tx, { fileId: file.id, position: 10, start: 0, end: 2, layer: l2! }).id;
    return { seq, lone };
  });
  return { p: doc.project, ...ids };
}

describe("targetCut", () => {
  it("takes the cut between two selected clips that meet", () => {
    const { p, seq } = project();
    expect(targetCut(p, [seq[2]!, seq[1]!], 0)).toMatchObject({ outClip: { id: seq[1] }, inClip: { id: seq[2] } });
  });

  it("takes the cut after one selected clip, else the one before it", () => {
    const { p, seq } = project();
    expect(targetCut(p, [seq[0]!], 9)?.inClip.id).toBe(seq[1]);
    expect(targetCut(p, [seq[2]!], 0)?.outClip.id).toBe(seq[1]);
  });

  it("falls back to the cut nearest the playhead", () => {
    const { p, lone } = project();
    expect(targetCut(p, [lone], 3.9)?.cut).toBeCloseTo(4, 1);
    expect(targetCut(p, [], 0.5)?.cut).toBeCloseTo(2, 1);
  });
});

describe("tinyGapTrack", () => {
  /** 2 s clips on the bottom track, `gaps[i]` seconds after clip i. */
  function spaced(gaps: number[]) {
    const doc = new ProjectDocument(createProject({ profile: findProfile("HD 1080p 30 fps")! }));
    doc.transaction("Add", (tx) => {
      const file = addFile(tx, { path: video.path, info: video, name: "clip.webm" });
      let at = 1;
      for (const gap of [...gaps, 0]) {
        addClip(tx, { fileId: file.id, position: at, start: 0, end: 2, layer: tx.project.layers[0]!.number });
        at += 2 + gap;
      }
    });
    return doc.project;
  }

  it("finds a sequence split only by one-frame gaps, closing from just after its start", () => {
    const p = spaced([1 / 30, 1 / 30]);
    expect(tinyGapTrack(p)).toEqual({ layer: p.layers[0]!.number, gaps: 2, from: 1 + 0.5 / 30 });
  });

  it("leaves a track with a deliberate gap alone", () => {
    expect(tinyGapTrack(spaced([1 / 30, 1]))).toBeNull();
  });

  it("has nothing to close when the clips already touch", () => {
    expect(tinyGapTrack(spaced([0, 0]))).toBeNull();
  });
});
