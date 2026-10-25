/**
 * Project Files rules (zenvi-core develop tests/test_project_files.py), on
 * folder listings instead of a real folder.
 */

import { describe, expect, it } from "vitest";
import {
  detectImageSequence,
  firstSequenceFrame,
  fpsFraction,
  relinkedFileData,
  sequenceFrameNumbers,
  sequenceFramesPresent,
  withInOutFrames,
  withSequenceFps,
} from "./project-files.js";

const names = (...list: string[]) => new Set(list);
const frames = (prefix: string, from: number, to: number, pad: number, ext = "png") =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${String(from + i).padStart(pad, "0")}.${ext}`);

describe("image sequences from a folder's names", () => {
  it("detects padded and unpadded sequences and counts their frames", () => {
    const padded = names(...frames("frame_", 1, 5, 4));
    const d = detectImageSequence("/shots/a/frame_0003.png", padded)!;
    expect(d).toEqual({
      folder_path: "/shots/a",
      base_name: "frame_",
      fixlen: true,
      digits: 4,
      extension: "png",
      pattern: "frame_%04d.png",
      path: "/shots/a/frame_%04d.png",
    });
    expect(sequenceFrameNumbers(d, padded)).toEqual([1, 2, 3, 4, 5]);
    const loose = names("img8.jpg", "img9.jpg", "img10.jpg");
    const d2 = detectImageSequence("/shots/b/img9.jpg", loose)!;
    expect([d2.pattern, d2.fixlen]).toEqual(["img%d.jpg", false]);
    expect(sequenceFrameNumbers(d2, loose)).toEqual([8, 9, 10]);
  });

  it("a lone numbered file, an unnumbered one and a video are not sequences", () => {
    const folder = names("photo_0001.png", "other.png");
    expect(detectImageSequence("/c/photo_0001.png", folder)).toBeNull();
    expect(detectImageSequence("/c/other.png", folder)).toBeNull();
    expect(detectImageSequence("/c/clip.mp4", names("clip.mp4", "clip2.mp4"))).toBeNull();
  });

  it("keeps Windows folders and numbers without a prefix", () => {
    const d = detectImageSequence("C:\\renders\\0002.tif", names("0001.tif", "0002.tif"))!;
    expect([d.folder_path, d.base_name, d.pattern, d.path]).toEqual(["C:\\renders", "", "%04d.tif", "C:\\renders\\%04d.tif"]);
  });

  it("finds the first frame of the largest set in a folder", () => {
    const folder = names("a_01.png", "a_02.png", ...frames("b_", 0, 9, 3), "logo.png");
    const found = firstSequenceFrame("/d", folder)!;
    expect(found.first).toBe("/d/b_000.png");
    expect(found.sequence.pattern).toBe("b_%03d.png");
    expect(firstSequenceFrame("/empty", names())).toBeNull();
    expect(firstSequenceFrame("/dots", names(".f_01.png", ".f_02.png"))).toBeNull();
  });

  it("tells whether a sequence's frames are still in their folder (media_missing)", () => {
    expect(sequenceFramesPresent("/s/frame_%04d.png", ["frame_0001.png", "notes.txt"])).toBe(true);
    expect(sequenceFramesPresent("/s/frame_%04d.png", ["frame_0001.jpg", "shot_0001.png"])).toBe(false);
    expect(sequenceFramesPresent("/s/%04d.png", [".0001.png"])).toBe(false);
  });
});

describe("fpsFraction", () => {
  it.each([
    [24, 24, 1],
    [23.976, 24000, 1001],
    [29.97, 30000, 1001],
    [12.5, 25, 2],
    [59.94, 60000, 1001],
    // Fraction(x).limit_denominator(1001), checked against CPython.
    [0.333, 333, 1000],
    [14.985, 2997, 200],
    [33.3333, 100, 3],
    [239.99, 23999, 100],
    [18.75, 75, 4],
  ])("%s fps is %i/%i", (value, num, den) => {
    expect(fpsFraction(value)).toEqual({ num, den });
  });

  it("refuses a rate that is not positive", () => {
    expect(() => fpsFraction(0)).toThrow(/positive/);
  });
});

describe("File Properties rules", () => {
  it("rescales a sequence's duration and in/out to a new frame rate", () => {
    const data = { fps: { num: 30, den: 1 }, video_timebase: { num: 1, den: 30 }, duration: 2.0, start: 0.5, end: 1.5 };
    const next = withSequenceFps(data, { num: 15, den: 1 });
    expect(next).toEqual({ fps: { num: 15, den: 1 }, video_timebase: { num: 1, den: 15 }, duration: 4.0, start: 1.0, end: 3.0 });
    expect(data.duration).toBe(2.0);
    expect(withSequenceFps({ fps: { num: 24, den: 1 }, duration: 1 }, { num: 48, den: 1 })).not.toHaveProperty("start");
  });

  it("sets in/out from 1-based frames, the end frame inclusive", () => {
    expect(withInOutFrames({ fps: { num: 25, den: 1 } }, 26, 50)).toMatchObject({ start: 1.0, end: 2.0 });
  });

  it("relinks without losing the Zenvi keys, clamping in/out to the new media", () => {
    const old = {
      id: "F1",
      path: "/old/a.mp4",
      name: "Intro",
      tags: "b-roll",
      ai_metadata: { analyzed: true },
      start: 2.0,
      end: 9.0,
      proxy_reader: { path: "/p.mp4" },
      duration: 10.0,
    };
    const reader = { path: "/new/a.mp4", duration: 8.0, width: 1920, id: "READER" };
    const next = relinkedFileData(old, reader, "video");
    expect(next).toMatchObject({ id: "F1", path: "/new/a.mp4", name: "Intro", tags: "b-roll", ai_metadata: { analyzed: true }, start: 2.0, end: 8.0, media_type: "video" });
    const gone = relinkedFileData({ ...old, start: 8.5, end: 9.5 }, reader, "video");
    expect(gone).not.toHaveProperty("start");
    expect(gone).not.toHaveProperty("end");
  });

  it("keeps an optimized preview only when the fingerprints prove the same media", () => {
    const old = { id: "F1", path: "/old/a.mp4", duration: 10.0, proxy_reader: { path: "/p.mp4" }, fingerprint: { sha256: "aaa" } };
    const reader = { path: "/new/a.mp4", duration: 10.0 };
    const moved = relinkedFileData(old, reader, "video", { sha256: "aaa" });
    expect([moved.proxy_reader, moved.fingerprint]).toEqual([{ path: "/p.mp4" }, { sha256: "aaa" }]);
    const other = relinkedFileData(old, reader, "video", { sha256: "bbb" });
    expect(other).not.toHaveProperty("proxy_reader");
    expect(other.fingerprint).toEqual({ sha256: "bbb" });
    const unknown = relinkedFileData(old, reader, "video");
    expect(unknown).not.toHaveProperty("proxy_reader");
    expect(unknown).not.toHaveProperty("fingerprint");
  });
});
