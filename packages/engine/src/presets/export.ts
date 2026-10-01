/**
 * Export settings: the desktop's defaults for a project, and their mapping
 * to the engine's `ExportOptions` for the browser and Node exporters.
 *
 * `getDefaultExportSettings` ports zenvi-core src/windows/export.py
 * `get_default_export_settings` (L2015-2127): profile-derived defaults, the
 * export dialog's saved widget values (`project.export_settings`) and the
 * agent's overrides (`project.export_overrides`, set_export_setting_tool).
 *
 * `encoderRates` turns `ExportOptions.quality` into the numbers the desktop
 * presets use for the same codec (e.g. libx264 Low/Med/High = crf 30/23/20),
 * so every exporter encodes a quality level the same way.
 */

import type { Project } from "../model/types.js";
import type { ContainerFormat, ExportOptions } from "../tools/types.js";
import {
  type ExportPreset,
  type ExportRate,
  type ExportType,
  type FrameFormat,
  type PresetQuality,
  EXPORT_TYPES,
  allFormatsBitrate,
  getExportPreset,
  parseExportRate,
  presetExportType,
  presetRates,
} from "./catalog.js";

/** FFmpeg channel layouts in the dialog's "Channel Layout" combo order (export.py L270-279). */
const CHANNEL_LAYOUT_CHOICES = [4, 3, 7, 1551, 1599] as const;
const LAYOUT_STEREO = 3;

/** `video_settings` as the desktop builds it. Unknown saved values are kept. */
export interface ExportVideoSettings {
  vformat: string;
  vcodec: string;
  fps: { num: number; den: number };
  width: number;
  height: number;
  pixel_ratio: { num: number; den: number };
  /** Bits per second, or the dialog's rate text ("2.05 Mb/s", "23 crf"). */
  video_bitrate: number | string;
  start_frame: number;
  end_frame: number;
  interlace: boolean;
  topfirst: boolean;
  spherical: boolean;
}

/** `audio_settings` as the desktop builds it. */
export interface ExportAudioSettings {
  acodec: string;
  sample_rate: number;
  channels: number;
  channel_layout: number;
  /** Bits per second, or the dialog's rate text ("192 kb/s"). */
  audio_bitrate: number | string;
}

export interface DefaultExportSettings {
  video: ExportVideoSettings;
  audio: ExportAudioSettings;
  exportType: ExportType;
  /** `output_path` override, else `<exportFolder>/export.mp4`. */
  defaultPath: string;
}

export interface DefaultExportOptions {
  /** The desktop's default export folder (Settings `getDefaultPath(EXPORT)`). Default: none. */
  exportFolder?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Python `x or default` for JSON numbers. */
function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value !== 0 ? value : fallback;
}

function joinPath(folder: string, name: string): string {
  if (!folder) return name;
  return /[\\/]$/.test(folder) ? folder + name : `${folder}${folder.includes("\\") && !folder.includes("/") ? "\\" : "/"}${name}`;
}

type Setter = (value: unknown) => void;

/**
 * The settings the desktop exports a project with when no dialog is shown
 * (`get_default_export_settings`). Saved dialog values that do not have the
 * type the dialog writes are ignored. The saved "Channel Layout" is the
 * combo index; it is mapped back to the layout it names (the desktop copies
 * the index itself).
 */
export function getDefaultExportSettings(project: Project, options: DefaultExportOptions = {}): DefaultExportSettings {
  const fps = isRecord(project.fps) && Object.keys(project.fps).length > 0 ? project.fps : { num: 30, den: 1 };
  const video: ExportVideoSettings = {
    vformat: "mp4",
    vcodec: "libx264",
    fps: { num: typeof fps.num === "number" ? fps.num : 30, den: numberOr(fps.den, 1) },
    width: numberOr(project.width, 1920),
    height: numberOr(project.height, 1080),
    pixel_ratio: { num: 1, den: 1 },
    video_bitrate: 2000000,
    // The desktop uses the duration in seconds as a frame count here; a
    // headless export then replaces the range with the whole timeline.
    start_frame: 1,
    end_frame: Math.max(1, Math.trunc(numberOr(project.duration, 0)) || 1),
    interlace: false,
    topfirst: false,
    spherical: false,
  };
  const audio: ExportAudioSettings = {
    acodec: "aac",
    sample_rate: numberOr(project.sample_rate, 48000),
    channels: numberOr(project.channels, 2),
    channel_layout: LAYOUT_STEREO,
    audio_bitrate: 192000,
  };
  let exportType: ExportType = EXPORT_TYPES[0];
  let defaultPath = joinPath(options.exportFolder ?? "", "export.mp4");

  const num = (set: (n: number) => void): Setter => (v) => {
    if (typeof v === "number" && Number.isFinite(v)) set(v);
  };
  const str = (set: (s: string) => void): Setter => (v) => {
    if (typeof v === "string") set(v);
  };
  const rate = (set: (r: number | string) => void): Setter => (v) => {
    if ((typeof v === "number" && Number.isFinite(v)) || typeof v === "string") set(v);
  };
  const widgets: Record<string, Setter> = {
    txtVideoFormat: str((v) => (video.vformat = v)),
    txtVideoCodec: str((v) => (video.vcodec = v)),
    txtWidth: num((v) => (video.width = v)),
    txtHeight: num((v) => (video.height = v)),
    txtFrameRateNum: num((v) => (video.fps.num = v)),
    txtFrameRateDen: num((v) => (video.fps.den = v)),
    txtPixelRatioNum: num((v) => (video.pixel_ratio.num = v)),
    txtPixelRatioDen: num((v) => (video.pixel_ratio.den = v)),
    txtVideoBitRate: rate((v) => (video.video_bitrate = v)),
    txtStartFrame: num((v) => (video.start_frame = v)),
    txtEndFrame: num((v) => (video.end_frame = v)),
    txtAudioCodec: str((v) => (audio.acodec = v)),
    txtSampleRate: num((v) => (audio.sample_rate = v)),
    txtChannels: num((v) => (audio.channels = v)),
    txtAudioBitrate: rate((v) => (audio.audio_bitrate = v)),
    cboChannelLayout: num((v) => {
      const layout = CHANNEL_LAYOUT_CHOICES[v];
      if (layout !== undefined) audio.channel_layout = layout;
    }),
    cboExportTo: num((v) => {
      const type = EXPORT_TYPES[v];
      if (Number.isInteger(v) && type) exportType = type;
    }),
  };
  if (Array.isArray(project.export_settings)) {
    for (const widget of project.export_settings) {
      if (!isRecord(widget)) continue;
      const name = String(widget.name ?? "");
      if (Object.hasOwn(widgets, name)) widgets[name]!(widget.value);
    }
  }

  // set_export_setting_tool overrides (tool_handlers.py set_export_setting).
  const overrides = isRecord(project.export_overrides) ? project.export_overrides : {};
  for (const [key, value] of Object.entries(overrides)) {
    if (key === "width" || key === "height" || key === "start_frame" || key === "end_frame") num((v) => (video[key] = v))(value);
    else if (key === "fps_num") num((v) => (video.fps.num = v))(value);
    else if (key === "fps_den") num((v) => (video.fps.den = v))(value);
    else if (key === "video_codec" || key === "vcodec") str((v) => (video.vcodec = v))(value);
    else if (key === "vformat" || key === "format") str((v) => (video.vformat = v))(value);
    else if (key === "audio_codec" || key === "acodec") str((v) => (audio.acodec = v))(value);
    else if (key === "sample_rate") num((v) => (audio.sample_rate = v))(value);
    else if (key === "channels") num((v) => (audio.channels = v))(value);
    else if (key === "output_path" || key === "path") str((v) => (defaultPath = v))(value);
  }
  return { video, audio, exportType, defaultPath };
}

// ---------------------------------------------------------------------------
// ExportOptions
// ---------------------------------------------------------------------------

/**
 * `ExportOptions` plus the constant-quality value desktop presets use
 * ("23 crf"). `crf` wins over `quality` in `encoderRates`; exporters that
 * cannot use it (WebCodecs) keep using `quality`.
 */
export type PresetExportOptions = ExportOptions & { crf?: number };

/** Thrown when settings name a container the engine's exporters cannot write. */
export class ExportSettingsError extends Error {
  override readonly name = "ExportSettingsError";
}

const VIDEO_CONTAINERS: Partial<Record<string, ContainerFormat>> = {
  mp4: "mp4",
  m4v: "mp4",
  mov: "mov",
  mkv: "mkv",
  matroska: "mkv",
  webm: "webm",
  gif: "gif",
};
const AUDIO_CONTAINERS: Partial<Record<string, ContainerFormat>> = { mp3: "mp3", wav: "wav" };

/**
 * The engine container for an FFmpeg muxer name and export type: "Image
 * Sequence" is a PNG sequence, "Audio Only" needs mp3/wav, video exports
 * need mp4/mov/mkv/webm/gif. Undefined for everything else (avi, mpeg,
 * ogg, dvd …), which only the desktop's libopenshot exporter writes.
 */
export function exportContainer(videoFormat: string, exportType: ExportType = "Video & Audio"): ContainerFormat | undefined {
  const format = videoFormat.trim().toLowerCase();
  if (exportType === "Image Sequence") return "png-sequence";
  if (exportType === "Audio Only") return AUDIO_CONTAINERS[format];
  return VIDEO_CONTAINERS[format];
}

const QUALITY_OF: Record<PresetQuality, NonNullable<ExportOptions["quality"]>> = { Low: "low", Med: "medium", High: "high" };
const PRESET_QUALITY_OF: Record<"low" | "medium" | "high", PresetQuality> = { low: "Low", medium: "Med", high: "High" };

interface RateLadder {
  /** The reference desktop preset ("All Formats") for the codec. */
  preset: string;
  /** Its lossless sibling, when the desktop has one. */
  lossless?: string;
  /** crf 0 is lossless for this codec in libopenshot (FFmpegWriter.cpp L486-526). */
  crfZeroLossless: boolean;
}

/**
 * Which desktop preset defines Low/Med/High for an encoder. Every desktop
 * crf preset of a codec uses the same ladder (x264 30/23/20, x265 35/28/22,
 * vp9 46/34/26), so the reference presets reproduce them all.
 */
function rateLadder(format: ContainerFormat, videoCodec: string | undefined): RateLadder | undefined {
  const codec = (videoCodec ?? "").toLowerCase();
  if (format === "mp3") return { preset: "format_mp3", crfZeroLossless: false };
  if (format === "webm") {
    if (codec === "libvpx" || codec === "vp8") return { preset: "format_webm_libvpx", crfZeroLossless: false };
    return { preset: "format_webm_libvp9", lossless: "format_webm_libvp9_lossless", crfZeroLossless: true };
  }
  if (format === "mp4" || format === "mov" || format === "mkv") {
    if (codec === "libx265" || codec === "hevc" || codec === "h265") return { preset: "format_mp4_x265_crf", crfZeroLossless: true };
    if (codec.startsWith("prores")) return { preset: "format_mov_prores", crfZeroLossless: false };
    if (codec === "librav1e") return { preset: "format_mp4_librav1e", crfZeroLossless: false };
    if (codec === "libsvtav1") return { preset: "format_mp4_libsvtav1", crfZeroLossless: false };
    if (codec === "" || codec === "libx264" || codec === "h264" || codec === "avc") {
      return { preset: "format_mp4_x264", lossless: "format_mp4_x264_lossless", crfZeroLossless: true };
    }
    return undefined;
  }
  return undefined;
}

function rateToOptions(rate: ExportRate | null, target: PresetExportOptions): void {
  if (!rate) return;
  if (rate.kind === "bitrate") {
    if (rate.bitsPerSecond > 0) target.videoBitrate = rate.bitsPerSecond;
  } else {
    target.crf = rate.value;
  }
}

function audioBitrateOf(value: unknown): number | undefined {
  const rate = parseExportRate(value);
  return rate?.kind === "bitrate" && rate.bitsPerSecond > 0 ? rate.bitsPerSecond : undefined;
}

/** The quality level whose ladder value is closest to `crf` (ties go to the higher quality). */
function qualityForCrf(crf: number, format: ContainerFormat, videoCodec: string | undefined): NonNullable<ExportOptions["quality"]> {
  const ladder = rateLadder(format, videoCodec);
  if (crf === 0 && ladder?.crfZeroLossless) return "lossless";
  const preset = ladder ? getExportPreset(ladder.preset) : undefined;
  let best: NonNullable<ExportOptions["quality"]> = "medium";
  let distance = Number.POSITIVE_INFINITY;
  for (const [level, quality] of [["high", "High"], ["medium", "Med"], ["low", "Low"]] as const) {
    const rate = preset ? parseExportRate(quality === "Low" ? preset.videoBitrate.low : quality === "Med" ? preset.videoBitrate.med : preset.videoBitrate.high) : null;
    if (!rate || rate.kind === "bitrate") continue;
    const d = Math.abs(rate.value - crf);
    if (d < distance) [best, distance] = [level, d];
  }
  return best;
}

export interface SettingsToOptions {
  /**
   * Use the saved start/end frames. Default false: like the desktop's
   * headless export, the whole timeline is exported.
   */
  useSavedRange?: boolean;
}

/**
 * `ExportOptions` for desktop export settings (`getDefaultExportSettings`).
 * "Video Only" exports carry `channels: 0` (no audio stream, as libopenshot
 * reads a zero channel count). Throws `ExportSettingsError` for containers
 * the engine cannot write. `output` is left to the caller (`defaultPath`).
 */
export function exportOptionsFromSettings(settings: DefaultExportSettings, options: SettingsToOptions = {}): PresetExportOptions {
  const { video, audio, exportType } = settings;
  const format = exportContainer(video.vformat, exportType);
  if (!format) throw new ExportSettingsError(`The engine exporters cannot write ${exportType} as "${video.vformat}".`);
  const fps = { num: Math.trunc(video.fps.num), den: Math.trunc(video.fps.den) || 1 };
  const out: PresetExportOptions = { format, width: Math.trunc(video.width), height: Math.trunc(video.height), fps };
  const hasVideo = exportType !== "Audio Only";
  const hasAudio = exportType === "Video & Audio" || exportType === "Audio Only";
  if (hasVideo && format !== "png-sequence" && format !== "gif" && video.vcodec) out.videoCodec = video.vcodec;
  if (hasVideo && format !== "png-sequence") {
    rateToOptions(parseExportRate(video.video_bitrate), out);
    if (out.crf !== undefined) out.quality = qualityForCrf(out.crf, format, out.videoCodec);
  }
  if (hasAudio && format !== "gif" && format !== "png-sequence") {
    if (audio.acodec) out.audioCodec = audio.acodec;
    const bitrate = audioBitrateOf(audio.audio_bitrate);
    if (bitrate !== undefined) out.audioBitrate = bitrate;
    out.sampleRate = Math.trunc(audio.sample_rate);
    out.channels = Math.trunc(audio.channels);
  } else if (format !== "gif" && format !== "png-sequence") {
    out.channels = 0;
  }
  if (options.useSavedRange) {
    const rate = fps.num / fps.den;
    out.range = { start: (Math.max(1, video.start_frame) - 1) / rate, end: video.end_frame / rate };
  }
  return out;
}

export interface PresetChoice {
  quality: PresetQuality;
  /** Frame size and rate (the selected profile). */
  frame: FrameFormat;
}

/**
 * `ExportOptions` for a Simple-tab choice: preset + quality + profile.
 * Throws `ExportSettingsError` when the preset's container is one the
 * engine cannot write (AVI, MPEG, OGG, DVD …).
 */
export function exportOptionsForPreset(preset: ExportPreset, choice: PresetChoice): PresetExportOptions {
  const exportType = presetExportType(preset);
  const format = exportContainer(preset.videoFormat, exportType);
  if (!format) throw new ExportSettingsError(`The engine exporters cannot write "${preset.title}" (${preset.videoFormat}).`);
  const { video, audio } = presetRates(preset, choice.quality, choice.frame);
  const out: PresetExportOptions = {
    format,
    width: choice.frame.width,
    height: choice.frame.height,
    fps: { num: choice.frame.fps.num, den: choice.frame.fps.den },
    quality: QUALITY_OF[choice.quality],
  };
  if (exportType !== "Audio Only") {
    if (preset.videoCodec && format !== "gif") out.videoCodec = preset.videoCodec;
    rateToOptions(parseExportRate(video), out);
    if (out.crf === 0 && rateLadder(format, out.videoCodec)?.crfZeroLossless) out.quality = "lossless";
  }
  if (preset.audioCodec && preset.channels > 0 && preset.sampleRate > 0) {
    out.audioCodec = preset.audioCodec;
    const bitrate = audioBitrateOf(audio);
    if (bitrate !== undefined) out.audioBitrate = bitrate;
    out.sampleRate = preset.sampleRate;
    out.channels = preset.channels;
  }
  return out;
}

export type VideoRate =
  | { mode: "crf"; value: number }
  | { mode: "qp"; value: number }
  | { mode: "bitrate"; bitsPerSecond: number }
  /** crf 0 on a codec where libopenshot makes that lossless (x264, x265, vp9). */
  | { mode: "lossless" };

export interface EncoderRates {
  /** Null for formats without a video rate (gif, png-sequence) and audio-only formats. */
  video: VideoRate | null;
  /** Null when the format has no compressed audio (gif, png-sequence, wav). */
  audioBitsPerSecond: number | null;
}

/**
 * The rates an exporter should encode `options` with: explicit `crf` /
 * `videoBitrate` / `audioBitrate` first, otherwise the desktop preset
 * ladder for the codec at `quality` (default "high", the dialog's default),
 * with "All Formats" bitrates scaled to the frame like the dialog does.
 */
export function encoderRates(options: PresetExportOptions): EncoderRates {
  const quality = options.quality ?? "high";
  const ladder = rateLadder(options.format, options.videoCodec);
  const reference = ladder ? getExportPreset(quality === "lossless" ? (ladder.lossless ?? ladder.preset) : ladder.preset) : undefined;
  const level: PresetQuality = quality === "lossless" ? "High" : PRESET_QUALITY_OF[quality];
  const frame: FrameFormat = { width: options.width, height: options.height, fps: options.fps };
  const rates = reference ? presetRates(reference, level, frame) : null;

  let video: VideoRate | null = null;
  // GIF has no rate control; png-sequence, wav and mp3 have no video.
  const videoFormats: readonly ContainerFormat[] = ["mp4", "mov", "mkv", "webm"];
  if (videoFormats.includes(options.format)) {
    const toVideoRate = (rate: ExportRate | null): VideoRate | null => {
      if (!rate) return null;
      if (rate.kind === "bitrate") {
        return rate.bitsPerSecond > 0 ? { mode: "bitrate", bitsPerSecond: rate.bitsPerSecond } : null;
      }
      if (rate.value === 0 && ladder?.crfZeroLossless) return { mode: "lossless" };
      return rate.kind === "qp" ? { mode: "qp", value: rate.value } : { mode: "crf", value: rate.value };
    };
    if (options.crf !== undefined) video = toVideoRate({ kind: "crf", value: options.crf });
    else if (options.videoBitrate !== undefined && options.videoBitrate > 0) video = { mode: "bitrate", bitsPerSecond: Math.trunc(options.videoBitrate) };
    else if (quality === "lossless" && ladder?.crfZeroLossless) video = { mode: "lossless" };
    else if (rates) video = toVideoRate(parseExportRate(rates.video));
    else {
      const dynamic = parseExportRate(allFormatsBitrate(level, frame));
      video = toVideoRate(dynamic);
    }
  }

  let audioBitsPerSecond: number | null = null;
  const compressedAudio: readonly ContainerFormat[] = ["mp4", "mov", "mkv", "webm", "mp3"];
  if (compressedAudio.includes(options.format)) {
    if (options.audioBitrate !== undefined && options.audioBitrate > 0) audioBitsPerSecond = Math.trunc(options.audioBitrate);
    else if (rates) audioBitsPerSecond = audioBitrateOf(rates.audio) ?? null;
    else audioBitsPerSecond = audioBitrateOf(getExportPreset("format_mp4_x264")!.audioBitrate[level === "Low" ? "low" : level === "Med" ? "med" : "high"]) ?? null;
  }
  return { video, audioBitsPerSecond };
}
