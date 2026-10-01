/**
 * `zenvi push` / `zenvi pull`: move a project between this machine and
 * Zenvi Cloud (docs/ARCHITECTURE.md §5).
 *
 * Push: hash every local media file (full SHA-256; the desktop's
 * `fingerprint.sha256` is only a partial hash), upload the ones the cloud
 * lacks, then upload the project JSON with each file's `cloud` ref and its
 * paths replaced by unique file names (no local folders leak). The cloud
 * project id and revision are remembered per local file, so the next push
 * updates the same project (If-Match; a newer cloud edit is a conflict).
 *
 * Pull: download the project and any media not already on disk into
 * `<dir>/<name>_assets/media/`, point the paths at the local copies, save
 * `<dir>/<name>.zvn`.
 */

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Project, ProjectFile } from "@zenvi/engine";
import { projectAssetsDir, serializeProject } from "@zenvi/engine";
import { isPortableAssetPath, mapPathValues, sha256File, writeFileAtomic, writeProjectFile } from "@zenvi/render-node";
import type { ZenviConfig } from "../config.js";
import { CliError } from "../output.js";
import { CloudClient, CloudError, type CloudProject } from "./client.js";
import { uploadFile } from "./upload.js";

// ---------------------------------------------------------------------------
// Links: which cloud project a local file was pushed to / pulled from
// ---------------------------------------------------------------------------

export interface CloudLink {
  projectId: string;
  revision: string;
  editorUrl?: string;
  syncedAt: string;
}

type LinkFile = Record<string, CloudLink>;

function linksPath(config: ZenviConfig): string {
  return path.join(config.configDir, "cloud-links.json");
}

async function linkKey(config: ZenviConfig, projectFile: string): Promise<string> {
  const real = await realpath(projectFile).catch(() => path.resolve(projectFile));
  return `${config.cloudUrl}|${real}`;
}

async function readLinks(config: ZenviConfig): Promise<LinkFile> {
  try {
    const parsed = JSON.parse(await readFile(linksPath(config), "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as LinkFile) : {};
  } catch {
    return {};
  }
}

export async function getLink(config: ZenviConfig, projectFile: string): Promise<CloudLink | undefined> {
  return (await readLinks(config))[await linkKey(config, projectFile)];
}

export async function setLink(config: ZenviConfig, projectFile: string, link: CloudLink): Promise<void> {
  const links = await readLinks(config);
  links[await linkKey(config, projectFile)] = link;
  await mkdir(config.configDir, { recursive: true, mode: 0o700 });
  await writeFileAtomic(linksPath(config), `${JSON.stringify(links, null, 2)}\n`);
}

// ---------------------------------------------------------------------------

const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/x-m4v", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
  avi: "video/x-msvideo", mpg: "video/mpeg", mpeg: "video/mpeg", mts: "video/mp2t", ts: "video/mp2t", wmv: "video/x-ms-wmv",
  gif: "image/gif", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", bmp: "image/bmp",
  tif: "image/tiff", tiff: "image/tiff", svg: "image/svg+xml", heic: "image/heic",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg",
  opus: "audio/opus", flac: "audio/flac", aiff: "audio/aiff", aif: "audio/aiff", wma: "audio/x-ms-wma",
  srt: "application/x-subrip", vtt: "text/vtt",
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).slice(1).toLowerCase()] ?? "application/octet-stream";
}

export interface PushProgress {
  phase: "hashing" | "uploading" | "saving";
  file?: string;
  done: number;
  total: number;
}

export interface PushOptions {
  config: ZenviConfig;
  client: CloudClient;
  projectFile: string;
  /** The project as saved (with history). */
  project: Project;
  name?: string;
  /** Overwrite a cloud copy that changed since the last push. */
  force?: boolean;
  onProgress?: (p: PushProgress) => void;
  warn?: (message: string) => void;
}

export interface PushResult {
  projectId: string;
  revision: string;
  editorUrl: string;
  created: boolean;
  uploaded: number;
  reused: number;
  skipped: string[];
}

interface LocalMedia {
  file: ProjectFile;
  local: string;
  sha256: string;
  size: number;
  contentType: string;
  cloudName: string;
}

function uniqueName(name: string, taken: Set<string>): string {
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  let candidate = name;
  for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) candidate = `${stem} (${n})${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** The project JSON as the cloud stores it: cloud refs, paths replaced by unique names. */
export function cloudProjectJson(project: Project, media: LocalMedia[], warn?: (m: string) => void): Project {
  const byPath = new Map<string, LocalMedia>();
  for (const m of media) {
    byPath.set(m.local, m);
    if (typeof m.file.path === "string") byPath.set(m.file.path, m);
  }
  const unmapped = new Set<string>();
  const mapped = mapPathValues(project, (value) => {
    if (!value || isPortableAssetPath(value) || /^https?:\/\//i.test(value)) return value;
    const hit = byPath.get(value);
    if (hit) return hit.cloudName;
    if (path.isAbsolute(value)) {
      unmapped.add(value);
      return path.basename(value);
    }
    return value;
  });
  for (const file of mapped.files) {
    const m = media.find((x) => x.file.id === file.id);
    if (m) file.cloud = { sha256: m.sha256, size: m.size, content_type: m.contentType, name: m.cloudName };
  }
  for (const value of unmapped) {
    if (!/[\\/]thumbnail[\\/]/.test(value)) warn?.(`${path.basename(value)} is referenced by the project but is not a project file; it was not uploaded.`);
  }
  return mapped;
}

export async function pushProject(options: PushOptions): Promise<PushResult> {
  const { client, project, config } = options;
  const warn = options.warn ?? (() => undefined);
  const media: LocalMedia[] = [];
  const skipped: string[] = [];
  const taken = new Set<string>();
  const candidates = project.files.filter((f) => typeof f.path === "string" && f.path && !isPortableAssetPath(f.path) && !/^https?:/i.test(f.path));
  let done = 0;
  for (const file of candidates) {
    const local = String(file.path);
    options.onProgress?.({ phase: "hashing", file: path.basename(local), done, total: candidates.length });
    let size: number;
    try {
      const st = await stat(local);
      if (!st.isFile()) throw new Error("not a file");
      size = st.size;
    } catch {
      skipped.push(local);
      warn(`Media file missing, not uploaded: ${local}`);
      continue;
    }
    const contentType = contentTypeFor(local);
    if (contentType === "application/octet-stream") {
      skipped.push(local);
      warn(`${path.basename(local)} is not a media type Zenvi Cloud stores; skipped.`);
      continue;
    }
    const sha256 = await sha256File(local);
    const displayName = typeof file.name === "string" && file.name && path.extname(file.name) ? file.name : path.basename(local);
    media.push({ file, local, sha256, size, contentType, cloudName: uniqueName(displayName, taken) });
    done += 1;
  }

  const unique = [...new Map(media.map((m) => [m.sha256, m])).values()];
  const { missing } = await client.checkMedia(unique.map((m) => m.sha256));
  const missingSet = new Set(missing);
  let uploaded = 0;
  const toUpload = unique.filter((m) => missingSet.has(m.sha256));
  for (const m of toUpload) {
    options.onProgress?.({ phase: "uploading", file: m.cloudName, done: uploaded, total: toUpload.length });
    const ticket = await client.declareMedia({ sha256: m.sha256, size: m.size, name: m.cloudName, contentType: m.contentType });
    if (!ticket.exists) {
      if (!ticket.uploadUrl) throw new CliError(`Zenvi Cloud gave no upload URL for ${m.cloudName}.`);
      await uploadFile(m.local, ticket.uploadUrl, { headers: ticket.uploadHeaders });
      await client.completeMedia(m.sha256);
    }
    uploaded += 1;
  }

  options.onProgress?.({ phase: "saving", done: 0, total: 1 });
  // Through serializeProject like every saved project: the version stamp tells the
  // desktop the data is current (an unstamped project gets its clip alpha flipped).
  const body = JSON.parse(serializeProject(cloudProjectJson(project, media, warn))) as Project;
  const name = options.name ?? path.basename(options.projectFile, path.extname(options.projectFile));
  const link = await getLink(config, options.projectFile);
  let projectId: string;
  let revision: string;
  let editorUrl: string;
  let created = false;
  const create = async () => {
    const made = await client.createProject(name, body);
    created = true;
    return { id: made.id, revision: made.revision ?? "", editorUrl: made.editorUrl ?? `${config.editorUrl}/p/${made.id}` };
  };
  if (link) {
    try {
      const saved = await client.saveProject(link.projectId, body, options.force ? "*" : link.revision);
      projectId = link.projectId;
      revision = saved.revision;
      editorUrl = link.editorUrl ?? `${config.editorUrl}/p/${link.projectId}`;
      if (options.name) await client.renameProject(projectId, options.name).catch(() => undefined);
    } catch (error) {
      if (error instanceof CloudError && error.status === 404) {
        ({ id: projectId, revision, editorUrl } = await create());
      } else if (error instanceof CloudError && (error.status === 409 || error.status === 412)) {
        throw new CliError(
          "The cloud copy of this project changed since your last push (edited in the web editor or elsewhere).",
          1,
          "Pull it (`zenvi pull`) to get those edits, or push with --force to overwrite them.",
        );
      } else throw error;
    }
  } else {
    ({ id: projectId, revision, editorUrl } = await create());
  }
  await setLink(config, options.projectFile, { projectId, revision, editorUrl, syncedAt: new Date().toISOString() });
  return { projectId, revision, editorUrl, created, uploaded, reused: unique.length - uploaded, skipped };
}

// ---------------------------------------------------------------------------

export interface PullOptions {
  config: ZenviConfig;
  client: CloudClient;
  /** Project id, or an editor URL ending in /p/<id>. */
  id: string;
  /** Folder to pull into (default: ./<project name>). */
  dir?: string;
  cwd: string;
  onProgress?: (p: { file: string; done: number; total: number }) => void;
  warn?: (message: string) => void;
  fetchImpl?: typeof fetch;
}

export interface PullResult {
  projectFile: string;
  projectId: string;
  revision: string;
  downloaded: number;
  reused: number;
  missing: string[];
}

export function projectIdFrom(value: string): string {
  const m = /\/p\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/.exec(value.trim());
  return m ? m[1]! : value.trim();
}

function safeFileName(name: string): string {
  let out = "";
  for (const ch of name) out += ch.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(ch) ? "_" : ch;
  return out.replace(/^\.+/, "").trim().slice(0, 200) || "media";
}

async function sameContent(file: string, sha256: string, size?: number): Promise<boolean> {
  try {
    const st = await stat(file);
    if (size !== undefined && st.size !== size) return false;
    return (await sha256File(file)) === sha256;
  } catch {
    return false;
  }
}

async function download(url: string, dest: string, sha256: string, doFetch: typeof fetch): Promise<void> {
  const response = await doFetch(url, { signal: AbortSignal.timeout(30 * 60_000) });
  if (!response.ok || !response.body) throw new CliError(`Download failed (HTTP ${response.status}) for ${path.basename(dest)}.`);
  const tmp = `${dest}.${process.pid}.part`;
  const hash = createHash("sha256");
  const source = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
  source.on("data", (chunk: Buffer) => hash.update(chunk));
  try {
    await pipeline(source, createWriteStream(tmp));
    if (hash.digest("hex") !== sha256) throw new CliError(`${path.basename(dest)} did not match its SHA-256 after download.`);
    await rename(tmp, dest);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

export async function pullProject(options: PullOptions): Promise<PullResult> {
  const { client } = options;
  const warn = options.warn ?? (() => undefined);
  const id = projectIdFrom(options.id);
  const remote: CloudProject = await client.getProject(id);
  const name = safeFileName(remote.name || id);
  const dir = path.resolve(options.cwd, options.dir ?? name);
  const projectFile = path.join(dir, `${name}.zvn`);
  const mediaDir = path.join(projectAssetsDir(projectFile), "media");
  await mkdir(mediaDir, { recursive: true });

  const project = remote.project as unknown as Project;
  const byFile = new Map(remote.media.map((m) => [m.fileId, m]));
  const localFor = new Map<string, string>();
  let downloaded = 0;
  let reused = 0;
  let done = 0;
  const taken = new Set<string>();
  for (const file of project.files ?? []) {
    const entry = byFile.get(file.id);
    if (!entry) continue;
    options.onProgress?.({ file: entry.name, done, total: remote.media.length });
    const dest = path.join(mediaDir, uniqueName(safeFileName(entry.name || `${file.id}${path.extname(String(file.path ?? ""))}`), taken));
    if (await sameContent(dest, entry.sha256, entry.size)) reused += 1;
    else {
      await download(entry.url, dest, entry.sha256, options.fetchImpl ?? fetch);
      downloaded += 1;
    }
    if (typeof file.path === "string") localFor.set(file.path, dest);
    localFor.set(`#${file.id}`, dest);
    done += 1;
  }
  const missing = remote.missingMedia.map((m) => m.name);
  for (const m of missing) warn(`${m} is not in Zenvi Cloud; its clips will show as missing media.`);

  const local = mapPathValues(project, (value) => localFor.get(value) ?? value);
  for (const clip of local.clips ?? []) {
    const dest = localFor.get(`#${clip.file_id}`);
    if (dest && clip.reader && typeof clip.reader === "object") clip.reader.path = dest;
  }
  for (const file of local.files ?? []) {
    const dest = localFor.get(`#${file.id}`);
    if (dest) file.path = dest;
  }
  await writeProjectFile(projectFile, local);
  await setLink(options.config, projectFile, { projectId: id, revision: remote.revision ?? "", editorUrl: remote.editorUrl, syncedAt: new Date().toISOString() });
  return { projectFile, projectId: id, revision: remote.revision ?? "", downloaded, reused, missing };
}
