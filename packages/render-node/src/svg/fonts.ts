/**
 * Font discovery for SVG rasterization.
 *
 * resvg-wasm cannot read the file system, so fonts are handed to it as
 * buffers. Loading every system font would copy hundreds of MB into WASM
 * memory, so this module indexes font files by family name (reading only each
 * file's OpenType `name` table) and returns just the files an SVG asks for.
 */

import { existsSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { bundledFontsDir } from "../resources.js";

/** Per-user cache folder for derived data (font index). `ZENVI_CACHE_DIR` overrides. */
export function cacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ZENVI_CACHE_DIR?.trim();
  if (override) return override;
  const home = env.HOME || env.USERPROFILE || homedir();
  if (process.platform === "darwin") return path.join(home, "Library", "Caches", "zenvi");
  if (process.platform === "win32") return path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "zenvi", "Cache");
  return path.join(env.XDG_CACHE_HOME || path.join(home, ".cache"), "zenvi");
}

interface CachedFace {
  path: string;
  size: number;
  mtimeMs: number;
  families: string[];
}

interface FontCache {
  version: number;
  /** Every folder walked, with its mtime: unchanged folders mean no fonts were added or removed. */
  dirs: Record<string, number>;
  /** The roots the walk started from. */
  roots: string[];
  faces: CachedFace[];
}

/** 3: family names keep their case (2 stored them lowercased). */
const CACHE_VERSION = 3;

async function readCache(file: string): Promise<FontCache | undefined> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<FontCache>;
    if (parsed.version !== CACHE_VERSION || !Array.isArray(parsed.faces) || !parsed.dirs || !Array.isArray(parsed.roots)) {
      return undefined;
    }
    return parsed as FontCache;
  } catch {
    return undefined;
  }
}

async function writeCache(file: string, cache: FontCache): Promise<void> {
  try {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(cache));
    await rename(tmp, file);
  } catch {
    // A cache that cannot be written only costs the next process a rescan.
  }
}

/** True when every folder the cache walked still has the mtime it had then. */
async function cacheIsFresh(cache: FontCache, roots: string[]): Promise<boolean> {
  if (cache.roots.length !== roots.length || cache.roots.some((r, i) => r !== roots[i])) return false;
  const dirs = Object.entries(cache.dirs);
  const checks = await Promise.all(
    dirs.map(async ([dir, mtimeMs]) => {
      try {
        return (await stat(dir)).mtimeMs === mtimeMs;
      } catch {
        return false;
      }
    }),
  );
  return checks.every(Boolean);
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export interface FontFace {
  path: string;
  /** Family names as the font spells them (nameID 1 and 16); lookups ignore case. */
  families: string[];
  size: number;
}

const FONT_EXTS = new Set([".ttf", ".otf", ".ttc", ".otc"]);
/** Skip giant collections (emoji, CJK) unless nothing else matches. */
const MAX_FONT_BYTES = 40 * 1024 * 1024;

export function systemFontDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.HOME || env.USERPROFILE || homedir();
  if (process.platform === "darwin") {
    return ["/System/Library/Fonts", "/Library/Fonts", path.join(home, "Library", "Fonts")];
  }
  if (process.platform === "win32") {
    const windir = env.WINDIR || env.SystemRoot || "C:\\Windows";
    const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return [path.join(windir, "Fonts"), path.join(local, "Microsoft", "Windows", "Fonts")];
  }
  return [
    "/usr/share/fonts",
    "/usr/local/share/fonts",
    path.join(home, ".fonts"),
    path.join(home, ".local", "share", "fonts"),
  ];
}

function decodeName(bytes: Uint8Array, platform: number): string {
  if (platform === 0 || platform === 3) {
    let out = "";
    for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
    return out;
  }
  return Buffer.from(bytes).toString("latin1");
}

/** Family names from an sfnt `name` table, as the font spells them. */
export function parseNameTable(table: Uint8Array): string[] {
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  if (table.byteLength < 6) return [];
  const count = view.getUint16(2);
  const stringOffset = view.getUint16(4);
  const names = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    const rec = 6 + i * 12;
    if (rec + 12 > table.byteLength) break;
    const platform = view.getUint16(rec);
    const nameId = view.getUint16(rec + 6);
    const length = view.getUint16(rec + 8);
    const offset = view.getUint16(rec + 10);
    if (nameId !== 1 && nameId !== 16) continue;
    const start = stringOffset + offset;
    if (start + length > table.byteLength) continue;
    const name = decodeName(table.subarray(start, start + length), platform).trim();
    if (name) names.add(name);
  }
  // One spelling per name (Mac and Windows records usually agree; the first one wins).
  const seen = new Set<string>();
  return [...names].filter((name) => !seen.has(name.toLowerCase()) && seen.add(name.toLowerCase()));
}

async function readAt(handle: Awaited<ReturnType<typeof open>>, position: number, length: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

/** Family names of every face in a TTF/OTF/TTC file. */
export async function readFontFamilies(file: string): Promise<string[]> {
  const handle = await open(file, "r");
  try {
    const header = await readAt(handle, 0, 12);
    if (header.length < 12) return [];
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const tag = String.fromCharCode(header[0]!, header[1]!, header[2]!, header[3]!);
    let faceOffsets = [0];
    if (tag === "ttcf") {
      const numFonts = Math.min(view.getUint32(8), 64);
      const offsets = await readAt(handle, 12, numFonts * 4);
      const ov = new DataView(offsets.buffer, offsets.byteOffset, offsets.byteLength);
      faceOffsets = Array.from({ length: Math.floor(offsets.length / 4) }, (_, i) => ov.getUint32(i * 4));
    }
    const families = new Set<string>();
    for (const faceOffset of faceOffsets) {
      const dirHeader = await readAt(handle, faceOffset, 12);
      if (dirHeader.length < 12) continue;
      const numTables = new DataView(dirHeader.buffer, dirHeader.byteOffset).getUint16(4);
      const records = await readAt(handle, faceOffset + 12, numTables * 16);
      const rv = new DataView(records.buffer, records.byteOffset, records.byteLength);
      for (let i = 0; i + 16 <= records.length; i += 16) {
        const t = String.fromCharCode(records[i]!, records[i + 1]!, records[i + 2]!, records[i + 3]!);
        if (t !== "name") continue;
        const offset = rv.getUint32(i + 8);
        const length = Math.min(rv.getUint32(i + 12), 256 * 1024);
        for (const name of parseNameTable(await readAt(handle, offset, length))) families.add(name);
        break;
      }
    }
    return [...families];
  } finally {
    await handle.close();
  }
}

async function walk(dir: string, depth: number, out: string[], dirs: Record<string, number>, limit: number): Promise<void> {
  if (depth < 0 || out.length >= limit) return;
  let entries: import("node:fs").Dirent[];
  try {
    dirs[dir] = (await stat(dir)).mtimeMs;
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= limit) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, depth - 1, out, dirs, limit);
    else if (FONT_EXTS.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
}

export class FontIndex {
  private readonly byFamily = new Map<string, FontFace[]>();

  /** Lowercased family → the name as the first font with it spells it. */
  private readonly spelling = new Map<string, string>();

  constructor(readonly faces: FontFace[]) {
    for (const face of faces) {
      for (const name of face.families) {
        const family = name.toLowerCase();
        const list = this.byFamily.get(family) ?? [];
        list.push(face);
        this.byFamily.set(family, list);
        if (!this.spelling.has(family)) this.spelling.set(family, name);
      }
    }
    for (const list of this.byFamily.values()) list.sort((a, b) => a.size - b.size);
  }

  /**
   * The families installed, as the fonts spell them, sorted: what a tool may
   * name in an SVG title (a Qt font database's `families()`). Hidden system
   * families (".SF NS") are left out.
   */
  familyNames(): string[] {
    return [...this.spelling.values()].filter((name) => !name.startsWith(".")).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /**
   * Index the fonts in `dirs`. Family names are cached on disk by
   * path/size/mtime, so later processes only list and stat the folders.
   */
  static async scan(
    dirs: string[] = [...systemFontDirs(), bundledFontsDir()],
    cacheFile: string | undefined = path.join(cacheDir(), "font-index.json"),
  ): Promise<FontIndex> {
    const roots = dirs.filter((dir) => existsSync(dir));
    const cache = cacheFile ? await readCache(cacheFile) : undefined;
    if (cache && (await cacheIsFresh(cache, roots))) return FontIndex.fromCached(cache.faces);
    const files: string[] = [];
    const walked: Record<string, number> = {};
    for (const dir of roots) await walk(dir, 4, files, walked, 8000);
    const cached = new Map((cache?.faces ?? []).map((f) => [f.path, f]));
    const entries = await mapLimit(files, 16, async (file): Promise<CachedFace | undefined> => {
      try {
        const st = await stat(file);
        const hit = cached.get(file);
        if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit;
        return { path: file, size: st.size, mtimeMs: st.mtimeMs, families: await readFontFamilies(file) };
      } catch {
        return undefined; // unreadable or malformed font
      }
    });
    const kept = entries.filter((e): e is CachedFace => e !== undefined);
    if (cacheFile) await writeCache(cacheFile, { version: CACHE_VERSION, dirs: walked, roots, faces: kept });
    return FontIndex.fromCached(kept);
  }

  private static fromCached(entries: CachedFace[]): FontIndex {
    const faces = entries
      .filter((e) => e.families.length > 0)
      .map((e) => ({ path: e.path, families: e.families, size: e.size }))
      .sort((a, b) => a.path.localeCompare(b.path));
    return new FontIndex(faces);
  }

  has(family: string): boolean {
    return this.byFamily.has(family.toLowerCase());
  }

  /** Font files for a family (every style), small files first. */
  files(family: string): string[] {
    const faces = this.byFamily.get(family.toLowerCase()) ?? [];
    const small = faces.filter((f) => f.size <= MAX_FONT_BYTES);
    return (small.length > 0 ? small : faces.slice(0, 1)).map((f) => f.path);
  }
}

let shared: Promise<FontIndex> | undefined;

/** Process-wide font index (scanned once, on first SVG render). */
export function sharedFontIndex(): Promise<FontIndex> {
  shared ??= FontIndex.scan();
  return shared;
}

/** The font families SVG titles render with in this process (the shared index's `familyNames`). */
export async function installedFontFamilies(): Promise<string[]> {
  return (await sharedFontIndex()).familyNames();
}

const bufferCache = new Map<string, Promise<Uint8Array>>();

export function readFontFile(file: string): Promise<Uint8Array> {
  let hit = bufferCache.get(file);
  if (!hit) {
    hit = readFile(file).then((b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
    bufferCache.set(file, hit);
  }
  return hit;
}

/** CSS generic families resvg understands. */
export const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy"]);

/**
 * Installed families to try when a requested one is missing, closest first.
 * Metric-compatible substitutes come before generic fallbacks.
 */
const ALIASES: Record<string, string[]> = {
  "dejavu sans": ["verdana", "bitstream vera sans"],
  "bitstream vera sans": ["dejavu sans", "verdana"],
  sans: ["dejavu sans", "verdana"],
  arial: ["liberation sans", "arimo", "helvetica"],
  helvetica: ["arial", "liberation sans", "arimo", "helvetica neue"],
  "times new roman": ["liberation serif", "tinos", "times", "dejavu serif"],
  times: ["times new roman", "liberation serif", "tinos"],
  "courier new": ["liberation mono", "cousine", "courier", "dejavu sans mono"],
  courier: ["courier new", "liberation mono", "cousine"],
};

const DEFAULT_SANS = ["arial", "helvetica", "liberation sans", "dejavu sans", "noto sans", "verdana", "lato"];
const DEFAULT_SERIF = ["times new roman", "times", "liberation serif", "dejavu serif", "noto serif", "georgia", "lato"];
const DEFAULT_MONO = ["courier new", "menlo", "liberation mono", "dejavu sans mono", "consolas", "courier", "lato"];

export interface ResolvedFonts {
  /** Font files to load into resvg. */
  files: string[];
  /** Installed family to append to a requested family list. */
  fallbackFor(requested: string[]): string | undefined;
  sansSerif: string;
  serif: string;
  monospace: string;
}

function firstInstalled(index: FontIndex, names: string[]): string | undefined {
  return names.find((n) => index.has(n));
}

/** Choose font files for the family lists an SVG uses. */
export function resolveFonts(index: FontIndex, familyLists: string[][]): ResolvedFonts {
  const sansSerif = firstInstalled(index, DEFAULT_SANS) ?? "lato";
  const serif = firstInstalled(index, DEFAULT_SERIF) ?? sansSerif;
  const monospace = firstInstalled(index, DEFAULT_MONO) ?? sansSerif;
  const files = new Set<string>();
  const use = (family: string) => {
    for (const f of index.files(family)) files.add(f);
  };
  const genericTarget = (g: string) => (g === "serif" ? serif : g === "monospace" ? monospace : sansSerif);

  const fallbackFor = (requested: string[]): string | undefined => {
    const lowered = requested.map((f) => f.toLowerCase());
    if (lowered.some((f) => index.has(f) || GENERIC_FAMILIES.has(f))) return undefined;
    for (const family of lowered) {
      const alias = firstInstalled(index, ALIASES[family] ?? []);
      if (alias) return alias;
    }
    return sansSerif;
  };

  for (const list of familyLists) {
    const lowered = list.map((f) => f.toLowerCase());
    let satisfied = false;
    for (const family of lowered) {
      if (GENERIC_FAMILIES.has(family)) {
        use(genericTarget(family));
        satisfied = true;
        break;
      }
      if (index.has(family)) {
        use(family);
        satisfied = true;
        break;
      }
    }
    if (!satisfied) {
      const fb = fallbackFor(list);
      if (fb) use(fb);
    }
  }
  // Unstyled text uses the sans default; always have one font loaded.
  use(sansSerif);
  if (files.size === 0) use("lato");
  return { files: [...files], fallbackFor, sansSerif, serif, monospace };
}
