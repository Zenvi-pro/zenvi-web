/**
 * The motif method's hard rules for a brief, adapted from Tweenkit's
 * kinetic-cut-video skill (MIT, wmzspace: references/motif-method.md and the
 * storyboard rules of its SKILL.md; the method in prose is
 * plugins/zenvi/skills/zenvi-styles/METHOD-motif.md):
 *
 * - motifs: 8-12 elements only this subject has, one of them the through-line
 *   that opens and closes the piece;
 * - a storyboard whose duration, composition, text-entrance and tone columns
 *   do not repeat (lengths vary, no composition more than twice, three text
 *   entrances, one bright / inverted / accent-filled shot, a climax whose tone
 *   breaks the system);
 * - the reskin test: more than a third of the shots would work for any
 *   subject means the plan is a template;
 * - a creative-direction draw of at least three axes, each with a reason.
 *
 * Bench sk0 (zenvi-web #73): agents made to save a brief saved the least that
 * validated and the edit came out the same, so for a whole video these are
 * refusals, not advice. Very short pieces (a quick edit) skip them.
 */

import type { Brief } from "./brief.js";

/** Pieces at least this long are planned with the motif method. */
export const METHOD_MIN_SECONDS = 6;
export const MIN_MOTIFS = 8;
export const MIN_ROWS = 3;
export const MIN_AXES = 3;
/** A composition may appear this many times at most. */
const MAX_SAME_COMPOSITION = 2;
const MIN_TEXT_ENTRANCES = 3;
/** Tones that break a dark or uniform system: a light ground, an inversion, a full-frame accent. */
const BREAKING_TONE = /\b(bright|light|white|paper|cream|invert(?:ed)?|negative|accent|fill(?:ed)?|flash)\b/i;

const norm = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, " ");

function counts(values: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of values) out.set(norm(v), (out.get(norm(v)) ?? 0) + 1);
  return out;
}

/** What keeps `brief` from being a plan; empty when it holds. Each line says what to change. */
export function methodProblems(brief: Brief): string[] {
  if (brief.length_seconds < METHOD_MIN_SECONDS) return [];
  const out: string[] = [];
  const motifs = new Set(brief.motifs.map(norm));
  if (brief.motifs.length < MIN_MOTIFS) out.push(`motifs: ${brief.motifs.length} of the ${MIN_MOTIFS}-12 elements only this subject has (its tools, materials, signs, screens, places, the one gesture of the trade).`);
  if (!brief.through_line) out.push("through_line: name the motif that recurs and opens and closes the piece.");
  else if (motifs.size > 0 && !motifs.has(norm(brief.through_line))) out.push(`through_line "${brief.through_line}" is not one of motifs.`);

  const rows = brief.storyboard;
  if (rows.length < MIN_ROWS) {
    out.push(`storyboard: ${rows.length} rows; plan every shot (start, beats, picture, motif, source, composition, text_entrance, tone, transition).`);
  } else {
    if (brief.through_line) {
      const line = norm(brief.through_line);
      if (norm(rows[0]!.motif) !== line || norm(rows[rows.length - 1]!.motif) !== line) out.push(`storyboard: the first and the last shot grow from the through-line "${brief.through_line}".`);
    }
    const stray = rows.filter((r) => motifs.size > 0 && !motifs.has(norm(r.motif))).map((r) => r.motif);
    if (stray.length > 0) out.push(`storyboard: motifs not in the motif list: ${[...new Set(stray)].join(", ")}.`);
    const lengths = new Set(rows.map((r) => r.beats));
    if (rows.length >= 4 && lengths.size < (rows.length >= 6 ? 3 : 2)) out.push(`storyboard: every shot is ${[...lengths].join(" or ")} beats; mix 1 / 2 / 4 / 8 into a curve (set-up, speed-up, breath, climax, hold).`);
    const crowded = [...counts(rows.map((r) => r.composition))].filter(([, n]) => n > MAX_SAME_COMPOSITION).map(([c, n]) => `${c} x${n}`);
    if (crowded.length > 0) out.push(`storyboard: a composition used more than twice (${crowded.join(", ")}); vary it: cropped type, empty space, split, diagonal, full bleed.`);
    const entrances = [...counts(rows.map((r) => r.text_entrance))].filter(([e]) => e !== "none").length;
    const withText = rows.filter((r) => norm(r.text_entrance) !== "none").length;
    if (entrances < Math.min(MIN_TEXT_ENTRANCES, withText)) out.push(`storyboard: ${entrances} text entrance${entrances === 1 ? "" : "s"}; use ${Math.min(MIN_TEXT_ENTRANCES, withText)} or more (slam, typed, built from the motif, mask wipe, flip).`);
    if (!rows.some((r) => BREAKING_TONE.test(r.tone))) out.push("storyboard: no shot on a bright ground, inverted or filled with the accent; one breaks the tone.");
    const climaxes = rows.filter((r) => r.climax);
    if (climaxes.length !== 1) out.push(`storyboard: mark exactly one climax row (${climaxes.length} marked).`);
    else if (rows.some((r) => r !== climaxes[0] && norm(r.tone) === norm(climaxes[0]!.tone))) out.push(`storyboard: the climax's tone "${climaxes[0]!.tone}" repeats another shot's; the heaviest moment breaks the system (ground, scale, rhythm).`);
  }

  if (!brief.reskin) out.push("reskin: run the reskin test (how many shots would still work if the copy named another subject) and record it.");
  else if (rows.length > 0 && brief.reskin.generic * 3 > rows.length) out.push(`reskin: ${brief.reskin.generic} of ${rows.length} shots would work for any subject (over a third): the plan is a template; regrow those shots from the motifs.`);

  if (brief.direction.length < MIN_AXES) out.push(`direction: ${brief.direction.length} axes; draw at least ${MIN_AXES} (art style, palette, type, rhythm, camera, transitions, finish, copy tone, opening, ending) on purpose, differently from the last edit, each with a reason.`);
  return out;
}

/** The creative-direction axes and their options (after Tweenkit's scripts/brief.py, adapted to Zenvi's tools). */
export const DIRECTION_AXES: Readonly<Record<string, readonly string[]>> = {
  "art style": ["Swiss grid", "brutalist oversized type", "film documentary", "neon night", "paper collage", "minimal monochrome", "retro halftone print", "blueprint line drawing", "liquid gradient", "pixel dot matrix", "ink and empty space", "Bauhaus geometry", "magazine editorial", "information graphics", "low-poly 3D", "chalkboard hand-drawn"],
  palette: ["one colour plus one accent", "complementary clash", "black and white plus one fluorescent", "muted earth tones", "taken from the subject's own materials", "duotone", "high-key pastel", "night plus neon", "newsprint grey plus red", "cold then warm"],
  type: ["heavy serif display", "ultra-bold sans", "monospace technical", "hairline next to giant", "hand-drawn, wiped on stroke by stroke", "condensed stacked", "bilingual editorial mix"],
  rhythm: ["steady cut on every beat", "slow start, fast finish", "still then burst", "strobe climax mid-piece", "mostly one take, few cuts", "countdown", "fast and slow breathing", "three acts: set-up, unfold, hold"],
  camera: ["locked-off hard cuts", "continuous push-through", "lateral tracking", "dive and spin", "handheld drift", "split-screen angles", "tilted perspective planes", "macro pulling out to wide"],
  transitions: ["motif match cut", "mask wipe", "white flash cut", "zoom-through", "pixel or halftone dissolve", "page turn or tear", "colour block push", "glitch slice", "light sweep"],
  finish: ["clean, no aberration", "film grain and light leaks", "strong glow", "VHS scanlines", "halftone print", "flat, no post", "vignette and light grain"],
  "copy tone": ["manifesto lines", "numbers speak", "questions", "poetic images", "spoken, conversational", "contrast and suspense", "one word per shot"],
  opening: ["black, sound first", "macro pulling out", "countdown", "one object enters", "typed letter by letter", "straight into the hit", "a still photo comes alive"],
  ending: ["freeze as a poster", "back to the opening object", "breathe out", "hard cut to black on a hit", "logo built from the motif", "an open question over empty space", "timecode back to zero"],
};

/** A seeded draw: one option per axis, never the pick the last edit made on that axis when another exists. */
export function drawDirection(seed: number, last: Readonly<Record<string, string>> = {}): Record<string, string> {
  let state = seed >>> 0 || 1;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const out: Record<string, string> = {};
  for (const [axis, options] of Object.entries(DIRECTION_AXES)) {
    const fresh = options.filter((o) => norm(o) !== norm(last[axis] ?? ""));
    out[axis] = fresh[Math.floor(next() * fresh.length)]!;
  }
  return out;
}

/** The axes of `brief` that repeat `last`'s picks. */
export function repeatedAxes(brief: Brief, last: Readonly<Record<string, string>>): string[] {
  return brief.direction.filter((d) => last[norm(d.axis)] !== undefined && norm(last[norm(d.axis)]!) === norm(d.pick)).map((d) => d.axis);
}
