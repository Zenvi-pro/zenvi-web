/**
 * The CLI's web video fetch with a stand-in yt-dlp (a small Node program
 * that writes where --output says and prints the --print fields), a local
 * HTTP server for direct links, and a fake resolver: no network. Ported from
 * zenvi-core develop tests/test_web_video_ingest.py.
 */

import { createServer, type Server } from "node:http";
import { chmod, mkdir, readFile, readdir, utimes, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { isWebVideoError, type WebVideoRequest } from "@zenvi/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTempDir, makeVideo, removeDir } from "../test-support/fixtures.js";
import { createNodeMediaHost } from "./media.js";
import {
  YT_DLP_MISSING,
  assertPublicHttpUrl,
  checkRateLimitCooldown,
  createWebVideoFetcher,
  purgeExpiredCache,
  urlCacheKey,
  type WebVideoFetcherOptions,
} from "./web-video.js";

const FAKE_YT_DLP = `#!/usr/bin/env node
// A stand-in for yt-dlp: logs its arguments, fails for some URLs, else "downloads" a fixture.
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_YTDLP_LOG, JSON.stringify(args) + "\\n");
const url = args[args.indexOf("--") + 1] || "";
const out = args[args.indexOf("--output") + 1];
if (url.includes("gone")) {
  process.stderr.write("ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader\\n");
  process.exit(1);
}
if (url.includes("busy")) {
  process.stderr.write("ERROR: [youtube] abc: Unable to download webpage: HTTP Error 429: Too Many Requests\\n");
  process.exit(1);
}
const format = args[args.indexOf("--format") + 1];
const info = { id: "abc123", title: "Fake  Title", duration: 12.5, extractor: "youtube", webpage_url: url, width: 1280, height: format.includes("1080") ? 1080 : 720, ext: "mp4" };
const file = out.replace("%(title).80B", info.title).replace("%(id)s", info.id).replace("%(ext)s", info.ext);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.copyFileSync(process.env.FAKE_YTDLP_MEDIA, file);
if (args.includes("--write-subs")) fs.writeFileSync(file.replace(/\\.mp4$/, ".en.vtt"), "WEBVTT\\n\\n00:00.000 --> 00:01.000\\nHello\\n");
process.stdout.write(JSON.stringify({ ...info, filepath: file }) + "\\n");
`;

const PUBLIC = async (): Promise<string[]> => ["142.250.80.46"];
const YT = "https://www.youtube.com/watch?v=abc123";

let dir: string;
let ytDlp: string;
let clip: string;
let server: Server;
let baseUrl: string;
let runs = 0;

function request(url: string, intent: WebVideoRequest["intent"] = "reference", writeSubs = false): WebVideoRequest {
  return { url, intent, writeSubs };
}

/** A fetcher with its own cache and log, the fake yt-dlp and a public resolver. */
async function fetcher(name: string, extra: WebVideoFetcherOptions = {}) {
  const root = path.join(dir, name);
  const log = path.join(root, "yt-dlp.log");
  await mkdir(root, { recursive: true });
  await writeFile(log, "");
  const fetch = createWebVideoFetcher({
    cacheRoot: path.join(root, "cache"),
    ytDlp,
    ffmpeg: "/usr/bin/true-ffmpeg",
    env: { ...process.env, FAKE_YTDLP_LOG: log, FAKE_YTDLP_MEDIA: clip },
    resolve: PUBLIC,
    ...extra,
  });
  const calls = async (): Promise<string[][]> =>
    (await readFile(log, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as string[]);
  return { fetch, calls, cache: path.join(root, "cache") };
}

async function rejection(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(isWebVideoError(error), String(error)).toBe(true);
  return error as { code: string; message: string };
}

beforeAll(async () => {
  dir = await makeTempDir("zenvi-web-video-");
  ytDlp = path.join(dir, "bin", "yt-dlp");
  await mkdir(path.dirname(ytDlp), { recursive: true });
  await writeFile(ytDlp, FAKE_YT_DLP);
  await chmod(ytDlp, 0o755);
  clip = await makeVideo(dir, "clip.mp4", { duration: 1 });
  const bytes = await readFile(clip);
  server = createServer((req, res) => {
    runs += 1;
    if (req.url === "/clip.mp4") {
      res.writeHead(200, { "content-type": "video/mp4", "content-length": String(bytes.length) });
      res.end(bytes);
    } else if (req.url === "/moved.mp4") {
      res.writeHead(302, { location: "/clip.mp4" });
      res.end();
    } else if (req.url === "/wiki/File:Galaxy.webm") {
      res.writeHead(200, { "content-type": "text/html; charset=UTF-8" });
      res.end("<html><body><video src='/clip.mp4'></video></body></html>");
    } else {
      res.writeHead(404, "Not Found");
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 30_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await removeDir(dir);
});

describe.skipIf(process.platform === "win32")("fetchWebVideo through yt-dlp", () => {
  it("downloads a page into its cache folder and reports what the site said (test_download_web_video_with_fake_ydl)", async () => {
    const { fetch, calls, cache } = await fetcher("page");
    const got = await fetch(request(YT, "reference", false));
    const folder = path.join(cache, urlCacheKey(YT));
    expect(got).toEqual({
      path: path.join(folder, "Fake  Title [abc123].mp4"),
      title: "Fake Title",
      extractor: "youtube",
      durationSeconds: 12.5,
      width: 1280,
      height: 720,
      webpageUrl: YT,
      id: "abc123",
      isYoutube: true,
      subtitlePaths: [path.join(folder, "Fake  Title [abc123].en.vtt")],
      direct: false,
      fromCache: false,
      cachePurged: 0,
    });
    const [args] = await calls();
    expect(args).toEqual([
      "--format",
      "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best",
      "--output",
      path.join(folder, "%(title).80B [%(id)s].%(ext)s"),
      "--no-playlist",
      "--retries",
      "3",
      "--fragment-retries",
      "3",
      "--force-overwrites",
      "--no-warnings",
      "--no-progress",
      "--print",
      "after_move:%(.{id,title,duration,extractor,extractor_key,webpage_url,width,height,ext,filepath})j",
      "--merge-output-format",
      "mp4",
      "--ffmpeg-location",
      "/usr/bin/true-ffmpeg",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs",
      "en,en-US,en-GB",
      "--sub-format",
      "vtt/srt/best",
      "--extractor-args",
      "youtube:player_client=android,web",
      "--",
      YT,
    ]);
    const sidecar = JSON.parse(await readFile(path.join(folder, "ingest.json"), "utf8")) as Record<string, unknown>;
    expect(sidecar).toMatchObject({ id: "abc123", requested_height: 720, write_subs_requested: true, is_youtube: true });
  });

  it("reuses the cache when it is good enough, and downloads again when the intent needs more (test_download_reuses_cache_without_ydl, test_download_skips_cache_when_height_too_low)", async () => {
    const { fetch, calls } = await fetcher("reuse");
    await fetch(request(YT, "reference"));
    const again = await fetch(request(YT, "recreate"));
    expect(again.fromCache).toBe(true);
    expect(await calls()).toHaveLength(1);
    const taller = await fetch(request(YT, "timeline"));
    expect(taller).toMatchObject({ fromCache: false, height: 1080 });
    expect((await calls())[1]).toContain("bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best");
    expect(await calls()).toHaveLength(2);
  });

  it("asks for single files without ffmpeg, and for no subtitles on the timeline", async () => {
    const { fetch, calls } = await fetcher("plain", { ffmpeg: null });
    await fetch(request("https://vimeo.com/42", "timeline", false));
    const [args] = await calls();
    expect(args![1]).toBe("best[height<=1080][ext=mp4]/best[height<=1080]/best[ext=mp4]/best");
    expect(args).not.toContain("--merge-output-format");
    expect(args).not.toContain("--write-subs");
    expect(args).not.toContain("--extractor-args");
  });

  it("answers a failed pull briefly, and cools a rate-limited link down without asking again", async () => {
    const { fetch, calls, cache } = await fetcher("fail");
    const gone = await rejection(fetch(request("https://youtu.be/gone")));
    expect(gone).toMatchObject({ code: "failed", message: "That video is unavailable (removed, region-blocked, or bad link). Download the MP4 yourself and import it (Imports / import_files_tool)." });
    const busy = await rejection(fetch(request("https://youtu.be/busy")));
    expect(busy.message).toBe("YouTube rate-limited the download. Wait about 10 minutes, or upload an MP4 yourself.");
    expect(await checkRateLimitCooldown(path.join(cache, urlCacheKey("https://youtu.be/busy")))).toMatch(/^YouTube is still rate-limiting this link\. Wait about 10 minute\(s\)/);
    const cooling = await rejection(fetch(request("https://youtu.be/busy")));
    expect(cooling.message).toMatch(/^YouTube is still rate-limiting this link/);
    expect(await calls()).toHaveLength(2);
  });

  it("refuses in words when this computer has no yt-dlp", async () => {
    const { fetch } = await fetcher("missing", { ytDlp: path.join(dir, "nowhere", "yt-dlp") });
    expect(await rejection(fetch(request(YT)))).toEqual(expect.objectContaining({ code: "unavailable", message: YT_DLP_MISSING }));
  });
});

describe("links that may not be fetched", () => {
  it("refuses non-http URLs and private or local addresses before anything is fetched (test_assert_public_http_url_rejects_*)", async () => {
    expect(await rejection(assertPublicHttpUrl("/tmp/local.mp4"))).toMatchObject({ code: "refused", message: expect.stringMatching(/^URL must be http\(s\)/) });
    expect(await rejection(assertPublicHttpUrl("https://evil.example/video.mp4", { resolve: async () => ["127.0.0.1"] }))).toMatchObject({
      code: "refused",
      message: "That URL points at a private or local network address, which cannot be fetched.",
    });
    expect((await rejection(assertPublicHttpUrl("http://10.0.0.8/clip.mp4"))).message).toMatch(/private or local/);
    expect((await rejection(assertPublicHttpUrl("https://site.example/a", { resolve: async () => ["93.184.216.34", "192.168.1.4"] }))).message).toMatch(/private or local/);
    expect(await rejection(assertPublicHttpUrl("https://nowhere.example/a", { resolve: async () => Promise.reject(new Error("ENOTFOUND")) }))).toMatchObject({
      code: "failed",
      message: "Could not resolve host 'nowhere.example'.",
    });
    await expect(assertPublicHttpUrl("https://www.youtube.com/watch?v=1", { resolve: PUBLIC })).resolves.toBeUndefined();
  });
});

describe("direct media links", () => {
  it("downloads the file as is, following redirects host by host", async () => {
    const { fetch, calls, cache } = await fetcher("direct", { isAllowedAddress: () => true });
    const url = `${baseUrl}/moved.mp4`;
    const got = await fetch(request(url));
    expect(got).toMatchObject({ path: path.join(cache, urlCacheKey(url), "moved.mp4"), extractor: "", isYoutube: false, webpageUrl: url, subtitlePaths: [], direct: true });
    expect((await readFile(got.path)).equals(await readFile(clip))).toBe(true);
    expect(await calls()).toEqual([]);
    expect((await rejection(fetch(request(`${baseUrl}/missing.mp4`)))).message).toBe(
      "Pull failed (HTTP Error 404: Not Found). Download the MP4 yourself and import it (Imports / import_files_tool).",
    );
  });

  it.skipIf(process.platform === "win32")("reads a link that ends like a video file but serves a web page as a page (a Wikimedia Commons File: page)", async () => {
    const { fetch, calls } = await fetcher("direct-page", { isAllowedAddress: () => true });
    const url = `${baseUrl}/wiki/File:Galaxy.webm`;
    const got = await fetch(request(url));
    expect(got).toMatchObject({ direct: false, extractor: "youtube", title: "Fake Title" });
    expect((await calls()).map((args) => args.at(-1))).toEqual([url]);
  });

  it("does not fetch a direct link to a local address with the default policy", async () => {
    const before = runs;
    const { fetch } = await fetcher("direct-local");
    expect((await rejection(fetch(request(`${baseUrl}/clip.mp4`)))).message).toMatch(/private or local/);
    expect(runs).toBe(before);
  });
});

describe("the cache", () => {
  it("drops folders older than the TTL (test_purge_expired_cache)", async () => {
    const root = path.join(dir, "purge");
    await mkdir(path.join(root, "old"), { recursive: true });
    await mkdir(path.join(root, "new"), { recursive: true });
    await writeFile(path.join(root, "loose.txt"), "x");
    await utimes(path.join(root, "old"), 100, 100);
    const now = Date.now();
    expect(await purgeExpiredCache(root, { ttlSeconds: 3600, now })).toBe(1);
    expect((await readdir(root)).sort()).toEqual(["loose.txt", "new"]);
    expect(await purgeExpiredCache(path.join(dir, "no-such-folder"))).toBe(0);
  });

  it("is a place imports copy from, so the project keeps the video after the cache is cleaned", async () => {
    const cacheRoot = path.join(dir, "media-host-cache");
    const cached = await makeVideo(path.join(cacheRoot, "web-video-cache", "k1"), "Look Ref [x1].mp4", { duration: 1 });
    const own = await makeVideo(path.join(dir, "library"), "own.mp4", { duration: 1 });
    const project = path.join(dir, "media-host", "Edit.zvn");
    // The test folders live in the OS temp folder: name another one so only the cache rule applies.
    const media = createNodeMediaHost({ projectFile: () => project, cacheRoot, tempRoot: path.join(dir, "elsewhere") });
    const imported = await media.importPath!(cached);
    expect(imported.path).toBe(path.join(dir, "media-host", "Edit_assets", "media", "Look Ref [x1].mp4"));
    expect((await media.importPath!(own)).path).toBe(own);
    expect(typeof media.fetchWebVideo).toBe("function");
  });
});
