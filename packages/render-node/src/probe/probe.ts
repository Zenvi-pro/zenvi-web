/**
 * `probe(path)`: the file entry the desktop stores when it imports media.
 *
 * The desktop builds a file entry from libopenshot's reader JSON
 * (zenvi-core src/windows/models/files_model.py `inspect_media` + `add_files`).
 * libopenshot trusts those values when it reopens a project (FFmpegReader
 * skips `UpdateVideoInfo` once `vcodec` is set, FFmpegReader.cpp:1037), so
 * fps, sizes, durations and frame counts must match exactly. This module
 * ports the relevant parts of libopenshot 1.0:
 *
 * - reader choice: Clip::CreateReader (Clip.cpp:252)
 * - FFmpegReader::Open / UpdateVideoInfo / UpdateAudioInfo /
 *   ApplyDurationStrategy / UpdateOrientedVideoInfo (FFmpegReader.cpp:263-1241)
 * - QtImageReader::Open (QtImageReader.cpp:37)
 * - ReaderBase defaults and JSON shape (ReaderBase.cpp:30, :110)
 *
 * The desktop's is_audio_only fix-up (files_model.py:963) needs the project,
 * so it lives in the import host, not here.
 */

import { stat } from "node:fs/promises";
import path from "node:path";
import { getMediaType, type Fraction, type MediaType, type ReaderInfo } from "@zenvi/engine";
import { decoderNameFor } from "../ffmpeg/capabilities.js";
import { readSvgFile, svgIntrinsicSize } from "../svg/rasterize.js";
import { imageOrientation, orientationSwapsAxes } from "./exif.js";
import { ffprobe, type FfprobeResult, type FfprobeStream } from "./ffprobe.js";
import { PIXEL_FORMATS } from "./pixfmt.gen.js";

/** Reader info plus the desktop's `media_type`. */
export type ProbedInfo = ReaderInfo & { media_type: MediaType };

export class ProbeError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = "ProbeError";
  }
}

/** Extensions Clip::CreateReader always opens with FFmpegReader. */
const FFMPEG_EXTS = new Set(["avi", "flac", "mov", "mkv", "mpg", "mpeg", "mp3", "mp4", "mts", "ogg", "wav", "wmv", "webm", "vob", "gif"]);
/** Codecs Qt's image plugins decode (QtImageReader succeeds for these). */
const QT_IMAGE_CODECS = new Set(["png", "mjpeg", "bmp", "webp", "tiff", "ppm", "pgm", "pgmyuv", "pbm", "pam", "targa", "xbm", "xpm", "jpeg2000", "sgi"]);

/** FFmpeg channel layout masks by ffprobe name (libavutil 61 standard layouts). */
const CHANNEL_LAYOUTS: Record<string, number> = {
  mono: 4, stereo: 3, "2.1": 11, "3.0": 7, "3.0(back)": 259, "4.0": 263, quad: 51, "quad(side)": 1539,
  "3.1": 15, "5.0": 55, "5.0(side)": 1543, "4.1": 271, "5.1": 63, "5.1(side)": 1551, "6.0": 1799,
  "6.0(front)": 1731, "3.1.2": 20495, hexagonal: 311, "6.1": 1807, "6.1(back)": 319, "6.1(front)": 1739,
  "7.0": 1591, "7.0(front)": 1735, "7.1": 1599, "7.1(wide)": 255, "7.1(wide-side)": 1743, "5.1.2": 22031,
  "5.1.2(back)": 20543, octagonal: 1847, cube: 184371, "5.1.4": 185871, "7.1.2": 22079, "7.1.4": 185919,
  "9.1.4": 186111, downmix: 1610612736,
};
/** av_channel_layout_default() masks by channel count. */
const DEFAULT_LAYOUTS: Record<number, number> = { 1: 4, 2: 3, 3: 11, 4: 263, 5: 55, 6: 63, 7: 1807, 8: 1599 };
/** libopenshot LAYOUT_MONO. */
const LAYOUT_MONO = 4;

const ONE_HOUR = 60 * 60;

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

/** libopenshot Fraction::Reduce. */
function reduce(num: number, den: number): Fraction {
  const g = gcd(num, den);
  return g > 0 ? { num: num / g, den: den / g } : { num, den };
}

function parseRatio(text: string | undefined, sep = "/"): Fraction | undefined {
  if (!text) return undefined;
  const [a, b] = text.split(sep);
  const num = Number(a);
  const den = Number(b);
  return Number.isFinite(num) && Number.isFinite(den) ? { num, den } : undefined;
}

function toDouble(f: Fraction): number {
  return f.num / f.den;
}

function num(text: string | number | undefined): number | undefined {
  if (text === undefined || text === "N/A") return undefined;
  const v = typeof text === "number" ? text : Number(text);
  return Number.isFinite(v) ? v : undefined;
}

/** `av_guess_frame_rate` (libavformat/avformat.c) from what ffprobe exposes. */
export function guessFrameRate(stream: FfprobeStream): Fraction {
  let fr = parseRatio(stream.r_frame_rate) ?? { num: 0, den: 1 };
  const avg = parseRatio(stream.avg_frame_rate);
  if (avg && avg.num > 0 && avg.den > 0 && fr.num > 0 && fr.den > 0 && toDouble(avg) < 70 && toDouble(fr) > 210) {
    fr = avg;
  }
  // Field-coded streams (interlaced H.264/HEVC/MPEG-2) report the field rate
  // in r_frame_rate; FFmpeg then prefers the codec frame rate, which equals
  // the average rate for such streams.
  const fieldCoded = ["h264", "hevc", "mpeg2video", "vc1"].includes(stream.codec_name ?? "");
  const interlaced = ["tt", "bb", "tb", "bt"].includes(stream.field_order ?? "");
  if (fieldCoded && interlaced && avg && avg.num > 0 && avg.den > 0 && fr.num > 0) {
    if (toDouble(avg) < toDouble(fr) * 0.7) fr = avg;
  }
  return fr;
}

/** Keys in the order jsoncpp writes them (alphabetical), like desktop files. */
function sortKeys<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) as T;
}

type DurationStrategy = "VideoPreferred" | "AudioPreferred" | "LongestStream";

interface Durations {
  video: number;
  audio: number;
  format: number;
  inferred: number;
}

/** FFmpegReader::PickDurationSeconds. */
function pickDuration(d: Durations, strategy: DurationStrategy): number {
  const has = (v: number) => v > 0;
  if (strategy === "VideoPreferred") {
    if (has(d.video)) return d.video;
    if (has(d.audio)) return d.audio;
    if (has(d.format)) return d.format;
  } else if (strategy === "AudioPreferred") {
    if (has(d.audio)) return d.audio;
    if (has(d.video)) return d.video;
    if (has(d.format)) return d.format;
  } else {
    const longest = Math.max(0, d.video, d.audio, d.format);
    if (has(longest)) return longest;
  }
  if (has(d.format)) return d.format;
  if (has(d.inferred)) return d.inferred;
  return 0;
}

/** FFmpegReader::ApplyDurationStrategy: frames = llround(seconds × fps), duration = float(frames / fps). */
function applyDuration(info: MutableInfo, d: Durations, strategy: DurationStrategy): void {
  const fps = toDouble(info.fps);
  const seconds = pickDuration(d, strategy);
  if (!(seconds > 0) || !(fps > 0)) {
    info.duration = 0;
    info.video_length = 0;
    return;
  }
  const frames = Math.round(seconds * fps);
  if (frames <= 0) {
    info.duration = 0;
    info.video_length = 0;
    return;
  }
  info.video_length = frames;
  info.duration = Math.fround(frames / fps);
}

/** Working copy of libopenshot's ReaderInfo struct (every field present). */
interface MutableInfo {
  type: string;
  path: string;
  has_video: boolean;
  has_audio: boolean;
  has_single_image: boolean;
  duration: number;
  file_size: number;
  height: number;
  width: number;
  pixel_format: number;
  fps: Fraction;
  video_bit_rate: number;
  pixel_ratio: Fraction;
  display_ratio: Fraction;
  vcodec: string;
  video_length: number;
  video_stream_index: number;
  video_timebase: Fraction;
  interlaced_frame: boolean;
  top_field_first: boolean;
  acodec: string;
  audio_bit_rate: number;
  sample_rate: number;
  channels: number;
  channel_layout: number;
  audio_stream_index: number;
  audio_timebase: Fraction;
  metadata: Record<string, string>;
}

/** ReaderBase::ReaderBase defaults. */
function baseInfo(): MutableInfo {
  return {
    type: "",
    path: "",
    has_video: false,
    has_audio: false,
    has_single_image: false,
    duration: 0,
    file_size: 0,
    height: 0,
    width: 0,
    pixel_format: -1,
    fps: { num: 1, den: 1 },
    video_bit_rate: 0,
    pixel_ratio: { num: 1, den: 1 },
    display_ratio: { num: 1, den: 1 },
    vcodec: "",
    video_length: 0,
    video_stream_index: -1,
    video_timebase: { num: 1, den: 1 },
    interlaced_frame: false,
    top_field_first: true,
    acodec: "",
    audio_bit_rate: 0,
    sample_rate: 0,
    channels: 0,
    channel_layout: LAYOUT_MONO,
    audio_stream_index: -1,
    audio_timebase: { num: 1, den: 1 },
    metadata: {},
  };
}

function addTags(target: Record<string, string>, tags: Record<string, string> | undefined): void {
  for (const [key, value] of Object.entries(tags ?? {})) target[key] = String(value).trim();
}

/** C++ std::to_string(double): "%f". */
function cppToString(value: number): string {
  return value.toFixed(6);
}

function streamDuration(stream: FfprobeStream): number {
  const d = num(stream.duration);
  return d !== undefined && d > 0 ? d : 0;
}

/** FFmpegReader semantics for a stream set ffprobe already parsed. */
export async function readerInfoFromFfprobe(file: string, probe: FfprobeResult, fileSize: number): Promise<MutableInfo> {
  const info = baseInfo();
  info.type = "FFmpegReader";
  info.path = file;
  const video = probe.streams.find((s) => s.codec_type === "video");
  let audio = probe.streams.find((s) => s.codec_type === "audio");
  if (!video && !audio) throw new ProbeError("No video or audio streams found in this file.", file);

  const durations: Durations = { video: 0, audio: 0, format: 0, inferred: 0 };
  const strategy: DurationStrategy = "VideoPreferred";
  const formatDuration = num(probe.format.duration);
  const formatBitRate = num(probe.format.bit_rate) ?? 0;
  const record = (key: keyof Durations, seconds: number) => {
    if (seconds > 0) durations[key] = Math.max(durations[key], seconds);
  };

  if (video) {
    info.video_stream_index = video.index;
    info.has_video = true;
    info.file_size = fileSize;
    info.width = video.width ?? 0;
    info.height = video.height ?? 0;
    info.vcodec = await decoderNameFor(video.codec_name);
    info.video_bit_rate = Math.trunc(formatBitRate / 8);
    info.fps = guessFrameRate(video);
    const sar = parseRatio(video.sample_aspect_ratio, ":");
    info.pixel_ratio = sar && sar.num !== 0 ? sar : { num: 1, den: 1 };
    info.pixel_format = video.pix_fmt !== undefined ? (PIXEL_FORMATS[video.pix_fmt] ?? -1) : -1;
    info.display_ratio = reduce(info.width * info.pixel_ratio.num, info.height * info.pixel_ratio.den);
    switch (video.field_order) {
      case "progressive":
        info.interlaced_frame = false;
        break;
      case "tt":
      case "tb":
        info.interlaced_frame = true;
        info.top_field_first = true;
        break;
      case "bt":
      case "bb":
        info.interlaced_frame = true;
        info.top_field_first = false;
        break;
      default:
        break;
    }
    info.video_timebase = parseRatio(video.time_base) ?? { num: 1, den: 1 };
    record("video", streamDuration(video));
    if (formatDuration !== undefined) record("format", formatDuration);
    if (info.video_bit_rate > 0 && info.file_size > 0) record("inferred", info.file_size / info.video_bit_rate);
    // "image" formats without any duration (FFmpegReader.cpp:1124).
    if (durations.video <= 0 && durations.format <= 0 && video.duration === undefined && formatDuration === undefined) {
      record("video", ONE_HOUR);
      info.has_single_image = true;
    }
    if (durations.video <= 0 && durations.format <= 0 && (probe.format.format_name ?? "").split(",").includes("gif")) {
      record("video", ONE_HOUR);
      info.has_single_image = true;
    }
    applyDuration(info, durations, strategy);
    if (!info.has_single_image) {
      const stillCodec = ["mjpeg", "png", "bmp", "tiff", "webp", "jpeg2000"].includes(video.codec_name ?? "");
      const imageDemuxer = (probe.format.format_name ?? "").includes("image2");
      const attachedPic = video.disposition?.attached_pic === 1;
      const nbFrames = num(video.nb_frames);
      const singleFrameStream = nbFrames !== undefined && nbFrames > 0 && nbFrames <= 1;
      const singleFrameClip = info.video_length <= 1;
      if (attachedPic || ((singleFrameStream || singleFrameClip) && (stillCodec || imageDemuxer))) {
        info.has_single_image = true;
        if (!audio) record("video", ONE_HOUR);
        applyDuration(info, durations, strategy);
      }
    }
    addTags(info.metadata, video.tags);
  }

  if (audio && audio.codec_name) {
    info.audio_stream_index = audio.index;
    info.has_audio = true;
    info.file_size = fileSize;
    info.acodec = await decoderNameFor(audio.codec_name);
    const channels = audio.channels ?? 0;
    info.channels = channels;
    let layout = audio.channel_layout ? CHANNEL_LAYOUTS[audio.channel_layout] : undefined;
    layout ??= DEFAULT_LAYOUTS[channels] ?? 0;
    if (layout === 0) layout = channels === 1 ? LAYOUT_MONO : channels === 2 ? 3 : 0;
    info.channel_layout = layout;
    info.sample_rate = num(audio.sample_rate) ?? 0;
    const streamBitRate = num(audio.bit_rate) ?? 0;
    info.audio_bit_rate = streamBitRate > 0 ? Math.trunc(streamBitRate) : Math.trunc(formatBitRate);
    info.audio_timebase = parseRatio(audio.time_base) ?? { num: 1, den: 1 };
    record("audio", streamDuration(audio));
    if (formatDuration !== undefined) record("format", formatDuration);
    if (info.duration <= 0 && info.video_bit_rate > 0 && info.file_size > 0) {
      record("inferred", info.file_size / info.video_bit_rate);
    }
    if (!info.has_video) {
      info.fps = { num: 30, den: 1 };
      info.video_timebase = { num: 1, den: 30 };
      if (info.width <= 0 || info.height <= 0) {
        info.width = 720;
        info.height = 480;
      }
    }
    applyDuration(info, durations, strategy);
    addTags(info.metadata, audio.tags);
    const invalid =
      info.channels <= 0 ||
      info.sample_rate <= 0 ||
      info.audio_timebase.num <= 0 ||
      info.audio_timebase.den <= 0 ||
      audio.sample_fmt === undefined ||
      audio.sample_fmt === "none";
    if (invalid) {
      info.has_audio = false;
      info.audio_stream_index = -1;
    }
  } else if (audio) {
    // Audio codec FFmpeg cannot open: keep the video, drop the audio.
    audio = undefined;
  }

  if (info.fps.num <= 0 || info.fps.den <= 0) info.fps = { num: 30, den: 1 };
  if (info.video_timebase.num <= 0 || info.video_timebase.den <= 0) {
    info.video_timebase = { num: info.fps.den, den: info.fps.num };
  }
  addTags(info.metadata, probe.format.tags);

  if (video) {
    for (const side of video.side_data_list ?? []) {
      if (side.side_data_type === "Display Matrix" && typeof side.rotation === "number" && !("rotate" in info.metadata)) {
        const rotation = Number.isNaN(side.rotation) ? 0 : -side.rotation;
        info.metadata.rotate = cppToString(rotation === 0 ? 0 : rotation);
      }
      if (side.side_data_type === "Spherical Mapping") {
        info.metadata.spherical = "1";
        info.metadata.spherical_projection = side.projection ?? "unknown";
        info.metadata.spherical_yaw = cppToString(Number(side.yaw ?? 0));
        info.metadata.spherical_pitch = cppToString(Number(side.pitch ?? 0));
        info.metadata.spherical_roll = cppToString(Number(side.roll ?? 0));
      }
    }
    // UpdateOrientedVideoInfo: report display-oriented size.
    const rotate = Number.parseFloat(info.metadata.rotate ?? "0");
    if (Number.isFinite(rotate) && rotate !== 0 && info.width > 0 && info.height > 0) {
      const rad = (rotate * Math.PI) / 180;
      const w = Math.round(Math.abs(info.width * Math.cos(rad)) + Math.abs(info.height * Math.sin(rad)));
      const h = Math.round(Math.abs(info.width * Math.sin(rad)) + Math.abs(info.height * Math.cos(rad)));
      if (w > 0 && h > 0) {
        info.width = w;
        info.height = h;
        info.display_ratio = reduce(info.width * info.pixel_ratio.num, info.height * info.pixel_ratio.den);
      }
    }
    // FFmpegReader::CheckFPS scans packets for absurd rates; the average rate
    // ffprobe computed from the container is the same measurement.
    if (toDouble(info.fps) > 240) {
      const avg = parseRatio(video.avg_frame_rate);
      if (avg && avg.num > 0 && avg.den > 0 && toDouble(avg) <= 240) {
        info.fps = avg;
        applyDuration(info, durations, strategy);
      }
    }
  }
  return info;
}

/** Bytes QImage uses for a decoded image (QtImageReader stores it as file_size). */
function qimageBytes(width: number, height: number, pixFmt: string | undefined): number {
  let bpp = 4;
  if (pixFmt === "gray" || pixFmt === "pal8" || pixFmt === "monob" || pixFmt === "monow") bpp = 1;
  else if (pixFmt && /(48|64|16)(be|le)$/.test(pixFmt)) bpp = 8;
  const bytesPerLine = Math.ceil((width * bpp) / 4) * 4;
  return bytesPerLine * height;
}

/** QtImageReader::Open for an image of `width`×`height`. */
function qtImageInfo(file: string, width: number, height: number, fileSize: number): MutableInfo {
  const info = baseInfo();
  info.type = "QtImageReader";
  info.path = file;
  info.has_audio = false;
  info.has_video = true;
  info.has_single_image = true;
  info.file_size = fileSize;
  info.vcodec = "QImage";
  info.width = width;
  info.height = height;
  info.pixel_ratio = { num: 1, den: 1 };
  info.fps = { num: 30, den: 1 };
  info.video_timebase = { num: 1, den: 30 };
  info.video_length = ONE_HOUR * 30;
  info.duration = Math.fround(info.video_length / 30);
  info.display_ratio = reduce(width, height);
  return info;
}

function finish(info: MutableInfo): ProbedInfo {
  const out: Record<string, unknown> = { ...info };
  if (info.type === "FFmpegReader") out.duration_strategy = "VideoPreferred";
  const sorted = sortKeys(out) as ReaderInfo;
  // The desktop importer's media type (image_types.py get_media_type), from the engine.
  return { ...sorted, media_type: getMediaType(sorted) } as ProbedInfo;
}

export interface ProbeOptions {
  signal?: AbortSignal;
}

/**
 * Inspect a local media file like the desktop importer does. Returns the
 * libopenshot reader JSON (keys sorted like jsoncpp writes them) plus
 * `media_type`. Throws `ProbeError` for unreadable files.
 */
export async function probe(filePath: string, options: ProbeOptions = {}): Promise<ProbedInfo> {
  const file = path.resolve(filePath);
  let size: number;
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new ProbeError(`Not a file: ${file}`, file);
    size = st.size;
  } catch (error) {
    if (error instanceof ProbeError) throw error;
    throw new ProbeError(`File not found: ${file}`, file);
  }
  const ext = path.extname(file).slice(1).toLowerCase();

  if (!FFMPEG_EXTS.has(ext) && !file.includes("%")) {
    if (ext === "svg" || ext === "svgz") {
      let dims: { width: number; height: number };
      try {
        dims = await svgIntrinsicSize(await readSvgFile(file));
      } catch (error) {
        throw new ProbeError(`QtImageReader could not open image file: ${(error as Error).message}`, file);
      }
      if (dims.width <= 0 || dims.height <= 0) throw new ProbeError("SVG has no size.", file);
      return finish(qtImageInfo(file, dims.width, dims.height, dims.width * dims.height * 4));
    }
  }

  let result: FfprobeResult;
  try {
    result = await ffprobe(file, options.signal);
  } catch (error) {
    if ((error as Error).name === "AbortError" || (error as Error).name === "BinaryNotFoundError") throw error;
    throw new ProbeError(`FFmpegReader could not open media file: ${(error as Error).message}`, file);
  }

  if (!FFMPEG_EXTS.has(ext) && !file.includes("%")) {
    const streams = result.streams.filter((s) => s.codec_type === "video" || s.codec_type === "audio");
    const only = streams.length === 1 ? streams[0] : undefined;
    const imageDemuxer = /(_pipe|image2)/.test(result.format.format_name ?? "");
    if (only && only.codec_type === "video" && QT_IMAGE_CODECS.has(only.codec_name ?? "") && imageDemuxer) {
      let width = only.width ?? 0;
      let height = only.height ?? 0;
      if (orientationSwapsAxes(await imageOrientation(file))) [width, height] = [height, width];
      return finish(qtImageInfo(file, width, height, qimageBytes(width, height, only.pix_fmt)));
    }
  }
  return finish(await readerInfoFromFfprobe(file, result, size));
}
