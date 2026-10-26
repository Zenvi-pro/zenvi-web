/**
 * Render cache keys: sha256 over everything that changes the pixels —
 * scene id, params, render size, fps, frames, quality, each media file's
 * identity (path, size, mtime) and where it starts, the font file, and a
 * hash of every bpy script (an edited scene re-renders).
 */

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

/** Bump when the job → pixels contract changes outside the scripts (encoder settings). */
export const FINGERPRINT_VERSION = 1;

/** JSON with sorted keys, so equal values hash equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function sha256(text: string | Uint8Array): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Hash of the bpy scripts under `dir` (every .py, by relative path). */
export async function scriptsHash(dir: string): Promise<string> {
  const files: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "__pycache__") continue;
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (entry.name.endsWith(".py")) files.push(p);
    }
  };
  await walk(dir);
  files.sort();
  const hash = createHash("sha256");
  for (const f of files) {
    hash.update(path.relative(dir, f).split(path.sep).join("/"));
    hash.update("\0");
    hash.update(await readFile(f));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** A file's identity for the cache: its path, size and modification time. */
export async function fileStamp(file: string): Promise<{ file: string; size: number; mtime: number }> {
  const s = await stat(file);
  return { file, size: s.size, mtime: Math.trunc(s.mtimeMs) };
}

export interface FingerprintInput {
  scene: string;
  params: unknown;
  width: number;
  height: number;
  fps: { num: number; den: number };
  frames: number;
  quality: string;
  media: Record<string, { stamp: unknown; start: number; kind: string }>;
  font: unknown;
  scripts: string;
}

export function fingerprint(input: FingerprintInput): string {
  return sha256(canonicalJson({ v: FINGERPRINT_VERSION, ...input }));
}
