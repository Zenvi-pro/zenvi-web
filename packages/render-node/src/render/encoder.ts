/**
 * ffmpeg encoder command lines for every export format.
 *
 * Video arrives as raw RGBA on stdin (input 0); audio sources are extra
 * inputs mixed by the audio graph. Everything is routed through one
 * `filter_complex`, written to a script file when it is large (Windows limits
 * command lines to 32 KB).
 */

import path from "node:path";
import type { ContainerFormat, ExportOptions, Fraction } from "@zenvi/engine";
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
  "png-sequence": { video: true, audio: false, mimeType: "image/png", extension: "png" },
};

/** Format implied by an output file name, if any. */
export function formatFromPath(file: string): ContainerFormat | undefined {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (ext === "png") return "png-sequence";
  if (ext === "m4v") return "mp4";
  return (Object.keys(FORMATS) as ContainerFormat[]).find((f) => FORMATS[f].extension === ext);
}

const X264: Record<Quality, { crf: number; preset: string }> = {
  low: { crf: 28, preset: "veryfast" },
  medium: { crf: 23, preset: "medium" },
  high: { crf: 18, preset: "medium" },
  lossless: { crf: 0, preset: "veryfast" },
};
const VP9: Record<Quality, { crf: number; cpu: number }> = {
  low: { crf: 40, cpu: 5 },
  medium: { crf: 32, cpu: 4 },
  high: { crf: 24, cpu: 2 },
  lossless: { crf: 0, cpu: 4 },
};
const AUDIO_BITRATE: Record<Quality, number> = { low: 128_000, medium: 192_000, high: 256_000, lossless: 320_000 };

export interface EncodeJob {
  format: ContainerFormat;
  /** File (or `%05d` pattern for png-sequence) ffmpeg writes. */
  output: string;
  video?: { width: number; height: number; fps: Fraction };
  audio?: { graph: AudioGraph; sampleRate: number; channels: number };
  options: ExportOptions;
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

/** Raw frames must have even sizes for 4:2:0 codecs; pad instead of scaling. */
const PAD_EVEN = "pad=ceil(iw/2)*2:ceil(ih/2)*2";
/** RGB → BT.709 limited range, tagged below, so players reproduce the colors. */
const TO_YUV = (pixFmt: string) => `scale=out_color_matrix=bt709:out_range=tv,format=${pixFmt}`;
const COLOR_TAGS = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];

function videoChain(job: EncodeJob): { chain: string; codecArgs: string[] } {
  const quality = job.options.quality ?? "medium";
  const bitrate = job.options.videoBitrate;
  switch (job.format) {
    case "gif":
      return {
        chain: `[0:v]split[zv0][zv1];[zv0]palettegen=stats_mode=diff[zpal];[zv1][zpal]paletteuse=dither=sierra2_4a[vout]`,
        codecArgs: ["-loop", "0"],
      };
    case "png-sequence":
      return { chain: `[0:v]format=rgba[vout]`, codecArgs: ["-c:v", "png", "-f", "image2", "-start_number", "1"] };
    case "webm": {
      const codec = job.options.videoCodec ?? "libvpx-vp9";
      const preset = VP9[quality];
      const rate =
        quality === "lossless" ? ["-lossless", "1"] : bitrate ? ["-b:v", String(Math.round(bitrate))] : ["-b:v", "0", "-crf", String(preset.crf)];
      return {
        chain: `[0:v]${PAD_EVEN},${TO_YUV("yuv420p")}[vout]`,
        codecArgs: ["-c:v", codec, ...rate, "-deadline", "good", "-cpu-used", String(preset.cpu), "-row-mt", "1", ...COLOR_TAGS],
      };
    }
    default: {
      const codec = job.options.videoCodec ?? "libx264";
      const preset = X264[quality];
      if (codec.startsWith("prores")) {
        const profile = quality === "low" ? "0" : quality === "medium" ? "2" : quality === "high" ? "3" : "4";
        return {
          chain: `[0:v]${PAD_EVEN},${TO_YUV(profile === "4" ? "yuva444p10le" : "yuv422p10le")}[vout]`,
          codecArgs: ["-c:v", codec, "-profile:v", profile, ...COLOR_TAGS],
        };
      }
      const pixFmt = quality === "lossless" ? "yuv444p" : "yuv420p";
      let rate: string[];
      if (codec === "libx264" || codec === "libx265") {
        const r = quality === "lossless" ? ["-qp", "0"] : bitrate ? ["-b:v", String(Math.round(bitrate))] : ["-crf", String(preset.crf)];
        rate = ["-preset", preset.preset, ...r];
      } else {
        rate = bitrate ? ["-b:v", String(Math.round(bitrate))] : [];
      }
      return {
        chain: `[0:v]${PAD_EVEN},${TO_YUV(pixFmt)}[vout]`,
        codecArgs: ["-c:v", codec, ...rate, ...COLOR_TAGS],
      };
    }
  }
}

function audioCodecArgs(job: EncodeJob): string[] {
  const quality = job.options.quality ?? "medium";
  const bitrate = String(Math.round(job.options.audioBitrate ?? AUDIO_BITRATE[quality]));
  switch (job.format) {
    case "wav":
      return ["-c:a", job.options.audioCodec ?? "pcm_s16le"];
    case "mp3":
      return ["-c:a", job.options.audioCodec ?? "libmp3lame", "-b:a", bitrate];
    case "webm":
      return ["-c:a", job.options.audioCodec ?? "libopus", "-b:a", String(Math.min(Number(bitrate), 256_000))];
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
    case "png-sequence":
      return [];
  }
}

/** Parse "9.0.2", "6.1.1-3ubuntu5", "n7.1"; development builds count as current. */
export function ffmpegMajorVersion(version: string): number {
  const m = /^n?(\d+)\./.exec(version.trim());
  return m ? Number(m[1]) : 99;
}

const SCRIPT_THRESHOLD = 8 * 1024;

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
  args.push(...maps, ...videoCodec, ...audioCodec);
  if (info.video && job.video && job.format !== "png-sequence") args.push("-r", `${job.video.fps.num}/${job.video.fps.den}`);
  args.push("-metadata", "comment=Made with Zenvi", ...muxerArgs(job.format), job.output);
  return { args, script };
}
