/**
 * `MediaHost.fetchWebVideo` on this computer, for ingest_web_video_tool: the
 * video of a web page (YouTube and other sites) through yt-dlp, or a direct
 * media link, into a per-user cache (`<cache>/web-video-cache/<key>/`)
 * reused for seven days. Port of zenvi-core develop (1f80cb3d0)
 * src/classes/web_video_ingest.py `download_web_video` (and the direct-link
 * download of tool_handlers._ingest_web_video_impl); the rules (intents,
 * formats, cache reuse, failure wording) are the engine's
 * (web-video/web-video.ts).
 *
 * The desktop runs yt-dlp as a Python module it ships; here it is the
 * `yt-dlp` program the person installed (ZENVI_YT_DLP, PATH, the usual
 * install folders). Without it a page link is refused in words; direct
 * links need no yt-dlp. Links to private or local addresses are refused
 * before anything is fetched (assert_public_http_url). The tool imports the
 * file, and the media host copies it into the project: the cache gets
 * cleaned.
 */

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  NOT_HTTP_URL_MESSAGE,
  WEB_VIDEO_CACHE_TTL_SECONDS,
  WEB_VIDEO_COOLDOWN_SECONDS,
  WebVideoError,
  cacheSatisfiesRequest,
  cooldownMessage,
  formatSelectorForIntent,
  humanizeIngestFailure,
  isDirectMediaUrl,
  isProbableWebVideoUrl,
  isRateLimitError,
  isYoutubeUrl,
  requestedHeightForIntent,
  wantsSubtitles,
  type WebVideoDownload,
  type WebVideoIntent,
  type WebVideoRequest,
} from "@zenvi/engine";
import { fallbackBinaryDirs, isExecutable, resolveBinary, whichSync } from "../ffmpeg/binaries.js";
import { BinaryNotFoundError, FfmpegError, runBinary } from "../ffmpeg/process.js";
import { isPublicAddress } from "../net/public-address.js";
import { cacheDir } from "../svg/fonts.js";

export interface WebVideoFetcherOptions {
  /** The cache folder (default `<Zenvi cache>/web-video-cache`, like the desktop's `<user folder>/web-video-cache`). */
  cacheRoot?: string;
  /** The yt-dlp to run (default `findYtDlp`). */
  ytDlp?: string;
  /** The ffmpeg yt-dlp merges video and audio with (default: the one Zenvi renders with); null for none. */
  ffmpeg?: string | null;
  env?: NodeJS.ProcessEnv;
  /** Every address a host name resolves to (default: the system resolver). */
  resolve?: (host: string) => Promise<string[]>;
  /** Which addresses may be fetched (default: public unicast only). */
  isAllowedAddress?: (ip: string) => boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Largest direct-link download, bytes (default 4 GiB). */
  maxDownloadBytes?: number;
}

/** What yt-dlp prints once the file is in place: the fields the tool reports. */
const PRINT_FIELDS = "after_move:%(.{id,title,duration,extractor,extractor_key,webpage_url,width,height,ext,filepath})j";
const MEDIA_EXTS = new Set([".mp4", ".mkv", ".webm", ".mov", ".m4a", ".mp3"]);
const SIDECAR = "ingest.json";
const COOLDOWN = "cooldown.json";
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

/** The refusal when this computer has no yt-dlp. */
export const YT_DLP_MISSING =
  "fetching videos from web pages needs yt-dlp on this computer, and it was not found. Install it " +
  "(macOS: brew install yt-dlp; Windows: winget install yt-dlp; anywhere with Python: pip install -U yt-dlp) " +
  "or set ZENVI_YT_DLP to its path, then call again. Direct links to video files (.mp4, .mov, .webm, .mkv, .avi) work without it.";

/** `<Zenvi cache>/web-video-cache`. */
export function webVideoCacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(cacheDir(env), "web-video-cache");
}

/** The cache folder name of a URL: the first 24 hex digits of its SHA-256 (url_cache_key). */
export function urlCacheKey(url: string): string {
  return createHash("sha256").update(url.trim(), "utf8").digest("hex").slice(0, 24);
}

/** yt-dlp: ZENVI_YT_DLP, then PATH, then where package managers install it; undefined when none is found. */
export function findYtDlp(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const override = env.ZENVI_YT_DLP?.trim();
  if (override) return override;
  const found = whichSync("yt-dlp", env);
  if (found) return found;
  const exe = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  return fallbackBinaryDirs(env)
    .map((dir) => path.join(dir, exe))
    .find(isExecutable);
}

/** The ffmpeg yt-dlp should use: Zenvi's, when it is really there. */
function findFfmpeg(env: NodeJS.ProcessEnv): string | null {
  const ffmpeg = resolveBinary("ffmpeg", env);
  return path.isAbsolute(ffmpeg) ? (isExecutable(ffmpeg) ? ffmpeg : null) : (whichSync(ffmpeg, env) ?? null);
}

async function systemResolve(host: string): Promise<string[]> {
  return (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
}

/**
 * Refuse URLs that are not http(s), and hosts that resolve to a private or
 * local address (web_video_ingest.assert_public_http_url).
 */
export async function assertPublicHttpUrl(url: string, options: Pick<WebVideoFetcherOptions, "resolve" | "isAllowedAddress"> = {}): Promise<void> {
  if (!isProbableWebVideoUrl(url)) throw new WebVideoError("refused", NOT_HTTP_URL_MESSAGE);
  const host = new URL(url.trim()).hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new WebVideoError("refused", "URL host is missing.");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await (options.resolve ?? systemResolve)(host);
  } catch {
    throw new WebVideoError("failed", `Could not resolve host '${host}'.`);
  }
  if (addresses.length === 0) throw new WebVideoError("failed", `Could not resolve host '${host}'.`);
  const allowed = options.isAllowedAddress ?? isPublicAddress;
  if (!addresses.every(allowed)) {
    throw new WebVideoError("refused", "That URL points at a private or local network address, which cannot be fetched.");
  }
}

/** Remove cache folders older than the TTL (at least an hour); returns how many (purge_expired_cache). */
export async function purgeExpiredCache(root: string, options: { ttlSeconds?: number; now?: number } = {}): Promise<number> {
  const ttl = Math.max(3600, Math.trunc(options.ttlSeconds ?? WEB_VIDEO_CACHE_TTL_SECONDS));
  const cutoff = (options.now ?? Date.now()) - ttl * 1000;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const mtime = await stat(dir).then((s) => s.mtimeMs, () => undefined);
    if (mtime === undefined || mtime >= cutoff) continue;
    await rm(dir, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

/** The refusal while a link cools down after a rate limit, else null (an expired cooldown is cleared). */
export async function checkRateLimitCooldown(dir: string, now = Date.now()): Promise<string | null> {
  const file = path.join(dir, COOLDOWN);
  let until: number;
  try {
    until = Number((JSON.parse(await readFile(file, "utf8")) as { until?: unknown }).until) * 1000;
  } catch {
    return null;
  }
  if (!Number.isFinite(until) || now >= until) {
    await rm(file, { force: true });
    return null;
  }
  return cooldownMessage((until - now) / 1000);
}

/** Remember a rate limit so the next call refuses without asking the site again. */
export async function writeRateLimitCooldown(dir: string, now = Date.now()): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, COOLDOWN), JSON.stringify({ until: now / 1000 + WEB_VIDEO_COOLDOWN_SECONDS, reason: "rate_limit" }));
  } catch {
    // A cooldown that cannot be written only means the next call asks the site again.
  }
}

async function isFile(file: string): Promise<boolean> {
  return stat(file).then((s) => s.isFile(), () => false);
}

/** The largest video or audio file in a folder (_largest_media_file). */
async function largestMediaFile(dir: string): Promise<string | undefined> {
  let best: string | undefined;
  let bestSize = -1;
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!MEDIA_EXTS.has(path.extname(name).toLowerCase())) continue;
    const file = path.join(dir, name);
    const size = await stat(file).then((s) => (s.isFile() ? s.size : -1), () => -1);
    if (size > bestSize) {
      bestSize = size;
      best = file;
    }
  }
  return best;
}

/** Subtitle files next to the video, sorted (_find_subtitle_files). */
async function subtitleFiles(dir: string): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names
    .filter((n) => /\.(vtt|srt)$/i.test(n))
    .map((n) => path.join(dir, n))
    .sort();
}

type Meta = Record<string, unknown>;

/** A download an earlier call kept, if its video is still there (load_cached_download). */
export async function loadCachedDownload(dir: string): Promise<Meta | null> {
  let meta: unknown;
  try {
    meta = JSON.parse(await readFile(path.join(dir, SIDECAR), "utf8"));
  } catch {
    return null;
  }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const out = { ...(meta as Meta) };
  let video = String(out.video_path ?? "").trim();
  if (!video || !(await isFile(video))) video = (await largestMediaFile(dir)) ?? "";
  if (!video) return null;
  out.video_path = path.resolve(video);
  return out;
}

function numberOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : value === null || value === undefined || value === "" ? NaN : Number(value);
  return Number.isFinite(n) ? n : null;
}

function downloadOf(meta: Meta, extra: { fromCache: boolean; cachePurged: number }): WebVideoDownload {
  return {
    path: String(meta.video_path),
    title: String(meta.title ?? ""),
    extractor: String(meta.extractor ?? ""),
    durationSeconds: numberOrNull(meta.duration_seconds),
    width: numberOrNull(meta.width),
    height: numberOrNull(meta.height),
    webpageUrl: String(meta.webpage_url ?? meta.url ?? ""),
    id: String(meta.id ?? ""),
    isYoutube: Boolean(meta.is_youtube),
    subtitlePaths: Array.isArray(meta.subtitle_paths) ? meta.subtitle_paths.map(String) : [],
    direct: false,
    ...extra,
  };
}

/** The yt-dlp command line for a page (download_web_video's options). */
export function ytDlpArgs(url: string, dir: string, intent: WebVideoIntent, withSubs: boolean, ffmpeg: string | null): string[] {
  const args = [
    "--format",
    formatSelectorForIntent(intent, ffmpeg !== null),
    "--output",
    // Named after the page (the desktop's media.%(ext)s): the project keeps a copy under this name.
    path.join(dir, "%(title).80B [%(id)s].%(ext)s"),
    "--no-playlist",
    "--retries",
    "3",
    "--fragment-retries",
    "3",
    "--force-overwrites",
    "--no-warnings",
    "--no-progress",
    "--print",
    PRINT_FIELDS,
  ];
  if (ffmpeg !== null) args.push("--merge-output-format", "mp4", "--ffmpeg-location", ffmpeg);
  if (withSubs) args.push("--write-subs", "--write-auto-subs", "--sub-langs", "en,en-US,en-GB", "--sub-format", "vtt/srt/best");
  // Android then web: fewer bot challenges than the default client alone.
  if (isYoutubeUrl(url)) args.push("--extractor-args", "youtube:player_client=android,web");
  args.push("--", url);
  return args;
}

/** yt-dlp's own error lines (it writes `ERROR: …` on stderr), else the tail of what it said. */
function ytDlpError(stderr: string): string {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errors = lines.filter((l) => l.startsWith("ERROR:")).map((l) => l.replace(/^ERROR:\s*/, ""));
  return (errors.length > 0 ? errors : lines.slice(-3)).join(" ");
}

/** The JSON object yt-dlp printed (the last line that parses). */
function printedInfo(stdout: string): Meta {
  for (const line of stdout.split(/\r?\n/).reverse()) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const value = JSON.parse(t) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Meta;
    } catch {
      // Not the JSON line.
    }
  }
  return {};
}

async function downloadPage(url: string, dir: string, request: WebVideoRequest, cachePurged: number, options: WebVideoFetcherOptions): Promise<WebVideoDownload> {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const cool = await checkRateLimitCooldown(dir, now());
  if (cool) throw new WebVideoError("failed", cool);
  const withSubs = wantsSubtitles(request.intent, request.writeSubs);
  const cached = await loadCachedDownload(dir);
  if (cached && cacheSatisfiesRequest(cached, request.intent, withSubs)) return downloadOf(cached, { fromCache: true, cachePurged });

  const ytDlp = options.ytDlp ?? findYtDlp(env);
  if (!ytDlp) throw new WebVideoError("unavailable", YT_DLP_MISSING);
  const ffmpeg = options.ffmpeg === undefined ? findFfmpeg(env) : options.ffmpeg;
  let stdout: string;
  try {
    const result = await runBinary(ytDlp, ytDlpArgs(url, dir, request.intent, withSubs, ffmpeg), {
      env,
      signal: request.signal,
      maxStdout: 1024 * 1024,
      what: "yt-dlp",
    });
    stdout = result.stdout.toString("utf8");
  } catch (error) {
    if (error instanceof BinaryNotFoundError) throw new WebVideoError("unavailable", YT_DLP_MISSING);
    const detail = error instanceof FfmpegError ? ytDlpError(error.stderr) || error.message : error instanceof Error ? error.message : String(error);
    if (isRateLimitError(detail)) await writeRateLimitCooldown(dir, now());
    throw new WebVideoError("failed", humanizeIngestFailure(new Error(detail)));
  }

  const info = printedInfo(stdout);
  let video = typeof info.filepath === "string" ? info.filepath : "";
  if (!video || !(await isFile(video))) video = (await largestMediaFile(dir)) ?? "";
  if (!video) throw new WebVideoError("failed", "Download finished but no video file landed on disk. Try again or update yt-dlp.");
  const title = Array.from(String(info.title || info.id || "web_video").trim().replace(/\s+/g, " ")).slice(0, 180).join("");
  const meta: Meta = {
    ok: true,
    url,
    intent: request.intent,
    title,
    extractor: String(info.extractor || info.extractor_key || ""),
    duration_seconds: numberOrNull(info.duration),
    width: numberOrNull(info.width),
    height: numberOrNull(info.height),
    requested_height: requestedHeightForIntent(request.intent),
    write_subs_requested: withSubs,
    video_path: path.resolve(video),
    subtitle_paths: await subtitleFiles(dir),
    webpage_url: String(info.webpage_url || url).trim(),
    id: String(info.id ?? ""),
    is_youtube: isYoutubeUrl(url),
  };
  // The sidecar lets the next call for this link reuse the download.
  await writeFile(path.join(dir, SIDECAR), JSON.stringify(meta, null, 2)).catch(() => undefined);
  return downloadOf(meta, { fromCache: false, cachePurged });
}

/** GET with redirects followed one hop at a time, each host checked first. */
async function fetchChecked(url: string, options: WebVideoFetcherOptions, signal?: AbortSignal): Promise<Response> {
  const doFetch = options.fetchImpl ?? fetch;
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHttpUrl(current, options);
    const response = await doFetch(current, { redirect: "manual", headers: { "User-Agent": "ZenviApp/1.0" }, signal });
    if (!REDIRECTS.has(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location) throw new WebVideoError("failed", `Pull failed (HTTP Error ${response.status} without a Location).`);
    current = new URL(location, current).toString();
  }
  throw new WebVideoError("failed", "Pull failed (too many redirects).");
}

/** A file name for a direct link's last path part. */
function directName(url: string): string {
  const raw = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  let last = raw;
  try {
    last = decodeURIComponent(raw);
  } catch {
    // A malformed %-escape: keep the name as written.
  }
  // eslint-disable-next-line no-control-regex
  const cleaned = last.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").replace(/^\.+/, "").trim().slice(0, 200);
  return cleaned || "video.mp4";
}

/**
 * A direct media link downloaded as is, or null when the "file" is a web
 * page (a Wikimedia Commons `File:….webm` page): that is read like any page.
 */
async function downloadDirect(url: string, dir: string, cachePurged: number, options: WebVideoFetcherOptions, signal?: AbortSignal): Promise<WebVideoDownload | null> {
  const maxBytes = options.maxDownloadBytes ?? 4 * 1024 ** 3;
  let response: Response;
  try {
    response = await fetchChecked(url, options, signal);
  } catch (error) {
    throw error instanceof WebVideoError ? error : new WebVideoError("failed", humanizeIngestFailure(error));
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    // HTTP/2 answers have no status text.
    const status = `HTTP Error ${response.status}${response.statusText ? `: ${response.statusText}` : ""}`;
    throw new WebVideoError("failed", humanizeIngestFailure(new Error(status)));
  }
  if (/^(text\/html|application\/xhtml)/i.test(response.headers.get("content-type") ?? "")) {
    await response.body.cancel().catch(() => undefined);
    return null;
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    await response.body.cancel().catch(() => undefined);
    throw new WebVideoError("failed", `The file is ${declared} bytes, over the ${maxBytes}-byte limit. Download it yourself and import it.`);
  }
  const dest = path.join(dir, directName(url));
  let received = 0;
  const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
  body.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > maxBytes) body.destroy(new WebVideoError("failed", `The file is over the ${maxBytes}-byte limit. Download it yourself and import it.`));
  });
  try {
    await pipeline(body, createWriteStream(dest), { signal });
  } catch (error) {
    await rm(dest, { force: true });
    throw error instanceof WebVideoError ? error : new WebVideoError("failed", humanizeIngestFailure(error));
  }
  return {
    path: dest,
    title: path.basename(dest),
    extractor: "",
    durationSeconds: null,
    width: null,
    height: null,
    webpageUrl: url,
    id: "",
    isYoutube: false,
    subtitlePaths: [],
    direct: true,
    fromCache: false,
    cachePurged,
  };
}

/**
 * `MediaHost.fetchWebVideo` for this computer: a page through yt-dlp (cached
 * per link), or a direct media link downloaded as is. Rejects with a
 * WebVideoError in words.
 */
export function createWebVideoFetcher(options: WebVideoFetcherOptions = {}): (request: WebVideoRequest) => Promise<WebVideoDownload> {
  return async (request) => {
    const url = request.url.trim();
    await assertPublicHttpUrl(url, options);
    const root = options.cacheRoot ?? webVideoCacheRoot(options.env ?? process.env);
    const cachePurged = await purgeExpiredCache(root, { now: (options.now ?? Date.now)() });
    const dir = path.join(root, urlCacheKey(url));
    await mkdir(dir, { recursive: true });
    // The desktop takes any link ending in a video extension as the file itself; a page is read with yt-dlp.
    const direct = isDirectMediaUrl(url) ? await downloadDirect(url, dir, cachePurged, options, request.signal) : null;
    return direct ?? downloadPage(url, dir, request, cachePurged, options);
  };
}
