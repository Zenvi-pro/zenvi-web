/**
 * What the type blocks share: their output (a motion plan plus the mask
 * drawings some layers read), setting a line in a bundled family, and
 * glyph outlines as drawing commands. Every block is native: SVG title
 * clips of outlined glyphs moved by clip keyframes, and libopenshot Mask
 * effects where a block needs a reveal the keyframes cannot draw.
 */

import type { Effect } from "../../model/types.js";
import type { FontFamilyId } from "../../typography/families.js";
import type { FontLibrary } from "../../typography/library.js";
import type { PathCommand } from "../../typography/opentype.js";
import { typeset, type SetGlyph, type TextBlock, type TypeStyle } from "../../typography/typeset.js";
import type { MotionFrame, MotionPlan } from "../types.js";

/** A mask drawing a layer's Mask effect reads; the tool writes it and fills in `mask_reader`. */
export interface LayerMask {
  /** The plan layer that carries the effect. */
  layer: string;
  /** File name stem. */
  name: string;
  svg: string;
  /** The Mask effect without `mask_reader` (brightness and contrast keyframes in clip frames). */
  effect: Omit<Effect, "id">;
}

export interface TypeBlockOutput {
  plan: MotionPlan;
  masks: LayerMask[];
  /** Frames (from the block's start) where a hit lands: a word's cut, a copy, the collapse, the open. */
  hits: number[];
  /** Characters no loaded face could draw. */
  missing: string[];
  warnings: string[];
}

/** What every block reads. Sizes are frame px. */
export interface TypeBlockBase {
  frame: MotionFrame;
  /** Length, frames. */
  frames: number;
  lib: FontLibrary;
  family: FontFamilyId;
  weight?: number;
}

/** A content problem the caller can fix (the tool refuses with the message). */
export class TypeBlockError extends Error {
  override readonly name = "TypeBlockError";
}

export function refuseBlock(message: string): never {
  throw new TypeBlockError(message);
}

/** `text` set in the block's face, centred lines wrapped at `maxWidth`. */
export function setText(base: TypeBlockBase, text: string, size: number, o: { maxWidth?: number; tracking?: number; lineHeight?: number } = {}): TextBlock {
  const style: TypeStyle = { family: base.family, size, weight: base.weight ?? 400, tracking: o.tracking ?? 0, lineHeight: o.lineHeight ?? 1.05 };
  return typeset(base.lib, text, style, { align: "center", wrap: "balanced", ...(o.maxWidth !== undefined ? { maxWidth: o.maxWidth } : {}) });
}

/** The largest size ≤ `max` at which `text` fits `width` (on at most `lines` lines) and `height`. */
export function fitSize(base: TypeBlockBase, text: string, width: number, height: number, max: number, o: { lines?: number; tracking?: number; lineHeight?: number } = {}): TextBlock {
  let lo = 4;
  let hi = Math.max(lo, max);
  const fits = (size: number) => {
    const b = setText(base, text, size, { maxWidth: width, ...o });
    return b.width <= width + 0.5 && b.height <= height + 0.5 && b.lines.length <= (o.lines ?? 1) ? b : null;
  };
  const top = fits(hi);
  if (top) return top;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return fits(lo) ?? setText(base, text, lo, { maxWidth: width, ...o });
}

/** Glyphs that draw ink (no spaces). */
export function inked(glyphs: readonly SetGlyph[]): SetGlyph[] {
  return glyphs.filter((g) => g.commands.some((c) => c.type !== "Z" && c.type !== "M"));
}

/** Every glyph's outline moved by (`dx`, `dy`). */
export function moved(glyphs: readonly SetGlyph[], dx: number, dy: number): PathCommand[] {
  return glyphs.flatMap((g) => g.commands.map((c): PathCommand => shift(c, dx, dy)));
}

export function shift(c: PathCommand, dx: number, dy: number): PathCommand {
  switch (c.type) {
    case "Z":
      return c;
    case "M":
    case "L":
      return { type: c.type, x: c.x + dx, y: c.y + dy };
    case "Q":
      return { type: "Q", x1: c.x1 + dx, y1: c.y1 + dy, x: c.x + dx, y: c.y + dy };
    case "C":
      return { type: "C", x1: c.x1 + dx, y1: c.y1 + dy, x2: c.x2 + dx, y2: c.y2 + dy, x: c.x + dx, y: c.y + dy };
  }
}

/** The frame's short side, px: block sizes are shares of it. */
export function shortSide(frame: MotionFrame): number {
  return Math.min(frame.width, frame.height);
}

/** Seconds as whole frames (at least one). */
export function framesOf(seconds: number, fps: number): number {
  return Math.max(1, Math.round(seconds * fps));
}

/** #rrggbb of a gray level 0-255. */
export function grayHex(level: number): string {
  const v = Math.max(0, Math.min(255, Math.round(level))).toString(16).padStart(2, "0");
  return `#${v}${v}${v}`;
}
