/**
 * Style mixes for transitioning every cut on a track.
 *
 * Planning follows "The Current" and "Transition vocabulary" of HeyGen
 * HyperFrames' motion doctrine (Apache-2.0,
 * .claude/skills/motion-doctrine/SKILL.md): a sequence keeps ONE dominant
 * direction (default left) on every ordinary cut and never flips it on
 * consecutive cuts; it uses two or three transitions and repeats them; the
 * reserved vectors (zoom-through: deeper into the same thought; pull-back:
 * an arrival) are spent once, as the accent on the last cut. Deterministic,
 * so the same call always gives the same edit.
 *
 * Most styles cut hard most of the time (zenvi-styles styles/*.md "Motion &
 * transitions": brand films ~70 % hard cuts, flash edits 85 %, travel only
 * on block changes); `every` is how many cuts share one move, the others
 * staying hard, so a style never puts one whip on every cut (bench round 7,
 * brand story).
 */

import type { MotionTransitionId } from "./presets.js";

export interface StyleStep {
  preset: MotionTransitionId;
  intensity?: number;
}

export interface MotionTransitionStyleDef {
  /** Repeated move by move. */
  pattern: readonly StyleStep[];
  /** The last cut of a sequence of three or more. */
  accent: StyleStep;
  /** One move every this many cuts (the last of each group), the rest hard cuts; default 1 (every cut). */
  every?: number;
}

export const MOTION_TRANSITION_STYLES = {
  /** Social / hype edit: whips in the current with a crash zoom every third cut; it lands with a pull-back. */
  hype: { pattern: [{ preset: "whip" }, { preset: "whip" }, { preset: "zoom_in" }], accent: { preset: "zoom_out" } },
  /** Restrained, filmic: pushes in the current and defocus cuts; it ends by flying into the last shot. */
  cinematic: { pattern: [{ preset: "slide", intensity: 0.7 }, { preset: "blur_dissolve" }], accent: { preset: "zoom_through", intensity: 0.7 } },
  /** Broadcast sports / gaming: every other cut a whip, a tilt, a crash zoom or a glitch; it ends flying in. */
  sport: { pattern: [{ preset: "whip" }, { preset: "tilt" }, { preset: "zoom_in" }, { preset: "glitch" }], accent: { preset: "zoom_through" }, every: 2 },
  /** Flash cuts (Dc_2Y1qI0ZH): inverted and white frames and a glitch between hard cuts, a punch now and then. */
  flash: { pattern: [{ preset: "flash_invert" }, { preset: "glitch" }, { preset: "flash_white", intensity: 0.8 }, { preset: "zoom_in" }], accent: { preset: "zoom_through" }, every: 2 },
  /** Brand story / corporate: hard cuts, one move in three (a push, a defocus, a tilt); the end flies into the last shot. */
  brand: { pattern: [{ preset: "slide", intensity: 0.7 }, { preset: "blur_dissolve" }, { preset: "tilt", intensity: 0.6 }], accent: { preset: "zoom_through", intensity: 0.7 }, every: 3 },
  /** Editorial / kinetic type: every other cut a push or a soft white flash; it lands with a pull-back. */
  editorial: { pattern: [{ preset: "slide", intensity: 0.8 }, { preset: "flash_white", intensity: 0.5 }], accent: { preset: "zoom_out", intensity: 0.7 }, every: 2 },
  /** Match-cut chains: the aligned subject is the transition; a crash zoom or a glitch on one cut in four, flying into the subject at the end. */
  punch: { pattern: [{ preset: "zoom_in" }, { preset: "glitch" }], accent: { preset: "zoom_through" }, every: 4 },
  /** Travel / real estate: the cadence is the transition; a zoom-through or a tilt on one cut in four. */
  travel: { pattern: [{ preset: "zoom_through", intensity: 0.6 }, { preset: "tilt", intensity: 0.7 }], accent: { preset: "zoom_through", intensity: 0.7 }, every: 4 },
  /** Wedding / event / lifestyle: calm; a slow defocus or a soft flash on one cut in three, a defocus at the end. */
  gentle: { pattern: [{ preset: "blur_dissolve", intensity: 0.7 }, { preset: "flash_white", intensity: 0.4 }], accent: { preset: "blur_dissolve", intensity: 0.8 }, every: 3 },
} as const satisfies Record<string, MotionTransitionStyleDef>;

export type MotionTransitionStyle = keyof typeof MOTION_TRANSITION_STYLES;
export const MOTION_TRANSITION_STYLE_IDS = Object.keys(MOTION_TRANSITION_STYLES) as MotionTransitionStyle[];

function everyOf(style: MotionTransitionStyle): number {
  const def: MotionTransitionStyleDef = MOTION_TRANSITION_STYLES[style];
  return def.every ?? 1;
}

/**
 * The step for cut `index` (0-based) of a sequence of `count` cuts, or null
 * for a hard cut. Moves fall on the last cut of each group of `every`; the
 * cut just before the accent stays hard when the style spaces its moves.
 */
export function styleStep(style: MotionTransitionStyle, index: number, count: number): StyleStep | null {
  const def: MotionTransitionStyleDef = MOTION_TRANSITION_STYLES[style];
  const every = everyOf(style);
  if (count >= 3 && index === count - 1) return def.accent;
  // One or two cuts in all: the last one still moves, so the call is not a no-op.
  if (count < 3 && index === count - 1 && every > count) return def.pattern[0]!;
  if (every > 1 && count >= 3 && index === count - 2) return null;
  if ((index + 1) % every !== 0) return null;
  const move = Math.floor(index / every);
  return def.pattern[move % def.pattern.length]!;
}

/** Every preset a style can use. */
export function stylePresets(style: MotionTransitionStyle): MotionTransitionId[] {
  const def: MotionTransitionStyleDef = MOTION_TRANSITION_STYLES[style];
  return [...new Set([...def.pattern.map((s) => s.preset), def.accent.preset])];
}

/** One move every this many cuts (1: every cut). */
export function styleEvery(style: MotionTransitionStyle): number {
  return everyOf(style);
}

/**
 * The mix for a brief's style id (zenvi-styles styles/*.md, or the free
 * text agents save: "hype-reel", "flash-montage"), by the words in it; the
 * cinematic mix when nothing matches.
 */
export function styleForBrief(briefStyle: string | undefined): MotionTransitionStyle {
  const s = (briefStyle ?? "").toLowerCase();
  // Each name starts a word ("app" in saas-app-launch, not in "happy").
  const rules: [RegExp, MotionTransitionStyle][] = [
    [/\b(?:flash|cosmic|strobe)/, "flash"],
    [/\b(?:match)/, "punch"],
    [/\b(?:hype)/, "hype"],
    [/\b(?:sport|gaming|fitness|automotive)/, "sport"],
    [/\b(?:wedding|event|food|lifestyle)/, "gentle"],
    [/\b(?:travel|real.?estate|tour)/, "travel"],
    [/\b(?:saas|ui.?promo|app|explainer|tech|3d|product)/, "cinematic"],
    [/\b(?:brand|corporate|launch|documentary|essay|science|kids|fashion|ugc|testimonial)/, "brand"],
    [/\b(?:editorial|kinetic|type|lyric|news|podcast|talking|caption)/, "editorial"],
  ];
  return rules.find(([re]) => re.test(s))?.[1] ?? "cinematic";
}
