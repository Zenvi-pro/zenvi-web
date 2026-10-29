/**
 * An explainer led by its voice-over (the documentary and video-essay
 * references): the picture is B-roll from start to end, a shot changing on
 * the keyword that names the next picture or at a pause, never sooner than
 * a viewer can read it nor later than it goes stale; chapter cards sit in
 * the pauses nearest to where each chapter should start; spoken numbers
 * become data slots (a counter) unless the caller placed their own.
 */

import { bareWord, type CaptionWord } from "../captions/words.js";
import type { KeywordHit } from "./keywords.js";

export interface ExplainerShot {
  fileId: string;
  start: number;
  end: number;
  /** Why the shot starts here: on its keyword, at a pause, on a word, or because the last one ran long. */
  cue: "start" | "keyword" | "pause" | "word" | "hold";
  keyword?: string;
}

export interface ChapterSlot {
  title: string;
  /** Timeline seconds the card starts (in a pause when there is one near). */
  at: number;
}

export interface NumberSlot {
  /** Index of the word that says the number. */
  word: number;
  /** The digits ("2400", "3.5"). */
  value: string;
  prefix: string;
  suffix: string;
  at: number;
}

/** How long a shot holds, seconds: a documentary cuts on the phrases, an essay lets a picture breathe. */
export const EXPLAINER_PACES = {
  documentary: { min: 0.6, max: 1.6 },
  essay: { min: 2, max: 4.5 },
} as const;
export type ExplainerPace = keyof typeof EXPLAINER_PACES;

/** Pauses between words: [end of the word before, start of the next], longest first. */
export function pauses(words: readonly CaptionWord[], min = 0.3): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i < words.length; i += 1) if (words[i]!.start - words[i - 1]!.end >= min) out.push([words[i - 1]!.end, words[i]!.start]);
  return out;
}

/**
 * The B-roll cut: keyword hits put their picture on their word; between
 * them the unmatched pictures take turns, cutting at the pause nearest the
 * middle of the allowed shot length, else on the word start nearest it (a
 * cut on a word lands with the voice), else at the longest hold.
 */
export function planExplainerShots(duration: number, words: readonly CaptionWord[], hits: readonly KeywordHit[], fill: readonly string[], fps: number, pace: ExplainerPace): ExplainerShot[] {
  const { min: minShot, max: maxShot } = EXPLAINER_PACES[pace];
  const snap = (t: number) => Math.round(t * fps) / fps;
  const gaps = pauses(words).map(([a, b]) => (a + b) / 2);
  const starts = words.map((w) => w.start);
  const anchors = hits.filter((h) => h.start >= minShot * 0.5 && h.start <= duration - minShot * 0.5);
  const shots: ExplainerShot[] = [];
  let fillAt = 0;
  const nextFill = () => (fill.length > 0 ? fill[fillAt++ % fill.length]! : anchors[0]?.fileId ?? "");
  let at = 0;
  let cue: ExplainerShot["cue"] = "start";
  let current = anchors.length > 0 && anchors[0]!.start < minShot ? anchors[0]!.fileId : nextFill();
  let keyword: string | undefined;
  for (let guard = 0; guard < 2000 && at < duration - 1e-6; guard += 1) {
    const hit = anchors.find((h) => h.start >= at + minShot - 1e-6);
    let end: number;
    let nextCue: ExplainerShot["cue"];
    if (hit && hit.start <= at + maxShot) {
      end = hit.start;
      nextCue = "keyword";
    } else {
      const lo = at + minShot;
      const hi = Math.min(duration, at + maxShot);
      const mid = (lo + hi) / 2;
      const nearest = (ts: readonly number[]) => ts.filter((g) => g >= lo && g <= hi).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
      const pause = nearest(gaps);
      const word = pause === undefined ? nearest(starts) : undefined;
      end = pause ?? word ?? hi;
      nextCue = pause !== undefined ? "pause" : word !== undefined ? "word" : "hold";
    }
    end = snap(Math.min(duration, end));
    // A last sliver joins the shot before it.
    if (duration - end < minShot * 0.6) end = snap(duration);
    shots.push({ fileId: current, start: snap(at), end, cue, ...(keyword ? { keyword } : {}) });
    at = end;
    cue = nextCue;
    keyword = nextCue === "keyword" ? hit!.text : undefined;
    current = nextCue === "keyword" ? hit!.fileId : nextFill();
    // The same picture twice in a row is no cut: take the next one.
    if (current === shots[shots.length - 1]!.fileId && fill.length > 1) current = nextFill();
  }
  return shots;
}

/**
 * Chapter cards: chapter i of n starts at the pause nearest i/n of the way;
 * the first at the first pause after `after` (the hook's end), and none
 * before it.
 */
export function planChapters(titles: readonly string[], words: readonly CaptionWord[], duration: number, after = 0): ChapterSlot[] {
  const gaps = pauses(words, 0.25).filter(([a]) => a >= after);
  const n = titles.length;
  const used = new Set<number>();
  return titles.map((title, i) => {
    const target = i === 0 ? Math.max(after, Math.min(duration * 0.1, 4)) : Math.max(after, (duration * i) / n);
    let best = -1;
    gaps.forEach(([a], j) => {
      if (used.has(j) || a < 1) return;
      if (best < 0 || Math.abs(a - target) < Math.abs(gaps[best]![0] - target)) best = j;
    });
    if (best >= 0 && Math.abs(gaps[best]![0] - target) < duration / (2 * n)) {
      used.add(best);
      return { title, at: gaps[best]![0] };
    }
    return { title, at: target };
  });
}

const PERCENT = new Set(["percent", "per", "%"]);
const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** A number said in words ("forty", "forty-five", "ninety nine") at `i`: its value and how many words it took, or null. */
function spokenNumber(words: readonly CaptionWord[], i: number): { value: number; used: number } | null {
  const at = (k: number) => (words[k] ? words[k]!.text.toLowerCase().replace(/[^a-z-]/g, "") : "");
  const [first, ...rest] = at(i).split("-");
  const unit = (w: string | undefined) => (w ? UNITS.indexOf(w) : -1);
  const tens = TENS.indexOf(first ?? "");
  if (tens >= 2) {
    const inline = unit(rest[0]);
    if (inline > 0 && inline < 10) return { value: tens * 10 + inline, used: 1 };
    const next = unit(at(i + 1));
    return next > 0 && next < 10 ? { value: tens * 10 + next, used: 2 } : { value: tens * 10, used: 1 };
  }
  const u = unit(first);
  return u >= 10 ? { value: u, used: 1 } : null;
}

/**
 * Spoken numbers worth a counter, at least `spacing` apart, at most `max`:
 * a digit group (with %, k, m or x, or "percent" after it; a plain number
 * from 10, never a year), or a number said in words followed by "percent".
 */
export function numberSlots(words: readonly CaptionWord[], max = 2, spacing = 6): NumberSlot[] {
  const out: NumberSlot[] = [];
  words.forEach((w, i) => {
    if (out.some((s) => Math.abs(s.at - w.start) < spacing)) return;
    const m = /^([$€£]?)(\d[\d,.]*)(%|k|m|x)?$/i.exec(w.text.replace(/[^\p{L}\p{N}%$€£.,]/gu, "").replace(/[.,]$/, ""));
    if (m) {
      const digits = m[2]!.replace(/,/g, "");
      if (/^(19|20)\d\d$/.test(digits)) return; // a year is a date, not a stat
      const after = words[i + 1] ? bareWord(words[i + 1]!.text) : "";
      const suffix = m[3] ?? (PERCENT.has(after) ? "%" : "");
      if (!suffix && Number(digits) < 10) return;
      out.push({ word: i, value: digits, prefix: m[1]!, suffix, at: w.start });
      return;
    }
    const said = spokenNumber(words, i);
    if (said && PERCENT.has(words[i + said.used] ? bareWord(words[i + said.used]!.text) : "")) out.push({ word: i, value: String(said.value), prefix: "", suffix: "%", at: w.start });
  });
  return out.slice(0, max);
}
