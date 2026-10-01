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
 * `<dir>/<name>.zvn` with `zenvi_cloud.project_id`. A pull never replaces a
 * project file that belongs to another cloud project (or to none: a local
 * project), nor one with edits made since the last sync, unless forced:
 * names that collide after sanitizing (`Trip/One`, `Trip:One`) pull into
 * `Trip_One (2)/` instead.
 */

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { CloudMediaRef, Project, ProjectFile } from "@zenvi/engine";
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
  /** SHA-256 of the .zvn as it was after the last push or pull (local edits change it). */
  fileSha256?: string;
}

/** Top-level key of a pulled .zvn naming its cloud project (local metadata, never uploaded). */
export const CLOUD_MARKER_KEY = "zenvi_cloud";

interface CloudMarker {
  project_id: string;
  revision?: string;
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

function textSha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Record the .zvn's current content as synced (after a push saved cloud refs, or a pull). */
export async function markSynced(config: ZenviConfig, projectFile: string): Promise<void> {
  const link = await getLink(config, projectFile);
  if (!link) return;
  let bytes: Buffer;
  try {
    bytes = await readFile(projectFile);
  } catch {
    return;
  }
  await setLink(config, projectFile, { ...link, fileSha256: textSha256(bytes) });
}

/** Which cloud project an existing .zvn belongs to, and whether it changed since its last sync. */
export type LocalProjectState =
  | { kind: "missing" }
  | { kind: "same"; unsynced: boolean }
  | { kind: "other"; projectId?: string };

export async function localProjectState(config: ZenviConfig, projectFile: string, projectId: string): Promise<LocalProjectState> {
  let bytes: Buffer;
  try {
    bytes = await readFile(projectFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    throw error;
  }
  let marker: string | undefined;
  try {
    const value = (JSON.parse(bytes.toString("utf8")) as Record<string, unknown>)[CLOUD_MARKER_KEY] as Partial<CloudMarker> | undefined;
    if (value && typeof value.project_id === "string") marker = value.project_id;
  } catch {
    // Not JSON: certainly not something we pulled; never replace it silently.
  }
  const link = await getLink(config, projectFile);
  const owner = marker ?? link?.projectId;
  if (owner !== projectId) return { kind: "other", projectId: owner };
  // Ours. Unsynced when it differs from what the last sync wrote; with no
  // record of that (a link from an older CLI, or no link) assume it may have.
  const unsynced = link?.projectId === projectId && link.fileSha256 ? link.fileSha256 !== textSha256(bytes) : true;
  return { kind: "same", unsynced };
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
  /** `files[].cloud` per file id, to keep in the local project (the desktop reuses the hash while size and mtime match). */
  cloudRefs: Record<string, CloudMediaRef>;
}

interface LocalMedia {
  file: ProjectFile;
  local: string;
  sha256: string;
  size: number;
  /** Seconds, like Python's os.stat().st_mtime. */
  mtime: number;
  contentType: string;
  cloudName: string;
}

/**
 * `files[].cloud` as the desktop writes it (zenvi-core #238):
 * `{sha256 (whole file), size, name, content_type, mtime}`, keeping keys
 * this version does not know.
 */
export function cloudRef(file: ProjectFile, m: { sha256: string; size: number; contentType: string; name: string; mtime: number }): CloudMediaRef {
  const previous = file.cloud && typeof file.cloud === "object" ? file.cloud : {};
  return { ...previous, sha256: m.sha256, size: m.size, name: m.name, content_type: m.contentType, mtime: m.mtime };
}

/** The stored hash, when the file still has the size and mtime it was hashed at. */
function reusableHash(file: ProjectFile, size: number, mtime: number): string | undefined {
  const c = file.cloud as (CloudMediaRef & { mtime?: unknown }) | undefined;
  if (!c || typeof c.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(c.sha256)) return undefined;
  if (c.size !== size || typeof c.mtime !== "number" || Math.abs(c.mtime - mtime) > 1e-3) return undefined;
  return c.sha256;
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
    if (m) file.cloud = cloudRef(file, { ...m, name: m.cloudName });
  }
  for (const value of unmapped) {
    if (!/[\\/]thumbnail[\\/]/.test(value)) warn?.(`${path.basename(value)} is referenced by the project but is not a project file; it was not uploaded.`);
  }
  // Which cloud project a local copy belongs to is this machine's business.
  const { [CLOUD_MARKER_KEY]: _marker, ...upload } = mapped as Project & { [CLOUD_MARKER_KEY]?: unknown };
  return upload as Project;
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
    let mtime: number;
    try {
      const st = await stat(local);
      if (!st.isFile()) throw new Error("not a file");
      size = st.size;
      mtime = st.mtimeMs / 1000;
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
    // Never the desktop's fingerprint.sha256: it only hashes the first and last MB.
    const sha256 = reusableHash(file, size, mtime) ?? (await sha256File(local));
    const displayName = typeof file.name === "string" && file.name && path.extname(file.name) ? file.name : path.basename(local);
    media.push({ file, local, sha256, size, mtime, contentType, cloudName: uniqueName(displayName, taken) });
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
  const cloudRefs: Record<string, CloudMediaRef> = {};
  for (const m of media) cloudRefs[m.file.id] = cloudRef(m.file, { ...m, name: m.cloudName });
  return { projectId, revision, editorUrl, created, uploaded, reused: unique.length - uploaded, skipped, cloudRefs };
}

// ---------------------------------------------------------------------------

export interface PullOptions {
  config: ZenviConfig;
  client: CloudClient;
  /** Project id, or an editor URL ending in /p/<id>. */
  id: string;
  /** Folder to pull into (default: ./<project name>, or `<name> (2)`… when that holds another project). */
  dir?: string;
  cwd: string;
  /** Replace a project file that belongs to another project or has unsynced local edits. */
  force?: boolean;
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

/**
 * Where a pull writes `<name>.zvn`. An explicit folder is used as is, but a
 * project file there that belongs to another project (or has edits since its
 * last sync) is only replaced with `force`. Without a folder, `./<name>` or
 * the first `./<name> (n)` that is free or holds this same project.
 */
async function pullDestination(options: PullOptions, id: string, name: string): Promise<string> {
  const check = async (projectFile: string, explicit: boolean): Promise<"use" | "skip"> => {
    const state = await localProjectState(options.config, projectFile, id);
    if (state.kind === "missing" || options.force) return "use";
    if (state.kind === "same") {
      if (!state.unsynced) return "use";
      throw new CliError(
        `${projectFile} has edits that are not in Zenvi Cloud yet; pulling would replace them.`,
        1,
        "Push them first (`zenvi push`), or pull again with --force to replace them.",
      );
    }
    if (!explicit) return "skip";
    const whose = state.projectId ? `cloud project ${state.projectId}` : "a local project";
    throw new CliError(`${projectFile} belongs to ${whose}; pulling ${id} would replace it.`, 1, "Pull into another folder, or use --force to replace it.");
  };
  if (options.dir !== undefined) {
    const projectFile = path.join(path.resolve(options.cwd, options.dir), `${name}.zvn`);
    await check(projectFile, true);
    return projectFile;
  }
  for (let n = 1; n < 1000; n += 1) {
    const dir = path.resolve(options.cwd, n === 1 ? name : `${name} (${n})`);
    const projectFile = path.join(dir, `${name}.zvn`);
    if ((await check(projectFile, false)) === "use") return projectFile;
  }
  throw new CliError(`Too many folders named ${name} here; pull into a folder of your choice.`, 2);
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
  const projectFile = await pullDestination(options, id, name);
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
    if (!dest) continue;
    file.path = dest;
    // The download was hash-checked: record this copy's size and mtime so
    // the desktop and later pushes reuse the hash instead of re-reading it.
    const entry = byFile.get(file.id);
    const st = await stat(dest);
    if (entry) file.cloud = cloudRef(file, { sha256: entry.sha256, size: st.size, contentType: entry.contentType ?? file.cloud?.content_type ?? contentTypeFor(dest), name: entry.name, mtime: st.mtimeMs / 1000 });
  }
  const marker: CloudMarker = { project_id: id, revision: remote.revision ?? "" };
  (local as Project & { [CLOUD_MARKER_KEY]?: CloudMarker })[CLOUD_MARKER_KEY] = marker;
  await writeProjectFile(projectFile, local);
  await setLink(options.config, projectFile, {
    projectId: id,
    revision: remote.revision ?? "",
    editorUrl: remote.editorUrl,
    syncedAt: new Date().toISOString(),
    fileSha256: textSha256(await readFile(projectFile)),
  });
  return { projectFile, projectId: id, revision: remote.revision ?? "", downloaded, reused, missing };
}
