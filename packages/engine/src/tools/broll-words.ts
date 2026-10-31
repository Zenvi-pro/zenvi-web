/**
 * Which spoken words a B-roll cutaway lands on (insert_broll_on_words_tool):
 * the content words a viewer would want to see (things, places, names,
 * numbers), not the function words and the generic verbs between them, one
 * every 5-8 seconds. There is no part-of-speech tagger: a stop list, the
 * word's length, a capital in mid-sentence (a name) and repetition (the
 * topic) stand in for one.
 */

import type { TimelineWord } from "./timeline-words.js";

const STOP = new Set(
  (
    "a an the and or but nor so yet for of to in on at by with from up down out over under into onto about above below between through during before after " +
    "is am are was were be been being have has had having do does did doing done will would shall should can could may might must " +
    "i me my mine we us our ours you your yours he him his she her hers it its they them their theirs this that these those there here " +
    "what which who whom whose when where why how all any both each few more most other some such no not only own same than too very just " +
    "really actually basically literally like um uh erm hmm okay ok yeah yes oh well right so gonna wanna gotta kind sort thing things stuff lot lots " +
    "get got gets getting go goes going went gone make makes made making know knows knew think thinks thought say says said saying tell told " +
    "take takes took see sees saw seen come comes came want wants wanted look looks looking use uses used find found give gives gave put let lets " +
    "also even still then now ever never always often again because if while though although until unless whether one two thing way much many"
  ).split(" "),
);

/** How much a word wants a picture: 0 for words that do not. */
export function brollScore(word: TimelineWord, previous: TimelineWord | undefined, counts: ReadonlyMap<string, number>): number {
  const key = word.key;
  if (key.length < 3 || STOP.has(key)) return 0;
  let score = Math.min(key.length, 10);
  if (/^\p{N}+$/u.test(key)) score += 2;
  // A capital after a word that ends no sentence: a name or a place.
  if (/^\p{Lu}/u.test(word.text) && previous && !/[.!?]["')\]]*$/.test(previous.text)) score += 4;
  if ((counts.get(key) ?? 0) > 1) score += 2;
  if (/(ly|ing)$/.test(key)) score -= 3;
  return Math.max(0, score);
}

export interface BrollSpacing {
  /** Seconds between one insert's start and the next (default 5). */
  minGap: number;
  /** The next insert lands within this many seconds when a word allows (default 8). */
  maxGap: number;
  /** No insert before this timeline time (the speaker is seen first). */
  notBefore: number;
  maxCount: number;
}

/**
 * Words to cut away on, in time order: in each window [last + minGap,
 * last + maxGap] the best-scoring word; when the window has none, the next
 * word that scores at all.
 */
export function pickBrollWords(words: readonly TimelineWord[], spacing: BrollSpacing): TimelineWord[] {
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w.key, (counts.get(w.key) ?? 0) + 1);
  const scored = words.map((w, i) => ({ w, score: brollScore(w, words[i - 1], counts) })).filter((s) => s.score > 0 && s.w.start >= spacing.notBefore);
  const picked: TimelineWord[] = [];
  let from = spacing.notBefore;
  while (picked.length < spacing.maxCount) {
    const open = scored.filter((s) => s.w.start >= from);
    if (open.length === 0) break;
    const window = open.filter((s) => s.w.start <= from + (spacing.maxGap - spacing.minGap));
    const best = (window.length > 0 ? window : [open[0]!]).reduce((a, b) => (b.score > a.score ? b : a));
    picked.push(best.w);
    from = best.w.start + spacing.minGap;
  }
  return picked;
}
