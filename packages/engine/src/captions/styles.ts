/**
 * Kinetic caption styles: each a default matched to reference reels, so an
 * agent gets a tasteful result by naming one.
 *
 *   creator      Dc3mgNJO73W: groups of 2-4 words revealed word by word; the
 *                emphasis word huge in condensed capitals (Anton) in the
 *                accent red on its own line, connectors small in white Inter
 *                around it; words pop in (expo out), the group cuts away.
 *   documentary  DezFTyktEUp / DdR32Wpy4mg: a phrase at a time, small white
 *                Inter on the lower safe line, soft shadow, fades; emphasis
 *                only in weight.
 *   split        Dej3WX-s86l: two small words, one each side of the subject
 *                (the first avoid box) at its middle, fading in.
 *   karaoke      a line of up to four bold capitals; the word being said is
 *                marked by an accent pill as it is spoken.
 *   stack        DekLMhxqrFE: one word per line in condensed capitals (Bebas
 *                Neue), left aligned in the negative space beside the
 *                subject, each word sliding up as it is said; emphasis in
 *                the accent and larger.
 *   editorial    serif (Instrument Serif) phrases centred, emphasis in the
 *                italic and the accent; each word rises softly as it is said.
 *
 * Sizes are px at a 1080 px short side (TASTE.md type scale: caption 42 px),
 * scaled with the frame. Motion follows TASTE.md: entrances 0.2-0.4 s with
 * out easings, exits faster with in easings, travel 2-4 % of the frame.
 */

import type { FontFamilyId } from "../typography/families.js";
import type { Ease } from "../motion/types.js";
import type { GroupRules } from "./words.js";

export const CAPTION_STYLE_IDS = ["creator", "documentary", "split", "karaoke", "stack", "editorial"] as const;
export type CaptionStyleId = (typeof CAPTION_STYLE_IDS)[number];

export interface CaptionFace {
  family: FontFamilyId;
  weight: number;
  italic?: boolean;
  /** Px at a 1080 px short side. */
  size: number;
  transform: "none" | "upper" | "lower";
  /** Em. */
  tracking: number;
  /** "ink" or "accent". */
  fill: "ink" | "accent";
  /** Set as wide as the measure allows, up to this size (px at a 1080 px short side): emphasis words that fill the frame. */
  fillTo?: number;
}

/** How words arrive and leave. */
export interface CaptionMotion {
  /** Entrance length, seconds. */
  enter: number;
  /** Start pose relative to rest: scale, and travel as a share of the frame height (down positive). */
  fromScale: number;
  fromY: number;
  enterEase: Ease;
  /** Exit length, seconds (0: cut). */
  exit: number;
  toScale: number;
  exitEase: Ease;
}

export type CaptionArrangement =
  /** Lines of connectors with each emphasis word on a line of its own, centred. */
  | "mixed"
  /** Words flowing in balanced lines, centred. */
  | "lines"
  /** First half of the group left of the subject, second half right of it. */
  | "split"
  /** One word per line, left aligned. */
  | "column";

/** Where a group may go, in order of preference: its centre as shares of the frame. */
export interface Spot {
  x: number;
  y: number;
}

export interface CaptionStyle {
  id: CaptionStyleId;
  summary: string;
  groups: GroupRules;
  base: CaptionFace;
  emphasis: CaptionFace;
  /** Emphasised words per group in auto mode, and the lowest score that counts (words.ts EMPHASIS_FLOOR). */
  perGroup: number;
  floor: number;
  arrangement: CaptionArrangement;
  /** Widest a group may be, share of the safe width. */
  measure: number;
  /** Words appear one by one at their times (else the group at once). */
  reveal: "word" | "group";
  /** The word being said is marked with an accent pill (karaoke). */
  marker: boolean;
  motion: CaptionMotion;
  spots: { portrait: readonly Spot[]; landscape: readonly Spot[] };
  /** Drop trailing punctuation from words (display captions), or keep it (sentences). */
  punctuation: "strip" | "keep";
  /** A soft dark halo and drop under each word, for legibility over footage. */
  shadow: boolean;
  /** Line gap, × the base size. */
  gap: number;
}

const POP: CaptionMotion = { enter: 0.2, fromScale: 0.55, fromY: 0, enterEase: "out_strong", exit: 0.1, toScale: 0.94, exitEase: "in" };
const FADE_RISE: CaptionMotion = { enter: 0.3, fromScale: 1, fromY: 0.012, enterEase: "out", exit: 0.2, toScale: 1, exitEase: "in" };

export const CAPTION_STYLES: Readonly<Record<CaptionStyleId, CaptionStyle>> = {
  creator: {
    id: "creator",
    summary: "word by word; emphasis huge red condensed capitals, connectors small white (creator talking heads)",
    groups: { maxWords: 4, maxChars: 26, maxGap: 0.45, tail: 0.35, minHold: 0.5 },
    base: { family: "inter", weight: 700, size: 50, transform: "lower", tracking: -0.01, fill: "ink" },
    emphasis: { family: "anton", weight: 400, size: 190, transform: "upper", tracking: -0.005, fill: "accent", fillTo: 320 },
    perGroup: 1,
    floor: 0.5,
    arrangement: "mixed",
    measure: 0.9,
    reveal: "word",
    marker: false,
    motion: POP,
    spots: { portrait: [{ x: 0.5, y: 0.66 }, { x: 0.5, y: 0.3 }, { x: 0.5, y: 0.5 }], landscape: [{ x: 0.5, y: 0.7 }, { x: 0.27, y: 0.5 }, { x: 0.73, y: 0.5 }] },
    punctuation: "strip",
    shadow: true,
    gap: 0.22,
  },
  documentary: {
    id: "documentary",
    summary: "a phrase at a time, small white Inter on the lower safe line, soft fades (video essays, documentaries)",
    groups: { maxWords: 7, maxChars: 34, maxGap: 0.7, tail: 0.5, minHold: 0.9 },
    base: { family: "inter", weight: 600, size: 46, transform: "none", tracking: 0, fill: "ink" },
    emphasis: { family: "inter", weight: 800, size: 46, transform: "none", tracking: 0, fill: "ink" },
    perGroup: 1,
    floor: 3,
    arrangement: "lines",
    measure: 0.86,
    reveal: "group",
    marker: false,
    motion: { enter: 0.2, fromScale: 1, fromY: 0.006, enterEase: "out", exit: 0.15, toScale: 1, exitEase: "in" },
    spots: { portrait: [{ x: 0.5, y: 0.75 }, { x: 0.5, y: 0.2 }], landscape: [{ x: 0.5, y: 0.84 }, { x: 0.5, y: 0.16 }] },
    punctuation: "keep",
    shadow: true,
    gap: 0.3,
  },
  split: {
    id: "split",
    summary: "two small words, one each side of the subject (storytelling, cinematic B-roll)",
    groups: { maxWords: 2, maxChars: 22, maxGap: 0.5, tail: 0.45, minHold: 0.6 },
    base: { family: "inter", weight: 600, size: 44, transform: "lower", tracking: 0.01, fill: "ink" },
    emphasis: { family: "inter", weight: 700, size: 44, transform: "lower", tracking: 0.01, fill: "ink" },
    perGroup: 0,
    floor: 1.5,
    arrangement: "split",
    measure: 0.42,
    reveal: "word",
    marker: false,
    motion: { enter: 0.35, fromScale: 1, fromY: 0.008, enterEase: "out", exit: 0.2, toScale: 1, exitEase: "in" },
    spots: { portrait: [{ x: 0.5, y: 0.45 }], landscape: [{ x: 0.5, y: 0.45 }] },
    punctuation: "strip",
    shadow: true,
    gap: 0.3,
  },
  karaoke: {
    id: "karaoke",
    summary: "a line of bold capitals; the word being said lights up in an accent pill",
    groups: { maxWords: 4, maxChars: 24, maxGap: 0.6, tail: 0.3, minHold: 0.6 },
    base: { family: "inter", weight: 800, size: 64, transform: "upper", tracking: -0.01, fill: "ink" },
    emphasis: { family: "inter", weight: 900, size: 64, transform: "upper", tracking: -0.01, fill: "ink" },
    perGroup: 0,
    floor: 1.5,
    arrangement: "lines",
    measure: 0.9,
    reveal: "group",
    marker: true,
    motion: { enter: 0.15, fromScale: 0.92, fromY: 0, enterEase: "out_strong", exit: 0.1, toScale: 1, exitEase: "in" },
    spots: { portrait: [{ x: 0.5, y: 0.68 }, { x: 0.5, y: 0.3 }], landscape: [{ x: 0.5, y: 0.78 }, { x: 0.5, y: 0.22 }] },
    punctuation: "strip",
    shadow: true,
    gap: 0.25,
  },
  stack: {
    id: "stack",
    summary: "one condensed capital word per line, left aligned in the negative space, sliding up word by word",
    groups: { maxWords: 3, maxChars: 22, maxGap: 0.5, tail: 0.4, minHold: 0.6 },
    base: { family: "bebas-neue", weight: 400, size: 120, transform: "upper", tracking: 0.01, fill: "ink" },
    emphasis: { family: "bebas-neue", weight: 400, size: 170, transform: "upper", tracking: 0.01, fill: "accent", fillTo: 260 },
    perGroup: 1,
    floor: 0.5,
    arrangement: "column",
    measure: 0.5,
    reveal: "word",
    marker: false,
    motion: { enter: 0.3, fromScale: 1, fromY: 0.03, enterEase: "out_strong", exit: 0.15, toScale: 1, exitEase: "in" },
    spots: { portrait: [{ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }, { x: 0.3, y: 0.7 }], landscape: [{ x: 0.22, y: 0.5 }, { x: 0.78, y: 0.5 }] },
    punctuation: "strip",
    shadow: true,
    gap: 0.06,
  },
  editorial: {
    id: "editorial",
    summary: "serif phrases centred, the emphasis word in italic accent, each word rising softly",
    groups: { maxWords: 5, maxChars: 28, maxGap: 0.6, tail: 0.45, minHold: 0.8 },
    base: { family: "instrument-serif", weight: 400, size: 80, transform: "none", tracking: -0.01, fill: "ink" },
    emphasis: { family: "instrument-serif", weight: 400, italic: true, size: 80, transform: "none", tracking: -0.01, fill: "accent" },
    perGroup: 1,
    floor: 1,
    arrangement: "lines",
    measure: 0.84,
    reveal: "word",
    marker: false,
    motion: FADE_RISE,
    spots: { portrait: [{ x: 0.5, y: 0.64 }, { x: 0.5, y: 0.32 }], landscape: [{ x: 0.5, y: 0.74 }, { x: 0.5, y: 0.26 }] },
    punctuation: "keep",
    shadow: true,
    gap: 0.12,
  },
};

/** Default colours: white ink, a creator red; a karaoke yellow. */
export const DEFAULT_INK = "#ffffff";
export const DEFAULT_ACCENT: Readonly<Record<CaptionStyleId, string>> = {
  creator: "#ff2d2d",
  documentary: "#ffd60a",
  split: "#ffffff",
  karaoke: "#ffd60a",
  stack: "#ff2d2d",
  editorial: "#ffd60a",
};
