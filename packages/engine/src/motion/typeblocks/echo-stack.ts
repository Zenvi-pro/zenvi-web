/**
 * Echo stack: one line repeated up and down the frame, the centre copy
 * solid and the echoes outlined (or dimmer), the copies arriving a couple
 * of frames apart outward from the centre, then the stack collapsing into
 * the centre line, which holds. Every copy is its own clip (its own track:
 * they are all on screen at once), so the collapse is plain location and
 * alpha keyframes.
 */

import { commandList } from "../../typography/path-data.js";
import { key, pose } from "../elements.js";
import { planOf } from "../keyframes.js";
import { Drawing } from "../svg.js";
import type { Element } from "../types.js";
import { fitSize, framesOf, inked, moved, refuseBlock, type TypeBlockBase, type TypeBlockOutput } from "./common.js";

export const ECHO_STYLES = ["outline", "solid"] as const;
export type EchoStyle = (typeof ECHO_STYLES)[number];

export interface EchoStackOptions extends TypeBlockBase {
  text: string;
  ink: string;
  /** Copies including the centre one: odd, 3-13. */
  copies: number;
  echo: EchoStyle;
  /** Frames between one pair of copies and the next (default 2). */
  gap: number;
  /** Em size, px (default: the stack fills the frame's height). */
  size?: number;
}

/** Echo opacity by distance from the centre (outlines read lighter, so they stay brighter). */
const SOLID_ALPHA = [1, 0.7, 0.45, 0.3, 0.2, 0.14, 0.1];

export function buildEchoStack(o: EchoStackOptions): TypeBlockOutput {
  const { frame } = o;
  const fps = frame.fps;
  const text = o.text.trim();
  if (!text) refuseBlock("echo_stack needs text");
  const n = o.copies;
  if (n < 3 || n > 13 || n % 2 === 0) refuseBlock("echo_stack copies must be odd, 3-13");
  const half = (n - 1) / 2;
  // Big type with the stack running off the frame: at least five copies on screen, the line across ~86 % of the width.
  const cap = (frame.height * 0.94) / (Math.min(n, 5) * 1.2);
  const block = fitSize(o, text, frame.width * 0.86, (cap / 0.72) * 1.4, o.size ?? cap / 0.72, { lines: 1 });
  const glyphs = inked(block.glyphs);
  if (glyphs.length === 0) refuseBlock("no bundled face draws this text");
  const warnings: string[] = [];
  const pitch = block.capHeight * 1.2;
  const stroke = Math.max(1.5, block.style.size * 0.022);
  const pad = stroke * 2;
  const width = Math.ceil(block.width + 2 * pad);
  const height = Math.ceil(block.height + 2 * pad);
  const shapes = commandList(moved(glyphs, pad, pad));
  const cx = frame.width / 2;
  const cy = frame.height / 2;

  const total = o.frames;
  const arrive = half * o.gap;
  const collapseFrames = Math.min(framesOf(0.3, fps), Math.max(2, Math.floor(total / 5)));
  // Hold the full stack ~0.5 s, never so long that the collapse misses the end.
  const holdUntil = Math.min(arrive + framesOf(0.5, fps), Math.max(arrive + 1, total - collapseFrames - framesOf(0.4, fps)));
  if (total < arrive + collapseFrames + 3) refuseBlock(`echo_stack needs at least ${((arrive + collapseFrames + 3) / fps).toFixed(2)} s to build and collapse ${n} copies`);
  if (holdUntil - arrive < framesOf(0.25, fps)) warnings.push("the stack barely holds before it collapses; give it at least 1.2 s");
  const end = Math.min(total - 1, holdUntil + collapseFrames);
  const elements: Element[] = [];
  const hits: number[] = [];
  for (let d = 0; d <= half; d += 1) {
    const at = d * o.gap;
    hits.push(at);
    for (const side of d === 0 ? [0] : [-1, 1]) {
      const y = cy + side * d * pitch;
      const solid = d === 0 || o.echo === "solid";
      const alpha = d === 0 ? 1 : o.echo === "solid" ? SOLID_ALPHA[Math.min(d, SOLID_ALPHA.length - 1)]! : Math.max(0.35, 1 - d * 0.12);
      const name = d === 0 ? "line" : `echo-${side < 0 ? "up" : "down"}-${d}`;
      const keys =
        d === 0
          ? [key(at, pose(cx, cy, { s: 1.06 })), key(at + Math.min(3, total - 1 - at), pose(cx, cy), "out")]
          : [key(at, pose(cx, y, { alpha })), key(holdUntil, pose(cx, y, { alpha }), "linear"), key(end, pose(cx, cy, { alpha: 0 }), "in")];
      elements.push({
        name,
        track: d === 0 ? n : (side < 0 ? 0 : half) + d,
        from: at,
        to: d === 0 ? total : end + 1,
        source: {
          kind: "svg",
          name,
          width,
          height,
          cx: width / 2,
          cy: height / 2,
          draw: (k) => new Drawing(width, height, k).path(shapes, solid ? { fill: o.ink } : { stroke: o.ink, strokeWidth: stroke, linejoin: "round" }),
        },
        keys,
      });
    }
  }
  hits.push(end);
  const plan = planOf("type_echo_stack", total, elements, [0], frame);
  return { plan, masks: [], hits: [...new Set(hits)].sort((a, b) => a - b), missing: block.missing, warnings };
}
