/**
 * Type strobe: one word per hit, hard cut every few frames (or on the
 * beats), each a full-bleed card whose ground flips (ground / ink / accent,
 * the ink inverted with it) and whose layout changes every cut: fitted
 * across the frame, blown up past its edges, mirrored, outlined, turned on
 * end, stacked. It resolves on a lockup that holds. All cards are one
 * track of back-to-back clips, so the cuts are real cuts.
 */

import { MIN_CHANGE_GAP, fitsFlashLimit, isFlashChange, relativeLuminance } from "../../review/flashing.js";
import { commandList, mapCommands, rotation, type Affine } from "../../typography/path-data.js";
import type { PathCommand } from "../../typography/opentype.js";
import type { TextBlock } from "../../typography/typeset.js";
import { key, pose } from "../elements.js";
import { planOf } from "../keyframes.js";
import { Drawing } from "../svg.js";
import type { Element } from "../types.js";
import { fitSize, inked, moved, refuseBlock, type TypeBlockBase, type TypeBlockOutput } from "./common.js";

export const STROBE_LAYOUTS = ["fit", "bleed", "outline", "mirror", "tall", "stack"] as const;
export type StrobeLayout = (typeof STROBE_LAYOUTS)[number];

export interface StrobeOptions extends TypeBlockBase {
  words: readonly string[];
  /** First frame of each word, then of the lockup (words.length + 1 frames, increasing). */
  starts: readonly number[];
  /** The held end card (empty: no lockup, the last word holds). */
  lockup: string;
  ground: string;
  ink: string;
  accent: string;
  layouts: readonly StrobeLayout[];
  /** Flip the ground on every cut even past 3 flashes a second (WCAG 2.3.1); the user asked for a strobe. */
  allowStrobe?: boolean;
  /** Flash changes already on the timeline around the block, in seconds from its start: the flips count them too. */
  flashes?: readonly number[];
}

function luminance(hex: string): number {
  const c = (i: number) => Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
  return 0.2126 * c(0) + 0.7152 * c(1) + 0.0722 * c(2);
}

export function buildStrobe(o: StrobeOptions): TypeBlockOutput {
  const { frame } = o;
  const W = frame.width;
  const H = frame.height;
  if (o.words.length === 0) refuseBlock("strobe needs words");
  if (o.layouts.length === 0) refuseBlock("strobe needs at least one layout");
  if (o.starts.length !== o.words.length + 1) throw new Error("strobe: one start per word and one for the lockup");
  for (let i = 1; i < o.starts.length; i += 1) if (!(o.starts[i]! > o.starts[i - 1]!)) throw new Error("strobe: starts must increase");
  const accentInk = luminance(o.accent) > 0.5 ? "#0a0a0a" : "#ffffff";
  const grounds = [
    { ground: o.ground, ink: o.ink },
    { ground: o.ink, ink: o.ground },
    { ground: o.accent, ink: accentInk },
  ];
  const missing = new Set<string>();
  const elements: Element[] = [];
  const card = (name: string, from: number, to: number, paint: (d: Drawing) => void, punch: number): Element => ({
    name,
    track: 0,
    from,
    to,
    source: {
      kind: "svg",
      name,
      width: W,
      height: H,
      cx: W / 2,
      cy: H / 2,
      draw: (k) => {
        const d = new Drawing(W, H, k);
        paint(d);
        return d;
      },
    },
    // A small punch-in over the hold keeps a held card alive; one frame cards stay still.
    keys: to - from > 2 ? [key(from, pose(W / 2, H / 2, { s: punch })), key(to - 1, pose(W / 2, H / 2), "out")] : [key(from, pose(W / 2, H / 2))],
  });
  const fitted = (text: string, width: number, height: number): TextBlock => {
    const b = fitSize(o, text, width, height, H * 1.2, { lines: 1 });
    b.missing.forEach((m) => missing.add(m));
    return b;
  };
  /** The block's outlines centred on the frame, through `m` (about the frame centre). */
  const centred = (b: TextBlock, m: Affine = [1, 0, 0, 1, 0, 0], dy = 0): PathCommand[] => {
    const inner = moved(inked(b.glyphs), -b.width / 2, -b.height / 2 + dy);
    return mapCommands(mapCommands(inner, m), [1, 0, 0, 1, W / 2, H / 2]);
  };

  let previous = -1;
  // Ground flips that count toward a flash, seconds; a flip past 3 flashes a second holds the ground instead.
  const flips: number[] = [];
  let held = 0;
  o.words.forEach((word, i) => {
    const layout = o.layouts[i % o.layouts.length]!;
    // Flip the ground every cut, never twice the same in a row.
    let g = i % grounds.length;
    if (g === previous) g = (g + 1) % grounds.length;
    if (previous >= 0 && isFlashChange(relativeLuminance(grounds[previous]!.ground), relativeLuminance(grounds[g]!.ground))) {
      const t = o.starts[i]! / frame.fps;
      // Evenly: a flip at least MIN_CHANGE_GAP after the last, not bursts of six and a hold.
      if (o.allowStrobe || (t - (flips.at(-1) ?? -Infinity) >= MIN_CHANGE_GAP - 1e-6 && fitsFlashLimit([...(o.flashes ?? []), ...flips], [t]))) flips.push(t);
      else {
        g = previous;
        held += 1;
      }
    }
    previous = g;
    const { ground, ink } = grounds[g]!;
    let shapes: PathCommand[];
    let paint: { fill?: string; stroke?: string; strokeWidth?: number };
    switch (layout) {
      case "bleed": {
        const b = fitted(word, W * 0.9, H * 0.8);
        const big = fitSize(o, word, W * 1.9, H * 1.6, b.style.size * 1.9, { lines: 1 });
        shapes = centred(big, [1, 0, 0, 1, (i % 2 === 0 ? 1 : -1) * W * 0.08, 0], -big.height * 0.04);
        paint = { fill: ink };
        break;
      }
      case "mirror":
        shapes = centred(fitted(word, W * 0.9, H * 0.8), [-1, 0, 0, 1, 0, 0]);
        paint = { fill: ink };
        break;
      case "outline": {
        const b = fitted(word, W * 0.9, H * 0.8);
        shapes = centred(b);
        paint = { stroke: ink, strokeWidth: Math.max(2, b.style.size * 0.025) };
        break;
      }
      case "tall":
        shapes = centred(fitted(word, H * 0.92, W * 0.9), rotation(-90));
        paint = { fill: ink };
        break;
      case "stack": {
        const b = fitted(word, W * 0.96, H * 0.42);
        const step = b.capHeight * 1.12;
        shapes = [-1, 0, 1].flatMap((r) => centred(b, [1, 0, 0, 1, 0, r * step]));
        paint = { fill: ink };
        break;
      }
      default:
        shapes = centred(fitted(word, W * 0.9, H * 0.8));
        paint = { fill: ink };
    }
    const list = commandList(shapes);
    elements.push(
      card(`word-${i}`, o.starts[i]!, Math.min(o.starts[i + 1]!, o.frames), (d) => {
        d.rect(0, 0, W, H, { fill: ground });
        if (list.length > 0) d.path(list, paint);
      }, 1.04),
    );
  });
  const lockStart = o.starts[o.words.length]!;
  if (o.lockup && lockStart < o.frames) {
    const b = fitted(o.lockup, W * 0.8, H * 0.5);
    const list = commandList(centred(b));
    elements.push(
      card("lockup", lockStart, o.frames, (d) => {
        d.rect(0, 0, W, H, { fill: o.ground });
        if (list.length > 0) d.path(list, { fill: o.ink });
      }, 1.1),
    );
  } else if (elements.length > 0) {
    elements[elements.length - 1]!.to = Math.max(elements[elements.length - 1]!.to, o.frames);
  }
  const plan = planOf("type_strobe", o.frames, elements, [...o.starts], frame);
  const warnings = held > 0 ? [`the ground holds on ${held} of ${o.words.length} cuts: flipping it every cut makes more than 3 flashes in a second${(o.flashes ?? []).length > 0 ? " with the flashes already on the timeline" : ""}, which can trigger seizures (WCAG 2.3.1); hold_frames ${Math.ceil(frame.fps / 6)}+ flips every cut (away from other flashes), allow_strobe=true only when the user asks for a strobe`] : [];
  return { plan, masks: [], hits: elements.map((e) => e.from), missing: [...missing], warnings };
}
