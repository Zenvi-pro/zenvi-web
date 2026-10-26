// The part of opentype.js 2.0 (MIT, ships no types) the typesetter uses. Imported by its ES module
// file: the package has no "exports" map, and Node would load its UMD build, which has no named exports.
declare module "opentype.js/dist/opentype.mjs" {
  export type PathCommand =
    | { type: "M" | "L"; x: number; y: number }
    | { type: "Q"; x1: number; y1: number; x: number; y: number }
    | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: "Z" };

  export interface Path {
    commands: PathCommand[];
  }

  export interface Glyph {
    index: number;
    name: string | null;
    unicode: number | undefined;
    advanceWidth: number | undefined;
    path: Path;
    /** Outline points, once `path` was read. */
    points?: unknown[];
    isComposite?: boolean;
    components?: { glyphIndex: number }[];
  }

  export interface VariationAxis {
    tag: string;
    minValue: number;
    defaultValue: number;
    maxValue: number;
  }

  export interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    names: Record<string, Record<string, string> | undefined>;
    tables: Record<string, unknown>;
    glyphs: { get(index: number): Glyph };
    charToGlyph(char: string): Glyph;
    hasChar(char: string): boolean;
    variation?: { getTransform(glyph: Glyph, coords: Record<string, number>): Glyph };
  }

  export function parse(buffer: ArrayBuffer, options?: { lowMemory?: boolean }): Font;
}
