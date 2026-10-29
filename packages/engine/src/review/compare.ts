/**
 * Watching two renders side by side and saying which is the better edit:
 * the judgment behind best-of-N (make several variants, keep the best).
 *
 * Pairwise beats scoring each render alone: single videos get generous,
 * compressed scores, and the bench's calibration (~/zenvi-motion/bench
 * README "Watch judge", 2026-10-28) found a degraded copy beat its original
 * 13 of 40 times scored alone but 1 of 40 side by side. The model favours
 * one slot, so every pair is judged twice with the order swapped and the
 * scores averaged; a winner both orders agree on is "agreed", otherwise the
 * mean scores decide.
 *
 * The host does the watching (`WatchHost.compare`, one order per call);
 * hosts that can only watch one file at a time are compared from two
 * separate watches (`method: "separate"`, the weaker signal).
 */

import {
  fixToolsFor,
  WATCH_DIMENSION_NAMES,
  WATCH_DIMENSIONS,
  type WatchCritique,
  type WatchDimension,
  type WatchRequest,
} from "./watch.js";

/** Longest render compared, seconds: two videos in one request, and a variant proxy is a draft of a short piece. */
export const COMPARE_MAX_SECONDS = 60;
/** Variants in one tournament at most: N-1 matches, two watches each. */
export const COMPARE_MAX_VARIANTS = 4;
/** Separate watches whose overall scores differ by less than this are a tie (they compress around 5-6). */
const SEPARATE_TIE = 0.5;
/** Fixes reported for the winner. */
const WINNER_FIXES = 3;
/** Bumped when the prompt or schema changes, so preference rows from different prompts can be told apart. */
export const COMPARE_PROMPT_VERSION = "zenvi-compare-1";

export type CompareSlot = "A" | "B";
type Scores = Record<WatchDimension, number | null>;

export interface CompareFix {
  video: CompareSlot;
  /** Seconds from the start of that video. */
  start: number;
  dimension: WatchDimension | "other";
  problem: string;
  fix: string;
}

/** One judgment with the two renders in one order: A is shown first. */
export interface CompareVerdict {
  model: string;
  /** Seconds of each video watched. */
  durations: { A: number; B: number };
  winner: CompareSlot | "tie";
  /** Two sentences on the deciding differences. */
  why: string;
  scores: { A: Scores; B: Scores };
  /** Up to three per video, most valuable first. */
  fixes: CompareFix[];
  usage: { inputTokens: number; outputTokens: number; credits?: number };
  via: "backend" | "gemini";
}

export type CompareRequest = Pick<WatchRequest, "brief" | "focus" | "signal">;

// ---------------------------------------------------------------------------
// Prompt and answer (the developer-key path)
// ---------------------------------------------------------------------------

export const COMPARE_SYSTEM_PROMPT =
  "You are a senior short-form video editor choosing which of two cuts to post. " +
  "You watch both videos fully and listen to both soundtracks before answering. You are " +
  "calibrated and blunt: 1-3 is amateur or slideshow-like, 4-6 is competent but generic, 7-8 " +
  "is what a working pro would post, 9-10 is reference-grade. Do not give two different " +
  "videos similar scores unless they really are similar, and do not favour a video for " +
  "being first or second. Score each dimension 1-10 for each video, or null when it does " +
  "not apply (no text on screen: typography is null). Then name the better edit, and for " +
  "each video the three fixes that would most improve it, each a concrete edit on the " +
  "timeline: what to change, where (seconds from the start of that video), and by how much. " +
  "Never suggest reshooting.";

const SCORES_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(WATCH_DIMENSION_NAMES.map((d) => [d, { type: "number", nullable: true }])),
  required: WATCH_DIMENSION_NAMES,
} as const;

/** Gemini `responseSchema` (OpenAPI subset). */
export const COMPARE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    A: SCORES_SCHEMA,
    B: SCORES_SCHEMA,
    winner: { type: "string", enum: ["A", "B", "tie"] },
    why: { type: "string" },
    fixes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          video: { type: "string", enum: ["A", "B"] },
          start: { type: "number" },
          dimension: { type: "string", enum: [...WATCH_DIMENSION_NAMES, "other"] },
          problem: { type: "string" },
          fix: { type: "string" },
        },
        required: ["video", "start", "dimension", "problem", "fix"],
      },
    },
  },
  required: ["A", "B", "winner", "why", "fixes"],
} as const;

export function compareUserText(durations: { A: number; B: number }, request: Omit<CompareRequest, "signal"> = {}): string {
  const lines = [
    `Video A is ${durations.A.toFixed(2)} s and video B is ${durations.B.toFixed(2)} s long; every time in your JSON is seconds from the start of the video it names.`,
    "Dimensions:",
    ...WATCH_DIMENSION_NAMES.map((d) => `- ${d}: ${WATCH_DIMENSIONS[d]}`),
    "Give three fixes for each video (six in all), most valuable first.",
  ];
  if (request.focus && request.focus.length > 0) lines.push(`Weigh these dimensions most: ${request.focus.join(", ")}.`);
  if (request.brief) lines.push(`What the editor was asked to make (both are attempts at it): ${request.brief}`);
  return lines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const round = (value: number, places: number): number => Math.round(value * 10 ** places) / 10 ** places;

function score(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? round(Math.min(Math.max(n, 1), 10), 1) : null;
}

function scoresOf(raw: unknown): Scores {
  const r = isRecord(raw) ? raw : {};
  return Object.fromEntries(WATCH_DIMENSION_NAMES.map((d) => [d, score(r[d])])) as Scores;
}

/** A verdict from the model's JSON: scores clamped, at most three fixes per video, times inside each video. */
export function normalizeComparison(raw: unknown, durations: { A: number; B: number }): Pick<CompareVerdict, "winner" | "why" | "scores" | "fixes"> {
  const r = isRecord(raw) ? raw : {};
  const fixes: CompareFix[] = [];
  const per = { A: 0, B: 0 };
  for (const item of Array.isArray(r.fixes) ? r.fixes : []) {
    if (!isRecord(item)) continue;
    const video = item.video === "A" || item.video === "B" ? item.video : null;
    const problem = String(item.problem ?? "").trim();
    const fix = String(item.fix ?? "").trim();
    if (!video || !problem || !fix || per[video] >= 3) continue;
    per[video] += 1;
    const start = Number(item.start);
    const dim = String(item.dimension ?? "").trim().toLowerCase();
    fixes.push({
      video,
      start: Number.isFinite(start) ? round(Math.min(Math.max(start, 0), durations[video]), 2) : 0,
      dimension: dim in WATCH_DIMENSIONS ? (dim as WatchDimension) : "other",
      problem,
      fix,
    });
  }
  const winner = r.winner === "A" || r.winner === "B" ? r.winner : "tie";
  return { winner, why: String(r.why ?? "").trim(), scores: { A: scoresOf(r.A), B: scoresOf(r.B) }, fixes };
}

// ---------------------------------------------------------------------------
// Both orders → one judgment
// ---------------------------------------------------------------------------

export type PairSide = "a" | "b";

export interface PairFix extends Omit<CompareFix, "video"> {
  tools: string[];
}

/** Two renders compared, with the slot bias cancelled. */
export interface PairJudgment {
  /** "pairwise": both in one watch, both orders; "separate": one watch each (hosts without `compare`). */
  method: "pairwise" | "separate";
  model: string;
  winner: PairSide;
  /**
   * How the winner was decided: both orders named it ("agreed"); the orders
   * disagreed or tied and the mean scores decided ("scores"); or the scores
   * tied too and the first render stays ("kept").
   */
  decidedBy: "agreed" | "scores" | "kept";
  /** Mean per dimension over the orders; null where no order scored it. */
  scores: Record<PairSide, Scores>;
  /** Mean of the scored dimensions. */
  overall: Record<PairSide, number | null>;
  /** overall.a - overall.b. */
  margin: number;
  /** The winner's fixes, most important first (both orders agree on these first). */
  fixes: PairFix[];
  why: string;
  /** Each order's own winner, in the order run (a first, then b first). */
  orders: Array<PairSide | "tie">;
  usage: { inputTokens: number; outputTokens: number; credits: number };
  via: "backend" | "gemini";
}

function meanScores(list: Scores[]): Scores {
  return Object.fromEntries(
    WATCH_DIMENSION_NAMES.map((d) => {
      const vals = list.map((s) => s[d]).filter((v): v is number => v !== null);
      return [d, vals.length > 0 ? round(vals.reduce((x, y) => x + y, 0) / vals.length, 2) : null];
    }),
  ) as Scores;
}

function overallOf(scores: Scores): number | null {
  const vals = Object.values(scores).filter((v): v is number => v !== null);
  return vals.length > 0 ? round(vals.reduce((x, y) => x + y, 0) / vals.length, 2) : null;
}

function decide(orders: Array<PairSide | "tie">, overall: Record<PairSide, number | null>, tieBelow: number): Pick<PairJudgment, "winner" | "decidedBy"> {
  const named = new Set(orders);
  if (named.size === 1 && !named.has("tie")) return { winner: orders[0] as PairSide, decidedBy: "agreed" };
  const margin = (overall.a ?? 0) - (overall.b ?? 0);
  if (Math.abs(margin) >= tieBelow && margin !== 0) return { winner: margin > 0 ? "a" : "b", decidedBy: "scores" };
  return { winner: "a", decidedBy: "kept" };
}

/** Fixes both orders gave first, then the rest in their own order, without near-duplicates (same dimension within 1 s). */
function mergeFixes(lists: Array<Omit<CompareFix, "video">[]>): PairFix[] {
  const out: PairFix[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i += 1) {
    for (const list of lists) {
      const fix = list[i];
      if (!fix) continue;
      if (out.some((f) => f.dimension === fix.dimension && Math.abs(f.start - fix.start) < 1)) continue;
      out.push({ ...fix, tools: fixToolsFor({ ...fix }) });
    }
  }
  return out.slice(0, WINNER_FIXES);
}

function sumUsage(list: Array<{ inputTokens: number; outputTokens: number; credits?: number }>): PairJudgment["usage"] {
  const total = { inputTokens: 0, outputTokens: 0, credits: 0 };
  for (const u of list) {
    total.inputTokens += u.inputTokens;
    total.outputTokens += u.outputTokens;
    total.credits += u.credits ?? 0;
  }
  return total;
}

/**
 * Judge `ab` (a shown first) and `ba` (b shown first) as one: scores
 * averaged per dimension, the winner both orders name, else the higher mean.
 */
export function combineOrders(ab: CompareVerdict, ba: CompareVerdict): PairJudgment {
  const sideOf = (verdict: CompareVerdict, aFirst: boolean): PairSide | "tie" =>
    verdict.winner === "tie" ? "tie" : (verdict.winner === "A") === aFirst ? "a" : "b";
  const orders = [sideOf(ab, true), sideOf(ba, false)];
  const scores = { a: meanScores([ab.scores.A, ba.scores.B]), b: meanScores([ab.scores.B, ba.scores.A]) };
  const overall = { a: overallOf(scores.a), b: overallOf(scores.b) };
  const { winner, decidedBy } = decide(orders, overall, Number.EPSILON);
  const slotIn = (aFirst: boolean): CompareSlot => ((winner === "a") === aFirst ? "A" : "B");
  const fixesFor = (verdict: CompareVerdict, aFirst: boolean) =>
    verdict.fixes.filter((f) => f.video === slotIn(aFirst)).map(({ video: _video, ...fix }) => fix);
  return {
    method: "pairwise",
    model: ab.model,
    winner,
    decidedBy,
    scores,
    overall,
    margin: round((overall.a ?? 0) - (overall.b ?? 0), 2),
    fixes: mergeFixes([fixesFor(ab, true), fixesFor(ba, false)]),
    why: ([ab, ba].find((_, i) => orders[i] === winner) ?? ab).why,
    orders,
    usage: sumUsage([ab.usage, ba.usage]),
    via: ab.via,
  };
}

/** Two separate critiques as a judgment: a tie under half a point keeps a. */
export function combineSeparate(a: WatchCritique, b: WatchCritique): PairJudgment {
  const overall = { a: a.overall, b: b.overall };
  const { winner, decidedBy } = decide(["tie"], overall, SEPARATE_TIE);
  const won = winner === "a" ? a : b;
  return {
    method: "separate",
    model: a.model,
    winner,
    decidedBy,
    scores: { a: a.scores, b: b.scores },
    overall,
    margin: round((overall.a ?? 0) - (overall.b ?? 0), 2),
    fixes: mergeFixes([won.issues.map((i) => ({ start: i.start, dimension: i.dimension, problem: i.problem, fix: i.fix }))]),
    why: won.verdict,
    orders: ["tie"],
    usage: sumUsage([a.usage, b.usage]),
    via: a.via,
  };
}

// ---------------------------------------------------------------------------
// Taste data
// ---------------------------------------------------------------------------

/**
 * One line of `preferences.jsonl` (the future taste model's training set):
 * one judgment of one order, `a` shown first (on the left for a person).
 * The bench (`~/zenvi-motion/bench/watch_judge.py`) and the owner's rating
 * page write the same shape.
 */
export interface PreferenceRecord {
  v: 1;
  at: string;
  /** Who asked: "zenvi-cli", "bench:<name>", "owner". */
  source: string;
  /** The judge: a model id, or "owner". */
  judge: string;
  prompt: string;
  brief_sha256: string | null;
  a: { sha256: string; path: string; seconds: number };
  b: { sha256: string; path: string; seconds: number };
  winner: PairSide | "tie";
  scores: { a: Scores; b: Scores } | null;
}
