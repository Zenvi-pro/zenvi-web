/**
 * Reading and writing `.zvn` project files on disk.
 *
 * - Parsing, validation, the desktop's load upgrades and the version stamp
 *   come from the engine (`parseProjectText`, `serializeProject`); every
 *   write goes through `serializeProject`, because an unstamped project makes
 *   the desktop flip clip alpha on open.
 * - Paths: the engine's stored-path rules (`fromStoredPaths` / `toStoredPaths`,
 *   the desktop's json_data.py) with the Node host's roots (paths.ts).
 * - Atomic: written to a temp file in the same folder, fsynced, then renamed
 *   over the target, so a crash never leaves a half-written project.
 * - Locked: `<file>.lock` (pid + host) guards load → edit → save sequences
 *   from concurrent `zenvi` invocations.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { fromStoredPaths, parseProjectText as parseEngineProject, ProjectParseError, serializeProject, toStoredPaths, type Project } from "@zenvi/engine";
import { loadRoots, storeRoots } from "./paths.js";

export class ProjectFileError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(message);
    this.name = "ProjectFileError";
  }
}

export interface ProjectFileOptions {
  engineAssetsDir?: string;
}

function describeParseError(error: ProjectParseError): string {
  const issues = error.issues.slice(0, 3).map((i) => (i.path ? `${i.path}: ${i.message}` : i.message));
  return `${issues.join("; ")}${error.issues.length > 3 ? ` (+${error.issues.length - 3} more)` : ""}`;
}

/** Parse project file text read from `file` (upgraded like the desktop, paths made absolute). */
export function parseProjectFileText(text: string, file: string): Project {
  if (!text.trim()) throw new ProjectFileError(`${file} is empty.`, file);
  let project: Project;
  try {
    project = parseEngineProject(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    if (error instanceof ProjectParseError) throw new ProjectFileError(`${file} is not a Zenvi project: ${describeParseError(error)}`, file);
    throw error;
  }
  return fromStoredPaths(project, path.dirname(file), loadRoots(file));
}

export async function readProjectFile(file: string): Promise<Project> {
  const abs = path.resolve(file);
  let text: string;
  try {
    text = await readFile(abs, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new ProjectFileError(code === "ENOENT" ? `Project file not found: ${abs}` : `Cannot read ${abs}: ${(error as Error).message}`, abs);
  }
  return parseProjectFileText(text, abs);
}

/** The file text the desktop would read for `project` saved at `file`. */
export function serializeProjectFile(project: Project, file: string, options: ProjectFileOptions = {}): string {
  const abs = path.resolve(file);
  return serializeProject(toStoredPaths(project, path.dirname(abs), storeRoots(abs, options.engineAssetsDir)));
}

/** Write `text` to `file` atomically (temp file + fsync + rename). */
export async function writeFileAtomic(file: string, text: string | Uint8Array): Promise<void> {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  const handle = await open(tmp, "w", 0o644);
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

export async function writeProjectFile(file: string, project: Project, options: ProjectFileOptions = {}): Promise<string> {
  const abs = path.resolve(file);
  await writeFileAtomic(abs, serializeProjectFile(project, abs, options));
  return abs;
}

export interface FileState {
  mtimeMs: number;
  size: number;
}

/** Cheap change detector: mtime + size, or undefined when missing. */
export async function fileState(file: string): Promise<FileState | undefined> {
  try {
    const st = await stat(file);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return undefined;
  }
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const STALE_LOCK_MS = 10 * 60 * 1000;

async function tryAcquire(lockFile: string): Promise<boolean> {
  try {
    await writeFile(lockFile, JSON.stringify({ pid: process.pid, host: hostname(), at: Date.now() }), { flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  // Someone holds it: break the lock if its owner is gone.
  try {
    const info = JSON.parse(await readFile(lockFile, "utf8")) as { pid?: number; host?: string; at?: number };
    const sameHost = info.host === hostname();
    const stale = (sameHost && !pidAlive(Number(info.pid))) || Date.now() - Number(info.at ?? 0) > STALE_LOCK_MS;
    if (stale) {
      await rm(lockFile, { force: true });
      return tryAcquire(lockFile);
    }
  } catch {
    // Unreadable lock (being written right now): wait and retry.
  }
  return false;
}

/** Locks held by the current async call chain (reentrancy). */
const heldHere = new AsyncLocalStorage<ReadonlySet<string>>();
/** In-process queue per lock file: independent operations in this process still exclude each other. */
const queues = new Map<string, Promise<void>>();

/**
 * Run `fn` holding `<file>.lock`. Reentrant within one async call chain;
 * other operations (in this process or others) wait up to `timeoutMs`.
 */
export async function withProjectLock<T>(file: string, fn: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
  const lockFile = `${path.resolve(file)}.lock`;
  const held = heldHere.getStore();
  if (held?.has(lockFile)) return fn();

  const previous = queues.get(lockFile) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => (release = resolve));
  const tail = previous.then(() => mine);
  queues.set(lockFile, tail);
  await previous;
  try {
    const deadline = Date.now() + timeoutMs;
    let delay = 25;
    while (!(await tryAcquire(lockFile))) {
      if (Date.now() > deadline) {
        throw new ProjectFileError(`${file} is locked by another zenvi process (remove ${lockFile} if none is running).`, file);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(250, delay * 2);
    }
    try {
      return await heldHere.run(new Set([...(held ?? []), lockFile]), fn);
    } finally {
      await rm(lockFile, { force: true });
    }
  } finally {
    release();
    if (queues.get(lockFile) === tail) queues.delete(lockFile);
  }
}
