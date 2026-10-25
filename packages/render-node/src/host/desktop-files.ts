/**
 * What the CLI shares with Zenvi desktop on the same computer, in the
 * desktop's user folder (`~/.openshot_qt`, ZENVI_DESKTOP_DIR):
 *
 * - File > Recent Projects: `openshot.settings` (`recent_projects`, oldest
 *   first). Read only: the desktop app owns that file, and a second writer
 *   would undo its changes (zenvi-core settings.py keeps even its own
 *   headless sessions read-only).
 * - File > Recovery: `recovery/<unix time>-<project name>.zip`, one zip of
 *   the project per desktop save (project_recovery.py). Restoring keeps the
 *   current file as `<name>-<time>-backup.zvn` next to it and unzips the
 *   copy over it (main_window.restore_recovery_file).
 * - Custom video profiles: `profiles/<key>`, the profile editor's files,
 *   which the desktop's Choose Profile dialog lists.
 */

import { mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { ProfileFile, RecentProject, RecoveryCopy } from "@zenvi/engine";
import { ZipError, readZipEntries } from "./zip.js";
import { writeFileAtomic } from "./storage.js";

const PROJECT_EXTS = [".zvn", ".osp", ".flow"];
const MAX_PROFILE_BYTES = 64 * 1024;
const MAX_SETTINGS_BYTES = 16 * 1024 * 1024;

async function isFile(file: string): Promise<boolean> {
  return (await stat(file).catch(() => undefined))?.isFile() ?? false;
}

function stem(file: string): string {
  const name = path.basename(file);
  const ext = path.extname(name);
  return ext ? name.slice(0, -ext.length) : name;
}

/** Zenvi desktop's File > Recent Projects, most recent first (an empty list without the desktop). */
export async function desktopRecentProjects(desktopDir: string): Promise<RecentProject[]> {
  const settings = path.join(desktopDir, "openshot.settings");
  const st = await stat(settings).catch(() => undefined);
  if (!st?.isFile() || st.size > MAX_SETTINGS_BYTES) return [];
  let entries: unknown;
  try {
    entries = JSON.parse(await readFile(settings, "utf8"));
  } catch {
    return [];
  }
  const entry = Array.isArray(entries) ? entries.find((e) => e && typeof e === "object" && (e as { setting?: unknown }).setting === "recent_projects") : undefined;
  const value = (entry as { value?: unknown } | undefined)?.value;
  const paths = Array.isArray(value) ? value.filter((p): p is string => typeof p === "string" && p !== "") : [];
  const out: RecentProject[] = [];
  for (const file of paths.reverse()) {
    const info = await stat(file).catch(() => undefined);
    const exists = info?.isFile() ?? false;
    out.push({ path: file, name: stem(file), exists, modifiedAt: exists ? info!.mtimeMs / 1000 : null });
  }
  return out;
}

/** `_restorable`: a zip holding exactly one file, or a non-empty project file (older builds). */
async function restorable(file: string): Promise<boolean> {
  try {
    if (!file.endsWith(".zip")) return ((await stat(file)).size ?? 0) > 0;
    return readZipEntries(await readFile(file)).length === 1;
  } catch {
    return false;
  }
}

/** `recovery_files_for`: the copies of a project (its exact name), newest first. */
export async function recoveryCopiesFor(desktopDir: string, projectFile: string): Promise<RecoveryCopy[]> {
  const dir = path.join(desktopDir, "recovery");
  const names = await readdir(dir).catch(() => [] as string[]);
  const base = stem(projectFile);
  const wanted = new Set([`${base}.zip`, ...PROJECT_EXTS.map((ext) => `${base}${ext}`)]);
  const found: { savedAt: number; path: string; size: number }[] = [];
  for (const name of names) {
    const dash = name.indexOf("-");
    if (dash < 0 || !wanted.has(name.slice(dash + 1))) continue;
    const stamp = name.slice(0, dash).trim();
    if (!/^[+-]?\d+$/.test(stamp)) continue;
    const file = path.join(dir, name);
    if (!(await restorable(file))) continue;
    found.push({ savedAt: Number.parseInt(stamp, 10), path: file, size: (await stat(file)).size });
  }
  // Python sorts (stamp, path) tuples newest first.
  found.sort((a, b) => b.savedAt - a.savedAt || (a.path < b.path ? 1 : a.path > b.path ? -1 : 0));
  return found.map((f) => ({ path: f.path, savedAt: f.savedAt, sizeBytes: f.size }));
}

/**
 * Put a recovery copy in place of `projectFile` (main_window.restore_recovery_file):
 * the current file moves to `<name>-<time>-backup.zvn` first, and comes back
 * when the copy cannot be written. Returns the backup's path (null when
 * there was no current file).
 */
export async function restoreRecoveryCopy(desktopDir: string, projectFile: string, copy: string): Promise<string | null> {
  const recovery = path.resolve(desktopDir, "recovery");
  const source = path.resolve(copy);
  if (path.dirname(source) !== recovery) throw new Error(`${copy} is not one of Zenvi desktop's recovery copies`);
  let bytes: Buffer;
  if (source.endsWith(".zip")) {
    let entries;
    try {
      entries = readZipEntries(await readFile(source));
    } catch (error) {
      throw new Error(error instanceof ZipError ? `${path.basename(source)} is not a readable zip: ${error.message}` : String(error));
    }
    if (entries.length !== 1) throw new Error("Unexpected number of files in recovery zip.");
    bytes = entries[0]!.data();
  } else {
    bytes = await readFile(source);
  }
  const backup = path.join(path.dirname(projectFile), `${stem(projectFile)}-${Math.trunc(Date.now() / 1000)}-backup.zvn`);
  const hadFile = await isFile(projectFile);
  if (hadFile) await rename(projectFile, backup);
  try {
    await writeFileAtomic(projectFile, bytes);
  } catch (error) {
    // Never leave no project file behind.
    if (hadFile && !(await isFile(projectFile))) await rename(backup, projectFile);
    throw error;
  }
  return hadFile ? backup : null;
}

/** A profile file name: the profile key, never a path. */
function profileName(name: string): string {
  if (!/^[A-Za-z0-9._ -]+$/.test(name) || name === "." || name === "..") throw new Error(`"${name}" is not a profile file name`);
  return name;
}

/** The custom profile files in Zenvi desktop's profiles folder. */
export async function customProfileFiles(desktopDir: string): Promise<ProfileFile[]> {
  const dir = path.join(desktopDir, "profiles");
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: ProfileFile[] = [];
  for (const name of names.sort()) {
    const file = path.join(dir, name);
    const st = await stat(file).catch(() => undefined);
    if (!st?.isFile() || st.size > MAX_PROFILE_BYTES) continue;
    out.push({ name, text: await readFile(file, "utf8"), path: file });
  }
  return out;
}

export async function writeCustomProfileFile(desktopDir: string, name: string, text: string): Promise<string> {
  const dir = path.join(desktopDir, "profiles");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, profileName(name));
  await writeFileAtomic(file, text);
  return file;
}

export async function removeCustomProfileFile(desktopDir: string, name: string): Promise<void> {
  await rm(path.join(desktopDir, "profiles", profileName(name)));
}

