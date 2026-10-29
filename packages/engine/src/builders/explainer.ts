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
  /** Why the shot starts here: on its keyword, at a pause, or because the last one ran long. */
  cue: "start" | "keyword" | "pause" | "hold";
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

const MIN_SHOT = 2;
const MAX_SHOT = 4.5;

/** Pauses between words: [end of the word before, start of the next], longest first. */
export function pauses(words: readonly CaptionWord[], min = 0.3): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i < words.length; i += 1) if (words[i]!.start - words[i - 1]!.end >= min) out.push([words[i - 1]!.end, words[i]!.start]);
  return out;
}

/**
 * The B-roll cut: keyword hits put their picture on their word; between
 * them the unmatched pictures take turns, cutting at the pause nearest the
 * middle of the allowed shot length, or at MAX_SHOT when there is none.
 */
export function planExplainerShots(duration: number, words: readonly CaptionWord[], hits: readonly KeywordHit[], fill: readonly string[], fps: number): ExplainerShot[] {
  const snap = (t: number) => Math.round(t * fps) / fps;
  const gaps = pauses(words).map(([a, b]) => (a + b) / 2);
  const anchors = hits.filter((h) => h.start >= MIN_SHOT * 0.5 && h.start <= duration - MIN_SHOT * 0.5);
  const shots: ExplainerShot[] = [];
  let fillAt = 0;
  const nextFill = () => (fill.length > 0 ? fill[fillAt++ % fill.length]! : anchors[0]?.fileId ?? "");
  let at = 0;
  let cue: ExplainerShot["cue"] = "start";
  let current = anchors.length > 0 && anchors[0]!.start < MIN_SHOT ? anchors[0]!.fileId : nextFill();
  let keyword: string | undefined;
  for (let guard = 0; guard < 2000 && at < duration - 1e-6; guard += 1) {
    const hit = anchors.find((h) => h.start >= at + MIN_SHOT - 1e-6);
    let end: number;
    let nextCue: ExplainerShot["cue"];
    if (hit && hit.start <= at + MAX_SHOT) {
      end = hit.start;
      nextCue = "keyword";
    } else {
      const lo = at + MIN_SHOT;
      const hi = Math.min(duration, at + MAX_SHOT);
      const mid = (lo + hi) / 2;
      const pause = gaps.filter((g) => g >= lo && g <= hi).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
      end = pause ?? hi;
      nextCue = pause !== undefined ? "pause" : "hold";
    }
    end = snap(Math.min(duration, end));
    // A last sliver joins the shot before it.
    if (duration - end < MIN_SHOT * 0.6) end = snap(duration);
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

/** Chapter cards: chapter i of n starts at the pause nearest i/n of the way (the first after the opening sentence). */
export function planChapters(titles: readonly string[], words: readonly CaptionWord[], duration: number): ChapterSlot[] {
  const gaps = pauses(words, 0.25);
  const n = titles.length;
  const used = new Set<number>();
  return titles.map((title, i) => {
    const target = i === 0 ? Math.min(duration * 0.1, 4) : (duration * i) / n;
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

/** Spoken numbers worth a counter: a digit group, with % or a unit word after it, at least `spacing` apart, at most `max`. */
export function numberSlots(words: readonly CaptionWord[], max = 2, spacing = 6): NumberSlot[] {
  const out: NumberSlot[] = [];
  words.forEach((w, i) => {
    const m = /^([$€£]?)(\d[\d,.]*)(%|k|m|x)?$/i.exec(w.text.replace(/[^\p{L}\p{N}%$€£.,]/gu, "").replace(/[.,]$/, ""));
    if (!m) return;
    const digits = m[2]!.replace(/,/g, "");
    if (/^(19|20)\d\d$/.test(digits)) return; // a year is a date, not a stat
    const after = words[i + 1] ? bareWord(words[i + 1]!.text) : "";
    const suffix = m[3] ?? (PERCENT.has(after) ? "%" : "");
    if (!suffix && Number(digits) < 10) return;
    if (out.some((s) => Math.abs(s.at - w.start) < spacing)) return;
    out.push({ word: i, value: digits, prefix: m[1]!, suffix, at: w.start });
  });
  return out.slice(0, max);
}
