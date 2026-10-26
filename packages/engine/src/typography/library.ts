/**
 * Loaded font families. The engine has no file system: the host reads the
 * bundled font files (`AssetHost.readBytes`, paths under the engine's
 * `assets/`), the library parses them once and hands out faces.
 */

import { parse, type Font } from "./opentype.js";
import { FONT_FAMILIES, fontFileFor, type FontFamilyId, type FontFile } from "./families.js";
import { Face, OBLIQUE } from "./face.js";
import { readKerning, type KerningLookup } from "./kerning.js";

/** Reads a bundled asset's bytes by its path under the engine's `assets/` folder. */
export type FontBytesReader = (path: string) => Promise<Uint8Array>;

interface Parsed {
  font: Font;
  kerning: KerningLookup;
}

/** Parsed fonts by asset path: bundled files never change, and Inter alone is 0.9 MB to parse. */
const parsedCache = new Map<string, Promise<Parsed>>();

async function parseFile(read: FontBytesReader, path: string): Promise<Parsed> {
  let pending = parsedCache.get(path);
  if (!pending) {
    pending = read(path).then((bytes) => {
      const copy = bytes.slice();
      return { font: parse(copy.buffer), kerning: readKerning(copy) };
    });
    parsedCache.set(path, pending);
    pending.catch(() => parsedCache.delete(path));
  }
  return pending;
}

/** How to pick a face of a family. */
export interface FaceRequest {
  /** 100-900 (default 400). */
  weight?: number;
  italic?: boolean;
  /** Optical size in px for faces with an `opsz` axis (clamped to it). Default: the axis default. */
  opticalSize?: number;
}

export class FontLibrary {
  private readonly faces = new Map<string, Face>();

  private constructor(private readonly parsed: ReadonlyMap<string, Parsed>) {}

  /** Load every file of `families` (and Inter, the fallback for characters a face lacks). */
  static async load(read: FontBytesReader, families: Iterable<FontFamilyId>): Promise<FontLibrary> {
    const ids = new Set<FontFamilyId>([...families, "inter"]);
    const paths = [...ids].flatMap((id) => FONT_FAMILIES[id].files.map((f) => f.path));
    const parsed = await Promise.all(paths.map(async (p) => [p, await parseFile(read, p)] as const));
    return new FontLibrary(new Map(parsed));
  }

  has(family: FontFamilyId): boolean {
    return FONT_FAMILIES[family].files.every((f) => this.parsed.has(f.path));
  }

  /** A face of a loaded family. Throws when the family was not loaded (a programmer error). */
  face(family: FontFamilyId, request: FaceRequest = {}): Face {
    const spec = FONT_FAMILIES[family];
    const weight = request.weight ?? 400;
    const italic = request.italic ?? false;
    const file: FontFile = fontFileFor(family, weight, italic);
    const parsed = this.parsed.get(file.path);
    if (!parsed) throw new Error(`font family ${family} is not loaded`);
    const coords: Record<string, number> = {};
    if (spec.axes?.wght) coords.wght = clamp(weight, spec.axes.wght[0], spec.axes.wght[1]);
    if (spec.axes?.opsz && request.opticalSize !== undefined) coords.opsz = Math.round(clamp(request.opticalSize, spec.axes.opsz[0], spec.axes.opsz[1]));
    const slant = italic && !file.italic ? OBLIQUE : 0;
    const key = `${file.path}|${coords.wght ?? ""}|${coords.opsz ?? ""}|${slant}`;
    let face = this.faces.get(key);
    if (!face) {
      face = new Face(parsed.font, parsed.kerning, Object.keys(coords).length > 0 ? coords : null, slant);
      this.faces.set(key, face);
    }
    return face;
  }
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}
