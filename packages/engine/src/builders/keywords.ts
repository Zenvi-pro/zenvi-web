/**
 * B-roll on keywords: which spoken words a cutaway lands on, and which bin
 * picture it shows. A word matches a picture when its stem is one of the
 * picture's terms (its file name, its index summary). Cutaways start on the
 * word, hold to the end of the phrase (within a range a viewer reads as a
 * cutaway, not a new scene), and keep apart so the speaker is seen between
 * them; the opening stays on the speaker (the hook is a face, not B-roll).
 */

import { bareWord, emphasisScores, isStopword, type CaptionWord } from "../captions/words.js";

export interface KeywordMedia {
  fileId: string;
  /** Lower-case words that name what the picture shows. */
  terms: readonly string[];
}

/** A keyword the caller named, optionally with its picture. */
export interface GivenKeyword {
  word: string;
  fileId?: string;
}

export interface KeywordHit {
  /** Index of the word in the words given. */
  word: number;
  text: string;
  fileId: string;
  /** Timeline seconds the cutaway starts and ends. */
  start: number;
  end: number;
  /** "named" when the caller named the keyword, else "matched". */
  source: "named" | "matched";
}

export interface KeywordRules {
  /** No cutaway before this (default 2 s: the hook is the speaker). */
  minStart?: number;
  /** Seconds between one cutaway's end and the next one's start (default 2.5). */
  minGap?: number;
  minHold?: number;
  maxHold?: number;
  /** Timeline seconds nothing may run past (the end of the edit). */
  until: number;
  /** A picture is shown once unless the caller named it for several words (default true). */
  oncePerFile?: boolean;
  /** Timeline times a phrase ends at whatever the gap (a talking head's jump cuts, where the pauses were). */
  breaks?: readonly number[];
}

/** A light stem: plural and verb endings off, so "rockets" meets "rocket" and "launching" meets "launch". */
export function stem(word: string): string {
  const w = bareWord(word).replace(/'s$/, "");
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** The terms of a picture from its name and description: content words only, stemmed. */
export function termsOf(...texts: readonly string[]): string[] {
  const out = new Set<string>();
  for (const text of texts) {
    for (const raw of text.split(/[^\p{L}\p{N}']+/u)) {
      if (raw.length < 3 || isStopword(raw) || /^\d+$/.test(raw)) continue;
      out.add(stem(raw));
    }
  }
  return [...out];
}

/** End of the phrase a word is in: the last word before a pause longer than `gap`. */
export function phraseEnd(words: readonly CaptionWord[], index: number, gap = 0.35, breaks: readonly number[] = []): number {
  let end = words[index]!.end;
  const stop = breaks.filter((b) => b > words[index]!.start + 1e-6).reduce((a, b) => Math.min(a, b), Infinity);
  for (let i = index + 1; i < words.length; i += 1) {
    if (words[i]!.start - end > gap || words[i]!.start >= stop - 1e-6) break;
    end = words[i]!.end;
  }
  return end;
}

/**
 * The cutaways: the named keywords first (each on its first use after
 * minStart), then words that match a picture, strongest (emphasis score)
 * first, each kept only where it leaves the gaps; in time order.
 */
export function planKeywordBroll(words: readonly CaptionWord[], media: readonly KeywordMedia[], given: readonly GivenKeyword[], rules: KeywordRules): KeywordHit[] {
  const minStart = rules.minStart ?? 2;
  const minGap = rules.minGap ?? 2.5;
  const minHold = rules.minHold ?? 1.4;
  const maxHold = rules.maxHold ?? 3.2;
  const once = rules.oncePerFile ?? true;
  const byTerm = new Map<string, string>();
  for (const m of media) for (const t of m.terms) if (!byTerm.has(t)) byTerm.set(t, m.fileId);
  const scores = emphasisScores(words);

  type Candidate = { word: number; fileId: string; source: KeywordHit["source"]; rank: number };
  const candidates: Candidate[] = [];
  const namedStems = new Map(given.map((g) => [stem(g.word), g]));
  words.forEach((w, i) => {
    const s = stem(w.text);
    if (!s || w.start < minStart) return;
    const named = namedStems.get(s);
    if (named) {
      const fileId = named.fileId ?? byTerm.get(s);
      if (fileId) candidates.push({ word: i, fileId, source: "named", rank: 100 + scores[i]! });
      return;
    }
    if (isStopword(w.text) || s.length < 3) return;
    const fileId = byTerm.get(s);
    if (fileId) candidates.push({ word: i, fileId, source: "matched", rank: scores[i]! });
  });
  candidates.sort((a, b) => b.rank - a.rank || a.word - b.word);

  const chosen: KeywordHit[] = [];
  const usedFiles = new Set<string>();
  const usedNamed = new Set<string>();
  for (const c of candidates) {
    const w = words[c.word]!;
    if (c.source === "named" && usedNamed.has(stem(w.text))) continue;
    if (once && c.source === "matched" && usedFiles.has(c.fileId)) continue;
    const start = w.start;
    const end = Math.min(rules.until, start + Math.min(maxHold, Math.max(minHold, phraseEnd(words, c.word, 0.35, rules.breaks) - start)));
    if (end - start < minHold * 0.6) continue;
    if (chosen.some((h) => start < h.end + minGap && h.start < end + minGap)) continue;
    chosen.push({ word: c.word, text: w.text, fileId: c.fileId, start, end, source: c.source });
    usedFiles.add(c.fileId);
    if (c.source === "named") usedNamed.add(stem(w.text));
  }
  return chosen.sort((a, b) => a.start - b.start);
}

/** Words worth a punch-in: numbers and strongly stressed words (score >= `floor`), at least `spacing` seconds apart. */
export function punchWords(words: readonly CaptionWord[], spacing = 4, floor = 3, minStart = 1): number[] {
  const scores = emphasisScores(words);
  const ranked = words.map((_, i) => i).filter((i) => scores[i]! >= floor && words[i]!.start >= minStart);
  ranked.sort((a, b) => scores[b]! - scores[a]! || a - b);
  const out: number[] = [];
  for (const i of ranked) if (out.every((j) => Math.abs(words[j]!.start - words[i]!.start) >= spacing)) out.push(i);
  return out.sort((a, b) => a - b);
}
