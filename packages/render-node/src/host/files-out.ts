/**
 * Files the CLI writes for a person: saved frames (save_frame_image_tool),
 * copies of project media and rendered sub-clips (export_files_to_folder_tool),
 * and media collected into the project's assets folder or reclaimed from it
 * (consolidate_project_media_tool).
 *
 * Ports of zenvi-core develop editor_tools/project_export_render.py
 * (save_frame_image, export_files_to_folder: staged writes, existing files
 * skipped) and classes/media_collect.py (copy_media_into_project,
 * find_reclaimable_media, the delete half of commit_reclaim), with
 * classes/assets.py unique_media_dest and media_fingerprint.files_identical.
 */

import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { projectAssetsDir, type Project, type CollectedMedia, type ExportedMedia, type MediaMove, type MediaRender, type ReclaimableMedia } from "@zenvi/engine";
import type { RenderEngine } from "../render/engine.js";
import { renderProject } from "../render/render-project.js";
import { isInside } from "./paths.js";
import { writeFileAtomic, writeProjectFile, type ProjectFileOptions } from "./storage.js";

async function isFile(file: string): Promise<boolean> {
  return (await stat(file).catch(() => undefined))?.isFile() ?? false;
}

async function exists(file: string): Promise<boolean> {
  return (await stat(file).catch(() => undefined)) !== undefined;
}

/** An error with the code a tool checks for (the desktop refuses to overwrite). */
function alreadyExists(file: string): Error {
  return Object.assign(new Error(`${file} already exists`), { code: "EEXIST", path: file });
}

/** Write `bytes` at `file` (folders created), atomically; refuses an existing file unless `overwrite`. */
export async function writeBytesFile(file: string, bytes: Uint8Array, overwrite = false): Promise<string> {
  if (!overwrite && (await exists(file))) throw alreadyExists(file);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, bytes);
  return file;
}

/** A copy of a project at `file` (a variant): its media paths stored relative to the copy's folder; refuses an existing file unless `overwrite`. */
export async function writeProjectCopy(file: string, project: Project, options: ProjectFileOptions & { overwrite?: boolean } = {}): Promise<string> {
  if (!options.overwrite && (await exists(file))) throw alreadyExists(file);
  await mkdir(path.dirname(file), { recursive: true });
  return writeProjectFile(file, project, options);
}

export interface ExportMediaOptions {
  /** The project file's media on disk. */
  source: string;
  /** Destination folder (absolute). */
  folder: string;
  name: string;
  render?: MediaRender;
  resolveMedia: (projectPath: string) => string;
  engine?: RenderEngine;
  signal?: AbortSignal;
}

/**
 * Copy a file into a folder, or render a sub-clip there; an existing file of
 * that name is kept (skipped, like the desktop's dialog). Renders are
 * written under a staged name and moved into place only when complete, so a
 * failed render never leaves a file the next export would skip.
 */
export async function exportMediaFile(opts: ExportMediaOptions): Promise<ExportedMedia> {
  const dest = path.join(opts.folder, opts.name);
  if (await exists(dest)) return { location: dest, folder: opts.folder, existed: true };
  await mkdir(opts.folder, { recursive: true });
  if (!opts.render) {
    if (!(await isFile(opts.source))) throw new Error(`file not found: ${opts.source}`);
    await copyFile(opts.source, dest, fsConstants.COPYFILE_EXCL);
    return { location: dest, folder: opts.folder, existed: false };
  }
  const ext = path.extname(dest);
  const staged = path.join(opts.folder, `${path.basename(dest, ext)}.partial-${randomBytes(4).toString("hex")}${ext}`);
  try {
    await renderProject(opts.render.project, {
      resolveMedia: opts.resolveMedia,
      output: staged,
      options: opts.render.options,
      engine: opts.engine,
      signal: opts.signal,
    });
    await rename(staged, dest);
  } finally {
    await rm(staged, { force: true });
  }
  return { location: dest, folder: opts.folder, existed: false };
}

/** `unique_media_dest`: `name`, else `stem_<file id>[_n].ext`; a path that already is the source is reused. */
async function uniqueMediaDest(dir: string, name: string, fileId: string, source: string): Promise<string> {
  const same = async (candidate: string): Promise<boolean> => {
    const [a, b] = await Promise.all([stat(source).catch(() => undefined), stat(candidate).catch(() => undefined)]);
    return Boolean(a && b && a.dev === b.dev && a.ino === b.ino);
  };
  const first = path.join(dir, name);
  if (!(await isFile(first)) || (await same(first))) return first;
  const ext = path.extname(name);
  const stemName = ext ? name.slice(0, -ext.length) : name;
  for (let n = 0; n < 100_000; n += 1) {
    const candidate = path.join(dir, n === 0 ? `${stemName}_${fileId || "file"}${ext}` : `${stemName}_${fileId || "file"}_${n}${ext}`);
    if (!(await isFile(candidate)) || (await same(candidate))) return candidate;
  }
  throw new Error(`no free name for ${name} in ${dir}`);
}

export interface CollectOptions {
  projectFile: string;
  /** Bundled engine assets: never collected (the desktop skips its own app folder). */
  engineAssetsDir?: string;
  resolveMedia: (projectPath: string) => string;
}

/** `copy_media_into_project`: copy external media into `<project>_assets/media`. Never changes the project. */
export async function collectMedia(files: readonly { id: string; path: string }[], opts: CollectOptions): Promise<CollectedMedia> {
  const out: CollectedMedia = { copied: [], skipped: [], errors: [], moves: [] };
  if (files.length === 0) return out;
  const assets = projectAssetsDir(path.resolve(opts.projectFile));
  const mediaDir = path.join(assets, "media");
  try {
    await mkdir(mediaDir, { recursive: true });
  } catch (error) {
    out.errors.push(error instanceof Error ? error.message : String(error));
    return out;
  }
  for (const file of files) {
    if (!file.path || file.path.includes("%")) {
      out.skipped.push(file.path || "(empty)");
      continue;
    }
    const source = path.resolve(opts.resolveMedia(file.path));
    if (!(await isFile(source)) || isInside(source, assets) || (opts.engineAssetsDir && isInside(source, opts.engineAssetsDir))) {
      out.skipped.push(source);
      continue;
    }
    const dest = await uniqueMediaDest(mediaDir, path.basename(source), file.id, source);
    if (await isFile(dest)) {
      out.skipped.push(source);
    } else {
      try {
        await copyFile(source, dest, fsConstants.COPYFILE_EXCL);
      } catch (error) {
        out.errors.push(`${source}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      out.copied.push(dest);
    }
    out.moves.push({ fileId: file.id, from: file.path, to: dest });
  }
  return out;
}

async function sha256Of(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** `files_identical`: same size and full-file SHA-256. */
async function filesIdentical(a: string, b: string): Promise<boolean> {
  const [sa, sb] = await Promise.all([stat(a).catch(() => undefined), stat(b).catch(() => undefined)]);
  if (!sa?.isFile() || !sb?.isFile() || sa.size !== sb.size) return false;
  const [ha, hb] = await Promise.all([sha256Of(a), sha256Of(b)]);
  return ha === hb;
}

/** `find_reclaimable_media`: asset copies whose recorded original is still there, byte for byte. */
export async function reclaimableMedia(
  files: readonly { id: string; path: string; original: string }[],
  opts: CollectOptions,
): Promise<ReclaimableMedia> {
  const out: ReclaimableMedia = { moves: [], kept: [], errors: [] };
  const mediaDir = path.join(projectAssetsDir(path.resolve(opts.projectFile)), "media");
  for (const file of files) {
    const copy = path.resolve(opts.resolveMedia(file.path));
    if (!isInside(copy, mediaDir)) continue;
    // Without a surviving original the copy may be the only version.
    if (!(await isFile(copy)) || !(await isFile(file.original))) {
      out.kept.push(copy);
      continue;
    }
    try {
      if (await filesIdentical(copy, file.original)) out.moves.push({ fileId: file.id, from: file.path, to: file.original } satisfies MediaMove);
      else out.kept.push(copy);
    } catch (error) {
      out.errors.push(`${copy}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return out;
}

/** Delete asset copies; only files inside the project's assets folder. */
export async function removeMediaCopies(paths: readonly string[], opts: CollectOptions): Promise<{ removed: string[]; errors: string[] }> {
  const assets = projectAssetsDir(path.resolve(opts.projectFile));
  const removed: string[] = [];
  const errors: string[] = [];
  for (const p of paths) {
    const file = path.resolve(opts.resolveMedia(p));
    if (!isInside(file, assets)) {
      errors.push(`${file}: not in the project's assets folder`);
      continue;
    }
    try {
      await rm(file);
      removed.push(file);
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { removed, errors };
}
