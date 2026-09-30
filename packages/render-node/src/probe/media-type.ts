/**
 * The media type the desktop importer assigns to a file.
 *
 * Port of zenvi-core src/classes/image_types.py (`is_image`, `is_audio_path`,
 * `get_media_type`, `is_audio_only_media`). The extension wins over stream
 * flags because libopenshot reports `has_video` for MP3s with cover art.
 */

import type { MediaType, ReaderInfo } from "@zenvi/engine";

/** image_types.py `_AUDIO_EXTS`. */
const AUDIO_EXTS = [".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".wma", ".opus", ".aiff", ".aif", ".oga"];

/** image_types.py `is_image` extensions. */
const IMAGE_EXTS = [
  ".bmp", ".dpx", ".exr", ".jpg", ".jpeg", ".pam", ".pbm", ".pcx", ".pgm", ".png", ".pnm", ".ppm",
  ".psd", ".sgi", ".svg", ".tga", ".thm", ".tif", ".tiff", ".webp", ".xbm", ".xpm", ".xwd",
];

export function isAudioPath(path: string): boolean {
  const p = (path || "").toLowerCase().split("?")[0] ?? "";
  return AUDIO_EXTS.some((ext) => p.endsWith(ext));
}

export function isImagePath(path: string): boolean {
  const p = (path || "").toLowerCase();
  return IMAGE_EXTS.some((ext) => p.endsWith(ext));
}

/** image_types.py `get_media_type`. */
export function desktopMediaType(info: Pick<ReaderInfo, "path" | "has_video" | "has_audio">): MediaType {
  const path = info.path ?? "";
  if (isAudioPath(path)) return "audio";
  if (info.has_video && !isImagePath(path)) return "video";
  if (info.has_video && isImagePath(path)) return "image";
  if (info.has_audio && !info.has_video) return "audio";
  return "video";
}

/** image_types.py `is_audio_only_media`: files that must never composite video. */
export function isAudioOnlyMedia(info: Pick<ReaderInfo, "path" | "has_video" | "has_audio" | "media_type">): boolean {
  if (isAudioPath(info.path ?? "")) return true;
  const mediaType = String(info.media_type ?? "").trim().toLowerCase();
  if (mediaType) return mediaType === "audio";
  return Boolean(info.has_audio) && !info.has_video;
}
