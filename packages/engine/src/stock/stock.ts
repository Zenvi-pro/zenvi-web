/**
 * Stock footage and music: Pexels videos and Freesound sounds as the Zenvi
 * backend returns them (`/api/v1/pexels/search`, `/api/v1/freesound/search`),
 * and which result or rendition to use. Pure: the search tools and
 * create_reel make the requests.
 */

export interface PexelsFile {
  quality?: string;
  file_type?: string;
  width?: number | null;
  height?: number | null;
  link?: string;
}

export interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;
  url?: string;
  image?: string;
  user_name?: string;
  video_files?: PexelsFile[];
}

export interface FreesoundSound {
  id: number;
  name: string;
  duration: number;
  username?: string;
  license?: string;
  tags?: string[];
  previews?: { hq_mp3?: string; lq_mp3?: string };
}

/** A stock video that suits the frame: the right orientation, long enough, not used yet. */
export function pickStockVideo(videos: readonly PexelsVideo[], portrait: boolean, used: ReadonlySet<number>, minSeconds = 4): PexelsVideo | undefined {
  const usable = videos.filter((v) => !used.has(v.id) && v.duration >= minSeconds && (v.video_files ?? []).some((f) => f.link));
  return usable.find((v) => (portrait ? v.height > v.width : v.width >= v.height)) ?? usable[0];
}

/** The MP4 rendition closest to the frame's width (at least most of it), so cuts stay sharp without huge downloads. */
export function pickStockFile(video: PexelsVideo, frameWidth: number, portrait: boolean): PexelsFile | undefined {
  const files = (video.video_files ?? []).filter((f) => f.link && (f.file_type ?? "video/mp4") === "video/mp4");
  if (files.length === 0) return undefined;
  const side = (f: PexelsFile) => Number((portrait ? Math.min(f.width ?? 0, f.height ?? 0) : f.width) ?? 0) || 0;
  const big = files.filter((f) => side(f) >= frameWidth * 0.75).sort((a, b) => side(a) - side(b));
  return big[0] ?? [...files].sort((a, b) => side(b) - side(a))[0];
}

/** 0 for CC0, 1 for other open licences (CC BY), 2 for non-commercial ones. */
export function licenceRank(license: string | undefined): 0 | 1 | 2 {
  const text = license ?? "";
  if (/zero|cc0/i.test(text)) return 0;
  if (/noncommercial|by-nc|\bnc\b/i.test(text)) return 2;
  return 1;
}

/** A short name for a Creative Commons licence URL, e.g. "CC BY-NC 4.0". */
export function licenceName(license: string | undefined): string {
  const text = license ?? "";
  if (/zero|cc0/i.test(text)) return "CC0";
  const m = /licenses\/([a-z-]+)\/(\d(?:\.\d)?)/i.exec(text);
  if (m) return `CC ${m[1]!.toUpperCase()} ${m[2]}`;
  if (/sampling\+/i.test(text)) return "Sampling+";
  return text || "unknown licence";
}

/** The sound's MP3 preview, high quality when there is one. */
export function previewOf(sound: FreesoundSound): string | undefined {
  return sound.previews?.hq_mp3 || sound.previews?.lq_mp3 || undefined;
}

/**
 * Music for a reel: among the most relevant results, open licences first
 * (CC0, then CC BY, non-commercial last), then the shortest track that is
 * long enough (the whole track downloads; stock CDNs can be slow).
 */
export function pickMusic(sounds: readonly FreesoundSound[], seconds: number): FreesoundSound | undefined {
  const usable = sounds.slice(0, 8).filter((s) => s.duration >= Math.min(seconds + 6, 30) && s.duration <= 360 && previewOf(s));
  return [...usable].sort((a, b) => licenceRank(a.license) - licenceRank(b.license) || a.duration - b.duration)[0];
}

/** m:ss */
export function clockTime(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
