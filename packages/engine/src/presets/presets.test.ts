import { describe, expect, it } from "vitest";
import goldens from "./__fixtures__/desktop-export.json" with { type: "json" };
import type { Project } from "../model/types.js";
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
import {
  ExportSettingsError,
  encoderRates,
  exportContainer,
  exportOptionsForPreset,
  exportOptionsFromSettings,
  getDefaultExportSettings,
  type DefaultExportSettings,
} from "./export.js";

interface SettingsGolden {
  name: string;
  project: Record<string, unknown>;
  video: Record<string, unknown>;
  audio: Record<string, unknown>;
  exportType: string;
  defaultPath: string;
}
const g = goldens as unknown as {
  settings: SettingsGolden[];
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

function projectFrom(data: Record<string, unknown>): Project {
  return data as unknown as Project;
}

describe("getDefaultExportSettings (parity with get_default_export_settings)", () => {
  for (const c of g.settings) {
    it(c.name, () => {
      const settings = getDefaultExportSettings(projectFrom(c.project), { exportFolder: "/media/exports" });
      // The desktop copies the Channel Layout combo index; the engine maps it to the layout.
      const savedLayout = Array.isArray(c.project.export_settings)
        ? (c.project.export_settings as { name: string; value: number }[]).find((w) => w.name === "cboChannelLayout")
        : undefined;
      const audio = savedLayout ? { ...c.audio, channel_layout: [4, 3, 7, 1551, 1599][savedLayout.value] } : c.audio;
      expect(settings).toEqual({ video: c.video, audio, exportType: c.exportType, defaultPath: c.defaultPath });
    });
  }

  it("ignores saved values of the wrong type and prototype keys", () => {
    const settings = getDefaultExportSettings(
      projectFrom({
        width: 1280,
        export_settings: [
          { name: "txtWidth", value: "wide" },
          { name: "constructor", value: 1 },
          { name: "__proto__", value: 1 },
          { name: "cboExportTo", value: 9 },
        ],
        export_overrides: { width: "640", channels: 6 },
      }),
    );
    expect(settings.video.width).toBe(1280);
    expect(settings.audio.channels).toBe(6);
    expect(settings.exportType).toBe("Video & Audio");
    expect(settings.defaultPath).toBe("export.mp4");
  });
});

describe("exportOptionsFromSettings", () => {
  const settingsOf = (name: string): DefaultExportSettings => {
    const c = g.settings.find((s) => s.name === name)!;
    return getDefaultExportSettings(projectFrom(c.project));
  };

  it("maps the headless defaults (2 Mb/s H.264, 192 kb/s AAC, whole timeline)", () => {
    expect(exportOptionsFromSettings(settingsOf("defaults"))).toEqual({
      format: "mp4",
      width: 1280,
      height: 720,
      fps: { num: 30, den: 1 },
      videoCodec: "libx264",
      videoBitrate: 2000000,
      audioCodec: "aac",
      audioBitrate: 192000,
      sampleRate: 48000,
      channels: 2,
    });
  });

  it("reads saved dialog rates and ranges", () => {
    const options = exportOptionsFromSettings(settingsOf("saved-dialog"), { useSavedRange: true });
    expect(options).toMatchObject({ width: 1440, height: 1080, fps: { num: 24, den: 1 }, videoBitrate: 2050000, audioBitrate: 96000 });
    expect(options.range).toEqual({ start: 0, end: 1488 / 24 });
  });

  it("keeps a saved crf and drops audio for Video Only", () => {
    const options = exportOptionsFromSettings(settingsOf("saved-crf-video-only"));
    expect(options.crf).toBe(21);
    expect(options.quality).toBe("high");
    expect(options.videoBitrate).toBeUndefined();
    expect(options.channels).toBe(0);
    expect(options.audioCodec).toBeUndefined();
  });

  it("applies overrides and rejects containers the engine cannot write", () => {
    const options = exportOptionsFromSettings(settingsOf("overrides"));
    expect(options).toMatchObject({ format: "mkv", videoCodec: "libx265", audioCodec: "libopus", sampleRate: 44100, channels: 1, width: 640 });
    const avi = { ...settingsOf("defaults") };
    avi.video = { ...avi.video, vformat: "avi" };
    expect(() => exportOptionsFromSettings(avi)).toThrow(ExportSettingsError);
  });

  it("knows which containers the engine writes", () => {
    expect(exportContainer("mp4")).toBe("mp4");
    expect(exportContainer("m4v")).toBe("mp4");
    expect(exportContainer("gif", "Video Only")).toBe("gif");
    expect(exportContainer("mp3", "Audio Only")).toBe("mp3");
    expect(exportContainer("mp4", "Audio Only")).toBeUndefined();
    expect(exportContainer("mp4", "Image Sequence")).toBe("png-sequence");
    for (const format of ["avi", "mpeg", "ogg", "dvd"]) expect(exportContainer(format)).toBeUndefined();
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
