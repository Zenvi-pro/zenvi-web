/**
 * Word wheel: lines of type on a turning drum (a slot reel, a word
 * flipper). The drum steps from one word to the next with a snap that
 * overshoots and settles; each line sits where the drum's angle puts it,
 * squashed by the angle's cosine, dimmer and blurred (a keyframed Blur)
 * as it turns away. Every line is its own clip moved by keyframes.
 */

import { defaultEffectJson } from "../../effects/registry.js";
import type { Effect } from "../../model/types.js";
import { commandList } from "../../typography/path-data.js";
import { easeHandles, keyframeThrough, planOf } from "../keyframes.js";
import { key, pose } from "../elements.js";
import { Drawing } from "../svg.js";
import type { Element, Key } from "../types.js";
import { fitSize, framesOf, inked, moved, refuseBlock, shortSide, type TypeBlockBase, type TypeBlockOutput } from "./common.js";

export interface WheelOptions extends TypeBlockBase {
  words: readonly string[];
  /** First frame of each step after the first word (words.length - 1 frames, increasing). */
  steps: readonly number[];
  ink: string;
  /** Centre, frame px. */
  x: number;
  y: number;
  size?: number;
}

/** Degrees between neighbouring lines on the drum. */
const PITCH = 30;
/** Past this angle a line has turned out of sight. */
const VISIBLE = 80;

/** The out-back ease (keyframes.ts handles) as a function of 0-1, for sampling the snap. */
function outBack(u: number): number {
  const h = easeHandles("out_back")!;
  // A cubic bezier with handles h, solved for x = u by bisection.
  const bez = (a: number, b: number, t: number) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (bez(h[0], h[2], mid) < u) lo = mid;
    else hi = mid;
  }
  return bez(h[1], h[3], (lo + hi) / 2);
}

export function buildWheel(o: WheelOptions): TypeBlockOutput {
  const { frame } = o;
  const fps = frame.fps;
  const n = o.words.length;
  if (n < 2) refuseBlock("wheel needs at least 2 words");
  if (o.steps.length !== n - 1) throw new Error("wheel: one step per word after the first");
  const turn = Math.max(2, framesOf(0.32, fps));
  if (o.steps.some((f, i) => f < 1 || f + turn > o.frames || (i > 0 && f < o.steps[i - 1]! + turn))) refuseBlock("wheel's steps need 0.32 s each to turn, inside the block");
  // One size for every line: the longest sets it.
  const longest = o.words.reduce((a, b) => (b.length > a.length ? b : a));
  const sized = fitSize(o, longest, frame.width * 0.8, shortSide(frame) * 0.3, o.size ?? shortSide(frame) * 0.2, { lines: 1 });
  const em = sized.style.size;
  const radius = (sized.capHeight * 1.9) / Math.sin((PITCH * Math.PI) / 180);
  const missing = new Set<string>(sized.missing);

  // The drum's position (in words) at every frame: steps snap from one word to the next.
  const at = (f: number): number => {
    let c = 0;
    for (const s of o.steps) {
      if (f >= s + turn) c += 1;
      else if (f > s) c += outBack((f - s) / turn);
    }
    return c;
  };
  const moving = (f: number) => o.steps.some((s) => f > s && f < s + turn);
  const elements: Element[] = [];
  o.words.forEach((word, i) => {
    const block = fitSize(o, word, frame.width * 0.9, shortSide(frame) * 0.5, em, { lines: 1 });
    block.missing.forEach((m) => missing.add(m));
    const glyphs = inked(block.glyphs);
    if (glyphs.length === 0) return;
    const pad = 4;
    const width = Math.ceil(block.width + 2 * pad);
    const height = Math.ceil(block.height + 2 * pad);
    const shapes = commandList(moved(glyphs, pad, pad));
    const angle = (f: number) => (i - at(f)) * PITCH;
    const seen = (f: number) => Math.abs(angle(f)) < VISIBLE;
    let from = -1;
    let to = -1;
    for (let f = 0; f < o.frames; f += 1) {
      if (!seen(f)) continue;
      if (from < 0) from = f;
      to = f + 1;
    }
    if (from < 0) return;
    const keys: Key[] = [];
    const blur: [number, number][] = [];
    for (let f = from; f < to; f += 1) {
      // Keys on every turning frame and at the ends of each hold.
      if (!moving(f) && f !== from && f !== to - 1 && !moving(f - 1) && !moving(f + 1)) continue;
      const a = (angle(f) * Math.PI) / 180;
      const cos = Math.max(0.02, Math.cos(a));
      keys.push(key(f, pose(o.x, o.y + radius * Math.sin(a), { sy: cos, alpha: Math.max(0, Math.min(1, cos ** 3 * (0.6 + 0.4 * Math.max(0, 1 - Math.abs(angle(f)) / PITCH)))) }), "linear"));
      blur.push([f - from + 1, Math.round(Math.min(1, Math.abs(Math.sin(a)) * 1.6) * em * 0.04 * 10) / 10]);
    }
    const effects: Omit<Effect, "id">[] = [];
    if (blur.some(([, r]) => r > 0)) {
      const { id: _id, ...json } = defaultEffectJson("Blur", "TEMPLATE00");
      const radii = keyframeThrough(blur.map(([f]) => f), blur.map(([, r]) => r), blur.map(() => "linear"));
      effects.push({ ...json, horizontal_radius: keyframeThrough([1], [0], ["linear"]), vertical_radius: radii, iterations: keyframeThrough([1], [2], ["linear"]) } as Omit<Effect, "id">);
    }
    elements.push({
      name: `line-${i}`,
      track: i,
      from,
      to,
      source: { kind: "svg", name: `line-${i}`, width, height, cx: width / 2, cy: height / 2, draw: (k) => new Drawing(width, height, k).path(shapes, { fill: o.ink }) },
      keys,
      effects,
    });
  });
  const plan = planOf("type_wheel", o.frames, elements, [0, ...o.steps], frame);
  return { plan, masks: [], hits: [...o.steps.map((s) => s + Math.round(turn * 0.6))], missing: [...missing], warnings: [] };
}
