/**
 * Fetching the video of a web page (YouTube and other sites) for
 * ingest_web_video_tool: the rules, without the I/O. Port of zenvi-core
 * develop (1f80cb3d0) src/classes/web_video_ingest.py: intents, URL checks,
 * the format to ask yt-dlp for, when a cached download can be reused, and
 * the short reasons a failed pull is reported with.
 *
 * The download itself (yt-dlp, the cache folder, DNS checks) belongs to the
 * host (`MediaHost.fetchWebVideo`; the CLI's is render-node
 * host/web-video.ts). Hosted surfaces (Zenvi Cloud, the web editor) have
 * none: a server or a browser fetching third-party pages is a different
 * terms-of-service position, and it gets server addresses blocked.
 */

/** What the person wants the web video for (web_video_ingest.VALID_INTENTS). */
export type WebVideoIntent = "reference" | "timeline" | "recreate";

export const WEB_VIDEO_INTENTS: readonly WebVideoIntent[] = ["reference", "timeline", "recreate"];

/** Colour / look words never place on the timeline; only explicit place words do (normalize_intent). */
const INTENT_ALIASES: Readonly<Record<string, WebVideoIntent>> = {
  ref: "reference",
  look: "reference",
  colour: "reference",
  color: "reference",
  grade: "reference",
  match: "reference",
  place: "timeline",
  add: "timeline",
  timeline: "timeline",
  remake: "recreate",
  recreate_like: "recreate",
};

/** Cache entries older than this are removed before a new pull (DEFAULT_CACHE_TTL_SECONDS). */
export const WEB_VIDEO_CACHE_TTL_SECONDS = 7 * 24 * 3600;

/** After a real rate limit (HTTP 429), the same link is refused this long (RATE_LIMIT_COOLDOWN_SECONDS). */
export const WEB_VIDEO_COOLDOWN_SECONDS = 10 * 60;

/** Extensions of a direct media link: imported as a file, without yt-dlp (_ingest_web_video_impl). */
const DIRECT_MEDIA_EXTS = [".mp4", ".mov", ".webm", ".mkv", ".avi"];

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be", "music.youtube.com"]);

/** What `MediaHost.fetchWebVideo` is asked for. */
export interface WebVideoRequest {
  /** The page (or direct media) URL, trimmed. */
  url: string;
  intent: WebVideoIntent;
  /** Also fetch English subtitles when the site has them. */
  writeSubs: boolean;
  signal?: AbortSignal;
}

/** A fetched web video: a local file to import, and what the site said about it (download_web_video's meta). */
export interface WebVideoDownload {
  /** Local path of the video file (in the host's cache: import it, the cache gets cleaned). */
  path: string;
  title: string;
  /** yt-dlp's extractor name ("youtube", "generic"…); "" for a direct media link. */
  extractor: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  /** The page the video came from, as the site names it. */
  webpageUrl: string;
  id: string;
  isYoutube: boolean;
  /** Subtitle files fetched next to the video (.vtt / .srt). */
  subtitlePaths: string[];
  /** Downloaded as is from a direct media link (no page was read). */
  direct: boolean;
  /** Served from the cache without a new pull. */
  fromCache: boolean;
  /** Expired cache folders removed before this pull. */
  cachePurged: number;
}

export type WebVideoErrorCode = "unavailable" | "refused" | "failed";

/**
 * A user-facing failure to fetch (web_video_ingest.WebVideoIngestError):
 * `unavailable` when this computer cannot fetch web videos at all (no
 * yt-dlp), `refused` for a link that may not be fetched, `failed` when the
 * pull itself went wrong. The message is what the person is told.
 */
export class WebVideoError extends Error {
  constructor(
    readonly code: WebVideoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WebVideoError";
  }
}

export function isWebVideoError(error: unknown): error is WebVideoError {
  return error instanceof WebVideoError || (error instanceof Error && error.name === "WebVideoError" && typeof (error as { code?: unknown }).code === "string");
}

/**
 * One of the three intents, from the person's word for it (normalize_intent).
 * Vague words ("edit") are refused rather than read as "timeline": a colour
 * request must never put the web video on the cut.
 */
export function normalizeWebVideoIntent(intent: unknown): WebVideoIntent {
  const raw = String(intent || "reference").trim().toLowerCase();
  const mapped = INTENT_ALIASES[raw] ?? raw;
  if ((WEB_VIDEO_INTENTS as readonly string[]).includes(mapped)) return mapped as WebVideoIntent;
  throw new WebVideoError("refused", `Unknown intent '${String(intent)}'. Use reference, timeline, or recreate.`);
}

function parseUrl(url: unknown): URL | null {
  try {
    return new URL(String(url ?? "").trim());
  } catch {
    return null;
  }
}

/** True for http(s) page or media URLs with a host (not local paths or file://) (is_probable_web_video_url). */
export function isProbableWebVideoUrl(url: unknown): boolean {
  const parsed = parseUrl(url);
  return parsed !== null && (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host !== "";
}

/** The refusal for a URL that is not http(s) (assert_public_http_url). */
export const NOT_HTTP_URL_MESSAGE =
  "URL must be http(s). Local paths use import_files_tool; direct MP4s may use import_video_url_and_add_to_timeline_tool.";

/** youtube.com, youtu.be and their subdomains (is_youtube_url). */
export function isYoutubeUrl(url: unknown): boolean {
  const host = parseUrl(url)?.hostname.toLowerCase() ?? "";
  return YOUTUBE_HOSTS.has(host) || host.endsWith(".youtube.com");
}

/** A link straight to a video file (.mp4, .mov, .webm, .mkv, .avi before any query string): no page to read. */
export function isDirectMediaUrl(url: unknown): boolean {
  const lower = String(url ?? "").trim().split("?")[0]!.toLowerCase();
  return DIRECT_MEDIA_EXTS.some((ext) => lower.endsWith(ext));
}

/** Timeline use gets up to 1080p; reference and recreate 720p (requested_height_for_intent). */
export function requestedHeightForIntent(intent: WebVideoIntent): 1080 | 720 {
  return intent === "timeline" ? 1080 : 720;
}

/** Reference and recreate want the site's English subtitles by default (download_web_video's want_subs). */
export function wantsSubtitles(intent: WebVideoIntent, writeSubs: boolean): boolean {
  return writeSubs || intent === "reference" || intent === "recreate";
}

/**
 * yt-dlp's format selector for an intent (format_selector_for_intent). Without
 * ffmpeg only single-file formats work: there is nothing to merge video and
 * audio with.
 */
export function formatSelectorForIntent(intent: WebVideoIntent, hasFfmpeg = true): string {
  const height = requestedHeightForIntent(intent);
  if (!hasFfmpeg) return `best[height<=${height}][ext=mp4]/best[height<=${height}]/best[ext=mp4]/best`;
  return `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;
}

/** Python `int(x or 0)` for a cached field, 0 when it is not a number. */
function cachedInt(value: unknown): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim() || 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/**
 * Whether a cached download (its ingest.json fields) is good enough for this
 * request (cache_satisfies_request): tall enough for the intent, and with
 * subtitles when they are wanted (or an earlier pull already asked the site
 * for them).
 */
export function cacheSatisfiesRequest(meta: Readonly<Record<string, unknown>>, intent: WebVideoIntent, writeSubs: boolean): boolean {
  const want = requestedHeightForIntent(intent);
  const have = cachedInt(meta.height);
  if (have && have < want) return false;
  // Unknown height: reuse only what was asked for at the same or a lower height.
  if (!have) {
    const stored = cachedInt(meta.requested_height);
    if (stored && stored < want) return false;
  }
  if (wantsSubtitles(intent, writeSubs)) {
    const subs = meta.subtitle_paths;
    if ((!Array.isArray(subs) || subs.length === 0) && !meta.write_subs_requested) return false;
  }
  return true;
}

/** A rate limit from the site (is_rate_limit_error). */
export function isRateLimitError(message: string): boolean {
  const low = message.toLowerCase();
  return low.includes("http error 429") || low.includes("too many requests") || low.includes("rate-limited");
}

/** The refusal while a link cools down after a rate limit (check_rate_limit_cooldown). */
export function cooldownMessage(remainingSeconds: number): string {
  const minutes = Math.max(1, Math.trunc((remainingSeconds + 59) / 60));
  return `YouTube is still rate-limiting this link. Wait about ${minutes} minute(s), or upload an MP4 yourself.`;
}

const UPLOAD_HINT = " Download the MP4 yourself and import it (Imports / import_files_tool).";

/**
 * A short reason for a failed pull, never a stack trace (humanize_ingest_failure).
 * `error` is what went wrong: a WebVideoError keeps its own words; anything
 * else (yt-dlp's error output, an exception) is mapped by what it mentions.
 */
export function humanizeIngestFailure(error: unknown): string {
  if (isWebVideoError(error)) return error.message;
  const message = (error instanceof Error ? error.message : String(error ?? "")).trim();
  const name = error instanceof Error ? error.name || "Error" : "Error";
  const low = message.toLowerCase();
  if (low.includes("ffmpeg") || low.includes("ffprobe")) {
    return "Pull needs ffmpeg to combine YouTube video+audio. Install ffmpeg (e.g. brew install ffmpeg) and try again, or upload an MP4 yourself.";
  }
  const restricted = ["sign in", "login required", "private video", "members only", "members-only", "join this channel", "confirm your age", "age-restricted", "restricted", "premium"];
  if (restricted.some((word) => low.includes(word))) return `This video is private, restricted, or requires sign-in.${UPLOAD_HINT}`;
  if (low.includes("unavailable") || low.includes("not available") || low.includes("removed")) {
    return `That video is unavailable (removed, region-blocked, or bad link).${UPLOAD_HINT}`;
  }
  if (low.includes("unsupported url") || low.includes("no suitable")) {
    return "That URL is not a supported video page. Paste a public YouTube watch link, or upload an MP4 yourself.";
  }
  if (low.includes("http error 429") || low.includes("too many requests")) {
    return "YouTube rate-limited the download. Wait about 10 minutes, or upload an MP4 yourself.";
  }
  if (low.includes("timed out") || low.includes("timeout")) return "Pull timed out. Check the network and try again, or upload an MP4 yourself.";
  if (low.includes("js runtime") || low.includes("javascript runtime")) {
    return "YouTube blocked some formats (JS runtime). Try again once; if it still fails, update yt-dlp or upload an MP4 yourself.";
  }
  let one = message.replace(/\s+/g, " ").trim();
  if (Array.from(one).length > 180) one = `${Array.from(one).slice(0, 177).join("")}...`;
  return `Pull failed (${one || name}).${UPLOAD_HINT}`;
}
