import { describe, expect, it } from "vitest";
import { Interpolation, ScaleMode, type ProjectFile } from "./types.js";
import { createClip, createProject, createTransition, defaultProjectTemplate, libopenshotClipDefaults, transitionKeyframes } from "./defaults.js";
import { getMediaType, isAudioOnlyMedia, isSingleImageMedia } from "./media.js";
import { CLIP_PROPERTIES, TRANSITION_PROPERTIES, valueKind } from "./properties.js";
import { clampTimingToMedia, videoLengthToProjectFrames } from "./timing.js";
import { isGeneratedId } from "./ids.js";
import { PROJECT_FORMAT_VERSION } from "../io/versions.js";

const fps30 = { num: 30, den: 1 };

function file(extra: Partial<ProjectFile> = {}): ProjectFile {
  return {
    id: "F1",
    path: "/media/clip.mp4",
    type: "FFmpegReader",
    media_type: "video",
    has_video: true,
    has_audio: true,
    has_single_image: false,
    duration: 12.345,
    width: 1920,
    height: 1080,
    fps: { num: 30, den: 1 },
    video_length: "370",
    pixel_ratio: { num: 1, den: 1 },
    display_ratio: { num: 16, den: 9 },
    sample_rate: 48000,
    channels: 2,
    channel_layout: 3,
    ...extra,
  } as ProjectFile;
}

describe("createProject", () => {
  it("matches _default.project after new(): default profile, 48 kHz stereo, fresh id", () => {
    const p = createProject();
    expect(p.fps).toEqual({ num: 30, den: 1 });
    expect(p.profile).toBe("HD 720p 30 fps");
    expect([p.width, p.height, p.sample_rate, p.channels, p.channel_layout]).toEqual([1280, 720, 48000, 2, 3]);
    expect(p.layers.map((l) => l.number)).toEqual([1000000, 2000000, 3000000, 4000000, 5000000]);
    expect(isGeneratedId(p.id)).toBe(true);
    expect(Object.keys(p).sort()).toEqual(Object.keys(defaultProjectTemplate()).sort());
  });

  it("applies another profile and channel count", () => {
    const p = createProject({ profile: "01920x1080p2997_16-09", channels: 1 });
    expect(p.fps).toEqual({ num: 30000, den: 1001 });
    expect([p.width, p.height, p.channels, p.channel_layout]).toEqual([1920, 1080, 1, 4]);
    expect(() => createProject({ profile: "nope" })).toThrow(/Unknown profile/);
  });

  it("stamps the engine's project format version; the template keeps the beta stamp", () => {
    const p = createProject();
    expect(p.version).toEqual({ "openshot-qt": "1.0.188", libopenshot: "1.0.0" });
    expect(p.version).toEqual(PROJECT_FORMAT_VERSION);
    // A copy, not the frozen constant: hosts may add their own version keys.
    expect(Object.isFrozen(p.version)).toBe(false);
    expect(defaultProjectTemplate().version).toEqual({ "openshot-qt": "0.0.0", libopenshot: "0.0.0" });
  });
});

describe("createClip", () => {
  it("writes every libopenshot clip key plus the desktop's", () => {
    const defaults = libopenshotClipDefaults();
    const clip = createClip({ id: "C1", file: file(), position: 2, layer: 1000000, fps: fps30 });
    for (const key of Object.keys(defaults)) expect(clip).toHaveProperty(key);
    expect(clip).toMatchObject({ id: "C1", file_id: "F1", title: "clip.mp4", position: 2, layer: 1000000, start: 0 });
    // 12.345 s → 370 frames at 30 fps (Python round) → 12.333… s.
    expect(clip.end).toBeCloseTo(370 / 30, 12);
    expect(clip.duration).toBeCloseTo(370 / 30, 12);
    expect(clip.reader).toEqual(file());
    expect(clip.rotation.Points).toHaveLength(1);
    expect(clip.reader_orientation_mode).toBe("reader");
  });

  it("images last default-image-length; subclips keep their range", () => {
    const img = createClip({
      id: "C2",
      file: file({ path: "/a.png", media_type: "image", has_single_image: true, duration: 3600 }),
      position: 0,
      layer: 1,
      fps: fps30,
    });
    expect(img.end).toBe(10);
    const sub = createClip({ id: "C3", file: file({ start: 1.01, end: 4 } as Partial<ProjectFile>), position: 0, layer: 1, fps: fps30 });
    expect(sub.start).toBeCloseTo(1, 12);
    expect(sub.end).toBe(4);
  });

  it("audio-only media never composites video", () => {
    const clip = createClip({ id: "C4", file: file({ path: "/song.mp3", media_type: "audio" }), position: 0, layer: 1, fps: fps30 });
    expect(clip.has_video).toEqual({ Points: [{ co: { X: 1, Y: 0 }, interpolation: Interpolation.CONSTANT }] });
    expect(clip.scale).toBe(ScaleMode.NONE);
    expect(clip.reader.has_video).toBe(false);
  });
});

describe("transitions", () => {
  it("default keyframes: brightness 1 → -1 over the duration, contrast 3", () => {
    const { brightness, contrast } = transitionKeyframes(0.5, fps30);
    expect(brightness.Points.map((p) => [p.co.X, p.co.Y])).toEqual([
      [1, 1],
      [16, -1],
    ]);
    expect(contrast.Points[0]!.co.Y).toBe(3);
  });

  it("createTransition writes the desktop's sparse Mask dictionary", () => {
    const t = createTransition({
      id: "T1",
      layer: 2000000,
      position: 4,
      duration: 1,
      reader: { type: "QtImageReader", path: "@transitions/common/fade.svg" } as never,
      fps: fps30,
      direction: "out",
    });
    expect(t).toMatchObject({ id: "T1", type: "Mask", class_name: "Mask", title: "Transition", start: 0, end: 1, replace_image: false });
    expect(t.brightness.Points.map((p) => p.co.Y)).toEqual([-1, 1]);
  });
});

describe("media classification (image_types.py)", () => {
  it("getMediaType follows the importer rules", () => {
    expect(getMediaType({ path: "a.mp3", has_video: true, has_audio: true })).toBe("audio");
    expect(getMediaType({ path: "a.png", has_video: true })).toBe("image");
    expect(getMediaType({ path: "a.gif", has_video: true })).toBe("video");
    expect(getMediaType({ path: "a.wav", has_audio: true })).toBe("audio");
    expect(getMediaType({ path: "blob-123", has_video: true }, "photo.jpg")).toBe("image");
    expect(getMediaType({ path: "x" })).toBe("video");
  });

  it("isAudioOnlyMedia / isSingleImageMedia", () => {
    expect(isAudioOnlyMedia({ path: "a.mp3", media_type: "video" })).toBe(true);
    expect(isAudioOnlyMedia({ path: "a.mp4", media_type: "audio" })).toBe(true);
    expect(isAudioOnlyMedia({ path: "a.mp4", has_audio: true, has_video: false })).toBe(true);
    expect(isAudioOnlyMedia({ path: "a.mp4", media_type: "video", has_audio: true, has_video: false })).toBe(false);
    expect(isSingleImageMedia({ has_single_image: true, path: "cover.mp3" })).toBe(false);
    expect(isSingleImageMedia({ media_type: "image" })).toBe(true);
  });
});

describe("property metadata", () => {
  it("clip and transition tables come from libopenshot", () => {
    expect(CLIP_PROPERTIES.gravity?.choices?.length).toBe(9);
    expect(CLIP_PROPERTIES.rotation).toMatchObject({ keyframe: true, min: -360, max: 360 });
    expect(CLIP_PROPERTIES.wave_color?.type).toBe("color");
    expect(TRANSITION_PROPERTIES.brightness).toMatchObject({ min: -1, max: 1 });
    expect(valueKind(CLIP_PROPERTIES.alpha, undefined)).toBe("keyframe");
    expect(valueKind(CLIP_PROPERTIES.gravity, 4)).toBe("number");
    expect(valueKind(CLIP_PROPERTIES.waveform, false)).toBe("bool");
  });
});

describe("clip timing (clip_utils.clamp_timing_to_media)", () => {
  it("videoLengthToProjectFrames rescales the source frame count", () => {
    expect(videoLengthToProjectFrames({ video_length: "300", fps: { num: 25, den: 1 } }, fps30)).toBe(360);
    expect(videoLengthToProjectFrames({ duration: 2, fps: { num: 24, den: 1 } }, fps30)).toBe(60);
    expect(videoLengthToProjectFrames({}, fps30)).toBeNull();
  });

  it("clamps start/end to the media", () => {
    const t = clampTimingToMedia({ start: -1, end: 99, reader: file() }, fps30);
    expect(t).toEqual({ start: 0, end: 12.345, duration: 12.345, time: undefined });
  });

  it("keeps any length for still images", () => {
    const t = clampTimingToMedia({ start: 0, end: 60, reader: file({ media_type: "image", has_single_image: true, duration: 3600 }) }, fps30);
    expect(t).toEqual({ start: 0, end: 60, duration: 60 });
  });

  it("bounds remapped clips by their time curve", () => {
    const clip = {
      start: 0,
      end: 30,
      reader: file(),
      time: { Points: [{ co: { X: 1, Y: 1 } }, { co: { X: 600, Y: 999 } }] },
    };
    const t = clampTimingToMedia(clip, fps30);
    // Y is clamped to the media's 370 frames.
    expect(t.time?.Points[1]).toEqual({ co: { X: 600, Y: 370 } });
    expect(t.end).toBe(30);
  });
});

describe("profiles", () => {
  it("findProfile follows get_profile: key, current description, legacy upgrade", async () => {
    const { findProfile, profileKey, PROFILES } = await import("./profiles.js");
    expect(findProfile("01280x0720p0030_16-09")?.description).toBe("HD 720p 30 fps");
    expect(findProfile("hd 720p 30 fps")?.key).toBe("01280x0720p0030_16-09");
    expect(findProfile("HD 1080p 25 fps")?.key).toBe("01920x1080p0025_16-09");
    expect(findProfile("nope")).toBeUndefined();
    for (const p of PROFILES.filter((x) => !x.legacy)) expect(profileKey(p), p.key).toBe(p.key);
  });
});

describe("libopenshot parity", () => {
  it("libopenshotClipDefaults() equals Clip(path).Json() for video, audio and image readers", async () => {
    const fixture = (await import("./__fixtures__/libopenshot-clips.json")).default as Record<string, Record<string, unknown>>;
    // end/duration come from the reader there; add-to-timeline sets both itself.
    const { end: _end, duration: _duration, ...ours } = libopenshotClipDefaults();
    for (const [kind, json] of Object.entries(fixture)) expect(ours, kind).toEqual(json);
  });
});
