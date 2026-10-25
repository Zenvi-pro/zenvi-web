import { describe, expect, it } from "vitest";
import goldens from "./__fixtures__/desktop-export.json" with { type: "json" };
import {
  ALL_FORMATS,
  DEFAULT_EXPORT_PRESET,
  EXPORT_PRESETS,
  allFormatsBitrate,
  defaultPresetQuality,
  exportPresetTypes,
  exportPresetsOfType,
  getExportPreset,
  isQualityModeRate,
  parseExportRate,
  presetExportType,
  presetProfileFor,
  presetProfiles,
  presetQualities,
  presetRates,
  type PresetQuality,
} from "./catalog.js";
import { ExportSettingsError, encoderRates, exportContainer, exportOptionsForPreset, isSequenceFormat } from "./export.js";

// The goldens' `settings` cases are the desktop's get_default_export_settings, which no tool ports any more
// (export_video_tool plans like develop's build_export_plan: plan.test.ts).
const g = goldens as unknown as {
  parse: [string, number | null][];
  allFormats: [number, number, number, number, PresetQuality, string | null][];
  presetProfiles: Record<string, (string | null)[]>;
  allProfiles: string[];
};

const FHD30 = { width: 1920, height: 1080, fps: { num: 30, den: 1 } };

describe("export preset table", () => {
  it("has the desktop's 60 presets", () => {
    expect(EXPORT_PRESETS).toHaveLength(60);
    expect(new Set(EXPORT_PRESETS.map((p) => p.id)).size).toBe(60);
    expect(getExportPreset("youtube_HD")).toEqual({
      id: "youtube_HD",
      type: "Web",
      title: "YouTube",
      exportTo: null,
      videoFormat: "mp4",
      videoCodec: "libx264",
      audioCodec: "aac",
      channels: 2,
      channelLayout: 3,
      sampleRate: 48000,
      videoBitrate: { low: "8 Mb/s", med: "10 Mb/s", high: "12 Mb/s" },
      audioBitrate: { low: "128 kb/s", med: "192 kb/s", high: "256 kb/s" },
      profiles: [
        "FHD 1080p 23.98 fps",
        "FHD 1080p 24 fps",
        "FHD PAL 1080p 25 fps",
        "FHD 1080p 29.97 fps",
        "FHD 1080p 30 fps",
        "FHD PAL 1080p 50 fps",
        "FHD 1080p 59.94 fps",
        "FHD 1080p 60 fps",
        "FHD Vertical 1080p 23.98 fps",
        "FHD Vertical 1080p 24 fps",
        "FHD Vertical 1080p 25 fps",
        "FHD Vertical 1080p 29.97 fps",
        "FHD Vertical 1080p 30 fps",
        "FHD Vertical 1080p 50 fps",
        "FHD Vertical 1080p 59.94 fps",
        "FHD Vertical 1080p 60 fps",
      ],
    });
  });

  it("resolves preset profiles like the dialog's getProfilePath", () => {
    for (const preset of EXPORT_PRESETS) {
      const expected = preset.profiles.length === 0 ? g.allProfiles : g.presetProfiles[preset.id]!.filter((key) => key !== null);
      expect(presetProfiles(preset).map((p) => p.key), preset.id).toEqual(expected);
    }
    // A stale name ("NTSC SD Anamorphic 480i 29.97 fps") still resolves by substring.
    expect(presetProfiles(getExportPreset("dvd_ntsc")!).map((p) => p.description)).toEqual([
      "NTSC SD Anamorphic 480i 29.97 fps | 4:3",
      "NTSC SD Widescreen Anamorphic 480i 29.97 fps",
    ]);
  });

  it("selects the project's profile when the preset allows it", () => {
    const youtube = getExportPreset("youtube_HD")!;
    expect(presetProfileFor(youtube, "FHD 1080p 30 fps")!.key).toBe("01920x1080p0030_16-09");
    expect(presetProfileFor(youtube, "HD 720p 30 fps")!.key).toBe("01920x1080p2398_16-09");
    expect(presetProfileFor(DEFAULT_EXPORT_PRESET, "HD 720p 30 fps")!.key).toBe("01280x0720p0030_16-09");
    // Desktop data names a profile that does not exist.
    expect(presetProfileFor(getExportPreset("nokia_nHD")!, "HD 720p 30 fps")).toBeUndefined();
  });

  it("finds presets by id or title and lists them like the Simple tab", () => {
    expect(getExportPreset("MP4 (h.264)")).toBe(DEFAULT_EXPORT_PRESET);
    expect(getExportPreset("tiktok")!.title).toBe("TikTok");
    expect(getExportPreset("nope")).toBeUndefined();
    expect(exportPresetTypes()).toEqual([ALL_FORMATS, "Blu-Ray/AVCHD", "DVD", "Device", "Web"]);
    const web = exportPresetsOfType("Web").map((p) => p.title);
    expect(web.slice(0, 4)).toEqual(["Facebook", "Flickr", "Instagram", "Instagram Reels"]);
    expect(web).toHaveLength(17);
    expect(exportPresetsOfType(ALL_FORMATS)).toHaveLength(36);
  });

  it("offers only the quality levels a preset fills in, highest by default", () => {
    expect(presetQualities(getExportPreset("youtube_HD")!)).toEqual(["Low", "Med", "High"]);
    expect(presetQualities(getExportPreset("avchd")!)).toEqual(["Low", "High"]);
    expect(presetQualities(getExportPreset("format_mp4_x264_lossless")!)).toEqual(["High"]);
    expect(defaultPresetQuality(getExportPreset("avchd")!)).toBe("High");
  });

  it("forces the export type a preset names", () => {
    expect(presetExportType(getExportPreset("format_gif")!)).toBe("Video Only");
    expect(presetExportType(getExportPreset("format_mp3")!)).toBe("Audio Only");
    expect(presetExportType(getExportPreset("youtube_HD")!)).toBe("Video & Audio");
  });
});

describe("rates (parity with export.py)", () => {
  it("parses rate text like _parse_bitrate_to_bps", () => {
    for (const [text, expected] of g.parse) {
      const rate = parseExportRate(text);
      const value = rate === null ? null : rate.kind === "bitrate" ? rate.bitsPerSecond : rate.value;
      expect(value, JSON.stringify(text)).toBe(expected);
    }
    expect(parseExportRate("23 crf")).toEqual({ kind: "crf", value: 23 });
    expect(parseExportRate("22 cqp")).toEqual({ kind: "cqp", value: 22 });
    expect(parseExportRate("38 qp")).toEqual({ kind: "qp", value: 38 });
    expect(parseExportRate(2000000)).toEqual({ kind: "bitrate", bitsPerSecond: 2000000 });
    expect(parseExportRate(null)).toBeNull();
  });

  it("computes All Formats bitrates like calculate_all_formats_bitrate", () => {
    for (const [width, height, num, den, quality, expected] of g.allFormats) {
      expect(allFormatsBitrate(quality, { width, height, fps: { num, den } })).toBe(expected);
    }
  });

  it("fills in preset rates like the Simple tab", () => {
    expect(isQualityModeRate("23 crf")).toBe(true);
    expect(isQualityModeRate("8 Mb/s")).toBe(false);
    // crf presets keep their ladder.
    expect(presetRates(getExportPreset("format_mp4_x264")!, "High", FHD30)).toEqual({ video: "20 crf", audio: "160 kb/s" });
    // All Formats bitrate presets scale to the frame.
    expect(presetRates(getExportPreset("format_avi_mp4")!, "High", FHD30)).toEqual({ video: "7.46 Mb/s", audio: "160 kb/s" });
    // Other project types use the XML values.
    expect(presetRates(getExportPreset("youtube_HD")!, "Med", FHD30)).toEqual({ video: "10 Mb/s", audio: "192 kb/s" });
    expect(presetRates(getExportPreset("format_webm_libvp9_lossless")!, "High", FHD30)).toEqual({ video: "0 crf", audio: "192 kb/s" });
  });
});

describe("exportContainer", () => {
  it("knows which containers the engine writes", () => {
    expect(exportContainer("mp4")).toBe("mp4");
    expect(exportContainer("m4v")).toBe("mp4");
    expect(exportContainer("gif", "Video Only")).toBe("gif");
    expect(exportContainer("mp3", "Audio Only")).toBe("mp3");
    // Audio Only MP4 is an MPEG-4 file holding only its sound.
    expect(exportContainer("mp4", "Audio Only")).toBe("m4a");
    expect(exportContainer("flac", "Audio Only")).toBe("flac");
    expect(exportContainer("png", "Image Sequence")).toBe("png-sequence");
    expect(exportContainer("jpg", "Image Sequence")).toBe("jpg-sequence");
    expect(exportContainer("tiff", "Image Sequence")).toBe("tiff-sequence");
    expect(isSequenceFormat("bmp-sequence")).toBe(true);
    expect(isSequenceFormat("mp4")).toBe(false);
    for (const format of ["avi", "mpeg", "ogg", "dvd"]) expect(exportContainer(format)).toBeUndefined();
    expect(exportContainer("ppm", "Image Sequence")).toBeUndefined();
    expect(exportContainer("ogg", "Audio Only")).toBeUndefined();
  });
});

describe("exportOptionsForPreset", () => {
  it("YouTube at High: the preset's bitrates", () => {
    expect(exportOptionsForPreset(getExportPreset("youtube_HD")!, { quality: "High", frame: FHD30 })).toEqual({
      format: "mp4",
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      quality: "high",
      videoCodec: "libx264",
      videoBitrate: 12000000,
      audioCodec: "aac",
      audioBitrate: 256000,
      sampleRate: 48000,
      channels: 2,
    });
  });

  it("crf presets carry their crf; lossless ones are lossless", () => {
    expect(exportOptionsForPreset(DEFAULT_EXPORT_PRESET, { quality: "Med", frame: FHD30 })).toMatchObject({ crf: 23, quality: "medium", audioBitrate: 128000 });
    expect(exportOptionsForPreset(getExportPreset("format_mp4_x264_lossless")!, { quality: "High", frame: FHD30 })).toMatchObject({
      crf: 0,
      quality: "lossless",
    });
  });

  it("GIF has no audio or codec, MP3 has no video, DVD is not supported", () => {
    const gif = exportOptionsForPreset(getExportPreset("format_gif")!, { quality: "Low", frame: FHD30 });
    expect(gif.format).toBe("gif");
    expect(gif.audioCodec).toBeUndefined();
    expect(gif.videoCodec).toBeUndefined();
    const mp3 = exportOptionsForPreset(getExportPreset("format_mp3")!, { quality: "High", frame: FHD30 });
    expect(mp3).toMatchObject({ format: "mp3", audioCodec: "libmp3lame", audioBitrate: 192000, channels: 2 });
    expect(mp3.videoBitrate).toBeUndefined();
    expect(() => exportOptionsForPreset(getExportPreset("dvd_ntsc")!, { quality: "High", frame: FHD30 })).toThrow(ExportSettingsError);
  });
});

describe("encoderRates (quality → crf/bitrate from the desktop ladders)", () => {
  const base = { width: 1280, height: 720, fps: { num: 30, den: 1 } };

  it("H.264 / H.265 / VP9 crf ladders", () => {
    expect(encoderRates({ ...base, format: "mp4", quality: "low" })).toEqual({ video: { mode: "crf", value: 30 }, audioBitsPerSecond: 96000 });
    expect(encoderRates({ ...base, format: "mp4", quality: "medium" })).toEqual({ video: { mode: "crf", value: 23 }, audioBitsPerSecond: 128000 });
    expect(encoderRates({ ...base, format: "mov", videoCodec: "libx264" })).toEqual({ video: { mode: "crf", value: 20 }, audioBitsPerSecond: 160000 });
    expect(encoderRates({ ...base, format: "mkv", videoCodec: "libx265", quality: "low" }).video).toEqual({ mode: "crf", value: 35 });
    expect(encoderRates({ ...base, format: "webm", quality: "medium" })).toEqual({ video: { mode: "crf", value: 34 }, audioBitsPerSecond: 128000 });
  });

  it("lossless where libopenshot makes crf 0 lossless", () => {
    expect(encoderRates({ ...base, format: "mp4", quality: "lossless" })).toEqual({ video: { mode: "lossless" }, audioBitsPerSecond: 160000 });
    expect(encoderRates({ ...base, format: "webm", quality: "lossless" })).toEqual({ video: { mode: "lossless" }, audioBitsPerSecond: 192000 });
    expect(encoderRates({ ...base, format: "mp4", videoCodec: "libx265", quality: "lossless" }).video).toEqual({ mode: "lossless" });
    expect(encoderRates({ ...base, format: "mp4", crf: 0 }).video).toEqual({ mode: "lossless" });
  });

  it("bitrate codecs scale with the frame like All Formats", () => {
    expect(encoderRates({ ...base, format: "webm", videoCodec: "libvpx", quality: "high" }).video).toEqual({ mode: "bitrate", bitsPerSecond: 3320000 });
    expect(encoderRates({ ...base, format: "mp4", videoCodec: "mpeg4", quality: "medium" }).video).toEqual({ mode: "bitrate", bitsPerSecond: 2210000 });
  });

  it("explicit values win; formats without rates get none", () => {
    expect(encoderRates({ ...base, format: "mp4", crf: 18, quality: "low" }).video).toEqual({ mode: "crf", value: 18 });
    expect(encoderRates({ ...base, format: "mp4", videoBitrate: 5e6, audioBitrate: 64000 })).toEqual({
      video: { mode: "bitrate", bitsPerSecond: 5000000 },
      audioBitsPerSecond: 64000,
    });
    expect(encoderRates({ ...base, format: "gif" })).toEqual({ video: null, audioBitsPerSecond: null });
    expect(encoderRates({ ...base, format: "png-sequence" })).toEqual({ video: null, audioBitsPerSecond: null });
    expect(encoderRates({ ...base, format: "wav" })).toEqual({ video: null, audioBitsPerSecond: null });
    expect(encoderRates({ ...base, format: "mp3", quality: "high" })).toEqual({ video: null, audioBitsPerSecond: 192000 });
  });
});
