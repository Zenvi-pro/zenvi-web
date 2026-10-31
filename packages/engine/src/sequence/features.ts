/**
 * What a shot looks like where it can be cut: tiny frames of its first and
 * last moments (shape, layout, colour, where the picture is moving), how much
 * it moves overall (energy) and how much there is to look at (interest).
 * Pure numbers over small RGB frames, like matchcut/circles.ts; the frames
 * come from the host (`FrameHost.sampleFrames`, or rendered frames scaled
 * down by `thumbnail`).
 *
 * The bench that motivated this (zenvi-motion re-edit bench, 2026-10-28):
 * agents re-cutting a reference's own shots left them in bin order or worse
 * (Kendall tau -0.14 against the editor's order). A professional cut carries
 * something across most cuts: the action continues, the subject sits where
 * the last one did, or the colour holds. These features measure exactly what
 * crosses a cut, so the order can be chosen by it (sequence/plan.ts).
 */

import type { RgbaImage } from "../render/types.js";

/** Every shot is compared on frames of this size (aspect ignored: shots of one edit share a canvas). */
export const THUMB_W = 32;
export const THUMB_H = 18;
const PIXELS = THUMB_W * THUMB_H;
/** Colour is compared on a coarse grid of block means: framing moves a little across a match. */
const COLOUR_COLS = 4;
const COLOUR_ROWS = 3;
/** Largest global shift searched between consecutive frames, thumbnail pixels. */
const FLOW_RANGE = 3;

/**
 * Small RGB frames (rgb24, THUMB_W × THUMB_H) of one shot: its first and last
 * frames (two consecutive project frames each where the shot has them, for
 * the motion across the cut) and frames through the whole shot, `step`
 * project frames apart, for its energy.
 */
export interface ShotFrames {
  head: readonly Uint8Array[];
  tail: readonly Uint8Array[];
  body: readonly Uint8Array[];
  step: number;
}

export interface Flow {
  /** Global motion between the two frames, fraction of the frame per project frame (+x right, +y down). */
  dx: number;
  dy: number;
}

export interface ShotFeatures {
  /** Normalised luma (zero mean, unit RMS) of the first and last frames: shape and layout. */
  head: Float32Array;
  tail: Float32Array;
  /** Mean RGB of COLOUR_ROWS × COLOUR_COLS blocks, 0-1. */
  headColour: Float32Array;
  tailColour: Float32Array;
  /** Raw luma 0-1 of the first frame, and the frame after the last one extrapolated from the last two (null: one frame). */
  headLuma: Float32Array;
  nextLuma: Float32Array | null;
  /** Normalised luma of the middle frame: two shots alike here and at the head are the same picture twice. */
  middle: Float32Array;
  /** Motion at the start and the end of the shot (null: one frame). */
  headFlow: Flow | null;
  tailFlow: Flow | null;
  /** Where the eye goes on the last and first frame (saliency centroid, 0-1). */
  headFocus: { x: number; y: number };
  tailFocus: { x: number; y: number };
  /** Mean absolute luma change per project frame, 0-1. */
  motion: number;
  /** Luma standard deviation, 0-1. */
  contrast: number;
  /** Hasler-Süsstrunk colourfulness, 0-1-ish. */
  colourfulness: number;
}

/** Box-filter an RGBA image down to a THUMB_W × THUMB_H rgb24 frame (hosts without `sampleFrames`). */
export function thumbnail(image: RgbaImage): Uint8Array {
  const out = new Uint8Array(PIXELS * 3);
  for (let ty = 0; ty < THUMB_H; ty += 1) {
    const y0 = Math.floor((ty * image.height) / THUMB_H);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * image.height) / THUMB_H));
    for (let tx = 0; tx < THUMB_W; tx += 1) {
      const x0 = Math.floor((tx * image.width) / THUMB_W);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * image.width) / THUMB_W));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * image.width + x) * 4;
          r += image.data[i]!;
          g += image.data[i + 1]!;
          b += image.data[i + 2]!;
          n += 1;
        }
      }
      const o = (ty * THUMB_W + tx) * 3;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
    }
  }
  return out;
}

function luma(frame: Uint8Array): Float32Array {
  const out = new Float32Array(PIXELS);
  for (let i = 0; i < PIXELS; i += 1) out[i] = (0.299 * frame[3 * i]! + 0.587 * frame[3 * i + 1]! + 0.114 * frame[3 * i + 2]!) / 255;
  return out;
}

/** Zero mean, unit RMS; the floor keeps a flat frame (a black card) from blowing noise up. */
function normalised(l: Float32Array): Float32Array {
  let mean = 0;
  for (const v of l) mean += v;
  mean /= l.length;
  let ss = 0;
  for (const v of l) ss += (v - mean) ** 2;
  const rms = Math.sqrt(ss / l.length) + 0.03;
  return l.map((v) => (v - mean) / rms);
}

function colourBlocks(frame: Uint8Array): Float32Array {
  const out = new Float32Array(COLOUR_ROWS * COLOUR_COLS * 3);
  const bw = THUMB_W / COLOUR_COLS;
  const bh = THUMB_H / COLOUR_ROWS;
  for (let y = 0; y < THUMB_H; y += 1) {
    for (let x = 0; x < THUMB_W; x += 1) {
      const b = (Math.floor(y / bh) * COLOUR_COLS + Math.floor(x / bw)) * 3;
      for (let c = 0; c < 3; c += 1) out[b + c]! += frame[(y * THUMB_W + x) * 3 + c]! / 255 / (bw * bh);
    }
  }
  return out;
}

/** The shift (pixels) that best maps `a` onto `b`, by mean absolute difference over the overlap. */
function shift(a: Float32Array, b: Float32Array): { dx: number; dy: number } {
  let best = { dx: 0, dy: 0, err: Infinity };
  for (let dy = -FLOW_RANGE; dy <= FLOW_RANGE; dy += 1) {
    for (let dx = -FLOW_RANGE; dx <= FLOW_RANGE; dx += 1) {
      let err = 0;
      let n = 0;
      for (let y = Math.max(0, dy); y < Math.min(THUMB_H, THUMB_H + dy); y += 1) {
        for (let x = Math.max(0, dx); x < Math.min(THUMB_W, THUMB_W + dx); x += 1) {
          err += Math.abs(b[y * THUMB_W + x]! - a[(y - dy) * THUMB_W + (x - dx)]!);
          n += 1;
        }
      }
      err /= n;
      // Ties go to the smaller move: a still frame has no direction.
      if (err < best.err - 1e-6 || (Math.abs(err - best.err) <= 1e-6 && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) best = { dx, dy, err };
    }
  }
  return { dx: best.dx, dy: best.dy };
}

function flow(a: Float32Array, b: Float32Array): Flow {
  const s = shift(a, b);
  return { dx: s.dx / THUMB_W, dy: s.dy / THUMB_H };
}

/** Saliency centroid: pixels weighted by how far their colour is from the frame's mean colour. */
function focus(frame: Uint8Array): { x: number; y: number } {
  const mean = [0, 0, 0];
  for (let i = 0; i < PIXELS; i += 1) for (let c = 0; c < 3; c += 1) mean[c]! += frame[3 * i + c]! / PIXELS;
  let sw = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < PIXELS; i += 1) {
    const w = Math.abs(frame[3 * i]! - mean[0]!) + Math.abs(frame[3 * i + 1]! - mean[1]!) + Math.abs(frame[3 * i + 2]! - mean[2]!);
    sw += w;
    sx += w * ((i % THUMB_W) + 0.5);
    sy += w * (Math.floor(i / THUMB_W) + 0.5);
  }
  return sw > 0 ? { x: sx / sw / THUMB_W, y: sy / sw / THUMB_H } : { x: 0.5, y: 0.5 };
}

function colourfulness(frame: Uint8Array): number {
  let mrg = 0;
  let myb = 0;
  const rg = new Float32Array(PIXELS);
  const yb = new Float32Array(PIXELS);
  for (let i = 0; i < PIXELS; i += 1) {
    const r = frame[3 * i]! / 255;
    const g = frame[3 * i + 1]! / 255;
    const b = frame[3 * i + 2]! / 255;
    rg[i] = r - g;
    yb[i] = 0.5 * (r + g) - b;
    mrg += rg[i]!;
    myb += yb[i]!;
  }
  mrg /= PIXELS;
  myb /= PIXELS;
  let vrg = 0;
  let vyb = 0;
  for (let i = 0; i < PIXELS; i += 1) {
    vrg += (rg[i]! - mrg) ** 2;
    vyb += (yb[i]! - myb) ** 2;
  }
  return Math.sqrt(vrg / PIXELS + vyb / PIXELS) + 0.3 * Math.sqrt(mrg * mrg + myb * myb);
}

/** Features of one shot from its sampled frames (head and tail need at least one frame each). */
export function shotFeatures(shot: ShotFrames): ShotFeatures {
  const all = [...shot.head, ...shot.tail, ...shot.body];
  if (shot.head.length === 0 || shot.tail.length === 0) throw new Error("shotFeatures needs a head and a tail frame");
  for (const f of all) if (f.length !== PIXELS * 3) throw new Error(`shot frames must be ${THUMB_W}x${THUMB_H} rgb24`);
  const step = Math.max(1, shot.step);
  const head = shot.head.map(luma);
  const tail = shot.tail.map(luma);
  const body = shot.body.length > 0 ? shot.body.map(luma) : head;
  const first = head[0]!;
  const last = tail[tail.length - 1]!;
  // The frame after the last, extrapolated from the last change (one project frame).
  const before = tail.length > 1 ? tail[tail.length - 2]! : null;
  const nextLuma = before ? last.map((v, i) => Math.min(1, Math.max(0, 2 * v - before[i]!))) : null;
  let motion = 0;
  for (let k = 1; k < body.length; k += 1) {
    let d = 0;
    for (let i = 0; i < PIXELS; i += 1) d += Math.abs(body[k]![i]! - body[k - 1]![i]!);
    motion += d / PIXELS / step;
  }
  motion = body.length > 1 ? motion / (body.length - 1) : 0;
  const midFrame = shot.body.length > 0 ? shot.body[Math.floor(shot.body.length / 2)]! : shot.head[0]!;
  const mid = body[Math.floor(body.length / 2)]!;
  let mean = 0;
  for (const v of mid) mean += v;
  mean /= PIXELS;
  let ss = 0;
  for (const v of mid) ss += (v - mean) ** 2;
  return {
    head: normalised(first),
    tail: normalised(last),
    headColour: colourBlocks(shot.head[0]!),
    tailColour: colourBlocks(shot.tail[shot.tail.length - 1]!),
    headLuma: first,
    nextLuma,
    middle: normalised(mid),
    headFlow: head.length > 1 ? flow(head[0]!, head[1]!) : null,
    tailFlow: before ? flow(before, last) : null,
    headFocus: focus(shot.head[0]!),
    tailFocus: focus(shot.tail[shot.tail.length - 1]!),
    motion,
    contrast: Math.sqrt(ss / PIXELS),
    colourfulness: colourfulness(midFrame),
  };
}

/** Mean squared difference of two normalised luma frames, halved: 0 identical, ~1 unrelated, 2 inverted. */
export function shapeDistance(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += (a[i]! - b[i]!) ** 2;
  return s / a.length / 2;
}

/** Mean absolute difference, 0-1. */
export function meanAbsDistance(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += Math.abs(a[i]! - b[i]!);
  return s / a.length;
}
