/**
 * Typesetting into outlines: text in a bundled family becomes glyph paths in
 * px, with a box for every glyph, word and line (what animators and caption
 * layouts move and avoid).
 *
 *   advances   glyph advance + GPOS pair kerning inside a word + tracking
 *              (em, after every glyph); a word space is the font's space
 *              plus tracking.
 *   lines      words never split. With `maxWidth`, greedy breaking finds the
 *              fewest lines; `balanced` (the default) then narrows the
 *              measure as far as that line count allows, so lines come out
 *              even (CSS `text-wrap: balance`). Newlines always break.
 *   vertical   the block's top is the first line's ascender; baselines are
 *              `lineHeight` × size apart; boxes run ascender to descender,
 *              `capHeight` / `xHeight` are given for tighter optical boxes.
 *   optical    faces with an `opsz` axis set at the type's px size (CSS
 *              `font-optical-sizing: auto`), clamped to the axis.
 *   coverage   characters the family lacks come from Inter; characters
 *              neither has are skipped and listed in `missing`.
 *
 * Shaping is per character (cmap + kerning): no ligatures, no contextual
 * forms, left to right only. Arabic, Devanagari and other complex scripts
 * need a shaper (HarfBuzz) and are out of scope.
 */

import type { PathCommand } from "./opentype.js";
import type { FontFamilyId } from "./families.js";
import type { Face, GlyphShape } from "./face.js";
import type { FontLibrary } from "./library.js";

export interface TypeStyle {
  family: FontFamilyId;
  /** Em size, px. */
  size: number;
  /** 100-900, default 400. */
  weight?: number;
  italic?: boolean;
  /** Letter spacing, em (negative tightens). */
  tracking?: number;
  /** Baseline to baseline, × size (default 1.2). */
  lineHeight?: number;
  /** Optical size: "auto" (the px size, default), a px value, or "off" (the face's default). */
  opticalSize?: "auto" | "off" | number;
  /** Pair kerning (default on). */
  kerning?: boolean;
  transform?: "none" | "upper" | "lower";
}

export interface SetOptions {
  /** Wrap at spaces to this width, px. */
  maxWidth?: number;
  wrap?: "greedy" | "balanced";
  align?: "left" | "center" | "right";
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SetGlyph {
  char: string;
  /** Index of its word in `TextBlock.words`. */
  word: number;
  /** Pen position (left of the advance) and baseline, block px. */
  x: number;
  baseline: number;
  advance: number;
  /** Outline in block px, y down. */
  commands: readonly PathCommand[];
}

export interface SetWord {
  text: string;
  index: number;
  line: number;
  /** Ascender-to-descender box, block px. */
  box: Box;
  baseline: number;
  /** Glyphs `[first, end)` in `TextBlock.glyphs`. */
  first: number;
  end: number;
}

export interface SetLine {
  text: string;
  box: Box;
  baseline: number;
  /** Words `[first, end)` in `TextBlock.words`. */
  first: number;
  end: number;
}

export interface TextBlock {
  style: Required<Omit<TypeStyle, "opticalSize">> & { opticalSize: TypeStyle["opticalSize"] };
  width: number;
  height: number;
  /** Px from a baseline up to the ascender, cap height and x height; down to the descender. */
  ascent: number;
  capHeight: number;
  xHeight: number;
  descent: number;
  lines: SetLine[];
  words: SetWord[];
  glyphs: SetGlyph[];
  /** Characters no loaded face could draw. */
  missing: string[];
}

interface Measured {
  text: string;
  glyphs: { char: string; shape: GlyphShape; face: Face; x: number }[];
  width: number;
}

const DEFAULTS = { weight: 400, italic: false, tracking: 0, lineHeight: 1.2, kerning: true, transform: "none" as const };

function faceFor(lib: FontLibrary, style: TypeStyle, family: FontFamilyId): Face {
  const o = style.opticalSize ?? "auto";
  const opticalSize = o === "off" ? undefined : o === "auto" ? style.size : o;
  return lib.face(family, { weight: style.weight ?? 400, italic: style.italic ?? false, ...(opticalSize !== undefined ? { opticalSize } : {}) });
}

function applyCase(text: string, transform: TypeStyle["transform"]): string {
  if (transform === "upper") return text.toUpperCase();
  if (transform === "lower") return text.toLowerCase();
  return text;
}

class Measurer {
  readonly face: Face;
  private readonly fallback: Face;
  readonly missing = new Set<string>();
  readonly space: number;

  constructor(
    lib: FontLibrary,
    readonly style: TypeStyle,
  ) {
    this.face = faceFor(lib, style, style.family);
    this.fallback = style.family === "inter" ? this.face : faceFor(lib, style, "inter");
    const space = this.face.glyph(" ") ?? this.fallback.glyph(" ");
    this.space = this.px(space?.advance ?? this.face.unitsPerEm * 0.25, this.face) + this.tracking;
  }

  get tracking(): number {
    return (this.style.tracking ?? 0) * this.style.size;
  }

  px(units: number, face: Face): number {
    return (units / face.unitsPerEm) * this.style.size;
  }

  word(text: string): Measured {
    const out: Measured["glyphs"] = [];
    let x = 0;
    let prev: { shape: GlyphShape; face: Face } | null = null;
    for (const char of text) {
      let face = this.face;
      let shape = face.glyph(char);
      if (!shape) {
        face = this.fallback;
        shape = face.glyph(char);
      }
      if (!shape) {
        this.missing.add(char);
        continue;
      }
      if (prev && prev.face === face && this.style.kerning !== false) x += this.px(face.kern(prev.shape, shape), face);
      out.push({ char, shape, face, x });
      x += this.px(shape.advance, face) + this.tracking;
      prev = { shape, face };
    }
    // Tracking follows every glyph but the word's last (it would push the next space or the line end).
    return { text, glyphs: out, width: out.length > 0 ? x - this.tracking : 0 };
  }
}

/** Break measured words into lines no wider than `width` (a word wider than it gets its own line). */
function breakLines(paragraphs: readonly Measured[][], space: number, width: number): Measured[][] {
  const lines: Measured[][] = [];
  for (const words of paragraphs) {
    let line: Measured[] = [];
    let w = 0;
    for (const word of words) {
      const next = line.length === 0 ? word.width : w + space + word.width;
      if (line.length > 0 && next > width + 1e-6) {
        lines.push(line);
        line = [word];
        w = word.width;
      } else {
        line.push(word);
        w = next;
      }
    }
    lines.push(line);
  }
  return lines;
}

const lineWidth = (line: readonly Measured[], space: number): number =>
  line.reduce((sum, word, i) => sum + word.width + (i > 0 ? space : 0), 0);

/** Set `text` in `style`. */
export function typeset(lib: FontLibrary, text: string, style: TypeStyle, options: SetOptions = {}): TextBlock {
  const m = new Measurer(lib, style);
  const paragraphs = applyCase(text, style.transform)
    .split(/\r?\n/)
    .map((p) => p.split(/\s+/).filter(Boolean).map((w) => m.word(w)));
  let lines: Measured[][];
  if (options.maxWidth === undefined) {
    lines = paragraphs;
  } else {
    lines = breakLines(paragraphs, m.space, options.maxWidth);
    if ((options.wrap ?? "balanced") === "balanced" && lines.length > paragraphs.length) {
      const count = lines.length;
      let lo = Math.max(0, ...paragraphs.flat().map((w) => w.width));
      let hi = options.maxWidth;
      for (let i = 0; i < 24 && hi - lo > 0.5; i += 1) {
        const mid = (lo + hi) / 2;
        if (breakLines(paragraphs, m.space, mid).length > count) lo = mid;
        else hi = mid;
      }
      lines = breakLines(paragraphs, m.space, hi);
    }
  }

  const face = m.face;
  const size = style.size;
  const ascent = m.px(face.ascender, face);
  const descent = m.px(-face.descender, face);
  const leading = size * (style.lineHeight ?? DEFAULTS.lineHeight);
  const widths = lines.map((line) => lineWidth(line, m.space));
  const width = Math.max(0, ...widths);
  const align = options.align ?? "left";

  const block: TextBlock = {
    style: { ...DEFAULTS, ...style, opticalSize: style.opticalSize ?? "auto" },
    width,
    height: lines.length === 0 ? 0 : ascent + (lines.length - 1) * leading + descent,
    ascent,
    capHeight: m.px(face.capHeight, face),
    xHeight: m.px(face.xHeight, face),
    descent,
    lines: [],
    words: [],
    glyphs: [],
    missing: [],
  };
  lines.forEach((line, li) => {
    const baseline = ascent + li * leading;
    const lw = widths[li]!;
    let x = align === "center" ? (width - lw) / 2 : align === "right" ? width - lw : 0;
    const firstWord = block.words.length;
    const left = x;
    for (const word of line) {
      const first = block.glyphs.length;
      for (const g of word.glyphs) {
        const scale = size / g.face.unitsPerEm;
        block.glyphs.push({
          char: g.char,
          word: block.words.length,
          x: x + g.x,
          baseline,
          advance: g.shape.advance * scale,
          commands: g.shape.commands.map((c) => place(c, x + g.x, baseline, scale)),
        });
      }
      block.words.push({
        text: word.text,
        index: block.words.length,
        line: li,
        box: { x, y: baseline - ascent, width: word.width, height: ascent + descent },
        baseline,
        first,
        end: block.glyphs.length,
      });
      x += word.width + m.space;
    }
    block.lines.push({
      text: line.map((w) => w.text).join(" "),
      box: { x: left, y: baseline - ascent, width: lw, height: ascent + descent },
      baseline,
      first: firstWord,
      end: block.words.length,
    });
  });
  block.missing = [...m.missing];
  return block;
}

/**
 * One run of text on a baseline at 0, pen from 0, spaces kept as they are
 * (SVG text runs): glyphs with `word` 0 and the run's advance width.
 */
export function setRun(lib: FontLibrary, text: string, style: TypeStyle): { glyphs: SetGlyph[]; width: number; capHeight: number; missing: string[] } {
  const m = new Measurer(lib, style);
  const run = m.word(applyCase(text, style.transform));
  const glyphs = run.glyphs.map((g): SetGlyph => {
    const scale = style.size / g.face.unitsPerEm;
    return { char: g.char, word: 0, x: g.x, baseline: 0, advance: g.shape.advance * scale, commands: g.shape.commands.map((c) => place(c, g.x, 0, scale)) };
  });
  // A run ends after its last glyph's tracking: the next run continues the line.
  return { glyphs, width: run.width + (run.glyphs.length > 0 ? m.tracking : 0), capHeight: m.px(m.face.capHeight, m.face), missing: [...m.missing] };
}

/** A font-unit command (y up) at pen (`x`, `baseline`) in px (y down). */
function place(c: PathCommand, x: number, baseline: number, s: number): PathCommand {
  switch (c.type) {
    case "Z":
      return c;
    case "M":
    case "L":
      return { type: c.type, x: x + c.x * s, y: baseline - c.y * s };
    case "Q":
      return { type: "Q", x1: x + c.x1 * s, y1: baseline - c.y1 * s, x: x + c.x * s, y: baseline - c.y * s };
    case "C":
      return { type: "C", x1: x + c.x1 * s, y1: baseline - c.y1 * s, x2: x + c.x2 * s, y2: baseline - c.y2 * s, x: x + c.x * s, y: baseline - c.y * s };
  }
}

export interface FitOptions extends Omit<SetOptions, "maxWidth"> {
  minSize?: number;
  maxSize: number;
  maxLines?: number;
}

/**
 * The largest size (0.5 px steps, `minSize` … `maxSize`) at which `text`
 * fits `box` (wrapped to its width, at most `maxLines`), or null when even
 * `minSize` does not.
 */
export function fitText(lib: FontLibrary, text: string, style: Omit<TypeStyle, "size">, box: { width: number; height: number }, options: FitOptions): TextBlock | null {
  const fits = (size: number): TextBlock | null => {
    const block = typeset(lib, text, { ...style, size }, { ...options, maxWidth: box.width });
    if (block.width > box.width + 1e-6 || block.height > box.height + 1e-6) return null;
    if (options.maxLines !== undefined && block.lines.length > options.maxLines) return null;
    return block;
  };
  let lo = Math.max(0.5, options.minSize ?? 1);
  const best = fits(options.maxSize);
  if (best) return best;
  let found = fits(lo);
  if (!found) return null;
  let hi = options.maxSize;
  while (hi - lo > 0.5) {
    const mid = Math.round(((lo + hi) / 2) * 2) / 2;
    if (mid <= lo || mid >= hi) break;
    const got = fits(mid);
    if (got) {
      lo = mid;
      found = got;
    } else hi = mid;
  }
  return found;
}

/** Bounds of the drawn outlines (control points included, so it never undercuts the ink), or null for no ink. */
export function inkBox(glyphs: readonly SetGlyph[]): Box | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const g of glyphs) {
    for (const c of g.commands) {
      if (c.type === "Z") continue;
      add(c.x, c.y);
      if (c.type === "Q" || c.type === "C") add(c.x1, c.y1);
      if (c.type === "C") add(c.x2, c.y2);
    }
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/**
 * Glyph outlines as path commands for `Drawing.path` (numbers in frame px,
 * moved by `dx`, `dy`; the drawing scales them).
 */
export function outlineCommands(glyphs: readonly SetGlyph[], dx = 0, dy = 0): (string | number)[] {
  const out: (string | number)[] = [];
  for (const g of glyphs) {
    for (const c of g.commands) {
      switch (c.type) {
        case "Z":
          out.push("Z");
          break;
        case "M":
        case "L":
          out.push(c.type, c.x + dx, c.y + dy);
          break;
        case "Q":
          out.push("Q", c.x1 + dx, c.y1 + dy, c.x + dx, c.y + dy);
          break;
        case "C":
          out.push("C", c.x1 + dx, c.y1 + dy, c.x2 + dx, c.y2 + dy, c.x + dx, c.y + dy);
          break;
      }
    }
  }
  return out;
}
