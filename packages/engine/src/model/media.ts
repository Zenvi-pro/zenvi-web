/**
 * Media classification, ported from zenvi-core src/classes/image_types.py
 * (`is_image`, `is_audio_path`, `get_media_type`, `is_audio_only_media`) and
 * src/classes/clip_utils.py (`_is_single_image`, `is_audio_media`).
 */

import type { MediaType } from "./types.js";

/** image_types.py `_AUDIO_EXTS`. */
export const AUDIO_EXTENSIONS: readonly string[] = [
  ".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".wma", ".opus", ".aiff", ".aif", ".oga",
];

/** image_types.py `is_image` extensions. */
export const IMAGE_EXTENSIONS: readonly string[] = [
  ".bmp", ".dpx", ".exr", ".jpg", ".jpeg", ".pam", ".pbm", ".pcx", ".pgm", ".png", ".pnm", ".ppm",
  ".psd", ".sgi", ".svg", ".tga", ".thm", ".tif", ".tiff", ".webp", ".xbm", ".xpm", ".xwd",
];

/** clip_utils.py `is_audio_media` extensions (a shorter list than image_types). */
const CLIP_AUDIO_EXTENSIONS: readonly string[] = [".mp3", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".wav", ".wma"];

type Data = Record<string, unknown>;

function isRecord(value: unknown): value is Data {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lowerPath(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

/** image_types.py `is_audio_path`: a pure-audio extension (query strings ignored). */
export function isAudioPath(path: string | null | undefined): boolean {
  const p = lowerPath(path).split("?")[0]!;
  return AUDIO_EXTENSIONS.some((ext) => p.endsWith(ext));
}

/** image_types.py `is_image`: a still-image extension. */
export function isImagePath(path: string | null | undefined): boolean {
  const p = lowerPath(path);
  return IMAGE_EXTENSIONS.some((ext) => p.endsWith(ext));
}

function hasExtension(path: string): boolean {
  const base = path.split(/[?#]/)[0]!.split(/[\\/]/).pop() ?? "";
  return /\.[a-z0-9]{1,5}$/i.test(base);
}

/**
 * The desktop importer's media type (image_types.py `get_media_type`):
 * audio extension → audio; has_video → image for image extensions, else
 * video; has_audio without video → audio; otherwise video.
 *
 * `name` (the original file name) stands in for the path's extension when
 * the path has none, which happens for browser storage paths and URLs.
 */
export function getMediaType(file: { path?: unknown; has_video?: unknown; has_audio?: unknown }, name?: string): MediaType {
  let path = String(file.path ?? "");
  if (name && !hasExtension(path)) path = name;
  if (isAudioPath(path)) return "audio";
  const image = isImagePath(path);
  if (file.has_video && !image) return "video";
  if (file.has_video && image) return "image";
  if (file.has_audio && !file.has_video) return "audio";
  return "video";
}

/**
 * True when a file must never composite video (image_types.py
 * `is_audio_only_media`): extension first, because libopenshot reports
 * `has_video` for MP3s with cover art; then `media_type`; then the streams.
 */
export function isAudioOnlyMedia(file: unknown): boolean {
  if (!isRecord(file)) return false;
  if (isAudioPath(String(file.path ?? ""))) return true;
  const mediaType = String(file.media_type ?? "").trim().toLowerCase();
  if (mediaType) return mediaType === "audio";
  return Boolean(file.has_audio) && !file.has_video;
}

/** clip_utils.py `is_audio_media`. */
export function isAudioMedia(source: unknown): boolean {
  const data = isRecord(source) ? source : {};
  if (String(data.media_type ?? "").trim().toLowerCase() === "audio") return true;
  const path = lowerPath(data.path ?? data.file_path ?? "").trim();
  if (CLIP_AUDIO_EXTENSIONS.some((ext) => path.endsWith(ext))) return true;
  return data.has_audio === true && data.has_video === false;
}

/** clip_utils.py `_is_single_image`: a still image (and not audio with cover art). */
export function isSingleImageMedia(source: unknown): boolean {
  const data = isRecord(source) ? source : {};
  if (data.has_single_image) return !isAudioMedia(data);
  return String(data.media_type ?? "").toLowerCase() === "image";
}
