/**
 * Write-on: strokes draw themselves along their paths (After Effects' trim
 * paths), then the fill comes up. The strokes are one outlined drawing; a
 * libopenshot Mask effect reads a "time map" of the same strokes, each
 * piece of stroke painted the gray of the moment it is drawn (black first,
 * white last), and the Mask's brightness keyframe sweeps that gray range,
 * so the line grows along its own path the way a luma wipe grows across
 * its mask (Mask.cpp:77-100, render/kernels/mask.ts). Glyphs draw their
 * contours together, each glyph starting a little after the one before;
 * SVG paths (a signature, an underline, an icon) draw one after another.
 */

import { defaultEffectJson } from "../../effects/registry.js";
import { maskGrayTable } from "../../render/kernels/mask.js";
import type { PathCommand } from "../../typography/opentype.js";
import { commandList, flatten, linesBounds, mapCommands, parsePathData, polylineLength, type Polyline } from "../../typography/path-data.js";
import { key, pose } from "../elements.js";
import { keyframeThrough, planOf } from "../keyframes.js";
import { Drawing } from "../svg.js";
import type { Effect } from "../../model/types.js";
import type { Element } from "../types.js";
import { fitSize, framesOf, grayHex, inked, moved, refuseBlock, shortSide, type LayerMask, type TypeBlockBase, type TypeBlockOutput } from "./common.js";

/** Mask contrast of the drawing front: 20 / (20 - 19.2) = 25x, a pen head ~10 gray levels long. */
const CONTRAST = 19.2;

export interface WriteOnOptions extends TypeBlockBase {
  /** Text to write, or `paths` (SVG path data in `viewBox` units). */
  text?: string;
  paths?: readonly string[];
  /** [min x, min y, width, height] of the paths (default: their bounds). */
  viewBox?: readonly [number, number, number, number];
  ink: string;
  /** Centre, frame px. */
  x: number;
  y: number;
  /** Em size, px (text; default: fit to the frame). */
  size?: number;
  /** Paths: the drawing's width on the frame, px. */
  width?: number;
  /** Stroke width, px (default 3 % of the em, or 1 % of the short side for paths). */
  stroke?: number;
  /** Fill the shapes once they are drawn (default: on for text, off for paths). */
  fill?: boolean;
  /** Seconds the strokes take (default 70 % of the length, at most 3 s per line). */
  draw?: number;
}

interface Stroke {
  line: Polyline;
  /** Drawing times of its start and end, 0-1 of the write. */
  t0: number;
  t1: number;
}

/** Brightness at which every gray ≥ 0 is hidden / every gray ≤ 255 is shown, for the front's contrast. */
function sweepRange(contrast: number): { hidden: number; shown: number } {
  // Search the integer brightness offsets libopenshot uses (trunc(255·b)) for the exact ends; half a step
  // further out, so the keyframe's rounding still truncates to them.
  let hidden = 255;
  let shown = -255;
  for (let adj = -255; adj <= 255; adj += 1) {
    const t = maskGrayTable(adj / 255, contrast);
    if (t[0]! >= 255 && adj < hidden) hidden = adj;
    if (t[255]! <= 0 && adj > shown) shown = adj;
  }
  return { hidden: (hidden + 0.5) / 255, shown: (shown - 0.5) / 255 };
}

export function buildWriteOn(o: WriteOnOptions): TypeBlockOutput {
  const { frame } = o;
  const fps = frame.fps;
  const short = shortSide(frame);
  const warnings: string[] = [];
  let missing: string[] = [];
  let outlines: PathCommand[];
  let strokes: Stroke[];
  let strokeWidth: number;
  let lines = 1;
  if (o.paths && o.paths.length > 0) {
    if (o.text) refuseBlock("write_on takes text or paths, not both");
    const shapes = o.paths.map((d) => {
      try {
        return parsePathData(d);
      } catch (error) {
        return refuseBlock(`a write_on path is not valid SVG path data (${error instanceof Error ? error.message : String(error)})`);
      }
    });
    const all = shapes.flat();
    const b = linesBounds(flatten(all, 2));
    const box = o.viewBox ?? (b ? [b.x, b.y, b.width, b.height] : [0, 0, 0, 0]);
    if (!(box[2] > 0 && box[3] > 0)) refuseBlock("the write_on paths have no extent");
    const target = Math.min(o.width ?? frame.width * 0.6, frame.width * 0.95);
    const scale = Math.min(target / box[2], (frame.height * 0.8) / box[3]);
    const m = [scale, 0, 0, scale, -(box[0] + box[2] / 2) * scale, -(box[1] + box[3] / 2) * scale] as const;
    const mapped = shapes.map((s) => mapCommands(s, m));
    outlines = mapped.flat();
    const pieces = mapped.flatMap((s) => flatten(s, 1.5));
    const lengths = pieces.map(polylineLength);
    const total = lengths.reduce((a, b) => a + b, 0) || 1;
    let at = 0;
    strokes = pieces.map((line, i) => {
      const t0 = at / total;
      at += lengths[i]!;
      return { line, t0, t1: at / total };
    });
    strokeWidth = o.stroke ?? Math.max(2, short * 0.01);
  } else {
    const text = (o.text ?? "").trim();
    if (!text) refuseBlock("write_on needs text or paths");
    const block = o.size !== undefined ? fitSize(o, text, frame.width * 0.9, frame.height * 0.8, o.size, { lines: 3 }) : fitSize(o, text, frame.width * 0.8, frame.height * 0.6, short * 0.24, { lines: 3 });
    missing = block.missing;
    lines = block.lines.length;
    const glyphs = inked(block.glyphs);
    if (glyphs.length === 0) refuseBlock("no bundled face draws this text");
    const dx = -block.width / 2;
    const dy = -block.height / 2;
    outlines = moved(glyphs, dx, dy);
    // About three glyphs on the go at once: a letter takes 3/n of the write, the last one ending at 1.
    const n = glyphs.length;
    const each = Math.min(1, 3 / n);
    strokes = glyphs.flatMap((g, i) => {
      const t0 = n === 1 ? 0 : (i * (1 - each)) / (n - 1);
      return flatten(moved([g], dx, dy), 1.5).map((line) => ({ line, t0, t1: t0 + each }));
    });
    strokeWidth = o.stroke ?? Math.max(1.5, block.style.size * 0.03);
  }

  const ink = linesBounds(strokes.map((s) => s.line)) ?? refuseBlock("write_on has nothing to draw");
  const pad = strokeWidth * 2 + 4;
  const width = Math.ceil(ink.width + 2 * pad);
  const height = Math.ceil(ink.height + 2 * pad);
  // Drawing coordinates: the shapes' box with its padding at (0, 0).
  const ox = -ink.x + pad;
  const oy = -ink.y + pad;
  const shapes = commandList(mapCommands(outlines, [1, 0, 0, 1, ox, oy]));
  const cx = ox;
  const cy = oy;

  const fill = o.fill ?? !o.paths;
  const drawSeconds = Math.min(o.draw ?? (o.frames / fps) * (fill ? 0.6 : 0.8), (o.frames / fps) * 0.95);
  const drawFrames = Math.max(2, Math.min(o.frames - 1, framesOf(drawSeconds, fps)));
  if (!o.draw && drawSeconds > 3 * lines) warnings.push("a write over 3 s a line drags; give a shorter duration_seconds or draw_seconds");

  const strokeEl: Element = {
    name: "strokes",
    track: 0,
    from: 0,
    to: o.frames,
    source: {
      kind: "svg",
      name: "strokes",
      width,
      height,
      cx,
      cy,
      draw: (k) => new Drawing(width, height, k).path(shapes, { stroke: o.ink, strokeWidth, linecap: "round", linejoin: "round" }),
    },
    keys: [key(0, pose(o.x, o.y))],
  };
  const elements: Element[] = [strokeEl];
  const hits = [0];
  if (fill) {
    const fillFrames = Math.max(1, Math.min(framesOf(0.35, fps), o.frames - drawFrames));
    // The fill starts as the last strokes close and is up a beat later.
    const from = Math.max(1, drawFrames - Math.round(fillFrames / 2));
    elements.push({
      name: "fill",
      track: 1,
      from,
      to: o.frames,
      source: { kind: "svg", name: "fill", width, height, cx, cy, draw: (k) => new Drawing(width, height, k).path(shapes, { fill: o.ink }) },
      keys: [key(from, pose(o.x, o.y, { alpha: 0 })), key(Math.min(o.frames - 1, from + fillFrames), pose(o.x, o.y), "out")],
    });
    hits.push(from);
  }

  // The time map: each piece of stroke the gray of its drawing moment, a little wider than the stroke so its edge is covered.
  const map = new Drawing(width, height, 1);
  const runs: { gray: number; points: [number, number][] }[] = [];
  for (const s of strokes) {
    const p = s.line.points;
    const len = polylineLength(s.line) || 1;
    let along = 0;
    let run: { gray: number; points: [number, number][] } | undefined;
    for (let i = 0; i < p.length; i += 2) {
      if (i > 0) along += Math.hypot(p[i]! - p[i - 2]!, p[i + 1]! - p[i - 1]!);
      const gray = Math.round(255 * (s.t0 + (s.t1 - s.t0) * (along / len)));
      const pt: [number, number] = [p[i]! + ox, p[i + 1]! + oy];
      if (run && run.gray === gray) run.points.push(pt);
      else {
        // A new gray starts where the last piece ended, so the line has no gap.
        const prev: [number, number] | undefined = run?.points.at(-1);
        run = { gray, points: prev ? [prev, pt] : [pt] };
        runs.push(run);
      }
    }
  }
  // Later pieces paint over earlier ones where strokes cross: what is drawn later shows later.
  runs.sort((a, b) => a.gray - b.gray);
  for (const r of runs) {
    if (r.points.length === 1) map.circle(r.points[0]![0], r.points[0]![1], strokeWidth / 2 + 2, { fill: grayHex(r.gray) });
    else map.polyline(r.points, { stroke: grayHex(r.gray), strokeWidth: strokeWidth + 4, linecap: "round", linejoin: "round" });
  }
  const { hidden, shown } = sweepRange(CONTRAST);
  const mask: Omit<Effect, "id"> = (() => {
    const { id: _id, ...json } = defaultEffectJson("Mask", "TEMPLATE00");
    return {
      ...json,
      brightness: keyframeThrough([1, drawFrames + 1], [hidden, shown], ["linear", "in_out"]),
      contrast: keyframeThrough([1], [CONTRAST], ["linear"]),
    } as Omit<Effect, "id">;
  })();
  const masks: LayerMask[] = [{ layer: "strokes", name: "write-on-time", svg: map.svg(), effect: mask }];
  const plan = planOf(o.paths ? "type_write_on_paths" : "type_write_on", o.frames, elements, [0], frame);
  return { plan, masks, hits, missing, warnings };
}

