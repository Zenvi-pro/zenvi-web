/**
 * Copy in fragments, one at a time, with picture between: cinetic's text
 * flow gate (scripts/grid-check.ts and SKILL.md section 4, MIT, (c) 2026
 * Leonxlnx) on the timeline's text. A fragment is one title on screen: a
 * title clip, or the word clips one add_kinetic_title_tool call placed.
 *
 * calm (the default) / crisp (a film that asked for energy):
 * - 1-4 words per fragment (crisp 5); at most 8 words readable at once (10);
 * - a fragment holds max(60, 42 + 8 f per word) at 60 fps once it is up
 *   (crisp 36 + 6 f per word);
 * - two separate lines never arrive together (one is read first);
 * - copy on at most 65 % of the runtime (80 %), and in every 10 s at least
 *   1.5 s with no text at all.
 */

export type CopyPace = "calm" | "crisp";

export interface CopyFragment {
  id: string;
  text: string;
  start: number;
  end: number;
}

export interface CopyIssue {
  code: "copy-fragment-long" | "copy-crowded" | "copy-short-hold" | "copy-together" | "copy-share" | "copy-no-breath";
  at: number;
  until?: number;
  message: string;
  fix: string;
}

const LIMITS: Readonly<Record<CopyPace, { words: number; visible: number; share: number; hold: (words: number) => number }>> = {
  calm: { words: 4, visible: 8, share: 0.65, hold: (n) => Math.max(60, 42 + 8 * n) / 60 },
  crisp: { words: 5, visible: 10, share: 0.8, hold: (n) => (36 + 6 * n) / 60 },
};
/** Two lines starting this close arrive together. */
const TOGETHER_SECONDS = 0.2;
const WINDOW_SECONDS = 10;
const BREATH_SECONDS = 1.5;

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const t = (s: number): string => `${s.toFixed(1)}s`;

/** Where the copy of `fragments` (a film of `duration` s) breaks the text flow of `pace`. */
export function copyPacing(fragments: readonly CopyFragment[], duration: number, pace: CopyPace = "calm"): CopyIssue[] {
  const lim = LIMITS[pace];
  const frags = [...fragments].filter((f) => f.end > f.start && wordCount(f.text) > 0).sort((a, b) => a.start - b.start);
  const out: CopyIssue[] = [];
  for (const f of frags) {
    const n = wordCount(f.text);
    if (n > lim.words) out.push({ code: "copy-fragment-long", at: f.start, until: f.end, message: `"${f.text}" lands ${n} words at once (${pace}: at most ${lim.words} per fragment).`, fix: `Split it at the grammar into a chain of 2-4 fragments with 0.5-1.5 s of picture between them.` });
    const hold = lim.hold(n);
    if (f.end - f.start + 1e-6 < hold) out.push({ code: "copy-short-hold", at: f.start, until: f.end, message: `"${f.text}" is up ${(f.end - f.start).toFixed(2)} s; ${n} word${n === 1 ? "" : "s"} need ${hold.toFixed(2)} s to be read.`, fix: `Hold it at least ${hold.toFixed(2)} s (drift or creep it 1-3 % so the hold is alive).` });
  }
  // Words readable at once, at every fragment start.
  for (const f of frags) {
    const visible = frags.filter((g) => g.start <= f.start + 1e-6 && g.end > f.start + 1e-6).reduce((sum, g) => sum + wordCount(g.text), 0);
    if (visible > lim.visible) {
      out.push({ code: "copy-crowded", at: f.start, message: `${visible} words on screen at ${t(f.start)} (${pace}: at most ${lim.visible}).`, fix: "Clear the line before the next fragment, or cut words: one thought on screen at a time." });
      break;
    }
  }
  for (let i = 1; i < frags.length; i += 1) {
    const a = frags[i - 1]!;
    const b = frags[i]!;
    if (b.start - a.start < TOGETHER_SECONDS && a.text !== b.text) {
      out.push({ code: "copy-together", at: a.start, message: `"${a.text}" and "${b.text}" arrive together at ${t(a.start)}.`, fix: "Let one be read first: start the second after the first has resolved (0.5 s or more)." });
      break;
    }
  }
  if (duration > 0 && frags.length > 0) {
    // Union of the copy's time, then its share and the longest text-free stretch in every 10 s window.
    const spans: [number, number][] = [];
    for (const f of frags) {
      const last = spans[spans.length - 1];
      if (last && f.start <= last[1]) last[1] = Math.max(last[1], f.end);
      else spans.push([Math.max(0, f.start), Math.min(duration, f.end)]);
    }
    const covered = spans.reduce((s, [a, b]) => s + Math.max(0, b - a), 0);
    if (covered / duration > lim.share) out.push({ code: "copy-share", at: 0, message: `Copy is on screen ${Math.round((covered / duration) * 100)} % of the film (${pace}: at most ${Math.round(lim.share * 100)} %).`, fix: "Give the picture stretches of its own: cut a fragment or let the product carry a beat with no text." });
    for (let from = 0; from + WINDOW_SECONDS <= duration + 1e-6; from += 1) {
      const to = from + WINDOW_SECONDS;
      let free = 0;
      let cursor = from;
      for (const [a, b] of spans) {
        if (b <= from || a >= to) continue;
        free = Math.max(free, Math.max(a, from) - cursor);
        cursor = Math.max(cursor, Math.min(b, to));
      }
      free = Math.max(free, to - cursor);
      if (free < BREATH_SECONDS) {
        out.push({ code: "copy-no-breath", at: from, until: to, message: `${t(from)}-${t(to)} never goes ${BREATH_SECONDS} s without text (longest gap ${free.toFixed(1)} s).`, fix: "Clear the text for at least 1.5 s in every 10 s: the picture acts between fragments." });
        break;
      }
    }
  }
  return out;
}
