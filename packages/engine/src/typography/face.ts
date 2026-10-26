/**
 * A font face at one weight, slant and optical size: glyph outlines and
 * advances in font units (y up), pair kerning, vertical metrics.
 *
 * Variable faces (Inter: `wght` 100-900, `opsz` 14-32) are instanced through
 * opentype.js's gvar support (repaired where it misreads all-points
 * tuples, gvar.ts); a face without a real italic is slanted 12°
 * (`slant`), as browsers synthesize an oblique.
 */

import type { Font, Glyph, PathCommand } from "./opentype.js";
import { repairGlyph, type AllPointTuples } from "./gvar.js";
import type { KerningLookup } from "./kerning.js";

/** A glyph ready to set: its id, advance and outline, font units, y up. */
export interface GlyphShape {
  index: number;
  advance: number;
  commands: readonly PathCommand[];
}

/** tan 12°: the slant of a synthesized oblique. */
export const OBLIQUE = Math.tan((12 * Math.PI) / 180);

export class Face {
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  readonly capHeight: number;
  readonly xHeight: number;
  private readonly glyphs = new Map<string, GlyphShape | null>();
  private readonly font: Font;
  private readonly kerning: KerningLookup;

  constructor(
    /** The parsed file: its font, kerning and gvar repairs (gvar.ts). */
    private readonly file: { font: Font; kerning: KerningLookup; allPoints: AllPointTuples; repaired: Set<number> },
    /** Variation coordinates of a variable face (null: the default instance). */
    private readonly coords: Readonly<Record<string, number>> | null,
    /** Horizontal shear of the outlines (tan of the angle): 0, or OBLIQUE for a synthesized italic. */
    readonly slant: number,
  ) {
    const font = file.font;
    this.font = font;
    this.kerning = file.kerning;
    const os2 = (font.tables.os2 ?? {}) as { sTypoAscender?: number; sTypoDescender?: number; sCapHeight?: number; sxHeight?: number };
    this.unitsPerEm = font.unitsPerEm;
    this.ascender = font.ascender;
    this.descender = font.descender;
    this.capHeight = os2.sCapHeight || font.ascender * 0.7;
    this.xHeight = os2.sxHeight || this.capHeight * 0.7;
  }

  /** The glyph for one character, or null when the font has none. */
  glyph(char: string): GlyphShape | null {
    const hit = this.glyphs.get(char);
    if (hit !== undefined) return hit;
    let shape: GlyphShape | null = null;
    if (this.font.hasChar(char)) {
      let glyph: Glyph = this.font.charToGlyph(char);
      if (this.coords && this.font.variation) {
        repairGlyph(this.font, glyph, this.file.allPoints, this.file.repaired);
        glyph = this.font.variation.getTransform(glyph, { ...this.coords });
      }
      const commands = this.slant ? glyph.path.commands.map((c) => shear(c, this.slant)) : glyph.path.commands;
      shape = { index: glyph.index, advance: glyph.advanceWidth ?? 0, commands };
    }
    this.glyphs.set(char, shape);
    return shape;
  }

  kern(left: GlyphShape, right: GlyphShape): number {
    return this.kerning(left.index, right.index);
  }
}

function shear(c: PathCommand, k: number): PathCommand {
  switch (c.type) {
    case "Z":
      return c;
    case "M":
    case "L":
      return { type: c.type, x: c.x + k * c.y, y: c.y };
    case "Q":
      return { type: "Q", x1: c.x1 + k * c.y1, y1: c.y1, x: c.x + k * c.y, y: c.y };
    case "C":
      return { type: "C", x1: c.x1 + k * c.y1, y1: c.y1, x2: c.x2 + k * c.y2, y2: c.y2, x: c.x + k * c.y, y: c.y };
  }
}
