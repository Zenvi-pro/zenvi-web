/**
 * `MediaHost` for local disk: probe, import (reference or copy), expand
 * folders and globs, download URLs with a size cap, write generated media
 * into the project's `<name>_assets` folder like the desktop, and fetch web
 * page videos with yt-dlp (host/web-video.ts).
 */

import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import type { ImportedMedia, MediaHost, PathListing, ProjectFile, WebVideoDownload, WebVideoRequest } from "@zenvi/engine";
import { fingerprint } from "../probe/fingerprint.js";
import { probe } from "../probe/probe.js";
import { projectAssetsDir, sequenceFramesPresent } from "@zenvi/engine";
import { cacheDir } from "../svg/fonts.js";
import { isInside } from "./paths.js";
import { createKitSampleCache } from "./sfx-kit.js";
import { createWebVideoFetcher } from "./web-video.js";

/**
 * reference: keep media where it is (desktop default). copy: copy into
 * `<project>_assets/media`. auto: copy files from the OS temp folder and
 * from Zenvi's cache folder (web videos; both get cleaned up) unless the
 * project itself lives there.
 */
export type ImportPolicy = "reference" | "copy" | "auto";

export interface NodeMediaOptions {
  /** Current project file, if any (generated media and copies go next to it). */
  projectFile: () => string | undefined;
  policy?: ImportPolicy;
  /** Largest download accepted, bytes (default 4 GiB). */
  maxDownloadBytes?: number;
  /** Where media goes when no project file exists yet. */
  scratchDir?: string;
  /** The OS temp folder for the auto policy (tests). */
  tempRoot?: string;
  /** Zenvi's cache folder for the auto policy (default `cacheDir(env)`). */
  cacheRoot?: string;
  /** Environment for finding yt-dlp, ffmpeg and the cache folder (default `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** How web page videos are fetched (default: yt-dlp into `<cacheRoot>/web-video-cache`). */
  fetchWebVideo?: (request: WebVideoRequest) => Promise<WebVideoDownload>;
  fetchImpl?: typeof fetch;
}

function expandHome(p: string): string {
  if (p === "~") return process.env.HOME ?? p;
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(process.env.HOME ?? "", p.slice(2));
  return p;
}

/** A local path from a user-supplied import entry (file:// URLs, ~, quotes). */
export function localPath(entry: string): string {
  let value = entry.trim().replace(/^["']|["']$/g, "");
  if (/^file:\/\//i.test(value)) value = fileURLToPath(value);
  return path.resolve(expandHome(value));
}

/** Glob syntax → RegExp over forward-slash relative paths (`*`, `?`, `**`, `[…]`, `{a,b}`). */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i]!;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        const slash = glob[i + 2] === "/";
        re += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else re += "[^/]*";
    } else if (ch === "?") re += "[^/]";
    else if (ch === "[") {
      const end = glob.indexOf("]", i + 1);
      if (end < 0) re += "\\[";
      else {
        re += `[${glob.slice(i + 1, end).replace(/^!/, "^").replace(/\\/g, "\\\\")}]`;
        i = end;
      }
    } else if (ch === "{") {
      const end = glob.indexOf("}", i + 1);
      if (end < 0) re += "\\{";
      else {
        re += `(?:${glob.slice(i + 1, end).split(",").map((s) => s.replace(/[.+^$()|\\]/g, "\\$&")).join("|")})`;
        i = end;
      }
    } else re += /[.+^$()|\\]/.test(ch) ? `\\${ch}` : ch;
  }
  return new RegExp(`^${re}$`, process.platform === "win32" || process.platform === "darwin" ? "i" : "");
}

const MAX_LISTED = 5000;

async function walkFiles(dir: string, out: string[]): Promise<void> {
  if (out.length >= MAX_LISTED) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const names = entries.filter((e) => !e.name.startsWith(".")).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of names) if (e.isFile()) out.push(path.join(dir, e.name));
  for (const e of names) if (e.isDirectory()) await walkFiles(path.join(dir, e.name), out);
}

export async function listPaths(entry: string): Promise<PathListing> {
  const target = localPath(entry);
  try {
    const st = await stat(target);
    if (st.isFile()) return { kind: "file", files: [target], path: target };
    if (st.isDirectory()) {
      const files: string[] = [];
      await walkFiles(target, files);
      return { kind: "directory", files, path: target };
    }
  } catch {
    // Not a plain path: maybe a glob.
  }
  if (/[*?[{]/.test(entry)) {
    const normalized = target.split(path.sep).join("/");
    const firstMagic = normalized.search(/[*?[{]/);
    const base = normalized.slice(0, normalized.lastIndexOf("/", firstMagic) + 1) || "/";
    const pattern = globToRegExp(normalized.slice(base.length));
    const all: string[] = [];
    await walkFiles(base.split("/").join(path.sep) || path.sep, all);
    const files = all.filter((f) => pattern.test(f.split(path.sep).join("/").slice(base.length)));
    return { kind: "glob", files, path: target };
  }
  return { kind: "missing", files: [], path: target };
}

/**
 * Which project files' media is not on this disk (zenvi-core
 * media_files.media_missing): a file that does not exist, or an image
 * sequence (`frame_%04d.png`) whose folder holds none of its frames.
 * `resolve` maps a path as the project holds it to a local file.
 */
export async function missingOnDisk(files: readonly ProjectFile[], resolve: (projectPath: string) => string): Promise<boolean[]> {
  const folders = new Map<string, Promise<string[] | null>>();
  const namesIn = (folder: string): Promise<string[] | null> => {
    let hit = folders.get(folder);
    if (!hit) {
      hit = readdir(folder).catch(() => null);
      folders.set(folder, hit);
    }
    return hit;
  };
  return Promise.all(
    files.map(async (file) => {
      const stored = typeof file.path === "string" ? file.path : "";
      if (!stored) return true;
      let local: string;
      try {
        local = resolve(stored);
      } catch {
        return true;
      }
      if (local.includes("%")) {
        const names = await namesIn(path.dirname(local));
        return names === null || !sequenceFramesPresent(local, names);
      }
      return stat(local).then(
        () => false,
        () => true,
      );
    }),
  );
}

function safeName(name: string): string {
  const base = path.basename(name);
  let cleaned = "";
  // Characters Windows forbids in file names, and control characters.
  for (const ch of base) cleaned += ch.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(ch) ? "_" : ch;
  cleaned = cleaned.replace(/^\.+/, "").trim();
  return cleaned.slice(0, 200) || "media";
}

/** `name`, or `name (2)`, `name (3)`… when taken. */
export async function uniquePath(dir: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let n = 1; n < 10_000; n += 1) {
    const candidate = path.join(dir, n === 1 ? name : `${stem} (${n})${ext}`);
    try {
      await stat(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error(`No free file name for ${name} in ${dir}`);
}

function filenameFromResponse(url: URL, response: Response, fallback?: string): string {
  if (fallback) return safeName(fallback);
  const disposition = response.headers.get("content-disposition") ?? "";
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition);
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  const fromHeader = star ? decodeURIComponent(star[1]!.replace(/"/g, "")) : plain?.[1];
  if (fromHeader) return safeName(fromHeader);
  const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
  if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return safeName(last);
  const type = response.headers.get("content-type") ?? "";
  const ext = type.includes("mp4") ? ".mp4" : type.includes("webm") ? ".webm" : type.includes("mpeg") ? ".mp3" : type.includes("png") ? ".png" : type.includes("jpeg") ? ".jpg" : type.includes("wav") ? ".wav" : "";
  return safeName(`${last || "download"}${ext}`);
}

export function createNodeMediaHost(options: NodeMediaOptions): MediaHost {
  const policy = options.policy ?? "auto";
  const maxBytes = options.maxDownloadBytes ?? 4 * 1024 ** 3;
  const doFetch = options.fetchImpl ?? fetch;
  const scratch = options.scratchDir ?? path.join(tmpdir(), "zenvi-media");
  /** What writeGenerated wrote: the only files discardGenerated deletes. */
  const generated = new Set<string>();

  const mediaDir = async (sub: "media" | "title"): Promise<string> => {
    const project = options.projectFile();
    const dir = project ? path.join(projectAssetsDir(project), sub) : path.join(scratch, sub);
    await mkdir(dir, { recursive: true });
    return dir;
  };

  const imported = async (file: string, name?: string, known?: ImportedMedia["info"]): Promise<ImportedMedia> => {
    const info = known ? { ...known, path: file } : await probe(file);
    const fp = await fingerprint(file);
    const media: ImportedMedia = { path: file, info, name: name ?? path.basename(file) };
    if (fp) media.fingerprint = fp;
    return media;
  };

  const importPath = async (entry: string): Promise<ImportedMedia> => {
    const source = localPath(entry);
    const st = await stat(source).catch(() => undefined);
    if (!st?.isFile()) throw new Error(`File not found: ${source}`);
    // Probe before copying so a bad file leaves nothing behind.
    const info = await probe(source);
    const project = options.projectFile();
    const inAssets = project !== undefined && isInside(source, projectAssetsDir(project));
    // Files in a folder that gets cleaned up are copied, unless the project lives there too.
    const cleanedUp = [options.tempRoot ?? tmpdir(), options.cacheRoot ?? cacheDir(options.env)].some(
      (folder) => isInside(source, folder) && !(project !== undefined && isInside(project, folder)),
    );
    const copy = !inAssets && (policy === "copy" || (policy === "auto" && cleanedUp));
    if (!copy) return imported(source, undefined, info);
    const dest = await uniquePath(await mediaDir("media"), safeName(path.basename(source)));
    await copyFile(source, dest);
    return imported(dest, path.basename(source), info);
  };

  return {
    probe: (p) => probe(localPath(p)),
    importPath,
    listPaths,

    async importUrl(url, opts = {}) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error(`Not a valid URL: ${url}`);
      }
      if (parsed.protocol === "file:") return importPath(fileURLToPath(parsed));
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error(`Only http(s) URLs can be imported (got ${parsed.protocol}).`);
      const response = await doFetch(parsed, { signal: opts.signal, redirect: "follow" });
      if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status} ${response.statusText} for ${url}`);
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > maxBytes) throw new Error(`Download is ${declared} bytes, over the ${maxBytes}-byte limit.`);
      const dest = await uniquePath(await mediaDir("media"), filenameFromResponse(parsed, response, opts.filename));
      let received = 0;
      const limited = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
      limited.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > maxBytes) limited.destroy(new Error(`Download exceeded the ${maxBytes}-byte limit.`));
      });
      try {
        await pipeline(limited, createWriteStream(dest), { signal: opts.signal });
        return await imported(dest, path.basename(dest));
      } catch (error) {
        await rm(dest, { force: true });
        throw error;
      }
    },

    kitSample: createKitSampleCache({ cacheRoot: options.cacheRoot ?? cacheDir(options.env), fetchImpl: options.fetchImpl }),

    fetchWebVideo:
      options.fetchWebVideo ??
      createWebVideoFetcher({
        ...(options.cacheRoot ? { cacheRoot: path.join(options.cacheRoot, "web-video-cache") } : {}),
        env: options.env,
        fetchImpl: options.fetchImpl,
      }),

    async writeGenerated(name, bytes, contentType) {
      const sub = contentType === "image/svg+xml" || name.toLowerCase().endsWith(".svg") ? "title" : "media";
      const dest = await uniquePath(await mediaDir(sub), safeName(name));
      await writeFile(dest, bytes);
      generated.add(dest);
      return dest;
    },

    async discardGenerated(paths) {
      for (const p of paths) if (generated.delete(p)) await rm(p, { force: true });
    },
  };
}
