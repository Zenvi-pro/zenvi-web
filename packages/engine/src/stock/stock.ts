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

const STOP_WORDS = new Set(["a", "an", "the", "of", "on", "in", "at", "to", "and", "with", "by", "for", "from", "up", "close", "shot", "video", "footage"]);

/** Content words cut to a short stem, so "runners" and "running" meet at "runn". */
function stems(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .map((w) => (w.length <= 4 ? w : w.slice(0, Math.max(4, w.length - 3))));
}

function sameStem(a: string, b: string): boolean {
  return a === b || (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a)));
}

/**
 * How well a Pexels video's page slug (".../video/woman-running-on-a-forest-trail-7348382/") matches the search: each
 * search word it shares counts, earlier words more (the subject usually comes first). 0 when the page has no words.
 */
export function stockRelevance(video: PexelsVideo, query: string): number {
  const words = stems(query);
  const slug = stems(/\/video\/([^/]*)/.exec(video.url ?? "")?.[1] ?? "");
  return words.reduce((score, w, i) => (slug.some((s) => sameStem(w, s)) ? score + words.length - i : score), 0);
}

/** The share (0-1) of `query`'s content words that `text` has, by stem: 0 when the query has none. */
export function wordMatch(query: string, text: string): number {
  const words = stems(query);
  if (words.length === 0) return 0;
  const have = stems(text);
  return words.filter((w) => have.some((s) => sameStem(w, s))).length / words.length;
}

/** A Pexels page's slug words ("woman-running-on-a-trail-7348382" → woma, runn, trail), as stems. */
function slugStems(video: PexelsVideo): string[] {
  return stems(/\/video\/([^/]*)/.exec(video.url ?? "")?.[1] ?? "");
}

/**
 * Two results that are likely takes of one shoot: the same contributor, and
 * pages whose words mostly agree (Pexels contributors upload a shoot as many
 * near-identical clips) or, without words, the same size and length.
 */
export function sameShoot(a: PexelsVideo, b: PexelsVideo): boolean {
  if (a.id === b.id) return true;
  if (!a.user_name || a.user_name !== b.user_name) return false;
  const wa = slugStems(a);
  const wb = slugStems(b);
  if (wa.length === 0 || wb.length === 0) return a.width === b.width && a.height === b.height && Math.abs(a.duration - b.duration) <= 1;
  const shared = wa.filter((w) => wb.some((v) => sameStem(w, v))).length;
  return shared / Math.min(wa.length, wb.length) >= 0.6;
}

/**
 * A stock video that suits the frame: long enough, not used yet, the one whose page best matches the search (Pexels'
 * deeper results drift: "trail runner" also brings plain mountains), then the frame's orientation, then Pexels' order.
 */
export function pickStockVideo(videos: readonly PexelsVideo[], portrait: boolean, used: ReadonlySet<number>, minSeconds = 4, query = ""): PexelsVideo | undefined {
  const usable = videos.filter((v) => !used.has(v.id) && v.duration >= minSeconds && (v.video_files ?? []).some((f) => f.link));
  let best: PexelsVideo | undefined;
  let bestScore = -1;
  for (const v of usable) {
    const score = 2 * stockRelevance(v, query) + ((portrait ? v.height > v.width : v.width >= v.height) ? 1 : 0);
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
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
