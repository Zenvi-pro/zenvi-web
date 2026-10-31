/**
 * Paper cut: type cut from paper, a darker cut edge and a soft drop
 * shadow, "boiling" like stop motion (every glyph nudged and turned a
 * little on twos, a new pose every 2 frames) with hand-drawn marks (dashes,
 * sparks, a ring) orbiting the word. Stop motion is drawings, not tweens:
 * one drawing per pose, back to back on one track, so it boils the same
 * on every surface. Seeded: the same call draws the same boil.
 */

import { commandList, mapCommands, rotation } from "../../typography/path-data.js";
import type { PathCommand } from "../../typography/opentype.js";
import { key, pose } from "../elements.js";
import { planOf } from "../keyframes.js";
import { Drawing } from "../svg.js";
import type { Element } from "../types.js";
import { fitSize, inked, refuseBlock, shortSide, type TypeBlockBase, type TypeBlockOutput } from "./common.js";

export interface PaperOptions extends TypeBlockBase {
  text: string;
  /** The paper. */
  paper: string;
  /** The cut edge. */
  edge: string;
  /** The hand-drawn marks. */
  ink: string;
  /** Centre, frame px. */
  x: number;
  y: number;
  size?: number;
  /** Frames per pose (2: on twos). */
  hold: number;
  seed: number;
  /** Draw the orbiting marks (default on). */
  marks: boolean;
}

/** A hand mark: line segments (pairs of points) or a ring. */
interface Mark {
  pts: [number, number][];
  ring?: { x: number; y: number; r: number };
}

/** mulberry32: a small seeded generator, the same sequence on every surface. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Most distinct poses one paper block draws. */
const MAX_POSES = 120;

export function buildPaper(o: PaperOptions): TypeBlockOutput {
  const { frame } = o;
  const text = o.text.trim();
  if (!text) refuseBlock("paper needs text");
  const block = fitSize(o, text, frame.width * 0.72, frame.height * 0.5, o.size ?? shortSide(frame) * 0.28, { lines: 2, lineHeight: 1 });
  const glyphs = inked(block.glyphs);
  if (glyphs.length === 0) refuseBlock("no bundled face draws this text");
  const em = block.style.size;
  const edge = Math.max(2, em * 0.06);
  const marksOut = o.marks ? em * 0.9 : 0;
  const width = Math.ceil(block.width + 2 * (edge * 3 + marksOut));
  const height = Math.ceil(block.height + 2 * (edge * 3 + marksOut));
  const ox = (width - block.width) / 2;
  const oy = (height - block.height) / 2;
  const rand = random(o.seed);
  // A long block boils slower instead of growing without bound (30 s at hold 1 was 900 poses, 5 MB of SVG).
  const hold = Math.max(o.hold, Math.ceil(o.frames / MAX_POSES));
  const poses = Math.max(1, Math.ceil(o.frames / hold));
  const elements: Element[] = [];
  // Orbiting marks: where each sits on an ellipse round the word, and how fast it goes round.
  const marks = o.marks
    ? Array.from({ length: 5 }, (_, i) => ({ kind: i % 3, phase: (i / 5) * 2 * Math.PI + rand() * 0.6, speed: (0.04 + rand() * 0.03) * (i % 2 ? 1 : -1), size: em * (0.26 + rand() * 0.1) }))
    : [];
  for (let p = 0; p < poses; p += 1) {
    const from = p * hold;
    const to = Math.min(o.frames, from + hold);
    // Each glyph nudged and turned about its own middle: the boil.
    const cut: PathCommand[] = glyphs.flatMap((g) => {
      const mx = ox + g.x + g.advance / 2;
      const my = oy + g.baseline - block.capHeight / 2;
      const deg = (rand() - 0.5) * 7;
      const dx = (rand() - 0.5) * em * 0.035;
      const dy = (rand() - 0.5) * em * 0.035;
      return mapCommands(mapCommands(g.commands, [1, 0, 0, 1, ox - mx, oy - my]), rotation(deg, mx + dx, my + dy));
    });
    const shapes = commandList(cut);
    const shadow = commandList(mapCommands(cut, [1, 0, 0, 1, edge * 1.2, edge * 1.6]));
    const strokes = marks.map((m): Mark => {
      const a = m.phase + m.speed * from;
      const cx = width / 2 + Math.cos(a) * (block.width / 2 + marksOut * 0.55);
      const cy = height / 2 + Math.sin(a) * (block.height / 2 + marksOut * 0.45);
      const j = () => (rand() - 0.5) * m.size * 0.25;
      if (m.kind === 0) return { pts: [], ring: { x: cx, y: cy, r: m.size * 0.45 + j() * 0.2 } };
      if (m.kind === 1) {
        const t = a + Math.PI / 2;
        return { pts: [[cx - Math.cos(t) * m.size + j(), cy - Math.sin(t) * m.size + j()], [cx + Math.cos(t) * m.size + j(), cy + Math.sin(t) * m.size + j()]] };
      }
      // A three-ray spark pointing away from the word.
      const out: [number, number][] = [];
      for (const r of [-0.5, 0, 0.5]) {
        const t = a + r;
        out.push([cx + Math.cos(t) * m.size * 0.2, cy + Math.sin(t) * m.size * 0.2], [cx + Math.cos(t) * m.size + j(), cy + Math.sin(t) * m.size + j()]);
      }
      return { pts: out };
    });
    const markWidth = Math.max(2, em * 0.05);
    elements.push({
      name: `pose-${p}`,
      track: 0,
      from,
      to,
      source: {
        kind: "svg",
        name: `pose-${p}`,
        width,
        height,
        cx: width / 2,
        cy: height / 2,
        draw: (k) => {
          const d = new Drawing(width, height, k);
          d.path(shadow, { fill: "#000000", fillOpacity: 0.28 });
          // The cut edge: the outline stroked under the paper, so it shows outside it only.
          d.path(shapes, { fill: o.edge, stroke: o.edge, strokeWidth: edge * 2, linejoin: "round" });
          d.path(shapes, { fill: o.paper });
          for (const s of strokes) {
            if (s.ring) d.circle(s.ring.x, s.ring.y, s.ring.r, { stroke: o.ink, strokeWidth: markWidth });
            for (let i = 0; i + 1 < s.pts.length; i += 2) d.line(s.pts[i]![0], s.pts[i]![1], s.pts[i + 1]![0], s.pts[i + 1]![1], { stroke: o.ink, strokeWidth: markWidth, linecap: "round" });
          }
          return d;
        },
      },
      // It pops in over the first poses (stop motion: the scale steps with the poses too).
      keys: [key(from, pose(o.x, o.y, { s: p === 0 ? 0.7 : p === 1 ? 1.08 : 1 }))],
    });
  }
  const plan = planOf("type_paper", o.frames, elements, [0], frame);
  return { plan, masks: [], hits: [0], missing: block.missing, warnings: [] };
}
