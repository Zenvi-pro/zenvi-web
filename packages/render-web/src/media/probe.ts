/**
 * `probeMedia`: the `ReaderInfo` the desktop would write for a file.
 *
 * Audio/video goes through Mediabunny (demux only, nothing is decoded), stills
 * through `createImageBitmap`, SVG through QtSvg's size rules. The mapping to
 * libopenshot fields lives in `probe-map.ts`.
 */

import {
  ADTS,
  ALL_FORMATS,
  FLAC,
  Input,
  MATROSKA,
  MP3,
  MP4,
  MPEG_TS,
  OGG,
  QTFF,
  UnsupportedInputFormatError,
  WAVE,
  WEBM,
  type InputAudioTrack,
  type InputFormat,
  type InputTrack,
  type InputVideoTrack,
  type MetadataTags,
} from "mediabunny";
import type { ReaderInfo } from "@zenvi/engine";
import {
  readerInfoForImage,
  readerInfoFromFacts,
  type AudioFacts,
  type ContainerKind,
  type MediaFacts,
  type VideoFacts,
} from "./probe-map.js";
import { openSource, readBlob, sourceName, type MediaSourceSpec } from "./source.js";
import { parseSvgSize } from "./svg.js";

export interface ProbeOptions {
  /** Stored as `ReaderInfo.path`. Defaults to the source's file name. */
  path?: string;
  /** Picture size reported for audio-only media (the project size on the desktop). Default 720×480. */
  audioOnlySize?: { width: number; height: number };
  signal?: AbortSignal;
}

export type MediaKind = "svg" | "image" | "av";

const RASTER_EXTENSIONS = /\.(png|jpe?g|webp|bmp|gif|avif|ico)$/i;

/**
 * How a file is read. GIFs are read as stills (first frame): browsers have no
 * demuxer for them, where the desktop's FFmpegReader animates them.
 */
export function mediaKind(name: string, mimeType = ""): MediaKind {
  const mime = mimeType.toLowerCase();
  const base = (name.toLowerCase().split("?")[0] ?? "").trim();
  if (mime === "image/svg+xml" || base.endsWith(".svg")) return "svg";
  if (mime.startsWith("image/") || RASTER_EXTENSIONS.test(base)) return "image";
  return "av";
}

export class ProbeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProbeError";
  }
}

/** Probe any supported media and return libopenshot-compatible reader info. */
export async function probeMedia(spec: MediaSourceSpec, options: ProbeOptions = {}): Promise<ReaderInfo> {
  const name = sourceName(spec);
  const path = options.path ?? name;
  const mime = spec.kind === "blob" ? spec.blob.type : "";
  const kind = mediaKind(path || name, mime);
  if (kind !== "av") return probeStill(spec, kind, path, options.signal);

  const input = new Input({ formats: ALL_FORMATS, source: await openSource(spec) });
  try {
    const facts = await gatherFacts(input);
    return readerInfoFromFacts(facts, { path, ...(options.audioOnlySize ? { audioOnlySize: options.audioOnlySize } : {}) });
  } catch (error) {
    if (error instanceof UnsupportedInputFormatError) {
      throw new ProbeError(`Unsupported media format: ${name || "file"}`, { cause: error });
    }
    throw error;
  } finally {
    input.dispose();
  }
}

async function probeStill(spec: MediaSourceSpec, kind: "svg" | "image", path: string, signal?: AbortSignal): Promise<ReaderInfo> {
  const blob = await readBlob(spec, signal);
  if (kind === "svg") {
    // Content-bound sizes need a renderer; 300×150 is the browser default for such SVGs.
    const size = parseSvgSize(await blob.text()) ?? { width: 300, height: 150 };
    return readerInfoForImage(size.width, size.height, { path });
  }
  let bitmap: ImageBitmap;
  try {
    // EXIF orientation is applied, like QImageReader::setAutoTransform.
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch (error) {
    throw new ProbeError(`Unsupported image: ${path || "file"}`, { cause: error });
  }
  try {
    return readerInfoForImage(bitmap.width, bitmap.height, { path });
  } finally {
    bitmap.close();
  }
}

function containerOf(format: InputFormat): ContainerKind {
  if (format === MP4) return "mp4";
  if (format === QTFF) return "mov";
  if (format === WEBM) return "webm";
  if (format === MATROSKA) return "matroska";
  if (format === MP3) return "mp3";
  if (format === WAVE) return "wav";
  if (format === OGG) return "ogg";
  if (format === FLAC) return "flac";
  if (format === ADTS) return "adts";
  if (format === MPEG_TS) return "mpegts";
  return "other";
}

/** Containers whose streams carry their own duration the way FFmpeg reads it (`AVStream.duration`). */
function streamDurationFromMetadata(container: ContainerKind): boolean {
  return container === "mp4" || container === "mov";
}

/** Containers where FFmpeg leaves `AVStream.duration` unset. */
function streamDurationUnknown(container: ContainerKind): boolean {
  return container === "webm" || container === "matroska" || container === "mpegts";
}

async function streamDuration(track: InputTrack, container: ContainerKind): Promise<number | null> {
  if (streamDurationUnknown(container)) return null;
  if (streamDurationFromMetadata(container)) return (await track.getDurationFromMetadata()) ?? (await track.computeDuration());
  return track.computeDuration();
}

/** FFmpeg's `codecpar->bit_rate` is the container's average bitrate (MP4 esds `avgBitrate`), not the peak. */
async function streamBitrate(track: InputTrack): Promise<number | null> {
  return (await track.getAverageBitrate()) ?? (await track.getBitrate());
}

/**
 * FFmpeg reports `language` only where the container stores one: MP4/MOV
 * always do (`mdhd`, "und" included); elsewhere only an explicit code counts.
 */
async function streamLanguage(track: InputTrack, container: ContainerKind): Promise<string | null> {
  const code = await track.getLanguageCode();
  if (container === "mp4" || container === "mov") return code;
  return code && code !== "und" ? code : null;
}

/** Collect everything `readerInfoFromFacts` needs from an open input. */
export async function gatherFacts(input: Input): Promise<MediaFacts> {
  const container = containerOf(await input.getFormat());
  const tracks = await input.getTracks();
  // libopenshot takes the first video and the first audio stream in file order
  // (FFmpegReader.cpp:292-306), not the "primary" ones.
  const videoIndex = tracks.findIndex((t) => t.isVideoTrack());
  const audioIndex = tracks.findIndex((t) => t.isAudioTrack());
  const videoTrack = videoIndex >= 0 ? (tracks[videoIndex] as InputVideoTrack) : null;
  const audioTrack = audioIndex >= 0 ? (tracks[audioIndex] as InputAudioTrack) : null;

  const [fileSize, metadataDuration, tags] = await Promise.all([
    input.source.getSizeOrNull(),
    input.getDurationFromMetadata(),
    input.getMetadataTags(),
  ]);
  const formatDuration = metadataDuration ?? (await input.computeDuration());

  return {
    container,
    fileSize: fileSize ?? 0,
    formatDuration: formatDuration > 0 ? formatDuration : null,
    tags: ffmpegTags(tags, container),
    video: videoTrack ? await videoFacts(videoTrack, videoIndex, container) : null,
    audio: audioTrack ? await audioFacts(audioTrack, audioIndex, container) : null,
  };
}

async function videoFacts(track: InputVideoTrack, index: number, container: ContainerKind): Promise<VideoFacts> {
  const [codec, codecString, width, height, rotation, pixelAspect, timeResolution, bitrate, language, colorSpace, duration] =
    await Promise.all([
      track.getCodec(),
      track.getCodecParameterString(),
      track.getCodedWidth(),
      track.getCodedHeight(),
      track.getRotation(),
      track.getPixelAspectRatio(),
      track.getTimeResolution(),
      streamBitrate(track),
      streamLanguage(track, container),
      track.getColorSpace(),
      streamDuration(track, container),
    ]);
  const rates = await track.computeFrameRateMetrics();
  return {
    index,
    codec,
    codecString,
    width,
    height,
    rotation,
    pixelAspect,
    timeResolution,
    bitrate,
    language,
    fullRange: colorSpace.fullRange ?? null,
    frameRate: rates.underlyingFrameRate ?? rates.bestGuessFrameRate,
    duration,
  };
}

async function audioFacts(track: InputAudioTrack, index: number, container: ContainerKind): Promise<AudioFacts> {
  const [codec, codecString, sampleRate, channels, timeResolution, bitrate, language, duration] = await Promise.all([
    track.getCodec(),
    track.getCodecParameterString(),
    track.getSampleRate(),
    track.getNumberOfChannels(),
    track.getTimeResolution(),
    streamBitrate(track),
    streamLanguage(track, container),
    streamDuration(track, container),
  ]);
  // Without a stored bitrate FFmpeg's demuxers derive one: mov from the sample
  // sizes over the duration, mp3 from the frame header. Matroska, Ogg and FLAC
  // leave it to the format bitrate.
  let measuredBitrate: number | null = null;
  if (!bitrate && (container === "mp4" || container === "mov")) measuredBitrate = (await track.computePacketStats()).averageBitrate;
  else if (!bitrate && codec === "mp3") measuredBitrate = (await track.computePacketStats(400)).averageBitrate;
  return { index, codec, codecString, sampleRate, channels, timeResolution, bitrate, language, duration, measuredBitrate };
}

/** FFmpeg's names for common container tags (mov/id3v2/riff/vorbis metadata conversion tables). */
const TAG_NAMES: Record<string, string> = {
  "©too": "encoder",
  "©nam": "title",
  "©ART": "artist",
  "©alb": "album",
  "©day": "date",
  "©cmt": "comment",
  "©gen": "genre",
  aART: "album_artist",
  cprt: "copyright",
  desc: "description",
  TSSE: "encoder",
  TIT2: "title",
  TPE1: "artist",
  TALB: "album",
  TPE2: "album_artist",
  TCON: "genre",
  TDRC: "date",
  TYER: "date",
  TRCK: "track",
  TCOP: "copyright",
  ISFT: "encoder",
  INAM: "title",
  IART: "artist",
  ICMT: "comment",
  ICOP: "copyright",
  ICRD: "date",
  IGNR: "genre",
};

function ffmpegTags(tags: MetadataTags, container: ContainerKind): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags.raw ?? {})) {
    const text = Array.isArray(value) ? value.join(";") : typeof value === "string" ? value : null;
    if (text === null) continue;
    const vorbis = container === "ogg" || container === "flac";
    // The Vorbis comment vendor string is not a tag to FFmpeg.
    if (vorbis && key === "vendor") continue;
    const name = TAG_NAMES[key] ?? (vorbis ? key.toLowerCase() : key);
    out[name] = text.trim();
  }
  return out;
}
