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
 *              With scenes (space.ts) the head comes from the shot's matte
 *              when no avoid box is given, and among the spots clear of it
 *              the one over the calmest, darkest, emptiest picture wins.
 *              Emphasis words behind the subject ("emphasis") are set on
 *              their own across the top of the head, the head hiding the
 *              lower third of their letters; the group's other words are
 *              placed clear of the head and of them.
 *   tracks     word-by-word styles put word n of every group on track n (the
 *              words of a group overlap in time); karaoke puts the line on
 *              one track and the moving marker on the next. Letters that
 *              move one by one (styles.ts LetterMotion stagger) take a track
 *              each above the words; words behind the subject take the
 *              lowest tracks (`under` of them), under the cut-out.
 */

import { defaultEffectJson } from "../effects/registry.js";
import { makeKeyframePoint } from "../keyframe/edit.js";
import { Interpolation, type Effect } from "../model/types.js";
import { planOf } from "../motion/keyframes.js";
import { Drawing } from "../motion/svg.js";
import type { Element, Key, MotionFrame, MotionPlan, Pose } from "../motion/types.js";
import type { FontLibrary } from "../typography/library.js";
import { inkBox, outlineCommands, typeset, type Box, type TextBlock } from "../typography/typeset.js";
import { boxCost, type CaptionScene } from "./space.js";
import { CAPTION_STYLES, DEFAULT_ACCENT, DEFAULT_INK, type CaptionFace, type CaptionMotion, type CaptionStyle, type CaptionStyleId } from "./styles.js";
import { groupWords, pickEmphasis, type CaptionGroup, type CaptionWord } from "./words.js";

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
  /**
   * The speaker is cut out above captions: true, every group goes high,
   * where its words pass behind the head; "emphasis", only the emphasis
   * words go behind (across the top of the head), the others stay in front.
   */
  behind?: boolean | "emphasis";
  /** What the shots under the captions show, by timeline time: the head (when `avoid` is empty) and where the picture is calm. */
  scenes?: readonly CaptionScene[];
  /** Groups to show instead of grouping the words by speech (a title: all its words at once). */
  groups?: readonly CaptionGroup[];
  /** Words whose letters move (scramble, stagger): the emphasis words (captions) or all (a title). Default emphasis. */
  letterWords?: "emphasis" | "all";
  /** Type size × the style's (emphasis words keep their ratio to the connectors). Default 1. */
  size?: number;
  /** Vertical centre of every group, share of the frame height, instead of the style's spots (still inside the safe area, still off the avoid boxes). */
  y?: number;
  /** Entrance and exit instead of the style's own (styles.ts CAPTION_ANIMATIONS). */
  motion?: CaptionMotion;
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
  /** Plan tracks (the lowest) that go under the subject's cut-out: all of them when every word is behind it. */
  under: number;
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

/** Cost a spot's later rank adds (0-1 scale of `cost`): a calmer spot must beat a preferred one by this much. */
const RANK_COST = 0.04;

/**
 * Where a `w` × `h` block goes: the first clear candidate centre, else the
 * least overlapping one. With `cost` (the picture under a box, 0-1), the
 * cheapest of the candidates that overlap least, each later candidate a
 * little dearer.
 */
function place(w: number, h: number, centres: readonly { x: number; y: number }[], safe: { left: number; top: number; right: number; bottom: number }, avoid: readonly Box[], cost?: (box: Box) => number): Placement {
  const all = centres.map((c, rank) => {
    const x = Math.min(Math.max(c.x - w / 2, safe.left), Math.max(safe.left, safe.right - w));
    const y = Math.min(Math.max(c.y - h / 2, safe.top), Math.max(safe.top, safe.bottom - h));
    const box = { x, y, width: w, height: h };
    return { box, overlap: avoid.reduce((s, a) => s + overlapArea(box, a), 0), rank };
  });
  const least = Math.min(...all.map((p) => p.overlap));
  if (!cost) return all.find((p) => p.overlap === 0) ?? all.find((p) => p.overlap === least)!;
  const level = all.filter((p) => p.overlap <= least + 1e-6);
  const price = (p: (typeof all)[number]) => cost(p.box) + RANK_COST * p.rank;
  return level.reduce((a, b) => (price(b) < price(a) - 1e-9 ? b : a));
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
 * safe area's bottom line never enters through the platform band). `turn`
 * is the start pose's rotation (degrees; the rest pose carries its own).
 * A motion with no entrance length (typewriter) just appears.
 */
function keysFor(from: number, to: number, rest: Pose, style: CaptionStyle, fps: number, H: number, entrance = true, travel = 1, turn = rest.rotation): Key[] {
  const m = style.motion;
  const last = to - 1;
  const e = Math.max(1, Math.round(m.enter * fps));
  const x = Math.round(m.exit * fps);
  if (last - from < 2) return [{ frame: from, pose: rest, ease: "linear" }];
  const keys: Key[] = [];
  if (entrance && m.enter > 0 && last - from > e) {
    keys.push({ frame: from, pose: { ...rest, alpha: 0, s: m.fromScale, y: rest.y + travel * m.fromY * H, rotation: turn }, ease: "linear" });
    keys.push({ frame: from + e, pose: rest, ease: m.enterEase });
  } else keys.push({ frame: from, pose: rest, ease: "linear" });
  const settled = keys[keys.length - 1]!.frame;
  if (x > 0 && last - x > settled) {
    keys.push({ frame: last - x, pose: rest, ease: "smooth" });
    keys.push({ frame: last, pose: { ...rest, alpha: 0, s: m.toScale }, ease: m.exitEase });
  }
  return keys;
}

/** Deterministic 0-1 numbers (mulberry32): a scramble looks the same every run. */
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

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghjkmnpqrstuvwxyz";
const DIGITS = "0123456789";

/** `text` with its letters from `resolved` on replaced by random ones of the same kind (case, digit). */
export function scrambled(text: string, resolved: number, next: () => number): string {
  return [...text]
    .map((ch, i) => {
      if (i < resolved) return ch;
      const set = /\p{Lu}/u.test(ch) ? UPPER : /\p{Ll}/u.test(ch) ? LOWER : /\p{Nd}/u.test(ch) ? DIGITS : "";
      return set ? set[Math.floor(next() * set.length)]! : ch;
    })
    .join("");
}

/**
 * A Crop effect typing a drawing letter by letter: its right margin steps
 * (constant keys) to each letter's right edge, `step` frames apart from the
 * clip's first frame; the last step shows all of it. `edges` are shares of
 * the drawing's width.
 */
function typingCrop(edges: readonly number[], step: number): Omit<Effect, "id"> {
  const { id: _id, ...json } = defaultEffectJson("Crop", "TEMPLATE00");
  const points = edges.map((edge, i) => makeKeyframePoint(1 + i * step, i === edges.length - 1 ? 0 : Math.round((1 - edge) * 1e6) / 1e6, Interpolation.CONSTANT));
  return { ...json, right: { Points: points } } as Omit<Effect, "id">;
}

/** Track numbers before compaction: words behind the cut-out lowest, then their letters, then the words in front, then theirs. */
const TRACK = { under: 0, underLetters: 100, front: 500, frontLetters: 1000 } as const;

/** Ink and advance box of one letter of a set word, in the word's block px. */
function glyphBounds(b: TextBlock, g: TextBlock["glyphs"][number]): Box {
  const ink = inkBox([g]);
  const x0 = Math.min(g.x, ink?.x ?? g.x);
  const x1 = Math.max(g.x + g.advance, ink ? ink.x + ink.width : g.x + g.advance);
  const y0 = Math.min(b.ascent - b.capHeight, ink?.y ?? b.ascent);
  const y1 = Math.max(b.ascent, ink ? ink.y + ink.height : b.ascent);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function buildKineticCaptions(input: KineticCaptionInput): KineticCaptionPlan {
  const style: CaptionStyle = input.motion ? { ...CAPTION_STYLES[input.style], motion: input.motion } : CAPTION_STYLES[input.style];
  const { frame, lib } = input;
  const fps = frame.fps;
  const layout = { W: frame.width, H: frame.height };
  const { W, H } = layout;
  const safe = captionSafe(frame);
  // Px per style px: the frame's short side / 1080, times the size asked for.
  const u = (Math.min(W, H) / 1080) * (input.size ?? 1);
  const colours = { ink: input.ink ?? DEFAULT_INK, accent: input.accent ?? DEFAULT_ACCENT[input.style] };
  const words = input.words.filter((w) => w.text.trim());
  if (words.length === 0) throw new Error("no words to caption");
  const groups = input.groups ? [...input.groups] : groupWords(words, style.groups);
  const emphasis = pickEmphasis(words, groups, input.emphasis, style.perGroup, style.floor);
  const margin = MARGIN * W;
  const toBox = (a: AvoidBox): Box => ({ x: (a.x - a.w / 2) * W - margin, y: (a.y - a.h / 2) * H - margin, width: a.w * W + 2 * margin, height: a.h * H + 2 * margin });
  const given = input.avoid.map(toBox);
  const scenes = [...(input.scenes ?? [])].sort((a, b) => a.from - b.from);
  const sceneAt = (t: number): CaptionScene | undefined =>
    scenes.find((s) => t >= s.from - 1e-6 && t < s.to) ?? scenes.reduce<CaptionScene | undefined>((a, s) => (!a || Math.min(Math.abs(s.from - t), Math.abs(s.to - t)) < Math.min(Math.abs(a.from - t), Math.abs(a.to - t)) ? s : a), undefined);
  const portrait = H > W * 1.05;
  const own = portrait ? style.spots.portrait : style.spots.landscape;
  const behindAll = input.behind === true;
  const spots = (behindAll ? [BEHIND[portrait ? "portrait" : "landscape"]] : input.y !== undefined ? [{ x: own[0]!.x, y: input.y }] : own).map((s) => ({ x: s.x * W, y: s.y * H }));
  const safeWidth = safe.right - safe.left;
  const letters = style.motion.letters;
  const tilt = style.motion.tilt;
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
    const scene = sceneAt(g.start);
    // The head: the first box given, else the shot's (from its matte).
    const subject = input.avoid[0] ?? scene?.head;
    const avoid = given.length > 0 ? given : scene?.head ? [toBox(scene.head)] : [];
    const cost = scene?.cost ? (box: Box) => boxCost(scene.cost!, box, W, H) : undefined;
    const behindEmphasis = input.behind === "emphasis" && style.reveal === "word" && items.some((i) => i.emphasis);

    // Lay out and place: split sits either side of the subject, the others at the first clear spot.
    let block: GroupBlock | null = null;
    let overlap = 0;
    const offsets = new Map<SetWord, { dx: number; dy: number }>();
    const around = (b: { width: number; height: number }) => {
      if (!subject) return [];
      const sx = subject.x * W;
      const sy = subject.y * H;
      const hw = (subject.w * W) / 2 + margin;
      const hh = (subject.h * H) / 2 + margin;
      return [{ x: sx - hw - b.width / 2, y: sy }, { x: sx + hw + b.width / 2, y: sy }, { x: sx, y: sy + hh + b.height / 2 }, { x: sx, y: sy - hh - b.height / 2 }];
    };
    if (behindEmphasis) {
      // The emphasis words alone across the top of the head (the head hides their lower third), the rest clear of both.
      const eb = layoutGroup(lib, style, items.filter((i) => i.emphasis), u, 1, style.measure * safeWidth);
      const headX = subject ? subject.x * W : W / 2;
      const headTop = subject ? (subject.y - subject.h / 2) * H : BEHIND[portrait ? "portrait" : "landscape"].y * H + 0.15 * eb.height;
      const ex = Math.min(Math.max(headX - eb.width / 2, safe.left), Math.max(safe.left, safe.right - eb.width));
      const ey = Math.min(Math.max(headTop - 0.65 * eb.height, safe.top), Math.max(safe.top, safe.bottom - eb.height));
      for (const w of eb.words) offsets.set(w, { dx: ex, dy: ey });
      const rest = items.filter((i) => !i.emphasis);
      let cb: GroupBlock = { words: [], width: 0, height: 0 };
      if (rest.length > 0) {
        const eBox = { x: ex - margin, y: ey - margin, width: eb.width + 2 * margin, height: eb.height + 2 * margin };
        let best: { b: GroupBlock; box: Box; overlap: number } | null = null;
        for (const scale of [1, 0.85, 0.7]) {
          const b = layoutGroup(lib, style, rest, u, scale, style.measure * safeWidth);
          const centres = [...spots, { x: ex + eb.width / 2, y: ey - margin - b.height / 2 }, { x: ex + eb.width / 2, y: ey + eb.height + margin + b.height / 2 }, ...around(b)];
          const p = place(b.width, b.height, centres, safe, [...avoid, eBox], cost);
          if (!best || p.overlap < best.overlap) best = { b, box: p.box, overlap: p.overlap };
          if (p.overlap === 0) break;
        }
        cb = best!.b;
        overlap = best!.overlap;
        for (const w of cb.words) offsets.set(w, { dx: best!.box.x, dy: best!.box.y });
      }
      block = { words: [...eb.words, ...cb.words].sort((a, b) => a.index - b.index), width: Math.max(eb.width, cb.width), height: eb.height + cb.height };
    } else {
      for (const scale of [1, 0.85, 0.7]) {
        const b = layoutGroup(lib, style, items, u, scale, style.measure * safeWidth);
        if (style.arrangement === "split") {
          const sb = subject ? { x: (subject.x - subject.w / 2) * W, y: (subject.y - subject.h / 2) * H, w: subject.w * W, h: subject.h * H } : { x: W * 0.35, y: H * 0.3, w: W * 0.3, h: H * 0.3 };
          const firstLine = b.words.filter((w) => w.baseline === b.words[0]!.baseline);
          const restLine = b.words.filter((w) => w.baseline !== b.words[0]!.baseline);
          const lw = Math.max(...firstLine.map((w) => w.x + w.block.width)) - Math.min(...firstLine.map((w) => w.x));
          const rw = restLine.length > 0 ? Math.max(...restLine.map((w) => w.x + w.block.width)) - Math.min(...restLine.map((w) => w.x)) : 0;
          const fits = sb.x - margin - lw >= safe.left && sb.x + sb.w + margin + rw <= safe.right;
          if (fits || scale === 0.7) {
            const cy = Math.min(Math.max(sb.y + sb.h * 0.5, safe.top + b.height), safe.bottom - b.height);
            const lineH = firstLine[0]!.block.capHeight;
            const left = { x: Math.max(safe.left, sb.x - margin - lw), y: cy - lineH / 2, width: lw, height: lineH };
            const right = { x: Math.min(safe.right - rw, sb.x + sb.w + margin), y: cy - lineH / 2, width: rw, height: lineH };
            block = b;
            overlap = avoid.reduce((s, a) => s + overlapArea(left, a) + (rw > 0 ? overlapArea(right, a) : 0), 0);
            for (const [line, half] of [[firstLine, left], [restLine, right]] as const) {
              const lx = Math.min(...line.map((x) => x.x));
              for (const w of line) offsets.set(w, { dx: half.x - lx, dy: half.y + half.height - w.baseline });
            }
            break;
          }
          continue;
        }
        const p = place(b.width, b.height, [...spots, ...around(b)], safe, avoid, cost);
        if (!block || p.overlap < overlap) {
          block = b;
          overlap = p.overlap;
          offsets.clear();
          for (const w of b.words) offsets.set(w, { dx: p.box.x, dy: p.box.y });
        }
        if (p.overlap === 0) break;
      }
    }
    const b = block!;
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
    const ink = boxesAt((w) => offsets.get(w)!).box;
    const shiftX = ink.x < safe.left ? safe.left - ink.x : ink.x + ink.width > safe.right ? Math.max(safe.left - ink.x, safe.right - ink.x - ink.width) : 0;
    const shiftY = ink.y < safe.top ? safe.top - ink.y : ink.y + ink.height > safe.bottom ? Math.max(safe.top - ink.y, safe.bottom - ink.y - ink.height) : 0;
    const offsetOf = (w: SetWord): { dx: number; dy: number } => {
      const o = offsets.get(w)!;
      return { dx: o.dx + shiftX, dy: o.dy + shiftY };
    };
    const groupBox = boxesAt(offsetOf);
    const travel = groupBox.box.y + groupBox.box.height + style.motion.fromY * H > safe.bottom ? -1 : 1;
    const wordStart = (w: SetWord) => Math.min(to - 1, Math.max(from, frameOf(words[w.index]!.start) - f0));
    placed.push({
      text: items.map((i) => i.text).join(" "),
      start: (f0 + from) / fps,
      stop: (f0 + to) / fps,
      box: groupBox.box,
      overlap,
      said: [words[g.first]!.start, words[g.end - 1]!.start],
      sources: [...new Set(words.slice(g.first, g.end).flatMap((w) => (w.source === undefined ? [] : [w.source])))],
      words: b.words.map((w, j) => ({
        text: w.text,
        emphasis: w.emphasis,
        start: (f0 + (style.reveal === "word" ? wordStart(w) : from)) / fps,
        box: groupBox.boxes[j]!,
      })),
    });

    const pad = Math.max(...b.words.map((w) => w.block.style.size)) * 0.3;
    /** A drawing of `sw` (its `bounds` in its own block px) placed at `o`, with its keys. */
    const drawn = (sw: SetWord, bounds: Box, o: { dx: number; dy: number }, name: string, track: number, start: number, end: number, opts: { marker?: boolean; entrance?: boolean; rest?: number; turn?: number; effects?: Omit<Effect, "id">[] } = {}): Element => {
      const wb = { x: o.dx + sw.x + bounds.x, y: o.dy + sw.baseline - sw.block.ascent + bounds.y, width: bounds.width, height: bounds.height };
      const left = wb.x - o.dx - pad;
      const top = wb.y - o.dy - pad;
      const width = wb.width + 2 * pad;
      const height = wb.height + 2 * pad;
      const rest: Pose = { x: wb.x + wb.width / 2, y: wb.y + wb.height / 2, s: 1, alpha: 1, rotation: opts.rest ?? 0 };
      return {
        name,
        track,
        from: start,
        to: end,
        source: { kind: "svg", name, width, height, cx: width / 2, cy: height / 2, draw: (k) => drawWords({ words: [sw], x: left, y: top }, width, height, k, colours, style, opts.marker ?? false, u) },
        keys: keysFor(start, end, rest, style, fps, H, opts.entrance ?? true, travel, opts.turn ?? rest.rotation),
        ...(opts.effects ? { effects: opts.effects } : {}),
      };
    };
    /** Rotation at rest and at the start of a word's entrance (tilt): emphasis words stay turned, connectors settle level; signs alternate. */
    const turnOf = (w: SetWord): { rest: number; turn: number } => {
      if (!tilt) return { rest: 0, turn: 0 };
      const sign = w.index % 2 === 0 ? -1 : 1;
      return w.emphasis ? { rest: sign * tilt.rest, turn: sign * tilt.from } : { rest: 0, turn: sign * tilt.from * 0.5 };
    };
    /** The clips of one word: the word, typed, scrambled into, or letter by letter. */
    const wordElements = (w: SetWord, j: number, start: number, end: number, under: boolean): Element[] => {
      const o = offsetOf(w);
      const name = `g${gi}w${j}`;
      const track = (under ? TRACK.under : TRACK.front) + j;
      const turn = turnOf(w);
      const moves = letters && (letters.kind === "type" || input.letterWords === "all" || w.emphasis) ? letters : undefined;
      const span = end - start;
      const glyphs = w.block.glyphs.filter((x) => x.commands.length > 0);
      if (!moves || glyphs.length < 2) return [drawn(w, wordBounds(w.block), o, name, track, start, end, turn)];
      const step = Math.max(1, Math.round(moves.step * fps));
      if (moves.kind === "type") {
        // Typing takes at most 60 % of the word's time on screen: longer words type faster, a frame a letter at most.
        const steps = Math.max(1, Math.min(glyphs.length, Math.floor(span * 0.6)));
        const every = Math.max(1, Math.min(step, Math.floor((span * 0.6) / steps)));
        const bounds = wordBounds(w.block);
        // The drawing starts `pad` left of the word's bounds (as `drawn` makes it): a letter's right edge as a share of it.
        const width = bounds.width + 2 * pad;
        const edges = Array.from({ length: steps }, (_, i) => {
          const g = glyphs[Math.ceil(((i + 1) * glyphs.length) / steps) - 1]!;
          return (pad - bounds.x + g.x + g.advance) / width;
        });
        return [drawn(w, bounds, o, name, track, start, end, { ...turn, effects: [typingCrop(edges, every)] })];
      }
      if (moves.kind === "scramble") {
        let count = moves.steps;
        while (count > 0 && count * step > span - 3) count -= 1;
        const text = w.block.glyphs.map((x) => x.char).join("");
        const next = random(w.index * 7919 + 17);
        const out: Element[] = [];
        for (let k = 0; k < count; k += 1) {
          const face = { ...w.face, transform: "none" as const };
          const sb = setWord(lib, scrambled(text, Math.floor((text.length * k) / count), next), face, w.block.style.size);
          const sw: SetWord = { ...w, face, block: sb, x: w.x + (w.block.width - sb.width) / 2 };
          out.push(drawn(sw, wordBounds(sb), o, `${name}s${k}`, track, start + k * step, start + (k + 1) * step, { ...turn, entrance: k === 0 }));
        }
        out.push(drawn(w, wordBounds(w.block), o, name, track, start + count * step, end, { ...turn, entrance: count === 0 }));
        return out;
      }
      // Stagger: a clip per letter on tracks of their own, each entering `step` after the one before.
      const every = Math.max(1, Math.min(step, Math.floor((span * 0.5) / glyphs.length)));
      return glyphs.map((gl, i) => {
        const sw: SetWord = { ...w, block: { ...w.block, glyphs: [gl] } };
        const at = Math.min(end - 3, start + i * every);
        return drawn(sw, glyphBounds(w.block, gl), o, `${name}l${i}`, (under ? TRACK.underLetters : TRACK.frontLetters) + i, Math.max(start, at), end, turn);
      });
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
        track: TRACK.front,
        from,
        to,
        source: { kind: "svg", name, width, height, cx: width / 2, cy: height / 2, draw: (k) => drawWords({ words: b.words, x: left, y: top }, width, height, k, colours, style, false, u) },
        keys: keysFor(from, to, { x: gb.x + gb.width / 2, y: gb.y + gb.height / 2, s: 1, alpha: 1, rotation: 0 }, style, fps, H, true, travel, tilt ? -tilt.from * 0.5 : 0),
      });
      if (style.marker) {
        b.words.forEach((w, j) => {
          const start = wordStart(w);
          const next = b.words[j + 1];
          // The last marker leaves when the line starts to: it must not outstay it.
          const lineExit = to - 1 - Math.round(style.motion.exit * fps);
          const end = next ? Math.min(to, Math.max(start + 1, frameOf(words[next.index]!.start) - f0)) : Math.max(start + 1, Math.min(to, lineExit));
          if (end > start) elements.push(drawn(w, wordBounds(w.block), offsetOf(w), `g${gi}m${j}`, TRACK.front + 1, start, end, { marker: true, entrance: j !== 0 }));
        });
      }
    } else {
      b.words.forEach((w, j) => elements.push(...wordElements(w, j, wordStart(w), to, behindEmphasis && w.emphasis)));
    }
  });

  const plan = planOf(`kinetic_captions_${style.id}`, prevEnd, elements, placed.map((p) => Math.round(p.start * fps) - f0), frame);
  const under = behindAll ? plan.tracks : new Set(elements.filter((e) => e.track < TRACK.front).map((e) => e.track)).size;
  return { plan, start: f0 / fps, groups: placed, missing: [...missing], under };
}
