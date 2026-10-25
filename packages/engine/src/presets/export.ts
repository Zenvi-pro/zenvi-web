/**
 * Export options for the engine's exporters: which container a desktop
 * format names, a Simple-tab choice (preset + quality + profile) as
 * `ExportOptions`, and `encoderRates`, which turns `ExportOptions.quality`
 * into the numbers the desktop presets use for the same codec (e.g. libx264
 * Low/Med/High = crf 30/23/20), so every exporter encodes a quality level
 * the same way. What export_video_tool renders is planned in `plan.ts`.
 */

import type { ContainerFormat, ExportOptions } from "../tools/types.js";
import {
  type ExportPreset,
  type ExportRate,
  type ExportType,
  type FrameFormat,
  type PresetQuality,
  allFormatsBitrate,
  getExportPreset,
  parseExportRate,
  presetExportType,
  presetRates,
} from "./catalog.js";

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
/** Audio-only files; an MPEG-4 file with only its sound is what the desktop writes for Audio Only MP4. */
const AUDIO_CONTAINERS: Partial<Record<string, ContainerFormat>> = { mp3: "mp3", wav: "wav", flac: "flac", m4a: "m4a", mp4: "m4a" };
const IMAGE_SEQUENCES: Partial<Record<string, ContainerFormat>> = {
  png: "png-sequence",
  jpg: "jpg-sequence",
  jpeg: "jpg-sequence",
  bmp: "bmp-sequence",
  tiff: "tiff-sequence",
  tif: "tiff-sequence",
};

/**
 * The engine container for an FFmpeg muxer name (or, for "Image
 * Sequence", the image type) and export type: image sequences of PNG, JPG,
 * BMP or TIFF frames; "Audio Only" MP3, WAV, FLAC or M4A (AAC; an MP4
 * holding only sound); video in MP4, MOV, MKV, WebM or GIF. Undefined for
 * everything else (avi, mpeg, ogg, dvd, ppm …), which only the desktop's
 * libopenshot exporter writes.
 */
export function exportContainer(videoFormat: string, exportType: ExportType = "Video & Audio"): ContainerFormat | undefined {
  const format = videoFormat.trim().toLowerCase();
  if (exportType === "Image Sequence") return IMAGE_SEQUENCES[format];
  if (exportType === "Audio Only") return AUDIO_CONTAINERS[format];
  return VIDEO_CONTAINERS[format];
}

/** A sequence of numbered image files rather than one file. */
export function isSequenceFormat(format: ContainerFormat): boolean {
  return format.endsWith("-sequence");
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

/** crf 0 encodes losslessly with this codec in libopenshot (x264, x265, VP9). */
export function crfZeroIsLossless(format: ContainerFormat, videoCodec: string | undefined): boolean {
  return rateLadder(format, videoCodec)?.crfZeroLossless === true;
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
  /** Null for formats without a video rate (gif, image sequences) and audio-only formats. */
  video: VideoRate | null;
  /** Null when the format has no compressed audio (gif, image sequences, wav, flac). */
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
  // GIF has no rate control; image sequences and audio-only files have no video rate.
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
  const compressedAudio: readonly ContainerFormat[] = ["mp4", "mov", "mkv", "webm", "mp3", "m4a"];
  if (compressedAudio.includes(options.format)) {
    if (options.audioBitrate !== undefined && options.audioBitrate > 0) audioBitsPerSecond = Math.trunc(options.audioBitrate);
    else if (rates) audioBitsPerSecond = audioBitrateOf(rates.audio) ?? null;
    else audioBitsPerSecond = audioBitrateOf(getExportPreset("format_mp4_x264")!.audioBitrate[level === "Low" ? "low" : level === "Med" ? "med" : "high"]) ?? null;
  }
  return { video, audioBitsPerSecond };
}
