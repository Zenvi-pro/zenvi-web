/**
 * ffmpeg encoder command lines for every export format.
 *
 * Video arrives as raw RGBA on stdin (input 0); audio sources are extra
 * inputs mixed by the audio graph. Everything is routed through one
 * `filter_complex`, written to a script file when it is large (Windows limits
 * command lines to 32 KB).
 */

import path from "node:path";
import { encoderRates, isSequenceFormat, type ContainerFormat, type ExportOptions, type Fraction, type VideoRate } from "@zenvi/engine";
import { binaryVersion } from "../ffmpeg/capabilities.js";
import { ffmpegThreads } from "../limits.js";
import type { AudioGraph } from "./audio-graph.js";

export type Quality = NonNullable<ExportOptions["quality"]>;

export interface FormatInfo {
  video: boolean;
  audio: boolean;
  mimeType: string;
  extension: string;
}

export const FORMATS: Record<ContainerFormat, FormatInfo> = {
  mp4: { video: true, audio: true, mimeType: "video/mp4", extension: "mp4" },
  mov: { video: true, audio: true, mimeType: "video/quicktime", extension: "mov" },
  mkv: { video: true, audio: true, mimeType: "video/x-matroska", extension: "mkv" },
  webm: { video: true, audio: true, mimeType: "video/webm", extension: "webm" },
  gif: { video: true, audio: false, mimeType: "image/gif", extension: "gif" },
  mp3: { video: false, audio: true, mimeType: "audio/mpeg", extension: "mp3" },
  wav: { video: false, audio: true, mimeType: "audio/wav", extension: "wav" },
  flac: { video: false, audio: true, mimeType: "audio/flac", extension: "flac" },
  m4a: { video: false, audio: true, mimeType: "audio/mp4", extension: "m4a" },
  "png-sequence": { video: true, audio: false, mimeType: "image/png", extension: "png" },
  "jpg-sequence": { video: true, audio: false, mimeType: "image/jpeg", extension: "jpg" },
  "bmp-sequence": { video: true, audio: false, mimeType: "image/bmp", extension: "bmp" },
  "tiff-sequence": { video: true, audio: false, mimeType: "image/tiff", extension: "tiff" },
};

/** Format implied by an output file name, if any (an image name means a sequence of them). */
export function formatFromPath(file: string): ContainerFormat | undefined {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (ext === "m4v") return "mp4";
  if (ext === "jpeg") return "jpg-sequence";
  if (ext === "tif") return "tiff-sequence";
  return (Object.keys(FORMATS) as ContainerFormat[]).find((f) => FORMATS[f].extension === ext);
}

/**
 * Encoders each container takes in ffmpeg's muxers, where it is picky (a
 * codec it does not take fails when the file is opened); others take any.
 */
const CONTAINER_CODECS: Partial<Record<ContainerFormat, { video?: RegExp; audio?: RegExp }>> = {
  webm: { video: /^(libvpx|libvpx-vp9|vp8|vp9|libaom-av1|libsvtav1|librav1e|av1|(vp8|vp9|av1)_\w+)$/, audio: /^(libopus|opus|libvorbis|vorbis)$/ },
  mp4: { audio: /^(?!pcm_)/ },
  gif: { video: /^gif$/ },
  mp3: { audio: /^(libmp3lame|mp3\w*)$/ },
  wav: { audio: /^pcm_/ },
  flac: { audio: /^flac$/ },
  m4a: { audio: /^(aac|aac_at|libfdk_aac|alac|alac_at)$/ },
  "png-sequence": { video: /^png$/ },
  "jpg-sequence": { video: /^mjpeg$/ },
  "bmp-sequence": { video: /^bmp$/ },
  "tiff-sequence": { video: /^tiff$/ },
};

/**
 * Whether this exporter writes `format` with these FFmpeg encoders ("" =
 * none): the container is one it writes, the build has the encoders
 * (`ffmpeg -encoders`, FFmpegWriter.IsValidCodec) and the muxer takes them.
 */
export function ffmpegCanWrite(format: ContainerFormat, videoCodec: string, audioCodec: string, encoders: ReadonlySet<string>): boolean {
  const info = FORMATS[format];
  if (!info) return false;
  if ((videoCodec && !info.video) || (audioCodec && !info.audio)) return false;
  const rules = CONTAINER_CODECS[format];
  if (videoCodec && (!encoders.has(videoCodec) || (rules?.video && !rules.video.test(videoCodec)))) return false;
  if (audioCodec && (!encoders.has(audioCodec) || (rules?.audio && !rules.audio.test(audioCodec)))) return false;
  return true;
}

/**
 * Encoder speed: an x264/x265 `-preset` name (VP9 maps it to `-cpu-used`).
 * Rate control (crf / bitrate / lossless) comes from the desktop preset
 * ladders through the engine's `encoderRates`, so a quality level encodes
 * the same as the desktop and the browser whatever the speed. The default
 * favours speed; "medium" is what the desktop's libopenshot uses (x264's own
 * default, FFmpegWriter.cpp sets no preset for crf > 0).
 */
export const ENCODER_PRESETS = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"] as const;
export type EncoderPreset = (typeof ENCODER_PRESETS)[number];
export const DEFAULT_ENCODER_PRESET: EncoderPreset = "veryfast";
const VP9_CPU: Record<EncoderPreset, number> = { ultrafast: 8, superfast: 6, veryfast: 5, faster: 4, fast: 3, medium: 2, slow: 1, slower: 1, veryslow: 0 };

/** `ExportOptions` plus the Node exporter's encoder speed. */
export type NodeExportOptions = ExportOptions & { encoderPreset?: EncoderPreset };

export function isEncoderPreset(value: unknown): value is EncoderPreset {
  return typeof value === "string" && (ENCODER_PRESETS as readonly string[]).includes(value);
}

/** Used only when the engine has no ladder for the codec (wav has no bitrate). */
const FALLBACK_AUDIO_BITRATE = 192_000;
/** libopus accepts at most 510 kb/s for stereo. */
const OPUS_MAX_BITRATE = 510_000;

export interface EncodeJob {
  format: ContainerFormat;
  /** File (or `%05d` pattern for an image sequence) ffmpeg writes. */
  output: string;
  video?: { width: number; height: number; fps: Fraction };
  audio?: { graph: AudioGraph; sampleRate: number; channels: number };
  options: NodeExportOptions;
  /** ffmpeg major version (filter script syntax changed in 7.0). */
  ffmpegMajor: number;
  /** Where to put a large filter graph script. */
  scriptPath: string;
}

export interface EncodeCommand {
  args: string[];
  /** Write this file before spawning when set. */
  script?: { path: string; contents: string };
}

/** Numbered image files, the first one 1 (like libopenshot's image sequences). */
const IMAGE_SEQUENCE = ["-f", "image2", "-start_number", "1"];

/** Raw frames must have even sizes for 4:2:0 codecs; pad instead of scaling. */
const PAD_EVEN = "pad=ceil(iw/2)*2:ceil(ih/2)*2";
/** RGB → BT.709 limited range, tagged below, so players reproduce the colors. */
const TO_YUV = (pixFmt: string) => `scale=out_color_matrix=bt709:out_range=tv,format=${pixFmt}`;
const COLOR_TAGS = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];

/** The options `encoderRates` sees: the frame actually encoded, quality defaulting to the dialog's "high". */
function rateOptions(job: EncodeJob): ExportOptions {
  const frame = job.video ?? { width: job.options.width, height: job.options.height, fps: job.options.fps };
  return { ...job.options, width: frame.width, height: frame.height, fps: frame.fps };
}

/** ffmpeg rate-control arguments for x264/x265/VP9/other encoders. */
export function videoRateArgs(rate: VideoRate | null, codec: string): string[] {
  if (!rate) return [];
  const vpx = codec.startsWith("libvpx");
  const x26x = codec === "libx264" || codec === "libx265";
  switch (rate.mode) {
    case "bitrate":
      return ["-b:v", String(Math.round(rate.bitsPerSecond))];
    case "lossless":
      if (codec === "libx265") return ["-x265-params", "lossless=1"];
      if (vpx) return ["-lossless", "1"];
      return x26x ? ["-qp", "0"] : [];
    case "qp":
      if (vpx) return ["-b:v", "0", "-crf", String(rate.value)];
      return x26x ? ["-qp", String(rate.value)] : ["-q:v", String(rate.value)];
    case "crf":
      if (vpx) return ["-b:v", "0", "-crf", String(rate.value)];
      return x26x ? ["-crf", String(rate.value)] : [];
  }
}

function videoChain(job: EncodeJob): { chain: string; codecArgs: string[] } {
  const quality = job.options.quality ?? "high";
  const preset = isEncoderPreset(job.options.encoderPreset) ? job.options.encoderPreset : DEFAULT_ENCODER_PRESET;
  const rate = encoderRates(rateOptions(job)).video;
  switch (job.format) {
    case "gif":
      return {
        chain: `[0:v]split[zv0][zv1];[zv0]palettegen=stats_mode=diff[zpal];[zv1][zpal]paletteuse=dither=sierra2_4a[vout]`,
        codecArgs: ["-loop", "0"],
      };
    case "png-sequence":
      return { chain: `[0:v]format=rgba[vout]`, codecArgs: ["-c:v", "png", ...IMAGE_SEQUENCE] };
    case "jpg-sequence": {
      // ffmpeg's -q:v scale (2 is near the best JPEG it writes).
      const q = quality === "low" ? "10" : quality === "medium" ? "5" : quality === "high" ? "2" : "1";
      return { chain: `[0:v]format=yuvj420p[vout]`, codecArgs: ["-c:v", "mjpeg", "-q:v", q, ...IMAGE_SEQUENCE] };
    }
    case "bmp-sequence":
      return { chain: `[0:v]format=bgr24[vout]`, codecArgs: ["-c:v", "bmp", ...IMAGE_SEQUENCE] };
    case "tiff-sequence":
      return { chain: `[0:v]format=rgba[vout]`, codecArgs: ["-c:v", "tiff", ...IMAGE_SEQUENCE] };
    case "webm": {
      const codec = job.options.videoCodec ?? "libvpx-vp9";
      return {
        chain: `[0:v]${PAD_EVEN},${TO_YUV("yuv420p")}[vout]`,
        codecArgs: ["-c:v", codec, ...videoRateArgs(rate, codec), "-deadline", "good", "-cpu-used", String(VP9_CPU[preset]), "-row-mt", "1", ...COLOR_TAGS],
      };
    }
    default: {
      const codec = job.options.videoCodec ?? "libx264";
      if (codec.startsWith("prores")) {
        const profile = quality === "low" ? "0" : quality === "medium" ? "2" : quality === "high" ? "3" : "4";
        return {
          chain: `[0:v]${PAD_EVEN},${TO_YUV(profile === "4" ? "yuva444p10le" : "yuv422p10le")}[vout]`,
          codecArgs: ["-c:v", codec, "-profile:v", profile, ...COLOR_TAGS],
        };
      }
      const lossless = rate?.mode === "lossless";
      const speed = codec === "libx264" || codec === "libx265" ? ["-preset", preset] : [];
      return {
        chain: `[0:v]${PAD_EVEN},${TO_YUV(lossless ? "yuv444p" : "yuv420p")}[vout]`,
        codecArgs: ["-c:v", codec, ...speed, ...videoRateArgs(rate, codec), ...COLOR_TAGS],
      };
    }
  }
}

/** Whether the export's audio goes through a lossy codec (the default codec of `format` when none is named). */
export function isLossyAudio(format: ContainerFormat, audioCodec?: string): boolean {
  const codec = audioCodec ?? (format === "wav" ? "pcm_s16le" : format === "flac" ? "flac" : "aac");
  return !/^(pcm_|flac$|alac$)/.test(codec);
}

function audioCodecArgs(job: EncodeJob): string[] {
  const rate = encoderRates(rateOptions(job)).audioBitsPerSecond ?? job.options.audioBitrate ?? FALLBACK_AUDIO_BITRATE;
  const bitrate = String(Math.round(rate));
  switch (job.format) {
    case "wav":
      return ["-c:a", job.options.audioCodec ?? "pcm_s16le"];
    case "flac":
      return ["-c:a", job.options.audioCodec ?? "flac"];
    case "mp3":
      return ["-c:a", job.options.audioCodec ?? "libmp3lame", "-b:a", bitrate];
    case "webm":
      return ["-c:a", job.options.audioCodec ?? "libopus", "-b:a", String(Math.min(Number(bitrate), OPUS_MAX_BITRATE))];
    default:
      return ["-c:a", job.options.audioCodec ?? "aac", "-b:a", bitrate];
  }
}

function muxerArgs(format: ContainerFormat): string[] {
  switch (format) {
    case "mp4":
      return ["-movflags", "+faststart", "-f", "mp4"];
    case "mov":
      return ["-movflags", "+faststart", "-f", "mov"];
    case "mkv":
      return ["-f", "matroska"];
    case "webm":
      return ["-f", "webm"];
    case "gif":
      return ["-f", "gif"];
    case "mp3":
      return ["-f", "mp3"];
    case "wav":
      return ["-f", "wav"];
    case "flac":
      return ["-f", "flac"];
    case "m4a":
      return ["-movflags", "+faststart", "-f", "mp4"];
    case "png-sequence":
    case "jpg-sequence":
    case "bmp-sequence":
    case "tiff-sequence":
      return [];
  }
}

/** Parse "9.0.2", "6.1.1-3ubuntu5", "n7.1"; development builds count as current. */
export function ffmpegMajorVersion(version: string): number {
  const m = /^n?(\d+)\./.exec(version.trim());
  return m ? Number(m[1]) : 99;
}

let versionPromise: Promise<number> | undefined;
/** The installed ffmpeg's major version (cached; 99 when it cannot be read). */
export function ffmpegMajor(): Promise<number> {
  versionPromise ??= binaryVersion("ffmpeg")
    .then((v) => ffmpegMajorVersion(v.version))
    .catch(() => 99);
  return versionPromise;
}

export const SCRIPT_THRESHOLD = 8 * 1024;

export function encoderCommand(job: EncodeJob): EncodeCommand {
  const info = FORMATS[job.format];
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"];
  const graphs: string[] = [];
  const maps: string[] = [];

  if (info.video) {
    if (!job.video) throw new Error(`${job.format} output needs video frames`);
    args.push(
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "-s", `${job.video.width}x${job.video.height}`,
      "-r", `${job.video.fps.num}/${job.video.fps.den}`,
      "-i", "pipe:0",
    );
  }
  if (info.audio && job.audio) {
    for (const input of job.audio.graph.inputs) {
      args.push("-ss", input.seek.toFixed(6), "-t", input.duration.toFixed(6), "-i", input.path);
    }
  }

  let videoCodec: string[] = [];
  if (info.video && job.video) {
    const v = videoChain(job);
    graphs.push(v.chain);
    maps.push("-map", "[vout]");
    videoCodec = v.codecArgs;
  }
  let audioCodec: string[] = [];
  if (info.audio && job.audio) {
    graphs.push(job.audio.graph.filter);
    maps.push("-map", "[aout]");
    audioCodec = [...audioCodecArgs(job), "-ar", String(job.audio.sampleRate), "-ac", String(job.audio.channels)];
  }

  const graph = graphs.join(";");
  let script: EncodeCommand["script"];
  if (graph.length > SCRIPT_THRESHOLD) {
    script = { path: job.scriptPath, contents: graph };
    args.push(job.ffmpegMajor >= 7 ? "-/filter_complex" : "-filter_complex_script", job.scriptPath);
  } else if (graph) {
    args.push("-filter_complex", graph);
  }
  args.push(...maps, ...videoCodec, ...audioCodec, ...(videoCodec.length > 0 ? ffmpegThreads("encode") : []));
  if (info.video && job.video && !isSequenceFormat(job.format)) args.push("-r", `${job.video.fps.num}/${job.video.fps.den}`);
  args.push("-metadata", "comment=Made with Zenvi", ...muxerArgs(job.format), job.output);
  return { args, script };
}
