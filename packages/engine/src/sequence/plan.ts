/**
 * Shot order: which shot follows which, and how long each holds, from what
 * crosses every cut (sequence/features.ts) and the goal of the edit.
 *
 *   continuity   a cut costs less when the action continues (the next shot
 *                starts where the last one was heading), the shape and
 *                layout carry (match on shape), the subject sits where the
 *                eye already is, the colour holds, the motion keeps its
 *                direction and, with shot embeddings (look), the next shot
 *                shows what the last one ended on; the next moment of the
 *                same source costs least
 *   duplicates   the same picture twice in a row costs a lot
 *   energy arc   shots are ranked by energy (motion, contrast) and pulled
 *                toward a curve: build, peak (build → peak → release,
 *                default), release, or flat (no pull)
 *   payoff       the strongest shot (interest and length) closes, held
 *   voice        a shot that says something in the voice-over starts where
 *                the voice says it (speechAt)
 *   slots        given slot lengths (beats from a brief), the weakest and
 *                duplicate shots are left out until the shots fit the slots,
 *                and no shot fills a slot longer than itself
 *
 * The order is a shortest path through the cut costs plus the position
 * terms, found from greedy starts and improved by moving runs of one to
 * three shots (or-opt, runs reversed too). Pure: numbers in, plan out.
 */

import { cosine, type Vector } from "../shots/vectors.js";
import { meanAbsDistance, shapeDistance, type Flow, type ShotFeatures } from "./features.js";

export const ENERGY_ARCS = ["build", "peak", "release", "flat"] as const;
export type EnergyArc = (typeof ENERGY_ARCS)[number];

export interface SequenceShotInput {
  features: ShotFeatures;
  /** How long the shot can hold, seconds. */
  seconds: number;
  /** A still image: it can hold any slot. */
  still?: boolean;
  /** The window of a source file the shot shows: windows of one file keep their order in it. */
  source?: { key: string; start: number; end: number };
  /** Seconds from the sequence start where this shot must start (its line in the voice-over). */
  speechAt?: number;
  /** Shot embeddings of its first and last moments (the host's shot model), when every shot has them. */
  look?: { head: Vector; tail: Vector };
}

export interface SequenceGoal {
  arc?: EnergyArc;
  /** Index of the shot that opens. */
  open?: number;
  /** Index of the shot that closes; null: no payoff hold; default: the strongest shot. */
  close?: number | null;
  /** Slot lengths, seconds, in timeline order. Default: every shot at its own length. */
  slots?: readonly number[];
  /** Weight of continuity against the arc, 0-2 (default 1). */
  continuity?: number;
}

export type CutReason = "next moment of the same source" | "action continues" | "same shape and layout" | "subject in place" | "colour carries" | "motion carries" | "looks alike";

export interface SequenceCut {
  /** Indices of the shots on either side. */
  from: number;
  to: number;
  /** How well the cut joins, 0-1 (0.5 = a typical cut between these shots). */
  match: number;
  reasons: CutReason[];
}

export interface SequencePlan {
  /** Shot indices in timeline order. */
  order: number[];
  /** Seconds each placed shot holds, in timeline order. */
  lengths: number[];
  /** Start of each placed shot, seconds from the sequence start. */
  starts: number[];
  cuts: SequenceCut[];
  dropped: { index: number; why: "near duplicate" | "weakest for the slots" }[];
  open: number;
  close: { index: number; why: "given" | "strongest shot" } | null;
  arc: EnergyArc;
  /** Energy rank of every shot, 0-1, by index. */
  energy: number[];
  /** Strength (interest and length), 0-1, by index. */
  strength: number[];
  /** Mean cut match of this order and of the order the shots were given in. */
  meanMatch: number;
  givenMatch: number;
  /** Placed shots that start more than a frame away from their speechAt, seconds off. */
  offSpeech: { index: number; seconds: number }[];
}

/**
 * Weights of the cut-cost parts, each part scaled by its median over all
 * pairs first. Look (1 - cosine of shot embeddings, tail to head), when the
 * shots carry them: on 10 re-edit bench bins it raises the editors'
 * neighbouring shots recovered from 32 % to 38 % and lowers the order's
 * Kendall tau from +0.07 to 0.00 (weight 2 does no better), so the tool
 * adds it only when asked or for match-cut chains.
 */
const W = { shape: 1, colour: 0.6, extrapolate: 0.6, focus: 0.3, flow: 0.3, look: 1 };
/** Normalised shape distance below which two frames are the same picture. */
const DUPLICATE = 0.06;
const DUPLICATE_COST = 4;
/** A window of a file followed by the next moment of it (within this many seconds), and by an earlier one. */
const SOURCE_GAP = 0.5;
const SOURCE_NEXT = -1.5;
const SOURCE_BACK = 1;
/** Weight of the energy pull, per shot. */
const ARC_WEIGHT = 1.2;
/** Per second a voice-synced shot starts away from its line (sync outweighs any cut), and per second a shot is shorter than its slot. */
const SPEECH_WEIGHT = 20;
const SHORT_WEIGHT = 20;
/** Greedy starts tried, and how far a run may move in one or-opt step on long sequences. */
const STARTS = 10;
const WINDOW = 14;
const MAX_SWEEPS = 60;

interface Parts {
  shape: number;
  colour: number;
  extrapolate: number;
  focus: number;
  flow: number;
  /** NaN without shot embeddings. */
  look: number;
}

function flowMismatch(a: Flow | null, b: Flow | null): number {
  if (!a || !b) return 0;
  const ma = Math.hypot(a.dx, a.dy);
  const mb = Math.hypot(b.dx, b.dy);
  // Under ~1 % of the frame a frame neither shot moves: no direction to keep.
  if (ma + mb < 0.01) return 0;
  return Math.hypot(a.dx - b.dx, a.dy - b.dy) / (ma + mb);
}

function rawParts(sa: SequenceShotInput, sb: SequenceShotInput): Parts {
  const a = sa.features;
  const b = sb.features;
  return {
    shape: shapeDistance(a.tail, b.head),
    colour: meanAbsDistance(a.tailColour, b.headColour),
    extrapolate: a.nextLuma ? meanAbsDistance(a.nextLuma, b.headLuma) : NaN,
    focus: Math.hypot(a.tailFocus.x - b.headFocus.x, a.tailFocus.y - b.headFocus.y),
    flow: flowMismatch(a.tailFlow, b.headFlow),
    look: sa.look && sb.look ? 1 - cosine(sa.look.tail, sb.look.head) : NaN,
  };
}

function median(xs: number[]): number {
  const s = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (s.length === 0) return 1;
  const m = s[Math.floor(s.length / 2)]!;
  return m > 1e-6 ? m : 1;
}

/** Rank of each value among the others, 0 (lowest) to 1 (highest); ties share the mean rank. */
export function ranks(values: readonly number[]): number[] {
  const n = values.length;
  if (n === 1) return [0.5];
  const idx = values.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && idx[j + 1]![0] === idx[i]![0]) j += 1;
    for (let k = i; k <= j; k += 1) out[idx[k]![1]] = (i + j) / 2 / (n - 1);
    i = j + 1;
  }
  return out;
}

/** Where the arc wants the energy at fraction `p` of the way through, 0-1. */
export function arcTarget(arc: EnergyArc, p: number): number {
  switch (arc) {
    case "build":
      return p;
    case "release":
      return 1 - p;
    case "peak":
      // Rise to the peak three quarters in, then let it go (but not to nothing).
      return p <= 0.75 ? 0.15 + (0.85 * p) / 0.75 : 1 - (0.5 * (p - 0.75)) / 0.25;
    case "flat":
      return 0.5;
  }
}

export interface CutMatrix {
  n: number;
  cost: Float64Array;
  parts: Parts[];
  scale: Parts;
  duplicate: Uint8Array;
}

/** Cost of every ordered pair of cuts (row = outgoing shot), with the scaled parts kept for the receipt. */
export function cutMatrix(shots: readonly SequenceShotInput[]): CutMatrix {
  const n = shots.length;
  const raw: Parts[] = [];
  // Look counts only when every shot has embeddings, so shots without them are not favoured.
  const looks = shots.every((s) => s.look);
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) raw.push(rawParts(shots[i]!, shots[j]!));
  const off = raw.filter((_, k) => Math.floor(k / n) !== k % n);
  const scale: Parts = {
    shape: median(off.map((p) => p.shape)),
    colour: median(off.map((p) => p.colour)),
    extrapolate: median(off.map((p) => p.extrapolate)),
    focus: median(off.map((p) => p.focus)),
    flow: median(off.map((p) => p.flow)),
    look: looks ? median(off.map((p) => p.look)) : NaN,
  };
  const cost = new Float64Array(n * n);
  const duplicate = new Uint8Array(n * n);
  const parts: Parts[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const r = raw[i * n + j]!;
      const p: Parts = {
        shape: r.shape / scale.shape,
        colour: r.colour / scale.colour,
        // A one-frame shot has no motion to extrapolate: its shape stands in.
        extrapolate: Number.isFinite(r.extrapolate) ? r.extrapolate / scale.extrapolate : r.shape / scale.shape,
        focus: r.focus / scale.focus,
        flow: r.flow / scale.flow,
        look: looks && scale.look > 0 ? r.look / scale.look : NaN,
      };
      parts.push(p);
      if (i === j) continue;
      let c = W.shape * p.shape + W.colour * p.colour + W.extrapolate * p.extrapolate + W.focus * p.focus + W.flow * p.flow + (Number.isFinite(p.look) ? W.look * p.look : 0);
      const a = shots[i]!;
      const b = shots[j]!;
      const sameSource = a.source && b.source && a.source.key === b.source.key;
      if (sameSource) {
        const gap = b.source!.start - a.source!.end;
        if (gap >= -1e-6 && gap <= SOURCE_GAP) c += SOURCE_NEXT;
        else if (b.source!.start < a.source!.start) c += SOURCE_BACK;
      }
      const fa = a.features;
      const fb = b.features;
      // The same picture twice: alike at the head and in the middle (not the next moment of one source).
      // Not by look: editors cut between shots that look this alike (a new angle on one scene), and a
      // duplicate cost on them pushes apart the very shots the look term joins (re-edit bench).
      if (!sameSource && a.speechAt === undefined && b.speechAt === undefined && shapeDistance(fa.head, fb.head) < DUPLICATE && shapeDistance(fa.middle, fb.middle) < DUPLICATE) {
        duplicate[i * n + j] = 1;
        c += DUPLICATE_COST;
      }
      cost[i * n + j] = c;
    }
  }
  return { n, cost, parts, scale, duplicate };
}

interface Problem {
  m: CutMatrix;
  shots: readonly SequenceShotInput[];
  energy: number[];
  arc: EnergyArc;
  continuity: number;
  slots: readonly number[] | null;
  openPin: number | null;
  closePin: number | null;
}

function lengthsOf(p: Problem, order: readonly number[]): number[] {
  return order.map((s, k) => (p.slots ? p.slots[k]! : p.shots[s]!.seconds));
}

function objective(p: Problem, order: readonly number[]): number {
  const n = order.length;
  const { cost } = p.m;
  let total = 0;
  for (let k = 0; k + 1 < n; k += 1) total += p.continuity * cost[order[k]! * p.m.n + order[k + 1]!]!;
  if (p.arc !== "flat") {
    for (let k = 0; k < n; k += 1) total += ARC_WEIGHT * (p.energy[order[k]!]! - arcTarget(p.arc, n === 1 ? 0.5 : k / (n - 1))) ** 2;
  }
  let t = 0;
  for (let k = 0; k < n; k += 1) {
    const shot = p.shots[order[k]!]!;
    const len = p.slots ? p.slots[k]! : shot.seconds;
    if (shot.speechAt !== undefined) total += SPEECH_WEIGHT * Math.abs(t - shot.speechAt);
    if (p.slots && !shot.still && shot.seconds + 1e-3 < len) total += SHORT_WEIGHT * (len - shot.seconds);
    t += len;
  }
  return total;
}

function greedy(p: Problem, items: readonly number[], start: number): number[] {
  const n = p.m.n;
  const left = new Set(items);
  left.delete(start);
  if (p.closePin !== null) left.delete(p.closePin);
  const out = [start];
  while (left.size > 0) {
    const last = out[out.length - 1]!;
    let best = -1;
    let bestCost = Infinity;
    for (const j of left) {
      const c = p.m.cost[last * n + j]!;
      if (c < bestCost) {
        bestCost = c;
        best = j;
      }
    }
    out.push(best);
    left.delete(best);
  }
  if (p.closePin !== null && start !== p.closePin) out.push(p.closePin);
  return out;
}

/** Move runs of 1-3 shots (reversed too) while the objective falls; pinned ends stay put. */
function improve(p: Problem, order: number[]): { order: number[]; value: number } {
  let best = order;
  let value = objective(p, best);
  const lo = p.openPin !== null ? 1 : 0;
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep += 1) {
    let moved = false;
    const hi = best.length - (p.closePin !== null ? 1 : 0);
    for (let len = 1; len <= 3; len += 1) {
      for (let i = lo; i + len <= hi; i += 1) {
        const run = best.slice(i, i + len);
        const rest = [...best.slice(0, i), ...best.slice(i + len)];
        const restHi = rest.length - (p.closePin !== null ? 1 : 0);
        const from = Math.max(lo, i - WINDOW);
        const to = Math.min(restHi, i + WINDOW);
        for (let j = from; j <= to; j += 1) {
          for (const flip of len > 1 ? [false, true] : [false]) {
            if (j === i && !flip) continue;
            const piece = flip ? [...run].reverse() : run;
            const next = [...rest.slice(0, j), ...piece, ...rest.slice(j)];
            const v = objective(p, next);
            if (v < value - 1e-9) {
              best = next;
              value = v;
              moved = true;
            }
          }
        }
        if (moved) break;
      }
      if (moved) break;
    }
    if (!moved) break;
  }
  return { order: best, value };
}

function strengthOf(shots: readonly SequenceShotInput[]): number[] {
  const interest = ranks(shots.map((s) => s.features.contrast + s.features.colourfulness));
  const length = ranks(shots.map((s) => s.seconds));
  return shots.map((_, i) => 0.5 * interest[i]! + 0.5 * length[i]!);
}

/** Which shots fill `slots`: duplicates go first (the weaker of the pair), then the weakest; pins stay. */
function chooseForSlots(m: CutMatrix, strength: readonly number[], keep: ReadonlySet<number>, slots: number): { items: number[]; dropped: SequencePlan["dropped"] } {
  const n = m.n;
  const items = new Set(Array.from({ length: n }, (_, i) => i));
  const dropped: SequencePlan["dropped"] = [];
  const weaker = (a: number, b: number) => (strength[a]! <= strength[b]! ? a : b);
  for (let i = 0; i < n && items.size > slots; i += 1) {
    for (let j = i + 1; j < n && items.size > slots; j += 1) {
      if (!items.has(i) || !items.has(j) || !(m.duplicate[i * n + j] || m.duplicate[j * n + i])) continue;
      const out = keep.has(weaker(i, j)) ? (weaker(i, j) === i ? j : i) : weaker(i, j);
      if (keep.has(out)) continue;
      items.delete(out);
      dropped.push({ index: out, why: "near duplicate" });
    }
  }
  const byWeak = [...items].filter((i) => !keep.has(i)).sort((a, b) => strength[a]! - strength[b]!);
  for (const i of byWeak) {
    if (items.size <= slots) break;
    items.delete(i);
    dropped.push({ index: i, why: "weakest for the slots" });
  }
  return { items: [...items].sort((a, b) => a - b), dropped };
}

const REASON_PARTS: [keyof Parts, CutReason][] = [
  ["extrapolate", "action continues"],
  ["shape", "same shape and layout"],
  ["focus", "subject in place"],
  ["colour", "colour carries"],
  ["flow", "motion carries"],
  ["look", "looks alike"],
];

function describeCut(m: CutMatrix, shots: readonly SequenceShotInput[], a: number, b: number, typical: number): SequenceCut {
  const parts = m.parts[a * m.n + b]!;
  const reasons: CutReason[] = [];
  const sa = shots[a]!.source;
  const sb = shots[b]!.source;
  if (sa && sb && sa.key === sb.key && sb.start - sa.end >= -1e-6 && sb.start - sa.end <= SOURCE_GAP) reasons.push("next moment of the same source");
  // A part at under 60 % of its median over all pairs is something this cut carries across.
  for (const [k, why] of REASON_PARTS) if (parts[k] < 0.6 && !(k === "flow" && parts.flow === 0)) reasons.push(why);
  const c = m.cost[a * m.n + b]!;
  return { from: a, to: b, match: Math.round(Math.max(0, Math.min(1, 1 - c / (2 * typical))) * 1000) / 1000, reasons };
}

function meanMatch(cuts: readonly SequenceCut[]): number {
  return cuts.length ? Math.round((cuts.reduce((s, c) => s + c.match, 0) / cuts.length) * 1000) / 1000 : 1;
}

/** Order (and with slots, choose and time) the shots. Throws only on invalid input; the tool checks first. */
export function planSequence(shots: readonly SequenceShotInput[], goal: SequenceGoal = {}): SequencePlan {
  const n = shots.length;
  if (n === 0) throw new Error("planSequence needs at least one shot");
  const inRange = (i: number | null | undefined) => i === undefined || i === null || (Number.isInteger(i) && i >= 0 && i < n);
  if (!inRange(goal.open) || !inRange(goal.close)) throw new Error("open/close must be shot indices");
  if (goal.slots && (goal.slots.length === 0 || goal.slots.length > n || goal.slots.some((s) => !(s > 0)))) throw new Error("slots must be 1..shots positive lengths");
  const m = cutMatrix(shots);
  const motion = ranks(shots.map((s) => s.features.motion));
  const contrast = ranks(shots.map((s) => s.features.contrast));
  const energy = shots.map((_, i) => Math.round((0.7 * motion[i]! + 0.3 * contrast[i]!) * 1000) / 1000);
  const strength = strengthOf(shots).map((v) => Math.round(v * 1000) / 1000);

  // The payoff: the strongest shot that is not voice-synced (a line has its own place) and does not open.
  let close: SequencePlan["close"] = null;
  if (goal.close !== null) {
    if (goal.close !== undefined) close = { index: goal.close, why: "given" };
    else if (n > 2) {
      const candidates = shots.map((_, i) => i).filter((i) => i !== goal.open && shots[i]!.speechAt === undefined);
      if (candidates.length) close = { index: candidates.reduce((a, b) => (strength[b]! > strength[a]! ? b : a)), why: "strongest shot" };
    }
  }
  const keep = new Set<number>([...(goal.open !== undefined ? [goal.open] : []), ...(goal.close != null ? [goal.close] : []), ...shots.flatMap((s, i) => (s.speechAt !== undefined ? [i] : []))]);
  if (goal.slots && keep.size > goal.slots.length) throw new Error("slots must be at least as many as the pinned shots (open, close, speechAt)");
  // The default payoff is a preference, not a pin: it holds only when a slot is left for it.
  if (close && close.why === "strongest shot" && !keep.has(close.index) && goal.slots && keep.size >= goal.slots.length) close = null;
  if (close) keep.add(close.index);
  const chosen = goal.slots && goal.slots.length < n ? chooseForSlots(m, strength, keep, goal.slots.length) : { items: shots.map((_, i) => i), dropped: [] };
  const problem: Problem = {
    m,
    shots,
    energy,
    arc: goal.arc ?? "peak",
    continuity: Math.max(0, Math.min(2, goal.continuity ?? 1)),
    slots: goal.slots ?? null,
    openPin: goal.open ?? null,
    closePin: close && chosen.items.includes(close.index) && chosen.items.length > 1 ? close.index : null,
  };
  const items = chosen.items;
  let starts: number[];
  if (problem.openPin !== null) starts = [problem.openPin];
  else {
    const free = items.filter((i) => i !== problem.closePin);
    // Spread the starts over the shots (the low-energy ones first: an arc opens low).
    const sorted = [...free].sort((a, b) => energy[a]! - energy[b]! || a - b);
    starts = sorted.length <= STARTS ? sorted : Array.from({ length: STARTS }, (_, k) => sorted[Math.floor((k * sorted.length) / STARTS)]!);
    if (starts.length === 0) starts = [items[0]!];
  }
  let best: { order: number[]; value: number } | null = null;
  for (const s of starts) {
    const tried = improve(problem, greedy(problem, items, s));
    if (!best || tried.value < best.value - 1e-9) best = tried;
  }
  const order = best!.order;
  const lengths = lengthsOf(problem, order).map((v) => Math.round(v * 1e6) / 1e6);
  const starts0: number[] = [];
  let t = 0;
  for (const len of lengths) {
    starts0.push(Math.round(t * 1e6) / 1e6);
    t += len;
  }
  const typical = median(Array.from(m.cost).filter((_, k) => Math.floor(k / n) !== k % n));
  const cuts = order.slice(1).map((b, k) => describeCut(m, shots, order[k]!, b, typical));
  const given = Array.from({ length: n - 1 }, (_, k) => describeCut(m, shots, k, k + 1, typical));
  const offSpeech = order.flatMap((s, k) => {
    const at = shots[s]!.speechAt;
    return at !== undefined && Math.abs(starts0[k]! - at) > 0.042 ? [{ index: s, seconds: Math.round((starts0[k]! - at) * 1000) / 1000 }] : [];
  });
  return {
    order,
    lengths,
    starts: starts0,
    cuts,
    dropped: chosen.dropped,
    open: order[0]!,
    close: problem.closePin !== null ? close : null,
    arc: problem.arc,
    energy,
    strength,
    meanMatch: meanMatch(cuts),
    givenMatch: meanMatch(given),
    offSpeech,
  };
}
