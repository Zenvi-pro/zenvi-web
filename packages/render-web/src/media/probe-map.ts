/**
 * Media facts → libopenshot `ReaderInfo`, exactly as the desktop writes a
 * `project.files[]` entry.
 *
 * Ported from libopenshot 1.0 `FFmpegReader::UpdateVideoInfo`,
 * `UpdateAudioInfo`, `ApplyDurationStrategy`, `UpdateOrientedVideoInfo`
 * (`src/FFmpegReader.cpp:852-1240`) and `QtImageReader::Open`. Checked field by
 * field against `openshot.FFmpegReader(path).Json()` for generated fixtures
 * (see `probe.parity.test.ts`). The mapping is pure so it can be tested
 * without a browser; `probe.ts` gathers the facts with Mediabunny.
 */

import { getMediaType, type Fraction, type ReaderInfo } from "@zenvi/engine";
import { FALLBACK_FPS, fractionValue, frameRateToFraction, reduceFraction } from "./fraction.js";

export type ContainerKind = "mp4" | "mov" | "matroska" | "webm" | "mp3" | "wav" | "ogg" | "flac" | "adts" | "mpegts" | "other";

interface StreamFacts {
  /** Position among all streams of the file (FFmpeg stream index). */
  index: number;
  /** Mediabunny codec id (`avc`, `vp9`, `aac`, `pcm-s16`, …) or null when unknown. */
  codec: string | null;
  /** Full codec string (`avc1.64001f`, `vp09.00.10.08`, …). */
  codecString: string | null;
  /** Ticks per second of the stream's timestamps. */
  timeResolution: number;
  /** Duration the container stores for this stream, if it stores one. */
  duration: number | null;
  /** Bitrate from container metadata (bits/s). */
  bitrate: number | null;
  language?: string | null;
}

export interface VideoFacts extends StreamFacts {
  /** Stored picture size before rotation (FFmpeg `codecpar->width/height`). */
  width: number;
  height: number;
  /** Clockwise display rotation from the container matrix. */
  rotation: 0 | 90 | 180 | 270;
  pixelAspect: Fraction;
  /** Measured frames per second, or null when unknown. */
  frameRate: number | null;
  /** Colour range of the samples (true = JPEG/full range). */
  fullRange?: boolean | null;
}

export interface AudioFacts extends StreamFacts {
  sampleRate: number;
  channels: number;
  /**
   * Average bitrate measured from the packets (bits/s), for containers where
   * FFmpeg computes the stream bitrate itself when none is stored (mov, mp3).
   */
  measuredBitrate?: number | null;
}

export interface MediaFacts {
  container: ContainerKind;
  fileSize: number;
  /** Container-level duration (FFmpeg `AVFormatContext.duration`). */
  formatDuration: number | null;
  /** Format-level metadata tags, already mapped to FFmpeg key names. */
  tags: Record<string, string>;
  video: VideoFacts | null;
  audio: AudioFacts | null;
}

export interface ReaderInfoOptions {
  /** Value stored in `path`. */
  path: string;
  /**
   * Picture size reported for audio-only media. libopenshot uses the parent
   * timeline's preview size and falls back to 720×480 (`FFmpegReader.cpp:988-1004`).
   */
  audioOnlySize?: { width: number; height: number };
}

/** FFmpeg decoder names, as libopenshot stores `codec->name` in `vcodec`/`acodec`. */
const FFMPEG_DECODER: Record<string, string> = {
  avc: "h264",
  hevc: "hevc",
  vp8: "vp8",
  vp9: "vp9",
  // FFmpeg builds with dav1d (Homebrew, the desktop's) prefer it for AV1.
  av1: "libdav1d",
  prores: "prores",
  aac: "aac",
  opus: "opus",
  // FFmpeg's default MP3 decoder is the float one.
  mp3: "mp3float",
  vorbis: "vorbis",
  flac: "flac",
  ac3: "ac3",
  eac3: "eac3",
  dts: "dca",
  "pcm-s16": "pcm_s16le",
  "pcm-s16be": "pcm_s16be",
  "pcm-s24": "pcm_s24le",
  "pcm-s24be": "pcm_s24be",
  "pcm-s32": "pcm_s32le",
  "pcm-s32be": "pcm_s32be",
  "pcm-f32": "pcm_f32le",
  "pcm-f32be": "pcm_f32be",
  "pcm-f64": "pcm_f64le",
  "pcm-f64be": "pcm_f64be",
  "pcm-u8": "pcm_u8",
  "pcm-s8": "pcm_s8",
  ulaw: "pcm_mulaw",
  alaw: "pcm_alaw",
};

export function ffmpegDecoderName(codec: string | null): string {
  if (!codec) return "";
  return FFMPEG_DECODER[codec] ?? codec;
}

/** Bits per sample of PCM codecs (FFmpeg sets `bit_rate = rate · channels · bits` for them). */
const PCM_BITS: Record<string, number> = {
  "pcm-s16": 16,
  "pcm-s16be": 16,
  "pcm-s24": 24,
  "pcm-s24be": 24,
  "pcm-s32": 32,
  "pcm-s32be": 32,
  "pcm-f32": 32,
  "pcm-f32be": 32,
  "pcm-f64": 64,
  "pcm-f64be": 64,
  "pcm-u8": 8,
  "pcm-s8": 8,
  ulaw: 8,
  alaw: 8,
};

/** MPEG-1/2 Layer III bitrates (kbps); FFmpeg's MP3 decoder reports the frame header's. */
const MP3_BITRATES = [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 192, 224, 256, 320];

/**
 * FFmpeg's default channel layout masks (`av_channel_layout_default`, as
 * decoders report them for mono/stereo/5.1). Mono is 4 (front centre), which is
 * also what libopenshot stores when there is no audio at all.
 */
export function channelLayoutFor(channels: number): number {
  switch (channels) {
    case 1:
      return 4;
    case 2:
      return 3;
    case 3:
      return 7; // 3.0
    case 4:
      return 51; // quad
    case 5:
      return 55; // 5.0(back)
    case 6:
      return 63; // 5.1(back)
    case 7:
      return 1807; // 6.1(back)
    case 8:
      return 1599; // 7.1
    default:
      return channels > 0 ? 0 : 4;
  }
}

/** AVPixelFormat values (FFmpeg 7–9 `pixfmt.h`) for what the codec string implies. */
const PIX = {
  NONE: -1,
  YUV420P: 0,
  YUV422P: 4,
  YUV444P: 5,
  YUVJ420P: 12,
  YUV420P10LE: 62,
  YUV422P10LE: 64,
  YUV444P10LE: 68,
} as const;

/** Best-effort `pixel_format` from the codec string (the decoder is never opened to probe). */
export function pixelFormatFor(codec: string | null, codecString: string | null, fullRange?: boolean | null): number {
  const parts = (codecString ?? "").split(".");
  const eightBit420 = fullRange ? PIX.YUVJ420P : PIX.YUV420P;
  switch (codec) {
    case "avc": {
      const profile = parseInt((parts[1] ?? "").slice(0, 2), 16);
      if (profile === 110) return PIX.YUV420P10LE;
      if (profile === 122) return PIX.YUV422P10LE;
      if (profile === 244) return PIX.YUV444P;
      return eightBit420;
    }
    case "hevc":
      return parts[1] === "2" ? PIX.YUV420P10LE : eightBit420;
    case "vp9": {
      const profile = Number(parts[1] ?? 0);
      const depth = Number(parts[3] ?? 8);
      if (depth > 8) return profile === 3 ? PIX.YUV444P10LE : PIX.YUV420P10LE;
      return profile === 1 ? PIX.YUV444P : PIX.YUV420P;
    }
    case "av1": {
      const depth = Number(parts[3] ?? 8);
      return depth > 8 ? PIX.YUV420P10LE : PIX.YUV420P;
    }
    case "vp8":
      return PIX.YUV420P;
    case "prores":
      return PIX.YUV422P10LE;
    default:
      return codec ? PIX.YUV420P : PIX.NONE;
  }
}

/** Audio stream timebase as FFmpeg's demuxers set it. */
function audioTimebase(container: ContainerKind, audio: AudioFacts): Fraction {
  switch (container) {
    case "mp3":
      return { num: 1, den: 14112000 }; // mp3dec.c: avpriv_set_pts_info(st, 64, 1, 14112000)
    case "adts":
      return { num: 1, den: 28224000 }; // aacdec.c (raw ADTS)
    case "matroska":
    case "webm":
      return { num: 1, den: 1000 };
    case "mpegts":
      return { num: 1, den: 90000 };
    case "wav":
    case "flac":
    case "ogg":
      return { num: 1, den: audio.sampleRate };
    default:
      return integerTimebase(audio.timeResolution, audio.sampleRate);
  }
}

function integerTimebase(resolution: number, fallback: number): Fraction {
  if (Number.isFinite(resolution) && resolution > 0 && Math.abs(resolution - Math.round(resolution)) < 1e-9) {
    return { num: 1, den: Math.round(resolution) };
  }
  return { num: 1, den: Math.max(1, Math.round(fallback)) };
}

/** `FFmpegReader::PickDurationSeconds` with the default `VideoPreferred` strategy. */
export function pickDurationSeconds(video: number | null, audio: number | null, format: number | null): number {
  for (const candidate of [video, audio, format]) {
    if (candidate !== null && candidate > 0) return candidate;
  }
  return 0;
}

/**
 * `FFmpegReader::ApplyDurationStrategy`: frames = llround(seconds · fps),
 * duration = float(frames / fps). `ReaderInfo::duration` is a C `float`.
 */
export function durationToFrames(seconds: number, fps: Fraction): { videoLength: number; duration: number } {
  const rate = fractionValue(fps);
  if (!(seconds > 0) || !(rate > 0)) return { videoLength: 0, duration: 0 };
  const frames = roundHalfAway(seconds * rate);
  if (frames <= 0) return { videoLength: 0, duration: 0 };
  return { videoLength: frames, duration: Math.fround(frames / rate) };
}

function roundHalfAway(x: number): number {
  return Math.sign(x) * Math.floor(Math.abs(x) + 0.5);
}

/**
 * `metadata.rotate`: `std::to_string(-av_display_rotation_get(matrix))`
 * (`FFmpegReader.cpp:676-686`), i.e. the clockwise angle in [-180, 180].
 * Measured: a quarter turn clockwise is "90.000000", counter-clockwise
 * "-90.000000", a half turn "180.000000" (FFmpeg returns -180 for it).
 */
export function rotateTag(rotation: 0 | 90 | 180 | 270): string | undefined {
  switch (rotation) {
    case 90:
      return "90.000000";
    case 180:
      return "180.000000";
    case 270:
      return "-90.000000";
    default:
      return undefined;
  }
}

/** `ReaderInfo` of an audio/video file (`type: "FFmpegReader"`). */
export function readerInfoFromFacts(facts: MediaFacts, options: ReaderInfoOptions): ReaderInfo {
  const { video, audio } = facts;
  const formatBitrate =
    facts.formatDuration !== null && facts.formatDuration > 0 ? Math.trunc((facts.fileSize * 8) / facts.formatDuration) : 0;

  const metadata: Record<string, string> = {};
  if (video?.language) metadata.language = video.language;
  if (audio?.language) metadata.language = audio.language;
  Object.assign(metadata, facts.tags);

  let fps: Fraction = { ...FALLBACK_FPS };
  let width = 0;
  let height = 0;
  let displayRatio: Fraction = { num: 1, den: 1 };
  let pixelRatio: Fraction = { num: 1, den: 1 };
  let videoTimebase: Fraction = { num: 1, den: 30 };
  if (video) {
    fps = frameRateToFraction(video.frameRate, video.timeResolution);
    pixelRatio = video.pixelAspect.num > 0 && video.pixelAspect.den > 0 ? reduceFraction(video.pixelAspect.num, video.pixelAspect.den) : { num: 1, den: 1 };
    // UpdateOrientedVideoInfo: the bounding box of the rotated picture.
    const quarter = video.rotation === 90 || video.rotation === 270;
    width = quarter ? video.height : video.width;
    height = quarter ? video.width : video.height;
    displayRatio = reduceFraction(width * pixelRatio.num, height * pixelRatio.den);
    videoTimebase = integerTimebase(video.timeResolution, fractionValue(fps));
    const rotate = rotateTag(video.rotation);
    if (rotate !== undefined) metadata.rotate = rotate;
  } else {
    width = options.audioOnlySize?.width ?? 720;
    height = options.audioOnlySize?.height ?? 480;
  }

  const seconds = pickDurationSeconds(video?.duration ?? null, audio?.duration ?? null, facts.formatDuration);
  const { videoLength, duration } = durationToFrames(seconds, fps);

  let audioBitrate = 0;
  if (audio) {
    const pcmBits = audio.codec ? PCM_BITS[audio.codec] : undefined;
    if (pcmBits !== undefined) audioBitrate = audio.sampleRate * audio.channels * pcmBits;
    else if (audio.bitrate !== null && audio.bitrate > 0) audioBitrate = Math.round(audio.bitrate);
    else if (audio.codec === "mp3" && audio.measuredBitrate) audioBitrate = nearestMp3Bitrate(audio.measuredBitrate);
    else if (audio.measuredBitrate) audioBitrate = Math.trunc(audio.measuredBitrate);
    else audioBitrate = formatBitrate;
  }

  return {
    acodec: ffmpegDecoderName(audio?.codec ?? null),
    audio_bit_rate: audioBitrate,
    audio_stream_index: audio ? audio.index : -1,
    audio_timebase: audio ? audioTimebase(facts.container, audio) : { num: 1, den: 1 },
    channel_layout: audio ? channelLayoutFor(audio.channels) : 4,
    channels: audio ? audio.channels : 0,
    display_ratio: displayRatio,
    duration,
    duration_strategy: "VideoPreferred",
    file_size: facts.fileSize,
    fps,
    has_audio: audio !== null,
    has_single_image: false,
    has_video: video !== null,
    height,
    interlaced_frame: false,
    metadata,
    path: options.path,
    pixel_format: video ? pixelFormatFor(video.codec, video.codecString, video.fullRange) : -1,
    pixel_ratio: pixelRatio,
    sample_rate: audio ? audio.sampleRate : 0,
    top_field_first: true,
    type: "FFmpegReader",
    vcodec: ffmpegDecoderName(video?.codec ?? null),
    video_bit_rate: video ? Math.trunc(formatBitrate / 8) : 0,
    video_length: videoLength,
    video_stream_index: video ? video.index : -1,
    video_timebase: videoTimebase,
    width,
    // The desktop importer's classification (extension first: MP3 cover art reports video).
    media_type: getMediaType({ path: options.path, has_video: video !== null, has_audio: audio !== null }),
  };
}

function nearestMp3Bitrate(bitsPerSecond: number): number {
  const kbps = bitsPerSecond / 1000;
  let best = MP3_BITRATES[0]!;
  for (const rate of MP3_BITRATES) if (Math.abs(rate - kbps) < Math.abs(best - kbps)) best = rate;
  return best * 1000;
}

/**
 * `ReaderInfo` of a still image or SVG (`type: "QtImageReader"`,
 * `QtImageReader.cpp`): one hour at 30 fps, and `file_size` is the decoded
 * RGBA byte count (`QImage::sizeInBytes`), not the file size.
 */
export function readerInfoForImage(width: number, height: number, options: ReaderInfoOptions): ReaderInfo {
  const w = Math.max(0, Math.round(width));
  const h = Math.max(0, Math.round(height));
  return {
    acodec: "",
    audio_bit_rate: 0,
    audio_stream_index: -1,
    audio_timebase: { num: 1, den: 1 },
    channel_layout: 4,
    channels: 0,
    display_ratio: w > 0 && h > 0 ? reduceFraction(w, h) : { num: 1, den: 1 },
    duration: 3600,
    file_size: w * h * 4,
    fps: { num: 30, den: 1 },
    has_audio: false,
    has_single_image: true,
    has_video: true,
    height: h,
    interlaced_frame: false,
    metadata: {},
    path: options.path,
    pixel_format: -1,
    pixel_ratio: { num: 1, den: 1 },
    sample_rate: 0,
    top_field_first: true,
    type: "QtImageReader",
    vcodec: "QImage",
    video_bit_rate: 0,
    video_length: 108000,
    video_stream_index: -1,
    video_timebase: { num: 1, den: 30 },
    width: w,
    media_type: "image",
  };
}
