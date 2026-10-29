/**
 * Where a line is said in a voice-over: the stretch of the voice's word
 * timings that best matches a shot's text (the caption burnt into it, or its
 * own transcript), so sequence_shots_tool can start the shot on its words.
 * Words compare lower-cased with punctuation dropped; a match must cover
 * most of the line's words in order (a longest common subsequence over a
 * window about the line's length).
 */

import type { TimedText } from "../analysis/transcription.js";

export interface SpokenMatch {
  /** Voice seconds of the first and last matched word. */
  start: number;
  end: number;
  /** Share of the line's words found in order, 0-1. */
  score: number;
}

/** Below this share of the line's words the match is a guess, not a line. */
export const MIN_SPOKEN_SCORE = 0.6;

export function spokenTokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}']+/u)
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

/** LCS of `a` and `b`, with the index in `b` of the first and last matched token. */
function lcs(a: readonly string[], b: readonly string[]): { length: number; first: number; last: number } {
  const n = a.length;
  const m = b.length;
  const len = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) len[i]![j] = a[i] === b[j] ? len[i + 1]![j + 1]! + 1 : Math.max(len[i + 1]![j]!, len[i]![j + 1]!);
  }
  let i = 0;
  let j = 0;
  let first = -1;
  let last = -1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      if (first < 0) first = j;
      last = j;
      i += 1;
      j += 1;
    } else if (len[i + 1]![j]! >= len[i]![j + 1]!) i += 1;
    else j += 1;
  }
  return { length: len[0]![0]!, first, last };
}

/** The best place `text` is said in `words`, or null when no stretch has most of its words in order. */
export function findSpoken(words: readonly TimedText[], text: string): SpokenMatch | null {
  const line = spokenTokens(text);
  if (line.length === 0 || words.length === 0) return null;
  // One token per word (a timed "don't" stays one token; "well-known" is split but keeps the word's time).
  const voice: { token: string; word: number }[] = [];
  words.forEach((w, k) => spokenTokens(w.text).forEach((token) => voice.push({ token, word: k })));
  const span = Math.max(line.length + 2, Math.ceil(line.length * 1.5));
  let best: SpokenMatch | null = null;
  for (let s = 0; s < voice.length; s += 1) {
    const window = voice.slice(s, s + span);
    const found = lcs(line, window.map((v) => v.token));
    if (found.length === 0) continue;
    const score = found.length / line.length;
    if (!best || score > best.score + 1e-9) {
      best = { start: words[window[found.first]!.word]!.startSec, end: words[window[found.last]!.word]!.endSec, score: Math.round(score * 1000) / 1000 };
    }
  }
  return best && best.score >= MIN_SPOKEN_SCORE ? best : null;
}
