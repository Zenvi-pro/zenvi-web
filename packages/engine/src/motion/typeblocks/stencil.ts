/**
 * Stencil: a full-frame card with the title cut out of it, so the shot
 * below plays through the letters, a soft shadow cast inside the cuts. The
 * card pushes in slowly, then opens: it flies through one letter (an
 * in-expo zoom about the fattest point inside the word until the hole
 * fills the frame), or cuts away on the beat.
 *
 * One path does the cut: the card's rectangle plus the glyph outlines,
 * filled even-odd (a letter is a hole, its counter stays card), which every
 * renderer draws alike. A drawing is rasterized at its largest pose, so
 * the fly-through is a chain of drawings on one track, each covering only
 * the part of the card still on screen at a 1.6x higher zoom than the last.
 */

import { commandList, edgeDistance, flatten, insideEvenOdd, linesBounds, mapCommands } from "../../typography/path-data.js";
import type { PathCommand } from "../../typography/opentype.js";
import { key, pose } from "../elements.js";
import { planOf } from "../keyframes.js";
import { Drawing } from "../svg.js";
import type { Element, Key, SvgSource } from "../types.js";
import { fitSize, framesOf, inked, moved, refuseBlock, shortSide, type TypeBlockBase, type TypeBlockOutput } from "./common.js";

export const STENCIL_OPENS = ["zoom", "cut", "hold"] as const;
export type StencilOpen = (typeof STENCIL_OPENS)[number];

export interface StencilOptions extends TypeBlockBase {
  text: string;
  /** The card's colour. */
  ground: string;
  open: StencilOpen;
  shadow: boolean;
  /** Em size, px (default: the word across ~90 % of the frame). */
  size?: number;
  /** Vertical centre of the word, px (default the frame's middle). */
  y?: number;
}

/** Zoom between one drawing of the fly-through and the next. */
const STAGE = 1.6;
/** The push over the hold. */
const PUSH = 1.06;

/** The point inside the letters farthest from any edge (weighted to the word's middle) and that distance. */
function fattestPoint(glyphs: readonly { commands: readonly PathCommand[] }[], centreX: number): { x: number; y: number; r: number } {
  let best = { x: centreX, y: 0, r: 0, score: -Infinity };
  for (const g of glyphs) {
    const lines = flatten(g.commands, 2);
    const box = linesBounds(lines);
    if (!box) continue;
    const step = Math.max(1, Math.min(box.width, box.height) / 36);
    for (let y = box.y + step / 2; y < box.y + box.height; y += step) {
      for (let x = box.x + step / 2; x < box.x + box.width; x += step) {
        if (!insideEvenOdd(lines, x, y)) continue;
        const r = edgeDistance(lines, x, y);
        const score = r * (1 - 0.35 * Math.min(1, Math.abs(x - centreX) / Math.max(1, centreX)));
        if (score > best.score) best = { x, y, r, score };
      }
    }
  }
  return best;
}

export function buildStencil(o: StencilOptions): TypeBlockOutput {
  const { frame } = o;
  const W = frame.width;
  const H = frame.height;
  const fps = frame.fps;
  const text = o.text.trim();
  if (!text) refuseBlock("stencil needs text");
  const block = fitSize(o, text, W * 0.9, H * 0.72, o.size ?? shortSide(frame) * 0.6, { lines: 2, lineHeight: 0.92 });
  const glyphs = inked(block.glyphs);
  if (glyphs.length === 0) refuseBlock("no bundled face draws this text");
  const warnings: string[] = [];
  if (block.style.size < shortSide(frame) * 0.12) warnings.push("the letters are small for a stencil: the shot reads through thin cuts only; use fewer words");
  const ox = (W - block.width) / 2;
  const oy = (o.y ?? H / 2) - block.height / 2;
  const holes = moved(glyphs, ox, oy);
  // The card: a rectangle with every glyph cut out (even-odd keeps counters solid).
  const card: PathCommand[] = [{ type: "M", x: 0, y: 0 }, { type: "L", x: W, y: 0 }, { type: "L", x: W, y: H }, { type: "L", x: 0, y: H }, { type: "Z" }, ...holes];
  const placedGlyphs = glyphs.map((g) => ({ commands: moved([g], ox, oy) }));
  const p = fattestPoint(placedGlyphs, W / 2);
  if (!(p.r > 0)) refuseBlock("the stencil found no inside to its letters");

  const total = o.frames;
  const zoomFrames = o.open === "zoom" ? Math.min(framesOf(0.5, fps), Math.max(2, Math.floor(total / 3))) : 0;
  // A cut leaves the shot whole on the last frame.
  const cardEnd = o.open === "cut" && total > 1 ? total - 1 : total;
  const holdEnd = cardEnd - zoomFrames;
  // Screen point P stays put: every pose is centred on it.
  const farthest = Math.max(Math.hypot(p.x, p.y), Math.hypot(W - p.x, p.y), Math.hypot(p.x, H - p.y), Math.hypot(W - p.x, H - p.y));
  const sEnd = Math.max(PUSH * STAGE, farthest / (p.r * 0.92));
  const scaleAt = (f: number): number => {
    if (f <= holdEnd) return 1 + (PUSH - 1) * (f / Math.max(1, holdEnd));
    const u = Math.min(1, (f - holdEnd) / Math.max(1, zoomFrames - 1));
    // In-expo on the log scale: barely moving, then rushing through the letter.
    return PUSH * Math.exp(Math.log(sEnd / PUSH) * u * u);
  };

  /** The card's part on screen at zoom `s0` (P fixed), drawn for zooms up to `k`. */
  const region = (name: string, s0: number, paint: (d: Drawing, shapes: (string | number)[]) => void): SvgSource => {
    const rx = p.x - p.x / s0;
    const ry = p.y - p.y / s0;
    const width = W / s0;
    const height = H / s0;
    return {
      kind: "svg",
      name,
      width,
      height,
      cx: p.x / s0,
      cy: p.y / s0,
      draw: (k) => {
        const d = new Drawing(width, height, k);
        paint(d, commandList(mapCommands(card, [1, 0, 0, 1, -rx, -ry])));
        return d;
      },
    };
  };
  const fillCard = (d: Drawing, shapes: (string | number)[]) => d.path(shapes, { fill: o.ground, fillRule: "evenodd" });
  const offset = Math.max(2, block.style.size * 0.035);
  // A soft shadow without filters: four offset copies of the card, each faint, deeper together near the edge.
  const shadowCard = (d: Drawing) => {
    for (let i = 1; i <= 4; i += 1) {
      const s = (offset * i) / 4;
      d.path(commandList(mapCommands(card, [1, 0, 0, 1, s, s])), { fill: "#000000", fillOpacity: 0.17, fillRule: "evenodd" });
    }
  };
  const keysOver = (from: number, to: number, alpha?: (f: number) => number): Key[] => {
    const out: Key[] = [];
    for (let f = from; f < to; f += 1) {
      const inHold = f < holdEnd;
      // The hold is one straight push: keys at its ends; the zoom is keyed every frame.
      if (inHold && f !== from && f !== Math.min(to, holdEnd) - 1) continue;
      out.push(key(f, pose(p.x, p.y, { s: scaleAt(f), alpha: alpha ? alpha(f) : 1 }), "linear"));
    }
    return out;
  };

  const elements: Element[] = [];
  const shadowTo = o.shadow ? Math.min(total, holdEnd + Math.max(0, Math.ceil(zoomFrames / 3))) : 0;
  if (o.shadow) {
    const fadeFrom = holdEnd;
    elements.push({
      name: "shadow",
      track: 0,
      from: 0,
      to: shadowTo,
      source: region("shadow", 1, (d) => shadowCard(d)),
      keys: keysOver(0, shadowTo, (f) => (f < fadeFrom ? 1 : Math.max(0, 1 - (f - fadeFrom + 1) / Math.max(1, shadowTo - fadeFrom)))),
    });
  }
  // The card over the hold (and the start of the zoom, while one drawing still holds it sharp).
  let from = 0;
  let s0 = 1;
  let stage = 0;
  while (from < cardEnd) {
    let to = from + 1;
    while (to < cardEnd && scaleAt(to) <= s0 * STAGE + 1e-9) to += 1;
    elements.push({ name: `card-${stage}`, track: 1, from, to, source: region(`card-${stage}`, s0, fillCard), keys: keysOver(from, to) });
    if (to >= cardEnd) break;
    from = to;
    s0 = scaleAt(from);
    stage += 1;
  }
  const hits = o.open === "hold" ? [0] : [0, o.open === "cut" ? cardEnd : holdEnd];
  const plan = planOf(`type_stencil_${o.open}`, total, elements.filter((e) => e.to > e.from), [0], frame);
  return { plan, masks: [], hits, missing: block.missing, warnings };
}
