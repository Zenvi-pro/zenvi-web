/**
 * The cue text of libopenshot's Caption effect, the way zenvi-core's caption
 * tools read and write it (src/classes/caption_cues.py). One `caption_text`
 * string holds every cue, in the format the Captions dock edits:
 *
 *     00:00:00:500 --> 00:00:03:000
 *     Welcome back to my channel.
 *
 * Times are the captioned clip's own (source) seconds. Drawing follows
 * libopenshot exactly (render/kernels/caption.ts `parseCaptions`); this module
 * is the tools' reading of the same text (cue text includes a line the
 * renderer would skip, so tools can show and edit it), plus `safeText`, which
 * rewrites text so libopenshot draws every line as written: a "10:30" inside
 * a cue would otherwise end it, and one-letter or "NOTE" lines are skipped.
 */

import { pyRound } from "../model/rounding.js";

export const ZERO_WIDTH = "​";
/** Older captions used this look-alike colon; `displayText` still undoes it. */
export const RATIO_COLON = "∶";

export interface Cue {
  /** Seconds, in the time base of whoever holds the cue (clip source time inside effects). */
  start: number;
  end: number;
  text: string;
}

/** caption_cues.py `_CAPTION_RE` (Python `.` = any character but "\n", `\Z` = the very end). */
const CAPTION_RE =
  /(\d{2})?:*(\d{2}):(\d{2})[^\n](\d{2,3})\s*-->\s*(\d{2})?:*(\d{2}):(\d{2})[^\n](\d{2,3})([\s\S]*?)([^\n]*?)(?=\d{2}:\d{2,3}|$(?![\s\S]))/gu;
const TIME_IN_TEXT = /(?<=\d\d):(?=\d\d)/g;

/** `format_time`: seconds → "HH:MM:SS:mmm", rounded to the millisecond. */
export function formatCueTime(seconds: number): string {
  const ms = Math.trunc(pyRound(Math.max(0, Number(seconds) || 0) * 1000));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${two(hours)}:${two(minutes)}:${two(secs)}:${String(milli).padStart(3, "0")}`;
}

function fraction(group: string | undefined): number {
  return Number((group ?? "").padEnd(3, "0").slice(0, 3)) / 1000;
}

/** `drawn_lines`: the lines of a cue libopenshot draws (not empty, not "NOTE…", longer than one UTF-16 unit). */
export function drawnLines(text: string): string[] {
  return String(text ?? "")
    .split("\n")
    .filter((line) => line && !line.startsWith("NOTE") && line.length > 1);
}

/** `parse_caption_text`: the cues of a Caption effect's text, in text order. */
export function parseCaptionText(captionText: string): Cue[] {
  let prepared = String(captionText ?? "");
  if (!prepared.endsWith("\n\n")) prepared += "\n\n";
  const cues: Cue[] = [];
  for (const m of prepared.matchAll(CAPTION_RE)) {
    const start = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + fraction(m[4]);
    const end = Number(m[5] ?? 0) * 3600 + Number(m[6]) * 60 + Number(m[7]) + fraction(m[8]);
    const body = (m[9] ?? "") + (m[10] ?? "");
    const text = body
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
    cues.push({ start, end, text });
  }
  return cues;
}

/** `safe_line`: one line rewritten so libopenshot draws all of it. */
export function safeLine(line: string): string {
  let out = line.replace(TIME_IN_TEXT, `${ZERO_WIDTH}:`);
  if (out.startsWith("NOTE")) out = ZERO_WIDTH + out;
  if (out.length === 1) out += ZERO_WIDTH;
  return out;
}

/** `safe_text`: [drawable text, changed?]; blank lines dropped, each line made safe. */
export function safeText(text: string): [string, boolean] {
  const lines = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim());
  const kept = lines.filter(Boolean);
  const result = kept.map(safeLine).join("\n");
  return [result, result !== kept.join("\n")];
}

/** `display_text`: undo `safeLine` for people (and models). */
export function displayText(text: string): string {
  return String(text ?? "").replaceAll(ZERO_WIDTH, "").replaceAll(RATIO_COLON, ":");
}

/** `build_caption_text`: Caption effect text for `cues`, sorted by start (text must already be safe). */
export function buildCaptionText(cues: readonly Cue[]): string {
  const blocks = [...cues]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((cue) => `${formatCueTime(cue.start)} --> ${formatCueTime(cue.end)}\n${cue.text}`);
  return blocks.join("\n\n") + (blocks.length > 0 ? "\n\n" : "");
}

// ---------------------------------------------------------------------------
// Subtitle files (.srt / .vtt): caption_cues.py `parse_subtitles`
// ---------------------------------------------------------------------------

const FILE_TIME = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;
const TAGS = /<[^>]{1,80}>|\{\\[^}]{0,80}\}/g;

/** Named character references subtitle files use; numeric ones are decoded too (Python `html.unescape`, the common part). */
const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", copy: "©", reg: "®", trade: "™", eacute: "é", egrave: "è",
};

function unescapeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function fileSeconds(h: string | undefined, m: string, s: string, frac: string): number {
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(frac.padEnd(3, "0").slice(0, 3)) / 1000;
}

/** Cues from SRT or WebVTT text: index lines, cue settings, NOTE/STYLE blocks and tags dropped (`parse_subtitles`). */
export function parseSubtitles(text: string): Cue[] {
  const body = String(text ?? "").replace(/^\uFEFF+/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const cues: Cue[] = [];
  for (const block of body.trim().split(/\n[ \t]*\n/)) {
    const lines = block
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => l.trimEnd());
    if (lines.length === 0) continue;
    const head = lines[0]!.trim();
    if (/^(WEBVTT|NOTE|STYLE|REGION)/i.test(head) && !head.includes("-->")) continue;
    const timingAt = lines.findIndex((l) => l.includes("-->"));
    if (timingAt < 0) continue;
    const m = FILE_TIME.exec(lines[timingAt]!);
    if (!m) continue;
    const start = fileSeconds(m[1], m[2]!, m[3]!, m[4]!);
    const end = fileSeconds(m[5], m[6]!, m[7]!, m[8]!);
    const textLines = lines.slice(timingAt + 1).map((l) => unescapeHtml(l.replace(TAGS, "")).trim());
    const caption = textLines.filter(Boolean).join("\n");
    if (caption && end > start) cues.push({ start, end, text: caption });
  }
  return cues;
}

// ---------------------------------------------------------------------------
// Phrasing transcripts into readable captions: caption_cues.py `split_cue`
// ---------------------------------------------------------------------------

const PUNCT = [",", ";", ":", ".", "!", "?", "…"];
const SENTENCE_END = /(?<=[.!?…])\s+/u;

/** Python `len(" ".join(words))`: code points. */
function joinedLength(words: readonly string[]): number {
  return Array.from(words.join(" ")).length;
}

function fits(words: readonly string[], maxWords: number, maxChars: number): boolean {
  return words.length <= maxWords && joinedLength(words) <= maxChars;
}

/**
 * Best caption breaks for one sentence (`_break_sentence`, a small
 * line-breaking DP): every caption fits the limits; the cost favours few,
 * evenly full captions that end at punctuation, and avoids one-word captions.
 */
export function breakSentence(words: readonly string[], maxWords: number, maxChars: number): string[][] {
  const n = words.length;
  const best = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
  const back = new Array<number>(n + 1).fill(0);
  best[0] = 0;
  for (let i = 1; i <= n; i += 1) {
    for (let j = Math.max(0, i - maxWords); j < i; j += 1) {
      const group = words.slice(j, i);
      const length = joinedLength(group);
      if (length > maxChars && group.length > 1) continue;
      let cost = 1 + 6 * ((maxChars - length) / maxChars) ** 2;
      if (i < n && !PUNCT.some((p) => group[group.length - 1]!.endsWith(p))) cost += 2;
      if (group.length === 1 && i < n) cost += 3;
      if (best[j]! + cost < best[i]!) {
        best[i] = best[j]! + cost;
        back[i] = j;
      }
    }
  }
  const groups: string[][] = [];
  for (let i = n; i > 0; i = back[i]!) groups.push(words.slice(back[i]!, i));
  return groups.reverse();
}

/** Word groups for one cue: sentences that fit stay whole, longer ones are broken well (`_phrases`). */
function phrases(text: string, maxWords: number, maxChars: number): string[][] {
  const out: string[][] = [];
  for (const sentence of text.trim().split(SENTENCE_END)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    out.push(...(fits(words, maxWords, maxChars) ? [words] : breakSentence(words, maxWords, maxChars)));
  }
  return out;
}

/**
 * Split a long transcript cue into readable captions of at most `maxWords`
 * words and `maxChars` characters (`split_cue`). Sentence ends always break;
 * longer sentences break where the captions come out evenly full and end at
 * punctuation, never leaving a lone word. Time is shared out by character
 * count: indexed transcript cues carry no word timings.
 */
export function splitCue(cue: Cue, maxWords = 8, maxChars = 42): Cue[] {
  const mw = Math.max(1, Math.trunc(maxWords));
  const mc = Math.max(8, Math.trunc(maxChars));
  const words = String(cue.text ?? "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (fits(words, mw, mc)) return [{ start: cue.start, end: cue.end, text: words.join(" ") }];
  const groups = phrases(words.join(" "), mw, mc);
  const total = groups.reduce((sum, g) => sum + joinedLength(g) + 1, 0);
  const span = Math.max(0, cue.end - cue.start);
  const out: Cue[] = [];
  let t = cue.start;
  groups.forEach((group, i) => {
    const text = group.join(" ");
    const end = i === groups.length - 1 ? cue.end : t + (span * (Array.from(text).length + 1)) / total;
    out.push({ start: t, end, text });
    t = end;
  });
  return out;
}

/** A word with its time, in the time base of whoever holds it (a clip's source seconds for captions). */
export interface TimedWordText {
  text: string;
  startSec: number;
  endSec: number;
}

/**
 * Captions from words with real timings (a speech-recognition transcript),
 * phrased by `splitCue`'s rules: a caption ends at a sentence end or a pause
 * longer than `maxGapSec`, longer runs break where `breakSentence` would, and
 * each caption runs from its first word's start to its last word's end
 * instead of sharing time by characters. A caption stays up until the next
 * one when the pause between them is short, so captions do not blink.
 */
export function phraseTimedWords(words: readonly TimedWordText[], maxWords = 8, maxChars = 42, maxGapSec = 0.8): Cue[] {
  const mw = Math.max(1, Math.trunc(maxWords));
  const mc = Math.max(8, Math.trunc(maxChars));
  const runs: TimedWordText[][] = [];
  let run: TimedWordText[] = [];
  for (const word of words) {
    const text = String(word.text ?? "").trim();
    if (!text) continue;
    const prev = run[run.length - 1];
    if (prev && (word.startSec - prev.endSec > maxGapSec || /[.!?…]$/u.test(prev.text))) {
      runs.push(run);
      run = [];
    }
    run.push({ text, startSec: word.startSec, endSec: word.endSec });
  }
  if (run.length > 0) runs.push(run);
  const cues: Cue[] = [];
  for (const r of runs) {
    const texts = r.map((w) => w.text);
    const sizes = fits(texts, mw, mc) ? [texts.length] : breakSentence(texts, mw, mc).map((g) => g.length);
    let k = 0;
    for (const size of sizes) {
      const group = r.slice(k, k + size);
      k += size;
      cues.push({ start: group[0]!.startSec, end: Math.max(group[0]!.startSec, group[group.length - 1]!.endSec), text: texts.slice(k - size, k).join(" ") });
    }
  }
  for (let i = 0; i + 1 < cues.length; i += 1) {
    const gap = cues[i + 1]!.start - cues[i]!.end;
    if (gap > 0 && gap <= maxGapSec) cues[i]!.end = cues[i + 1]!.start;
  }
  return cues;
}
