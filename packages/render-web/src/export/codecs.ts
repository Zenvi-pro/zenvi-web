/**
 * Output container and codecs for an export, from what the browser can encode.
 *
 * MP4 means H.264 + AAC, the file every player opens. When this browser
 * cannot encode H.264 (Chromium builds without proprietary codecs) the export
 * becomes WebM with VP9 (then VP8, AV1) and Opus. Audio that cannot be
 * encoded is dropped rather than failing the export, as the desktop retries
 * "video only" (zenvi-core `windows/export.py`).
 */

import type { AudioCodec, VideoCodec } from "mediabunny";
import type { ContainerFormat } from "@zenvi/engine/tools";

export type WebContainer = "mp4" | "webm" | "mov" | "mkv" | "wav";

export interface CodecChoice {
  container: WebContainer;
  videoCodec: VideoCodec | null;
  audioCodec: AudioCodec | null;
  width: number;
  height: number;
  /** Why the choice differs from what was asked for, if it does. */
  notes: string[];
}

export interface EncodeSupport {
  canEncodeVideo(codec: VideoCodec, options: { width: number; height: number; bitrate?: number; frameRate?: number }): Promise<boolean>;
  canEncodeAudio(codec: AudioCodec, options: { sampleRate: number; numberOfChannels: number; bitrate?: number }): Promise<boolean>;
}

export class ExportError extends Error {
  constructor(
    readonly code: "unsupported-format" | "no-encoder" | "no-audio-encoder" | "empty-range" | "aborted",
    message: string,
  ) {
    super(message);
    this.name = "ExportError";
  }
}

const VIDEO_ALIASES: Record<string, VideoCodec> = {
  avc: "avc",
  h264: "avc",
  libx264: "avc",
  libopenh264: "avc",
  hevc: "hevc",
  h265: "hevc",
  libx265: "hevc",
  vp9: "vp9",
  "libvpx-vp9": "vp9",
  vp8: "vp8",
  libvpx: "vp8",
  av1: "av1",
  "libaom-av1": "av1",
  libsvtav1: "av1",
  "librav1e": "av1",
  prores: "prores",
  prores_ks: "prores",
};

const AUDIO_ALIASES: Record<string, AudioCodec> = {
  aac: "aac",
  libfdk_aac: "aac",
  opus: "opus",
  libopus: "opus",
  vorbis: "vorbis",
  libvorbis: "vorbis",
  flac: "flac",
  mp3: "mp3",
  libmp3lame: "mp3",
  pcm_s16le: "pcm-s16",
  "pcm-s16": "pcm-s16",
};

/** A codec name as the desktop's export presets write it (FFmpeg encoder names) → Mediabunny's. */
export function videoCodecFromName(name: string | undefined): VideoCodec | undefined {
  return name ? VIDEO_ALIASES[name.toLowerCase()] : undefined;
}

export function audioCodecFromName(name: string | undefined): AudioCodec | undefined {
  return name ? AUDIO_ALIASES[name.toLowerCase()] : undefined;
}

const CONTAINER_VIDEO: Record<WebContainer, VideoCodec[]> = {
  mp4: ["avc"],
  mov: ["avc", "hevc", "prores"],
  mkv: ["avc", "vp9", "hevc", "av1", "vp8"],
  webm: ["vp9", "vp8", "av1"],
  wav: [],
};

const CONTAINER_VIDEO_ALLOWED: Record<WebContainer, VideoCodec[]> = {
  mp4: ["avc", "hevc", "vp9", "av1", "vp8"],
  mov: ["avc", "hevc", "vp9", "av1", "vp8", "prores"],
  mkv: ["avc", "hevc", "vp9", "av1", "vp8"],
  webm: ["vp9", "vp8", "av1"],
  wav: [],
};

const CONTAINER_AUDIO: Record<WebContainer, AudioCodec[]> = {
  mp4: ["aac", "opus"],
  mov: ["aac", "opus"],
  mkv: ["opus", "aac", "vorbis", "flac"],
  webm: ["opus", "vorbis"],
  wav: ["pcm-s16"],
};

function webContainer(format: ContainerFormat): WebContainer {
  switch (format) {
    case "mp4":
    case "webm":
    case "mov":
    case "mkv":
    case "wav":
      return format;
    default:
      throw new ExportError("unsupported-format", `Exporting ${format} is not supported in the browser (use mp4, webm, mov, mkv or wav)`);
  }
}

/** 4:2:0 H.264/HEVC encoders need even dimensions. */
function evenFor(codec: VideoCodec | null, size: number): number {
  const whole = Math.max(2, Math.round(size));
  return codec === "avc" || codec === "hevc" ? whole - (whole % 2) : whole;
}

export interface ChooseOptions {
  format: ContainerFormat;
  width: number;
  height: number;
  frameRate: number;
  videoCodec?: string;
  audioCodec?: string;
  videoBitrate?: number;
  audioBitrate?: number;
  sampleRate: number;
  channels: number;
  /** Whether the timeline has any audio to encode. */
  hasAudio: boolean;
  /**
   * Export without sound when no audio codec can be encoded. Default false:
   * the export fails with `no-audio-encoder` instead of dropping audio silently.
   */
  allowVideoOnly?: boolean;
}

export async function chooseCodecs(options: ChooseOptions, support: EncodeSupport): Promise<CodecChoice> {
  const requested = webContainer(options.format);
  const notes: string[] = [];

  if (requested === "wav") {
    return { container: "wav", videoCodec: null, audioCodec: "pcm-s16", width: 0, height: 0, notes };
  }

  const wanted = videoCodecFromName(options.videoCodec);
  const attempts: { container: WebContainer; codecs: VideoCodec[] }[] = [];
  if (wanted && CONTAINER_VIDEO_ALLOWED[requested].includes(wanted)) attempts.push({ container: requested, codecs: [wanted] });
  attempts.push({ container: requested, codecs: CONTAINER_VIDEO[requested] });
  if (requested !== "webm") attempts.push({ container: "webm", codecs: CONTAINER_VIDEO.webm });

  let container: WebContainer | null = null;
  let videoCodec: VideoCodec | null = null;
  outer: for (const attempt of attempts) {
    for (const codec of attempt.codecs) {
      const width = evenFor(codec, options.width);
      const height = evenFor(codec, options.height);
      const ok = await support.canEncodeVideo(codec, { width, height, frameRate: options.frameRate, ...(options.videoBitrate ? { bitrate: options.videoBitrate } : {}) });
      if (ok) {
        container = attempt.container;
        videoCodec = codec;
        break outer;
      }
    }
  }
  if (!container || !videoCodec) {
    throw new ExportError("no-encoder", "This browser cannot encode video (no H.264, VP9, VP8 or AV1 encoder)");
  }
  if (container !== requested) notes.push(`${requested.toUpperCase()} needs H.264, which this browser cannot encode; exporting ${container.toUpperCase()} (${videoCodec}) instead`);
  if (wanted && wanted !== videoCodec) notes.push(`${options.videoCodec} is not available; using ${videoCodec}`);

  let audioCodec: AudioCodec | null = null;
  if (options.hasAudio) {
    const wantedAudio = audioCodecFromName(options.audioCodec);
    const firstEncodable = async (box: WebContainer): Promise<AudioCodec | null> => {
      const candidates = [...(wantedAudio && CONTAINER_AUDIO[box].includes(wantedAudio) ? [wantedAudio] : []), ...CONTAINER_AUDIO[box]];
      for (const codec of candidates) {
        const ok = await support.canEncodeAudio(codec, {
          sampleRate: options.sampleRate,
          numberOfChannels: options.channels,
          ...(options.audioBitrate ? { bitrate: options.audioBitrate } : {}),
        });
        if (ok) return codec;
      }
      return null;
    };
    audioCodec = await firstEncodable(container);
    if (!audioCodec && container !== "webm") {
      // The sound matters more than the container: try WebM (Opus/Vorbis) with a WebM video codec.
      const webmAudio = await firstEncodable("webm");
      if (webmAudio) {
        for (const codec of CONTAINER_VIDEO.webm) {
          if (await support.canEncodeVideo(codec, { width: options.width, height: options.height, frameRate: options.frameRate })) {
            notes.push(`No ${container.toUpperCase()} audio encoder is available; exporting WebM (${codec}, ${webmAudio}) to keep the sound`);
            return finish("webm", codec, webmAudio, notes, options);
          }
        }
      }
    }
    if (!audioCodec) {
      // Never drop the sound silently: the person decides.
      if (!options.allowVideoOnly) {
        throw new ExportError("no-audio-encoder", "This browser cannot encode audio (no AAC, Opus or Vorbis encoder); export without sound or render in Zenvi Cloud");
      }
      notes.push("No audio encoder is available; exporting video only");
    }
  }
  return finish(container, videoCodec, audioCodec, notes, options);
}

/** The choice with the codec's size constraint applied (H.264/HEVC need even dimensions). */
function finish(container: WebContainer, videoCodec: VideoCodec, audioCodec: AudioCodec | null, notes: string[], options: ChooseOptions): CodecChoice {
  const width = evenFor(videoCodec, options.width);
  const height = evenFor(videoCodec, options.height);
  if (width !== Math.round(options.width) || height !== Math.round(options.height)) notes.push(`${videoCodec} needs even dimensions; exporting ${width}×${height}`);
  return { container, videoCodec, audioCodec, width, height, notes };
}
