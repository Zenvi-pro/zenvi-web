/**
 * Kinetic captions: spoken words into caption groups, and which words to
 * emphasise.
 *
 *   groups     a group is what is on screen at once. A new group starts when
 *              the current one has `maxWords` words or would pass `maxChars`
 *              characters, after a pause longer than `maxGap`, and after a
 *              word ending a sentence (. ? !) or, once the group has two
 *              words, a clause (, ; :) or before a clause opener (but,
 *              and, so…); a group that fills up on a connector leaves it
 *              to open the next group, and a word that closes its phrase
 *              may stretch a full group by one. A group shows from its first word's
 *              start to the next group's start, or `tail` after its last
 *              word (at least `minHold`). A single word left over by the
 *              limits joins the group before it when that stays within a
 *              word and a quarter of them.
 *   emphasis   auto picks per group the highest-scoring word, if it scores
 *              enough: numbers (digits, number words, %, $) score most, then
 *              words in capitals or with "!", long content words, and words
 *              the speaker stresses (held longer per letter than the clip's
 *              median, or followed by a pause). Stopwords never. A list
 *              emphasises those words (case and punctuation ignored).
 */

export interface CaptionWord {
  text: string;
  /** Timeline seconds. */
  start: number;
  end: number;
}

export interface CaptionGroup {
  /** Words `[first, end)` of the input. */
  first: number;
  end: number;
  /** Timeline seconds the group shows. */
  start: number;
  stop: number;
}

export interface GroupRules {
  maxWords: number;
  maxChars: number;
  /** Seconds of silence that end a group. */
  maxGap: number;
  /** Seconds a group stays after its last word when nothing follows it. */
  tail: number;
  /** Shortest a group shows, seconds (when the next group leaves room). */
  minHold: number;
}

/** Words that open a clause: a group breaks before them once it has two words. */
const CLAUSE_OPENERS = new Set(["but", "and", "so", "because", "or", "then", "that's", "which", "when", "while", "if"]);

const SENTENCE_END = /[.?!…]["')\]]*$/;
const CLAUSE_END = /[,;:—–]["')\]]*$/;

export function groupWords(words: readonly CaptionWord[], rules: GroupRules): CaptionGroup[] {
  const groups: { first: number; end: number }[] = [];
  let first = 0;
  let chars = 0;
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i]!;
    const count = i - first;
    if (count > 0) {
      const prev = words[i - 1]!;
      let full = count >= rules.maxWords || chars + 1 + w.text.length > rules.maxChars;
      // One word more when it closes the phrase (punctuation, a pause or a clause opener after it): no stranded word.
      const after = words[i + 1];
      const closes = SENTENCE_END.test(w.text) || CLAUSE_END.test(w.text) || !after || after.start - w.end > rules.maxGap || CLAUSE_OPENERS.has(bareWord(after.text));
      if (full && closes && count + 1 <= rules.maxWords + 1 && chars + 1 + w.text.length <= rules.maxChars * 1.25) full = false;
      const pause = w.start - prev.end > rules.maxGap;
      const sentence = SENTENCE_END.test(prev.text) || (count >= 2 && CLAUSE_END.test(prev.text));
      // A clause opener (but, and, so…) starts the next group rather than ending this one.
      const opener = count >= 2 && CLAUSE_OPENERS.has(bareWord(w.text));
      if (full && count >= 3 && isStopword(prev.text) && !isStopword(words[i - 2]!.text)) {
        // Full on a connector: it opens the next group with the words it leads into ("most people edit | for hours").
        groups.push({ first, end: i - 1 });
        first = i - 1;
        chars = prev.text.length;
      } else if (full || pause || sentence || opener) {
        groups.push({ first, end: i });
        first = i;
        chars = 0;
      }
    }
    chars += (i > first ? 1 : 0) + w.text.length;
  }
  if (words.length > first) groups.push({ first, end: words.length });
  // A lone word cut off by the size limits joins the group before it (no orphans), within a word and a quarter of the limits.
  for (let k = groups.length - 1; k > 0; k -= 1) {
    const g = groups[k]!;
    const prev = groups[k - 1]!;
    if (g.end - g.first !== 1 || SENTENCE_END.test(words[prev.end - 1]!.text)) continue;
    if (words[g.first]!.start - words[prev.end - 1]!.end > rules.maxGap) continue;
    const chars = words.slice(prev.first, g.end).reduce((n, w) => n + w.text.length + 1, -1);
    if (g.end - prev.first > rules.maxWords + 1 || chars > rules.maxChars * 1.25) continue;
    prev.end = g.end;
    groups.splice(k, 1);
  }
  return groups.map((g, k) => {
    const start = words[g.first]!.start;
    const last = words[g.end - 1]!.end;
    const next = groups[k + 1] ? words[groups[k + 1]!.first]!.start : Infinity;
    const stop = Math.min(next, Math.max(last + rules.tail, start + rules.minHold));
    return { ...g, start, stop: Math.max(stop, last) };
  });
}

/** Words never emphasised (English function words and fillers). */
const STOPWORDS = new Set(
  (
    "a an the and or but nor so yet for of to in on at by with from up down out off over under into onto upon about above below " +
    "as than then that this these those there here where when what which who whom whose why how " +
    "i me my mine we us our ours you your yours he him his she her hers it its they them their theirs " +
    "am is are was were be been being have has had having do does did doing done will would shall should can could may might must " +
    "not no just very really quite also too only even still ever again all any some each every both few more most other such own same " +
    "if because while until unless though although whether since once like get got go going gonna wanna kind sort " +
    "um uh er ah oh okay ok yeah yes well right actually basically literally thing things stuff lot lots let let's it's i'm you're we're they're " +
    "that's there's don't doesn't didn't isn't aren't wasn't can't won't i've you've we've i'll you'll i'd"
  ).split(/\s+/),
);

const NUMBER_WORDS = new Set(
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion trillion first second third half double triple percent".split(
    " ",
  ),
);

/** A word as compared: lower case, letters, digits and apostrophes. */
export function bareWord(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}'%$]/gu, "")
    .replace(/^'+|'+$/g, "");
}

export function isStopword(text: string): boolean {
  return STOPWORDS.has(bareWord(text));
}

/** How strongly each word asks for emphasis (0: never). */
export function emphasisScores(words: readonly CaptionWord[]): number[] {
  const perLetter = words.map((w) => (w.end - w.start) / Math.max(1, bareWord(w.text).length));
  const sorted = [...perLetter].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return words.map((w, i) => {
    const bare = bareWord(w.text);
    if (!bare || STOPWORDS.has(bare)) return 0;
    let score = 0;
    if (/\d/.test(bare) || NUMBER_WORDS.has(bare) || /[%$€£]/.test(w.text)) score += 3;
    const letters = w.text.replace(/[^\p{L}]/gu, "");
    if (letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) score += 2;
    if (/!/.test(w.text)) score += 1.5;
    if (bare.length >= 8) score += 1.5;
    else if (bare.length >= 6) score += 1;
    else if (bare.length >= 4) score += 0.5;
    if (median > 0 && perLetter[i]! > median * 1.35 && bare.length >= 3) score += 1;
    const next = words[i + 1];
    if (next && next.start - w.end > 0.25) score += 0.5;
    return score;
  });
}

/** Lowest auto score that is emphasised (a style may ask for less: every group gets its best content word). */
export const EMPHASIS_FLOOR = 1.5;

/**
 * Indices of the emphasised words: `auto` takes up to `perGroup` of each
 * group's best words scoring at least `floor`; a list takes the words
 * it names (each word of a phrase), wherever they are.
 */
export function pickEmphasis(
  words: readonly CaptionWord[],
  groups: readonly CaptionGroup[],
  mode: "auto" | "none" | readonly string[],
  perGroup: number,
  floor: number = EMPHASIS_FLOOR,
): Set<number> {
  const out = new Set<number>();
  if (mode === "none") return out;
  if (mode !== "auto") {
    // A phrase in the list ("big idea") emphasises each of its words.
    const wanted = new Set(mode.flatMap((m) => m.split(/\s+/)).map(bareWord).filter(Boolean));
    words.forEach((w, i) => {
      if (wanted.has(bareWord(w.text))) out.add(i);
    });
    return out;
  }
  const scores = emphasisScores(words);
  for (const g of groups) {
    const ranked: number[] = [];
    for (let i = g.first; i < g.end; i += 1) if (scores[i]! >= floor && scores[i]! > 0) ranked.push(i);
    ranked.sort((a, b) => scores[b]! - scores[a]! || a - b);
    for (const i of ranked.slice(0, perGroup)) out.add(i);
  }
  return out;
}
