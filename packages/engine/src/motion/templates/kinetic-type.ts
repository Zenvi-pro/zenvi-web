/**
 * kinetic_type: a headline that lands one word per beat, each word popping
 * in. `*` in the text stands for an image tile: a word made of `*` is a
 * word-sized tile, a `*` inside a word replaces a letter ("BL**M"). Tiles are
 * the given files, cropped to the tile's shape and rounded. Optional: a
 * highlighter swiped behind one word (`highlight`), a small tag that pops in
 * after the last word (`tag`).
 *
 * Layout without metrics: the text between tiles is one `<text>` laid out by
 * the host's own font, its words revealed by making the others transparent;
 * text next to a tile is anchored away from it (text-anchor end / start), so
 * a wider fallback font moves a line's ragged edge but never runs text into
 * a tile. Every word is drawn in two clips, a cumulative one and the popping
 * newest word, both with the whole block's geometry.
 */

import { cropToAspect, cued, drawing, enter, key, mediaCard, pose } from "../elements.js";
import type { Drawing, TextRun } from "../svg.js";
import { textWidth } from "../text.js";
import { refuse, type TemplateInput, type TemplateOutput, type TemplateSpec } from "../template.js";
import { tagElement } from "./end-card.js";
import type { Element, MotionMedia } from "../types.js";

const TILE = "*";
const MAX_WORDS = 12;

/** Relative luminance of #rrggbb, 0..1. */
function luminance(hex: string): number {
  const c = (i: number) => Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
  return 0.2126 * c(0) + 0.7152 * c(1) + 0.0722 * c(2);
}
const STYLE = { font: "sans" as const, bold: true, tracking: -0.025 };

/** A piece of a word: text, or an image tile (letter- or word-sized). */
type Piece = { kind: "text"; text: string; word: number } | { kind: "tile"; word: number; wide: boolean; index: number };

/** A line: its words' pieces and its width at size 1. */
interface Line {
  words: Piece[][];
  width: number;
}

interface Laid {
  lines: Line[];
  size: number;
}

const SPACE = textWidth(" ", { ...STYLE, size: 1 });
/** Gap on each side of a letter tile inside a word, × size. */
const TILE_GAP = 0.06;

/** Widths at size 1. */
function pieceWidth(p: Piece): number {
  if (p.kind === "tile") return p.wide ? 1.5 : 0.82;
  return textWidth(p.text, { ...STYLE, size: 1 });
}

/** The pieces of each word: text runs and tiles. */
function wordPieces(words: readonly string[]): Piece[][] {
  let tiles = 0;
  return words.map((word, w) => {
    if ([...word].every((c) => c === TILE)) return [...word].map(() => ({ kind: "tile" as const, word: w, wide: true, index: tiles++ }));
    const out: Piece[] = [];
    for (const part of word.split(/(\*)/).filter(Boolean)) {
      if (part === TILE) out.push({ kind: "tile", word: w, wide: false, index: tiles++ });
      else out.push({ kind: "text", text: part, word: w });
    }
    return out;
  });
}

/**
 * The space before piece `pi` of word `wi` on a line, × size: a word space
 * between words, a small gap beside a letter tile inside a word.
 */
function gapBefore(words: readonly Piece[][], wi: number, pi: number): number {
  if (pi === 0) return wi === 0 ? 0 : SPACE;
  const p = words[wi]![pi]!;
  const prev = words[wi]![pi - 1]!;
  return p.kind === "tile" || prev.kind === "tile" ? TILE_GAP : 0;
}

function lineWidth(words: readonly Piece[][]): number {
  let width = 0;
  words.forEach((pieces, wi) => pieces.forEach((p, pi) => (width += gapBefore(words, wi, pi) + pieceWidth(p))));
  return width;
}

/** Words into `n` lines whose widest line is as narrow as it can be (every split tried: headlines are short). */
function breakLines(words: readonly Piece[][], n: number): Piece[][][] {
  let best: { lines: Piece[][][]; widest: number } | null = null;
  const split = (from: number, left: number, acc: Piece[][][]): void => {
    if (left === 1) {
      const lines = [...acc, words.slice(from)];
      const widest = Math.max(...lines.map(lineWidth));
      if (!best || widest < best.widest - 1e-9) best = { lines, widest };
      return;
    }
    for (let end = from + 1; end <= words.length - (left - 1); end += 1) split(end, left - 1, [...acc, words.slice(from, end)]);
  };
  split(0, Math.min(n, words.length), []);
  return best!.lines;
}

function layoutWords(words: readonly Piece[][], maxW: number, maxH: number, maxSize: number, maxLines: number): Laid {
  let best: Laid = { lines: [], size: 0 };
  for (let n = 1; n <= Math.min(maxLines, words.length); n += 1) {
    const lines = breakLines(words, n);
    const widest = Math.max(...lines.map(lineWidth));
    const size = Math.floor(Math.min(maxSize, maxW / widest, maxH / lines.length));
    // Each line more only for clearly bigger type (a headline reads best in few lines).
    if (size > best.size * 1.3 ** (n - best.lines.length)) best = { lines: lines.map((l) => ({ words: l, width: lineWidth(l) })), size };
  }
  return best;
}

export const kineticType: TemplateSpec = {
  id: "kinetic_type",
  summary:
    "A big grotesk headline lands one word per beat, each word popping in; * in the text becomes an image tile (a word or a letter replaced by footage or a photo); optional highlighter swipe behind a word and a small tag after the last word.",
  reads: "text (the headline; * = image tile), file_ids (tile media, used in turn), highlight (word index), tag, align (left | center), position (top | center | bottom)",
  media: "optional",
  beats: (content) => Math.min(MAX_WORDS, (content.text ?? "").split(/\s+/).filter(Boolean).length) + 2,
  build(input: TemplateInput): TemplateOutput {
    const { content, palette, layout, frames, beats, media, frame } = input;
    const { W, H, u, m, portrait } = layout;
    const words = (content.text ?? "").split(/\s+/).filter(Boolean);
    if (words.length === 0) refuse("kinetic_type needs text: the headline");
    if (words.length > MAX_WORDS) refuse(`kinetic_type lands at most ${MAX_WORDS} words; shorten the headline`);
    const pieces = wordPieces(words);
    const tileCount = pieces.flat().filter((p) => p.kind === "tile").length;
    const files = content.fileIds ?? [];
    if (tileCount > 0 && files.length === 0) refuse("kinetic_type: each * in the text is an image tile; give file_ids for them");
    if (tileCount > 4) refuse("kinetic_type shows at most 4 image tiles");
    if (content.highlight !== undefined && content.highlight >= words.length) refuse(`kinetic_type: highlight is a word index, 0 to ${words.length - 1}`);

    const align = content.align ?? (palette.name === "editorial" ? "left" : "center");
    const left = m * 1.3;
    const maxW = W - 2 * left;
    const laid = layoutWords(pieces, maxW / 1.04, H * (portrait ? 0.42 : 0.56), Math.round((portrait ? 210 : 200) * u), portrait ? 4 : 3);
    const S = laid.size;
    const lead = S * 1.0;
    const blockH = laid.lines.length * lead;
    const position = content.position ?? "center";
    const top = position === "top" ? H * (portrait ? 0.12 : 0.13) : position === "bottom" ? H * (portrait ? 0.8 : 0.86) - blockH : (H - blockH) / 2;
    const capH = S * 0.72;
    const tileH = S * 0.78;

    // Place every piece: tiles at estimated x; the text between tiles is one segment, anchored to
    // the tile beside it (end before a tile, start after one, middle between two) so it never runs into one.
    interface Segment {
      runs: { text: string; word: number }[];
      x: number;
      anchor: "start" | "middle" | "end";
      baseline: number;
    }
    const segments: Segment[] = [];
    const tiles: { word: number; index: number; x: number; y: number; w: number; h: number }[] = [];
    const wordBoxes = new Map<number, { left: number; right: number; baseline: number }>();
    laid.lines.forEach((line, li) => {
      const baseline = top + li * lead + capH + (lead - capH) / 2 - S * 0.02;
      let x = align === "left" ? left : (W - line.width * S) / 2;
      let run: { text: string; word: number }[] = [];
      let runStart = x;
      /** Where text after the last tile may start (null: no tile before it on this line). */
      let afterTile: number | null = null;
      const flush = (beforeTile: number | null) => {
        if (run.length > 0) {
          const anchor = afterTile !== null && beforeTile !== null ? "middle" : beforeTile !== null ? "end" : "start";
          const ax = anchor === "middle" ? (afterTile! + beforeTile!) / 2 : anchor === "end" ? beforeTile! : (afterTile ?? runStart);
          segments.push({ runs: run, x: ax, anchor, baseline });
        }
        run = [];
      };
      line.words.forEach((pieces, wi) => {
        pieces.forEach((p, pi) => {
          const gap = gapBefore(line.words, wi, pi) * S;
          const w = pieceWidth(p) * S;
          if (p.kind === "tile") {
            flush(x);
            x += gap;
            tiles.push({ word: p.word, index: p.index, x: x + w / 2, y: baseline - capH / 2, w, h: tileH });
            x += w;
            // The next piece follows a small gap inside this word, a word space after it.
            afterTile = x + (pi + 1 < pieces.length ? TILE_GAP : SPACE) * S;
          } else {
            if (run.length === 0) runStart = x + gap;
            // A word space rides at the end of the word before it: a span holding only a space is
            // collapsed differently by different renderers (and between the two clips of a word).
            else if (gap > 0) run[run.length - 1] = { ...run[run.length - 1]!, text: `${run[run.length - 1]!.text} ` };
            x += gap;
            run.push({ text: p.text, word: p.word });
            x += w;
          }
          const box = wordBoxes.get(p.word);
          wordBoxes.set(p.word, { left: Math.min(box?.left ?? Infinity, x - w), right: Math.max(box?.right ?? -Infinity, x), baseline });
        });
      });
      flush(null);
    });

    // Drawings span the block; each clip draws the words it shows.
    const pad = S * 0.3;
    const blockLeft = Math.min(...segments.map((s) => s.x), ...tiles.map((t) => t.x - t.w / 2), left) - S;
    const blockRight = Math.max(...segments.map((s) => s.x), ...tiles.map((t) => t.x + t.w / 2), W - left) + S;
    const bx = Math.max(0, blockLeft - pad);
    const by = Math.max(0, top - pad);
    const bw = Math.min(W, blockRight + pad) - bx;
    const bh = Math.min(H, top + blockH + pad) - by;
    const paintWords = (shown: (word: number) => boolean) => (d: Drawing) => {
      for (const seg of segments) {
        if (!seg.runs.some((r) => shown(r.word))) continue;
        const runs: TextRun[] = seg.runs.map((r) => (shown(r.word) ? { text: r.text } : { text: r.text, opacity: 0 }));
        d.text(seg.x - bx, seg.baseline - by, runs, { size: S, ...STYLE, fill: palette.ink, anchor: seg.anchor });
      }
    };

    const elements: Element[] = [];
    const enters = beats.entrances(words.length, frames, 8);
    words.forEach((_, j) => {
      const from = enters[j]!;
      const to = j + 1 < words.length ? enters[j + 1]! : frames;
      if (from >= frames || to <= from) return;
      if (j > 0) elements.push(drawing(`type-words-${j}`, 2, from, to, { width: bw, height: bh }, paintWords((w) => w < j), [key(from, pose(bx + bw / 2, by + bh / 2))]));
      const box = wordBoxes.get(j);
      const centre = box ? { x: (box.left + box.right) / 2, y: box.baseline - capH / 2 } : { x: bx + bw / 2, y: by + bh / 2 };
      elements.push(
        drawing(`type-word-${j + 1}`, 3, from, to, { width: bw, height: bh, cx: centre.x - bx, cy: centre.y - by }, paintWords((w) => w === j), enter(pose(centre.x, centre.y), from, { s: 1.22, frames: 6, ease: "out_strong" })),
      );
    });

    // Tiles, popping in with their word.
    tiles.forEach((t, i) => {
      const file = files[t.index % files.length]!;
      const m0 = media.get(file) as MotionMedia;
      const from = enters[t.word]!;
      if (from >= frames) return;
      elements.push(mediaCard(`type-tile-${i + 1}`, 4 + i, from, frames, m0, frame.fps, { width: t.w, radius: t.h * 0.16, crop: cropToAspect(m0, t.w / t.h) }, enter(pose(t.x, t.y), from, { s: 0.55, frames: 9, ease: "out_back" })));
    });

    // The highlighter behind its word (a light second colour), or a bold underline (a dark one).
    if (content.highlight !== undefined) {
      const box = wordBoxes.get(content.highlight)!;
      const at = enters[content.highlight]! + 2;
      if (at < frames) {
        const light = luminance(palette.second) > 0.55;
        const mw = box.right - box.left + (light ? S * 0.24 : 0);
        const mh = light ? S * 0.46 : S * 0.1;
        const x0 = box.left - (light ? S * 0.12 : 0);
        const y = light ? box.baseline - S * 0.18 : box.baseline + S * 0.13;
        elements.push(
          cued(drawing("type-highlight", light ? 0 : 9, at, frames, { width: mw, height: mh, cx: 0, cy: mh / 2 }, (d) => d.rect(0, 0, mw, mh, { fill: palette.second, rx: light ? mh * 0.1 : 0 }), [
            key(at, pose(x0, y, { sx: 0 })),
            key(Math.min(frames - 1, at + 9), pose(x0, y), "out"),
          ]), enters[content.highlight]!),
        );
      }
    }

    // The tag, after the last word.
    const cues = [...enters];
    if (content.tag?.trim()) {
      const tagAt = beats.frame(beats.beatAfter(enters[enters.length - 1]!));
      if (tagAt + 6 < frames) {
        const size = Math.round(Math.max(20, S * 0.2));
        const tagW = textWidth(content.tag.trim().toUpperCase(), { size, font: "mono", tracking: 0.06 }) + size * 1.5;
        const x = align === "left" ? left + tagW / 2 : W / 2;
        const y = top - size * 1.6;
        elements.push(tagElement("type-tag", 8, tagAt, frames, content.tag.trim(), x, y, size, palette.accent, palette.accentInk, (rest) => enter(rest, tagAt, { s: 0.5, frames: 8, ease: "out_back" })));
        cues.push(tagAt);
      }
    }
    return { elements, cues };
  },
};
