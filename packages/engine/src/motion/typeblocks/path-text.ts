/**
 * Text on a path: one line of type set along a circle (a ring that can
 * spin: a record label, a badge round a logo), an arc over a point, or a
 * wave across the frame. Each glyph is turned to the path's tangent and
 * baked into one outlined drawing, so the whole ring is one clip and a
 * spin is a rotation keyframe about its centre (native everywhere).
 */

import { setRun, type SetGlyph } from "../../typography/typeset.js";
import { mapCommands, rotation, commandList } from "../../typography/path-data.js";
import type { PathCommand } from "../../typography/opentype.js";
import { key, pose } from "../elements.js";
import { planOf } from "../keyframes.js";
import { Drawing } from "../svg.js";
import type { Element, Key } from "../types.js";
import { framesOf, inked, refuseBlock, shortSide, type TypeBlockBase, type TypeBlockOutput } from "./common.js";

export const PATH_SHAPES = ["ring", "arc", "wave"] as const;
export type PathShape = (typeof PATH_SHAPES)[number];

export interface PathTextOptions extends TypeBlockBase {
  text: string;
  shape: PathShape;
  ink: string;
  /** Centre of the ring or arc, the wave's middle (frame px). */
  x: number;
  y: number;
  /** Ring and arc radius, px. */
  radius: number;
  /** Em size, px (default: from the radius or the frame). */
  size?: number;
  /** Degrees per second, clockwise (ring and arc; default 0). */
  spin: number;
}

/** A glyph's outline with its advance's centre on the baseline moved to the origin. */
function centred(g: SetGlyph): PathCommand[] {
  return mapCommands(g.commands, [1, 0, 0, 1, -(g.x + g.advance / 2), 0]);
}

export function buildPathText(o: PathTextOptions): TypeBlockOutput {
  const { frame } = o;
  const fps = frame.fps;
  const line = o.text.replace(/\s+/g, " ").trim();
  if ([...line].length < 2) refuseBlock("text_on_path needs at least 2 characters");
  // A ring's end meets its start: a word space keeps them apart.
  const text = o.shape === "ring" ? `${line} ` : line;
  const warnings: string[] = [];
  const unitRun = setRun(o.lib, text, { family: o.family, size: 100, weight: o.weight ?? 400, tracking: 0.08 });
  const perPx = unitRun.width / 100;
  let size: number;
  const outlines: PathCommand[] = [];
  let half: { w: number; h: number };
  if (o.shape === "wave") {
    const width = frame.width * 0.86;
    size = o.size ?? Math.min(width / perPx, shortSide(frame) * 0.16);
    const run = setRun(o.lib, text, { family: o.family, size, weight: o.weight ?? 400, tracking: 0.08 });
    if (run.width > frame.width * 0.98) warnings.push("the wave is wider than the frame at this size; its ends run off");
    const amp = size * 0.55;
    const wavelength = Math.max(run.width / 1.5, size * 4);
    for (const g of inked(run.glyphs)) {
      const along = g.x + g.advance / 2 - run.width / 2;
      const phase = (2 * Math.PI * along) / wavelength;
      const slope = ((amp * 2 * Math.PI) / wavelength) * Math.cos(phase);
      const deg = (Math.atan(slope) * 180) / Math.PI;
      outlines.push(...mapCommands(centred(g), rotation(deg, along, amp * Math.sin(phase) + run.capHeight / 2)));
    }
    half = { w: run.width / 2 + size, h: amp + size * 1.2 };
  } else {
    const r = o.radius;
    const circumference = 2 * Math.PI * r;
    // A ring is set to close on itself; letters taller than a third of the radius crowd the inside.
    size = o.size ?? Math.min(r * 0.42, (circumference * 0.94) / perPx);
    let run = setRun(o.lib, text, { family: o.family, size, weight: o.weight ?? 400, tracking: 0.08 });
    if (o.shape === "ring" && run.width > circumference * 0.98) {
      size *= (circumference * 0.94) / run.width;
      run = setRun(o.lib, text, { family: o.family, size, weight: o.weight ?? 400, tracking: 0.08 });
      warnings.push(`the text was set smaller (${Math.round(size)} px) to fit once round the ring`);
    }
    if (o.shape === "arc" && run.width > circumference * 0.75) warnings.push("the arc runs over 270°: a ring reads better for text this long");
    const glyphs = run.glyphs;
    // A ring spreads the leftover round the circle evenly: the line closes on itself with no seam.
    const extra = o.shape === "ring" ? (circumference - run.width) / Math.max(1, glyphs.length) : 0;
    const span = o.shape === "ring" ? circumference : run.width;
    glyphs.forEach((g, i) => {
      if (!inked([g]).length) return;
      const along = g.x + g.advance / 2 + i * extra - span / 2 + (o.shape === "ring" ? extra / 2 : 0);
      const deg = ((along / r) * 180) / Math.PI;
      const rad = (deg * Math.PI) / 180;
      outlines.push(...mapCommands(centred(g), rotation(deg, r * Math.sin(rad), -r * Math.cos(rad))));
    });
    half = { w: r + size, h: r + size };
  }
  if (outlines.length === 0) refuseBlock("no bundled face draws this text");

  const width = Math.ceil(half.w * 2);
  const height = Math.ceil(half.h * 2);
  // The outlines are round the path's centre: moved into the drawing once.
  const shapes = commandList(mapCommands(outlines, [1, 0, 0, 1, width / 2, height / 2]));
  const into = (k: number) => new Drawing(width, height, k).path(shapes, { fill: o.ink });
  const enterFrames = Math.min(framesOf(0.45, fps), Math.max(1, o.frames - 1));
  const last = o.frames - 1;
  const spinAt = (f: number) => (o.shape === "wave" ? 0 : (o.spin * f) / fps);
  // In: it grows from 85 % and turns into place 25° against its spin, then turns at the spin rate to the end.
  const lead = o.shape === "wave" || o.spin === 0 ? 0 : -Math.sign(o.spin) * 25;
  const keys: Key[] = [key(0, pose(o.x, o.y, { s: 0.85, alpha: 0, rotation: lead }))];
  keys.push(key(enterFrames, pose(o.x, o.y, { rotation: spinAt(enterFrames) }), "out"));
  if (last > enterFrames && spinAt(last) !== spinAt(enterFrames)) keys.push(key(last, pose(o.x, o.y, { rotation: spinAt(last) }), "linear"));
  const element: Element = {
    name: `path-${o.shape}`,
    track: 0,
    from: 0,
    to: o.frames,
    source: { kind: "svg", name: `path-${o.shape}`, width, height, cx: width / 2, cy: height / 2, draw: into },
    keys,
  };
  const plan = planOf(`type_${o.shape}`, o.frames, [element], [0], frame);
  return { plan, masks: [], hits: [0], missing: unitRun.missing, warnings };
}
