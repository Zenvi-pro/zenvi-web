/** Named shapes and traced glyphs as outlines, for the morph blocks. All fit a radius-1 circle about the origin. */

import { blob, bounds, chaikin, circle, plus, regularPolygon, roundRect, star, textOutline, toOutline, transformOutline, type BlockContext, type Outline } from "../runtime/index.js";
import { FONT_STACKS } from "../tokens.js";

export const SHAPE_NAMES = ["circle", "square", "triangle", "hexagon", "star", "burst", "blob", "plus", "pill", "ring"] as const;
export type ShapeName = (typeof SHAPE_NAMES)[number];

export function isShapeName(name: string): name is ShapeName {
  return (SHAPE_NAMES as readonly string[]).includes(name);
}

/** A named shape; soft corners so morphs read as one material. */
export function namedShape(name: ShapeName, seed: number): Outline {
  switch (name) {
    case "circle":
      return toOutline([circle(1)]);
    case "square":
      return toOutline([roundRect(1.62, 1.62, 0.26)]);
    case "triangle":
      // Optical centre: a triangle's mass sits low, so lift it a little.
      return toOutline([chaikin(regularPolygon(3, 1.08), 3, 0.08).map((p) => ({ x: p.x, y: p.y + 0.16 }))]);
    case "hexagon":
      return toOutline([chaikin(regularPolygon(6, 1), 3, 0.08)]);
    case "star":
      return toOutline([chaikin(star(5, 0.5, 1.04), 2, 0.06)]);
    case "burst":
      return toOutline([chaikin(star(12, 0.72, 1), 2, 0.12)]);
    case "blob":
      return toOutline([blob(seed, 0.16).map((p) => ({ x: p.x * 0.9, y: p.y * 0.9 }))]);
    case "plus":
      return toOutline([plus(0.66, 0.1)]);
    case "pill":
      return toOutline([roundRect(1.96, 0.9, 0.45)]);
    case "ring":
      return toOutline([circle(1), circle(0.5)]);
  }
}

/** The face a block's `display_font` names, as a canvas font at `px`. */
export function canvasFont(ctx: BlockContext, px: number, weight: number): string {
  // Anton and Instrument Serif have one weight; asking for another makes Chrome synthesise bold.
  const w = ctx.display === "display" || ctx.display === "serif" ? 400 : weight;
  return `${w} ${px}px ${FONT_STACKS[ctx.display]}`;
}

/** `text` traced in the display face, centred and scaled to fit radius 1; null without a canvas. */
export function glyphShape(ctx: BlockContext, text: string, weight = 800): Outline | null {
  const traced = textOutline(ctx.doc, text, canvasFont(ctx, 360, weight));
  if (!traced || traced.outline.solids.length === 0) return null;
  const b = bounds(traced.outline);
  const s = 1.8 / Math.max(b.width, b.height);
  return transformOutline(transformOutline(traced.outline, { x: -(b.x + b.width / 2), y: -(b.y + b.height / 2) }), { scale: s });
}
