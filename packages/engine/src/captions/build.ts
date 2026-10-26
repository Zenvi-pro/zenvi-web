/**
 * Kinetic captions as a motion plan: every word (or group) is an SVG title
 * of outlined type with clip keyframes (motion/keyframes.ts), so the result
 * is native and editable on every Zenvi surface and the desktop draws it
 * as-is.
 *
 *   time       plan frame 0 is the first group's start on the frame grid; a
 *              word's clip starts on its own start frame (round(start × fps))
 *              and runs to its group's end, so a word never shows before it
 *              is said. Groups follow each other without overlap.
 *   layout     each group is set as a block (styles.ts arrangement) at the
 *              style's size × the frame's short side / 1080, lines stacked
 *              on cap heights, then placed at the first spot (the style's
 *              spots, then beside, below and above the first avoid box)
 *              that stays in the caption safe area (captionSafe) and clear of
 *              every avoid box by 2 % of the frame width. When no spot is
 *              clear the block is set smaller (85 %, 70 %) before taking
 *              the spot that overlaps least. Behind a cut-out speaker the
 *              group goes across the top of the head instead (BEHIND).
 *   tracks     word-by-word styles put word n of every group on track n (the
 *              words of a group overlap in time); karaoke puts the line on
 *              one track and the moving marker on the next.
 */

import { planOf } from "../motion/keyframes.js";
import { Drawing } from "../motion/svg.js";
import type { Element, Key, MotionFrame, MotionPlan, Pose } from "../motion/types.js";
import type { FontLibrary } from "../typography/library.js";
import { inkBox, outlineCommands, typeset, type Box, type TextBlock } from "../typography/typeset.js";
import { CAPTION_STYLES, DEFAULT_ACCENT, DEFAULT_INK, type CaptionFace, type CaptionStyle, type CaptionStyleId } from "./styles.js";
import { groupWords, pickEmphasis, type CaptionWord } from "./words.js";

/** A region to keep captions off (a face, a product), shares of the frame: centre x, y and size w, h. */
export interface AvoidBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface KineticCaptionInput {
  frame: MotionFrame;
  /** Spoken words in timeline seconds, in order. */
  words: readonly CaptionWord[];
  style: CaptionStyleId;
  emphasis: "auto" | "none" | readonly string[];
  avoid: readonly AvoidBox[];
  ink?: string;
  accent?: string;
  /** The speaker is cut out above the captions: groups go high, where the words pass behind the head. */
  behind?: boolean;
  lib: FontLibrary;
}

export interface PlacedWord {
  text: string;
  emphasis: boolean;
  /** Timeline seconds (on the frame grid) the word appears. */
  start: number;
  /** Ink box on the frame, px. */
  box: Box;
}

export interface PlacedGroup {
  text: string;
  start: number;
  stop: number;
  /** The group's block on the frame, px. */
  box: Box;
  words: PlacedWord[];
  /** Px² of the block inside avoid boxes (0: clear). */
  overlap: number;
  /** Timeline seconds its first and last words start, as given (off the frame grid). */
  said: [number, number];
  /** The distinct `source`s of its words, in order. */
  sources: string[];
}

export interface KineticCaptionPlan {
  plan: MotionPlan;
  /** Timeline seconds of plan frame 0. */
  start: number;
  groups: PlacedGroup[];
  missing: string[];
}

interface SetWord {
  index: number;
  text: string;
  emphasis: boolean;
  face: CaptionFace;
  block: TextBlock;
  /** Pen position (left of the advance) and baseline in the group block. */
  x: number;
  baseline: number;
}

interface GroupBlock {
  words: SetWord[];
  width: number;
  height: number;
}

const MARGIN = 0.02;

/**
 * Where captions may go (TASTE.md §3): on 9:16 and taller frames the
 * platform-safe area, out of the bottom 20 % (Reels / TikTok / Shorts UI)
 * and the top 12 % (status bar, handle), 10 % in from the sides; on other
 * frames title-safe, 10 % in from every edge.
 */
export function captionSafe(frame: { width: number; height: number }): { left: number; top: number; right: number; bottom: number } {
  const W = frame.width;
  const H = frame.height;
  const tall = H >= W * 1.5;
  return { left: 0.1 * W, right: 0.9 * W, top: (tall ? 0.12 : 0.1) * H, bottom: (tall ? 0.8 : 0.9) * H };
}
/** Largest type size (px at a 1080 px short side) whose halo grows with it. */
const HALO_TYPE_SIZE = 64;
/** Where groups go behind a cut-out speaker: across the top of the head. */
const BEHIND = { portrait: { x: 0.5, y: 0.2 }, landscape: { x: 0.5, y: 0.26 } } as const;

function setWord(lib: FontLibrary, text: string, face: CaptionFace, size: number): TextBlock {
  return typeset(lib, text, { family: face.family, size, weight: face.weight, italic: face.italic ?? false, tracking: face.tracking, transform: face.transform });
}

/** Lay out a group's words as a block at `scale` × the style's sizes. */
function layoutGroup(lib: FontLibrary, style: CaptionStyle, words: readonly { index: number; text: string; emphasis: boolean }[], u: number, scale: number, measure: number): GroupBlock {
  const set = words.map((w): SetWord => {
    const face = w.emphasis ? style.emphasis : style.base;
    const size = face.size * u * scale;
    let block = setWord(lib, w.text, face, size);
    // Fill-width faces grow to the measure (up to their cap); any word wider than the measure is set smaller.
    const spanning = (size * measure) / Math.max(block.width, 1e-6);
    const wanted = face.fillTo ? Math.min(spanning, face.fillTo * u * scale) : Math.min(size, spanning);
    if (Math.abs(wanted - size) > 0.5) block = setWord(lib, w.text, face, wanted);
    return { ...w, face, block, x: 0, baseline: 0 };
  });
  const baseSize = style.base.size * u * scale;
  const space = baseSize * 0.28;
  const lines: SetWord[][] = [];
  if (style.arrangement === "column") {
    for (const w of set) lines.push([w]);
  } else if (style.arrangement === "split") {
    const half = Math.ceil(set.length / 2);
    lines.push(set.slice(0, half));
    if (set.length > half) lines.push(set.slice(half));
  } else {
    let line: SetWord[] = [];
    let width = 0;
    const target = style.arrangement === "lines" ? balancedWidth(set, space, measure) : measure;
    for (const w of set) {
      const own = style.arrangement === "mixed" && w.emphasis;
      if (line.length > 0 && (own || width + space + w.block.width > target + 1e-6 || line.some((x) => style.arrangement === "mixed" && x.emphasis))) {
        lines.push(line);
        line = [];
        width = 0;
      }
      width += (line.length > 0 ? space : 0) + w.block.width;
      line.push(w);
    }
    if (line.length > 0) lines.push(line);
  }
  const widths = lines.map((l) => l.reduce((s, w, i) => s + w.block.width + (i > 0 ? space : 0), 0));
  const width = Math.max(...widths);
  const gap = style.gap * baseSize;
  let y = 0;
  lines.forEach((line, li) => {
    const cap = Math.max(...line.map((w) => w.block.capHeight));
    const desc = Math.max(...line.map((w) => w.block.descent * (w.face.transform === "upper" ? 0.15 : 0.6)));
    const baseline = y + cap;
    let x = style.arrangement === "column" ? 0 : (width - widths[li]!) / 2;
    for (const w of line) {
      w.x = x;
      w.baseline = baseline;
      x += w.block.width + space;
    }
    y = baseline + desc + gap;
  });
  return { words: set, width, height: y - gap };
}

/** The narrowest measure that keeps the words on as few lines as `measure` allows: even lines. */
function balancedWidth(set: readonly SetWord[], space: number, measure: number): number {
  const count = (w: number): number => {
    let lines = 1;
    let width = 0;
    for (const s of set) {
      if (width > 0 && width + space + s.block.width > w + 1e-6) {
        lines += 1;
        width = s.block.width;
      } else width += (width > 0 ? space : 0) + s.block.width;
    }
    return lines;
  };
  const lines = count(measure);
  let lo = Math.max(...set.map((s) => s.block.width));
  let hi = measure;
  for (let i = 0; i < 20 && hi - lo > 1; i += 1) {
    const mid = (lo + hi) / 2;
    if (count(mid) > lines) lo = mid;
    else hi = mid;
  }
  return hi;
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

interface Placement {
  box: Box;
  overlap: number;
}

/** Where a `w` × `h` block goes: the first clear candidate centre, else the least overlapping one. */
function place(w: number, h: number, centres: readonly { x: number; y: number }[], safe: { left: number; top: number; right: number; bottom: number }, avoid: readonly Box[]): Placement {
  let best: Placement | null = null;
  for (const c of centres) {
    const x = Math.min(Math.max(c.x - w / 2, safe.left), Math.max(safe.left, safe.right - w));
    const y = Math.min(Math.max(c.y - h / 2, safe.top), Math.max(safe.top, safe.bottom - h));
    const box = { x, y, width: w, height: h };
    const overlap = avoid.reduce((s, a) => s + overlapArea(box, a), 0);
    if (!best || overlap < best.overlap - 1e-6) best = { box, overlap };
    if (overlap === 0) break;
  }
  return best!;
}

/** Ink and advance box of a set word, in its own block px. */
function wordBounds(b: TextBlock): Box {
  const ink = inkBox(b.glyphs);
  const x0 = Math.min(0, ink?.x ?? 0);
  const x1 = Math.max(b.width, ink ? ink.x + ink.width : 0);
  const y0 = Math.min(b.ascent - b.capHeight, ink?.y ?? b.ascent);
  const y1 = Math.max(b.ascent, ink ? ink.y + ink.height : b.ascent);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

interface Painted {
  words: readonly SetWord[];
  /** Block px of the drawing's top-left. */
  x: number;
  y: number;
}

/** A drawing of words (block coordinates offset by -x, -y), with the shadow and the karaoke pill. */
function drawWords(p: Painted, width: number, height: number, k: number, colours: { ink: string; accent: string }, style: CaptionStyle, marker: boolean, u: number): Drawing {
  const d = new Drawing(width, height, k);
  for (const w of p.words) {
    const ox = w.x - p.x;
    const oy = w.baseline - w.block.ascent - p.y;
    const size = w.block.style.size;
    if (marker) {
      const b = wordBounds(w.block);
      const padX = size * 0.2;
      const padY = size * 0.14;
      d.rect(ox + b.x - padX, oy + b.y - padY, b.width + 2 * padX, b.height + 2 * padY, { fill: colours.accent, rx: size * 0.2 });
      d.path(outlineCommands(w.block.glyphs, ox, oy), { fill: "#111111" });
      continue;
    }
    const outline = outlineCommands(w.block.glyphs, ox, oy);
    if (style.shadow) {
      // No renderer here blurs: a soft halo is two wide dark strokes under the letters, plus a short drop.
      // The halo is for small type: display sizes keep a thin one (a wide one reads as an outline).
      const halo = Math.min(size, HALO_TYPE_SIZE * u);
      d.path(outline, { fill: "#000000", fillOpacity: 0.2, stroke: "#000000", strokeWidth: Math.max(2, halo * 0.14), strokeOpacity: 0.2, linejoin: "round" });
      d.path(outline, { fill: "none", stroke: "#000000", strokeWidth: Math.max(1, halo * 0.06), strokeOpacity: 0.32, linejoin: "round" });
      d.path(outlineCommands(w.block.glyphs, ox + size * 0.02, oy + size * 0.035), { fill: "#000000", fillOpacity: 0.3 });
    }
    d.path(outline, { fill: w.face.fill === "accent" ? colours.accent : colours.ink });
  }
  return d;
}

/**
 * Keys of a word or group: entrance, hold, exit. `travel` is the entrance's
 * direction (1: rises from below, -1: drops from above, so a block on the
 * safe area's bottom line never enters through the platform band).
 */
function keysFor(from: number, to: number, rest: Pose, style: CaptionStyle, fps: number, H: number, entrance = true, travel = 1): Key[] {
  const m = style.motion;
  const last = to - 1;
  const e = Math.max(1, Math.round(m.enter * fps));
  const x = Math.round(m.exit * fps);
  if (last - from < 2) return [{ frame: from, pose: rest, ease: "linear" }];
  const keys: Key[] = [];
  if (entrance && last - from > e) {
    keys.push({ frame: from, pose: { ...rest, alpha: 0, s: m.fromScale, y: rest.y + travel * m.fromY * H }, ease: "linear" });
    keys.push({ frame: from + e, pose: rest, ease: m.enterEase });
  } else keys.push({ frame: from, pose: rest, ease: "linear" });
  const settled = keys[keys.length - 1]!.frame;
  if (x > 0 && last - x > settled) {
    keys.push({ frame: last - x, pose: rest, ease: "smooth" });
    keys.push({ frame: last, pose: { ...rest, alpha: 0, s: m.toScale }, ease: m.exitEase });
  }
  return keys;
}

export function buildKineticCaptions(input: KineticCaptionInput): KineticCaptionPlan {
  const style = CAPTION_STYLES[input.style];
  const { frame, lib } = input;
  const fps = frame.fps;
  const layout = { W: frame.width, H: frame.height };
  const { W, H } = layout;
  const safe = captionSafe(frame);
  const u = Math.min(W, H) / 1080;
  const colours = { ink: input.ink ?? DEFAULT_INK, accent: input.accent ?? DEFAULT_ACCENT[input.style] };
  const words = input.words.filter((w) => w.text.trim());
  if (words.length === 0) throw new Error("no words to caption");
  const groups = groupWords(words, style.groups);
  const emphasis = pickEmphasis(words, groups, input.emphasis, style.perGroup, style.floor);
  const margin = MARGIN * W;
  const avoid = input.avoid.map((a): Box => ({ x: (a.x - a.w / 2) * W - margin, y: (a.y - a.h / 2) * H - margin, width: a.w * W + 2 * margin, height: a.h * H + 2 * margin }));
  const subject = input.avoid[0];
  const portrait = H > W * 1.05;
  const spots = (input.behind ? [BEHIND[portrait ? "portrait" : "landscape"]] : portrait ? style.spots.portrait : style.spots.landscape).map((s) => ({ x: s.x * W, y: s.y * H }));
  const safeWidth = safe.right - safe.left;
  const frameOf = (t: number) => Math.round(t * fps);
  const f0 = frameOf(groups[0]!.start);
  const missing = new Set<string>();
  const elements: Element[] = [];
  const placed: PlacedGroup[] = [];
  let prevEnd = 0;

  groups.forEach((g, gi) => {
    const shown = (text: string) => (style.punctuation === "strip" ? text.trim().replace(/[.,;:!?…"”)\]]+$/u, "") || text.trim() : text.trim());
    const items = words.slice(g.first, g.end).map((w, j) => ({ index: g.first + j, text: shown(w.text), emphasis: emphasis.has(g.first + j) }));
    const from = Math.max(prevEnd, frameOf(g.start) - f0);
    const to = Math.max(from + 1, frameOf(g.stop) - f0);
    prevEnd = to;

    // Lay out and place: split sits either side of the subject, the others at the first clear spot.
    let block: GroupBlock | null = null;
    let where: { x: number; y: number; overlap: number } | null = null;
    let halves: { left: Box; right: Box } | null = null;
    for (const scale of [1, 0.85, 0.7]) {
      const b = layoutGroup(lib, style, items, u, scale, style.measure * safeWidth);
      if (style.arrangement === "split") {
        const sb = subject ? { x: (subject.x - subject.w / 2) * W, y: (subject.y - subject.h / 2) * H, w: subject.w * W, h: subject.h * H } : { x: W * 0.35, y: H * 0.3, w: W * 0.3, h: H * 0.3 };
        const firstLine = b.words.filter((w) => w.baseline === b.words[0]!.baseline);
        const rest = b.words.filter((w) => w.baseline !== b.words[0]!.baseline);
        const lw = Math.max(...firstLine.map((w) => w.x + w.block.width)) - Math.min(...firstLine.map((w) => w.x));
        const rw = rest.length > 0 ? Math.max(...rest.map((w) => w.x + w.block.width)) - Math.min(...rest.map((w) => w.x)) : 0;
        const fits = sb.x - margin - lw >= safe.left && sb.x + sb.w + margin + rw <= safe.right;
        if (fits || scale === 0.7) {
          const cy = Math.min(Math.max(sb.y + sb.h * 0.5, safe.top + b.height), safe.bottom - b.height);
          const lineH = firstLine[0]!.block.capHeight;
          halves = {
            left: { x: Math.max(safe.left, sb.x - margin - lw), y: cy - lineH / 2, width: lw, height: lineH },
            right: { x: Math.min(safe.right - rw, sb.x + sb.w + margin), y: cy - lineH / 2, width: rw, height: lineH },
          };
          block = b;
          where = { x: 0, y: 0, overlap: avoid.reduce((s, a) => s + overlapArea(halves!.left, a) + (rw > 0 ? overlapArea(halves!.right, a) : 0), 0) };
          break;
        }
        continue;
      }
      const centres = [...spots];
      if (subject) {
        const sx = subject.x * W;
        const sy = subject.y * H;
        const hw = (subject.w * W) / 2 + margin;
        const hh = (subject.h * H) / 2 + margin;
        centres.push({ x: sx - hw - b.width / 2, y: sy }, { x: sx + hw + b.width / 2, y: sy }, { x: sx, y: sy + hh + b.height / 2 }, { x: sx, y: sy - hh - b.height / 2 });
      }
      const p = place(b.width, b.height, centres, safe, avoid);
      if (!where || p.overlap < where.overlap) {
        block = b;
        where = { x: p.box.x, y: p.box.y, overlap: p.overlap };
      }
      if (p.overlap === 0) break;
    }
    const b = block!;
    // Each word's frame offset (px) from block coordinates.
    const placedAt = (w: SetWord): { dx: number; dy: number } => {
      if (halves) {
        const left = w.baseline === b.words[0]!.baseline;
        const line = b.words.filter((x) => (x.baseline === b.words[0]!.baseline) === left);
        const lx = Math.min(...line.map((x) => x.x));
        const half = left ? halves.left : halves.right;
        return { dx: half.x - lx, dy: half.y + half.height - w.baseline };
      }
      return { dx: where!.x, dy: where!.y };
    };
    for (const w of b.words) for (const m of w.block.missing) missing.add(m);

    const boxesAt = (at: (w: SetWord) => { dx: number; dy: number }) => {
      const boxes = b.words.map((w) => {
        const o = at(w);
        const wb = wordBounds(w.block);
        return { x: o.dx + w.x + wb.x, y: o.dy + w.baseline - w.block.ascent + wb.y, width: wb.width, height: wb.height };
      });
      const x0 = Math.min(...boxes.map((x) => x.x));
      const y0 = Math.min(...boxes.map((x) => x.y));
      const x1 = Math.max(...boxes.map((x) => x.x + x.width));
      const y1 = Math.max(...boxes.map((x) => x.y + x.height));
      return { boxes, box: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } };
    };
    // The ink (descenders, a slanted italic) may reach past the block's cap-height box: move it all inside the safe area.
    const ink = boxesAt(placedAt).box;
    const shiftX = ink.x < safe.left ? safe.left - ink.x : ink.x + ink.width > safe.right ? Math.max(safe.left - ink.x, safe.right - ink.x - ink.width) : 0;
    const shiftY = ink.y < safe.top ? safe.top - ink.y : ink.y + ink.height > safe.bottom ? Math.max(safe.top - ink.y, safe.bottom - ink.y - ink.height) : 0;
    const offsetOf = (w: SetWord): { dx: number; dy: number } => {
      const o = placedAt(w);
      return { dx: o.dx + shiftX, dy: o.dy + shiftY };
    };
    const groupBox = boxesAt(offsetOf);
    const travel = groupBox.box.y + groupBox.box.height + style.motion.fromY * H > safe.bottom ? -1 : 1;
    placed.push({
      text: items.map((i) => i.text).join(" "),
      start: (f0 + from) / fps,
      stop: (f0 + to) / fps,
      box: groupBox.box,
      overlap: where!.overlap,
      said: [words[g.first]!.start, words[g.end - 1]!.start],
      sources: [...new Set(words.slice(g.first, g.end).flatMap((w) => (w.source === undefined ? [] : [w.source])))],
      words: b.words.map((w, j) => ({
        text: w.text,
        emphasis: w.emphasis,
        start: (f0 + (style.reveal === "word" ? Math.min(to - 1, Math.max(from, frameOf(words[w.index]!.start) - f0)) : from)) / fps,
        box: groupBox.boxes[j]!,
      })),
    });

    const pad = Math.max(...b.words.map((w) => w.block.style.size)) * 0.3;
    const wordElement = (w: SetWord, j: number, name: string, track: number, start: number, end: number, marker: boolean, entrance: boolean): Element => {
      const o = offsetOf(w);
      const wb = groupBox.boxes[j]!;
      const left = wb.x - o.dx - pad;
      const top = wb.y - o.dy - pad;
      const width = wb.width + 2 * pad;
      const height = wb.height + 2 * pad;
      const rest: Pose = { x: wb.x + wb.width / 2, y: wb.y + wb.height / 2, s: 1, alpha: 1, rotation: 0 };
      return {
        name,
        track,
        from: start,
        to: end,
        source: { kind: "svg", name, width, height, cx: width / 2, cy: height / 2, draw: (k) => drawWords({ words: [w], x: left, y: top }, width, height, k, colours, style, marker, u) },
        keys: keysFor(start, end, rest, style, fps, H, entrance, travel),
      };
    };

    if (style.reveal === "group") {
      // One drawing of the whole group (its words share the block's offset).
      const o = offsetOf(b.words[0]!);
      const gb = groupBox.box;
      const left = gb.x - o.dx - pad;
      const top = gb.y - o.dy - pad;
      const width = gb.width + 2 * pad;
      const height = gb.height + 2 * pad;
      const name = `g${gi}`;
      elements.push({
        name,
        track: 0,
        from,
        to,
        source: { kind: "svg", name, width, height, cx: width / 2, cy: height / 2, draw: (k) => drawWords({ words: b.words, x: left, y: top }, width, height, k, colours, style, false, u) },
        keys: keysFor(from, to, { x: gb.x + gb.width / 2, y: gb.y + gb.height / 2, s: 1, alpha: 1, rotation: 0 }, style, fps, H, true, travel),
      });
      if (style.marker) {
        b.words.forEach((w, j) => {
          const start = Math.min(to - 1, Math.max(from, frameOf(words[w.index]!.start) - f0));
          const next = b.words[j + 1];
          // The last marker leaves when the line starts to: it must not outstay it.
          const lineExit = to - 1 - Math.round(style.motion.exit * fps);
          const end = next ? Math.min(to, Math.max(start + 1, frameOf(words[next.index]!.start) - f0)) : Math.max(start + 1, Math.min(to, lineExit));
          if (end > start) elements.push(wordElement(w, j, `g${gi}m${j}`, 1, start, end, true, j === 0 ? false : true));
        });
      }
    } else {
      b.words.forEach((w, j) => {
        const start = Math.min(to - 1, Math.max(from, frameOf(words[w.index]!.start) - f0));
        elements.push(wordElement(w, j, `g${gi}w${j}`, j, start, to, false, true));
      });
    }
  });

  const plan = planOf(`kinetic_captions_${style.id}`, prevEnd, elements, placed.map((p) => Math.round(p.start * fps) - f0), frame);
  return { plan, start: f0 / fps, groups: placed, missing: [...missing] };
}
