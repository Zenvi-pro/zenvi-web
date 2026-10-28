/**
 * Forced alignment of known text (lyrics, a TTS script, a caption script) to
 * the words speech recognition heard in the same audio: the text's words keep
 * their spelling, punctuation and line breaks, and take the times of the
 * heard words they match. Recognition mishears sung and fast speech, so the
 * match is fuzzy (difflib ratio of letters and digits) and ordered (a
 * weighted longest common subsequence, banded around the diagonal for long
 * texts); text words nothing matched are spread over the heard words between
 * their matched neighbours, by length, the way a TTS script spreads over its
 * voice (tools/tts-words.ts).
 */

import { sequenceRatio } from "../tools/difflib.js";
import type { TimedText } from "./transcription.js";

/** A word of the given text, timed. */
export interface AlignedWord extends TimedText {
  /** 0-based line of the given text the word is on. */
  line: number;
  /** Its time is the time of a word recognition heard (false: placed between heard neighbours). */
  heard: boolean;
}

export interface AlignedLine extends TimedText {
  /** Index of the line's first and last word in `words`. */
  firstWord: number;
  lastWord: number;
}

export interface TextAlignment {
  words: AlignedWord[];
  /** The text's non-empty lines, timed by their words. */
  lines: AlignedLine[];
  /** Share of the text's words matched to a heard word (0..1). */
  heardRatio: number;
}

/** Letters and digits, lowercased, accents folded: what two spellings of a word share. */
export function wordKey(word: string): string {
  return word
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** Below this difflib ratio two words are different words. */
const MATCH_RATIO = 0.6;
/** Cells of the full table before the search narrows to a band around the diagonal. */
const MAX_CELLS = 1_000_000;
/** Seconds a text word with no heard time takes, per weight unit, when there is nothing to spread it over. */
const SECONDS_PER_LETTER = 0.07;

/** difflib's ratio, after its cheap upper bounds (lengths, shared letters) rule most pairs out. */
function similarity(a: string, b: string, cache: Map<string, number>): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if ((2 * Math.min(a.length, b.length)) / (a.length + b.length) < MATCH_RATIO) return 0;
  const key = `${a}\u0000${b}`;
  let value = cache.get(key);
  if (value === undefined) {
    const left = new Map<string, number>();
    for (const ch of a) left.set(ch, (left.get(ch) ?? 0) + 1);
    let shared = 0;
    for (const ch of b) {
      const n = left.get(ch) ?? 0;
      if (n > 0) {
        shared += 1;
        left.set(ch, n - 1);
      }
    }
    value = (2 * shared) / (a.length + b.length) < MATCH_RATIO ? 0 : sequenceRatio(a, b);
    cache.set(key, value);
  }
  return value;
}

/** A word's share of time: its letters and digits, at least two. */
function weight(key: string): number {
  return Math.max(2, key.length);
}

/**
 * Pairs (text index, heard index), in order, that maximize the summed
 * similarity of matched words.
 */
function matchPairs(text: readonly string[], heard: readonly string[]): [number, number][] {
  const n = text.length;
  const m = heard.length;
  if (n === 0 || m === 0) return [];
  const band = n * m <= MAX_CELLS ? m : Math.max(64, Math.ceil(MAX_CELLS / n / 2));
  const lo = (i: number): number => (band >= m ? 0 : Math.max(0, Math.floor((i * m) / n) - band));
  const hi = (i: number): number => (band >= m ? m : Math.min(m, Math.ceil((i * m) / n) + band));
  // score[i][j]: best total for text[0..i) and heard[0..j); moves: 0 skip heard, 1 skip text, 2 match.
  const width = m + 1;
  const cache = new Map<string, number>();
  const score = new Float64Array((n + 1) * width);
  const move = new Uint8Array((n + 1) * width);
  for (let i = 1; i <= n; i += 1) {
    const row = i * width;
    const prev = (i - 1) * width;
    move[row] = 1;
    const from = lo(i - 1);
    const to = hi(i);
    for (let j = 1; j <= m; j += 1) {
      if (j < from || j > to) {
        // Outside the band: carry the best neighbour so the path stays connected.
        const up = score[prev + j]!;
        const left = score[row + j - 1]!;
        score[row + j] = up >= left ? up : left;
        move[row + j] = up >= left ? 1 : 0;
        continue;
      }
      let best = score[row + j - 1]!;
      let how = 0;
      const up = score[prev + j]!;
      if (up > best) {
        best = up;
        how = 1;
      }
      const sim = similarity(text[i - 1]!, heard[j - 1]!, cache);
      if (sim >= MATCH_RATIO) {
        const diag = score[prev + j - 1]! + sim;
        if (diag > best) {
          best = diag;
          how = 2;
        }
      }
      score[row + j] = best;
      move[row + j] = how;
    }
  }
  const pairs: [number, number][] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const how = move[i * width + j];
    if (how === 2) {
      pairs.push([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    } else if (how === 1) i -= 1;
    else j -= 1;
  }
  return pairs.reverse();
}

const round = (t: number): number => Math.round(t * 1000) / 1000;

/** Spread `keys` over [from, to] by weight; consecutive, touching. */
function spread(keys: readonly string[], from: number, to: number): [number, number][] {
  const weights = keys.map(weight);
  const sum = weights.reduce((a, b) => a + b, 0);
  const span = Math.max(0, to - from);
  const out: [number, number][] = [];
  let done = 0;
  for (const w of weights) {
    const start = from + (done / sum) * span;
    done += w;
    out.push([start, from + (done / sum) * span]);
  }
  return out;
}

/**
 * Time `text` by the words heard in its audio (source seconds, in order).
 * `range` bounds where unmatched words at either end may go (default: the
 * heard words' extent).
 */
export function alignText(text: string, heard: readonly TimedText[], range: { start?: number; end?: number } = {}): TextAlignment {
  const tokens: { text: string; key: string; line: number }[] = [];
  const lineCount = text.split(/\r?\n/).length;
  for (const [line, row] of text.split(/\r?\n/).entries()) {
    for (const word of row.split(/\s+/)) {
      const key = wordKey(word);
      if (key) tokens.push({ text: word, key, line });
    }
  }
  const spoken = heard.filter((w) => wordKey(w.text) && w.endSec >= w.startSec);
  const pairs = matchPairs(
    tokens.map((t) => t.key),
    spoken.map((w) => wordKey(w.text)),
  );
  const times: ([number, number] | undefined)[] = tokens.map(() => undefined);
  for (const [t, h] of pairs) times[t] = [spoken[h]!.startSec, spoken[h]!.endSec];

  const first = spoken[0]?.startSec ?? range.start ?? 0;
  const last = spoken[spoken.length - 1]?.endSec ?? range.end ?? first;
  const floor = range.start ?? Math.min(first, 0);
  const ceiling = range.end ?? last;
  // Each run of unmatched text words between matched ones (or the ends).
  let k = 0;
  while (k < tokens.length) {
    if (times[k]) {
      k += 1;
      continue;
    }
    let end = k;
    while (end < tokens.length && !times[end]) end += 1;
    const before = pairs.filter(([t]) => t < k).at(-1);
    const after = pairs.find(([t]) => t >= end);
    // Heard words between the neighbours that matched nothing: the run was said there.
    const lowHeard = before ? before[1] + 1 : 0;
    const highHeard = after ? after[1] : spoken.length;
    const between = spoken.slice(lowHeard, highHeard);
    const run = tokens.slice(k, end).map((t) => t.key);
    const need = run.reduce((n, key) => n + weight(key), 0) * SECONDS_PER_LETTER;
    let from: number;
    let to: number;
    if (between.length > 0) {
      from = between[0]!.startSec;
      to = between[between.length - 1]!.endSec;
    } else {
      const gapStart = before ? spoken[before[1]]!.endSec : floor;
      const gapEnd = after ? spoken[after[1]]!.startSec : ceiling;
      if (gapEnd - gapStart <= need * 1.5) {
        from = gapStart;
        to = gapEnd;
      } else if (!before || (after && tokens[k]!.line > tokens[before[0]]!.line)) {
        // A new line with no heard words of its own: it leads into the next heard word.
        from = Math.max(gapStart, gapEnd - need);
        to = gapEnd;
      } else {
        from = gapStart;
        to = Math.min(gapEnd, gapStart + need);
      }
    }
    for (const [i, span] of spread(run, from, to).entries()) times[k + i] = span;
    k = end;
  }

  const matched = new Set(pairs.map(([t]) => t));
  const words: AlignedWord[] = tokens.map((t, i) => ({
    text: t.text,
    startSec: round(times[i]![0]),
    endSec: round(Math.max(times[i]![0], times[i]![1])),
    line: t.line,
    heard: matched.has(i),
  }));
  const lines: AlignedLine[] = [];
  for (let line = 0; line < lineCount; line += 1) {
    const idx = words.flatMap((w, i) => (w.line === line ? [i] : []));
    if (idx.length === 0) continue;
    const a = idx[0]!;
    const b = idx[idx.length - 1]!;
    lines.push({ text: idx.map((i) => words[i]!.text).join(" "), startSec: words[a]!.startSec, endSec: words[b]!.endSec, firstWord: a, lastWord: b });
  }
  return { words, lines, heardRatio: tokens.length > 0 ? matched.size / tokens.length : 0 };
}
