/**
 * Reel styles: how a short-form edit is cut, moved, graded and titled.
 *
 * Each style is data the planner (plan.ts) and the builder
 * (tools/catalog/reels.ts) read; nothing here touches a project. Shot lengths
 * are in beats of the music (or of `defaultBpm` without music), so the cut
 * lands on the beat whatever the tempo. Paces come from measured short-form
 * edits: hype montages cut on 1/2 beats with 1/4-beat bursts (3-5 cuts/s at
 * 120-150 BPM), cinematic montages hold 1-2 beats, motion-led ads change
 * scene every bar or two.
 */

import type { LookPresetId } from "../ops/look.js";
import type { ClipPresetId } from "../ops/presets.js";
import type { MotionTransitionId } from "../transitions/motion/presets.js";
import type { FontFamilyId } from "../typography/families.js";

export const REEL_STYLE_IDS = ["hype", "cinematic", "highlight", "match_cut", "minimal", "editorial", "retro"] as const;
export type ReelStyleId = (typeof REEL_STYLE_IDS)[number];

export interface ReelTypography {
  /** Hook and end-card text case. */
  case: "upper" | "as_is";
  /** CSS font weight. */
  weight: 400 | 600 | 700 | 800 | 900;
  /** Letter spacing, in em. */
  tracking: number;
  /** A translucent dark plate behind the end card, for footage that is busy or bright. */
  endPlate: boolean;
  /**
   * How the hook title enters: a clip preset, or `slam_in` (lands from 135 %
   * to full size out of a blur in a few frames, the hype-edit title hit).
   */
  hookIn: ClipPresetId | "slam_in";
  /** Bundled faces, drawn as outlines so every renderer sets the same letters; without one, a system sans. */
  face?: ReelFace;
}

export interface ReelFace {
  /** Hook and end card. */
  display: FontFamilyId;
  /** Average advance of its capitals, in em (sizes the type before it is set). */
  advance: number;
  /** Shot labels. */
  label: FontFamilyId;
  /** Hollow outlined copies of a one-line end card above and below it. */
  echo: boolean;
}

/**
 * Accents on the cut (hype and highlight): motion transitions on the
 * downbeats, a glitch on the drop, a speed ramp winding up into it. Read by
 * reels/accents.ts.
 */
export interface ReelAccentStyle {
  /** Downbeat cuts before the climax, in one direction for the whole reel (the vector law). */
  body: MotionTransitionId | null;
  /** The drop: the first cut of the climax, on a downbeat. */
  drop: MotionTransitionId;
  /** Downbeat cuts after the drop, cycled. */
  climax: readonly MotionTransitionId[];
  /** The cut into the last shot (an arrival), spent once. */
  landing: MotionTransitionId | null;
  /** Beats the shot before the drop holds while it ramps from slow motion into a rush (0: no ramp). */
  windupBeats: number;
}

export interface ReelStyle {
  id: ReelStyleId;
  name: string;
  /** What it suits, one line (tool descriptions, the brief). */
  summary: string;
  defaultSeconds: number;
  /** Tempo of the cut grid when there is no music. */
  defaultBpm: number;
  /** Shot lengths in beats, cycled through the body of the reel. */
  pattern: readonly number[];
  /** Shot lengths from two thirds in (the climax), when faster than the body. */
  climax?: readonly number[];
  /** Beats the first shot holds (the opening, under the hook title). */
  firstBeats: number;
  /** Beats the last shot holds (under the end card). */
  lastBeats: number;
  /** Camera move per shot. `null` keeps the frame still (match cuts rely on it). */
  motion: { video: ClipPresetId | null; image: ClipPresetId };
  /** White flash frames on cuts: every downbeat, the climax's downbeats, or the downbeats that start a section (body, drop, last shot). */
  flash: "none" | "downbeats" | "climax_downbeats" | "sections";
  /** Looks applied to every shot, in order. */
  /** Look presets for every shot, at most one per family: a clip has one Color Grade, so a second colour preset replaces the first. */
  looks: readonly LookPresetId[];
  /** Share of the shots' own sound kept under the music (0 = music only). */
  clipVolume: number;
  accents?: ReelAccentStyle;
  /** Fade the picture in from black and out to black. */
  fadeIn: boolean;
  fadeOut: boolean;
  typography: ReelTypography;
  /** Brief lines. */
  pace: string;
  look: string;
}

/** Condensed display capitals with small mono labels, as the hype references set them. */
const DISPLAY: ReelTypography = {
  case: "upper",
  weight: 400,
  tracking: 0.01,
  endPlate: false,
  hookIn: "slam_in",
  face: { display: "anton", advance: 0.5, label: "space-mono", echo: true },
};

export const REEL_STYLES: Readonly<Record<ReelStyleId, ReelStyle>> = {
  hype: {
    id: "hype",
    name: "Hype montage",
    summary: "Energetic montage for launches, sports, events and travel: fast cuts on the beat, flashes on the downbeats, punchy colour.",
    defaultSeconds: 15,
    defaultBpm: 128,
    // About 0.23 s a shot at 128 BPM, quarter-beat bursts (3-4 frames) in the climax: the references average 0.16-0.25 s.
    pattern: [0.5, 0.5, 0.5, 0.5, 1, 0.5, 0.25, 0.25],
    climax: [0.5, 0.25, 0.25, 0.5, 0.25, 0.25, 0.25, 0.25],
    firstBeats: 2,
    lastBeats: 4,
    motion: { video: "animate.cam_push_in", image: "animate.ken_burns_in" },
    flash: "sections",
    looks: ["color.boost_color", "film_grain.35mm_fine"],
    clipVolume: 0,
    accents: { body: "whip", drop: "glitch", climax: ["flash_invert", "glitch"], landing: "zoom_out", windupBeats: 2 },
    fadeIn: false,
    fadeOut: true,
    typography: DISPLAY,
    pace: "Fast cuts that land on the beat; a slow-motion wind-up ramps into the drop, then faster cuts with glitch and negative hits; white flashes open each section",
    look: "Punchy colour and contrast, fine film grain, slow push-ins, whips in one direction, condensed display type",
  },
  cinematic: {
    id: "cinematic",
    name: "Cinematic montage",
    summary: "Moody, filmic montage for stories, brands and places: steady 2-beat shots, slow push-ins, grain, fades.",
    defaultSeconds: 20,
    defaultBpm: 96,
    pattern: [2, 2, 2, 2],
    climax: [1, 1, 2, 1, 1, 2],
    firstBeats: 4,
    lastBeats: 4,
    motion: { video: "animate.cam_push_in", image: "animate.ken_burns_in" },
    flash: "none",
    looks: ["color.lift_shadows", "film_grain.35mm_classic"],
    clipVolume: 0,
    fadeIn: true,
    fadeOut: true,
    typography: { case: "upper", weight: 600, tracking: 0.28, endPlate: false, hookIn: "animate.wipe_in_fade" },
    pace: "Shots hold two beats and tighten to one in the climax; fades in and out",
    look: "Lifted shadows, 35mm grain, slow push-ins, spaced capitals",
  },
  highlight: {
    id: "highlight",
    name: "Highlight reel",
    summary: "The best moments of the person's own clips (games, trips, events): cut on the beat, building to the big moment.",
    defaultSeconds: 12,
    defaultBpm: 120,
    pattern: [2, 1, 1, 2],
    climax: [1, 1, 0.5, 0.5, 1],
    firstBeats: 2,
    lastBeats: 4,
    motion: { video: "animate.cam_push_in", image: "animate.ken_burns_in" },
    flash: "sections",
    looks: ["color.boost_color"],
    clipVolume: 0.15,
    accents: { body: "whip", drop: "glitch", climax: ["zoom_in"], landing: "zoom_out", windupBeats: 2 },
    fadeIn: false,
    fadeOut: true,
    typography: DISPLAY,
    pace: "Cuts on the beat; a slow-motion wind-up ramps into the big moment, faster cuts with punch zooms after it, then a hold on the payoff",
    look: "Punchy colour, a little of the real sound under the music, condensed display type",
  },
  match_cut: {
    id: "match_cut",
    name: "Match cuts",
    summary: "Shots that share a shape or pose cut on every beat (circles, hands, horizons): the frame stays still so the shapes line up.",
    defaultSeconds: 15,
    defaultBpm: 120,
    pattern: [1],
    firstBeats: 2,
    lastBeats: 4,
    motion: { video: null, image: "animate.none" },
    flash: "none",
    looks: ["color.warm_up", "film_grain.16mm_classic"],
    clipVolume: 0,
    fadeIn: false,
    fadeOut: true,
    typography: { case: "upper", weight: 400, tracking: 0.45, endPlate: false, hookIn: "animate.wipe_in_fade" },
    pace: "A hard cut on every beat; no camera moves, so matching shapes line up",
    look: "Warm film, 16mm grain, small spaced capitals",
  },
  minimal: {
    id: "minimal",
    name: "Calm and minimal",
    summary: "Slow, airy edit for wellness, food, interiors and products: long holds, gentle moves, soft fades.",
    defaultSeconds: 20,
    defaultBpm: 80,
    pattern: [4],
    firstBeats: 4,
    lastBeats: 6,
    motion: { video: "animate.cam_push_in", image: "animate.ken_burns_in" },
    flash: "none",
    looks: ["color.warm_up", "film_grain.35mm_fine"],
    clipVolume: 0,
    fadeIn: true,
    fadeOut: true,
    typography: { case: "as_is", weight: 400, tracking: 0.04, endPlate: false, hookIn: "animate.wipe_in_fade" },
    pace: "Long four-beat holds with gentle moves and soft fades",
    look: "Warm, soft, fine grain, light type",
  },
  editorial: {
    id: "editorial",
    name: "Editorial",
    summary: "Graphic, magazine-like cut for fashion, design and tech: crisp cuts on 1/2 beats, labels on the shots, clean contrast.",
    defaultSeconds: 12,
    defaultBpm: 110,
    pattern: [1, 0.5, 0.5, 1, 1, 0.5, 0.5],
    firstBeats: 2,
    lastBeats: 4,
    motion: { video: null, image: "animate.none" },
    flash: "none",
    looks: ["color.auto_contrast"],
    clipVolume: 0,
    fadeIn: false,
    fadeOut: false,
    typography: { case: "upper", weight: 800, tracking: -0.01, endPlate: true, hookIn: "animate.slide_in_left" },
    pace: "Crisp cuts on half beats with a label on each shot",
    look: "Clean contrast, bold tight type, still frames",
  },
  retro: {
    id: "retro",
    name: "Retro tape",
    summary: "Nostalgic camcorder feel for vlogs, throwbacks and music: tape artefacts, warm colour, super 8 grain.",
    defaultSeconds: 15,
    defaultBpm: 100,
    pattern: [2, 1, 1],
    firstBeats: 2,
    lastBeats: 4,
    motion: { video: null, image: "animate.ken_burns_in" },
    flash: "none",
    looks: ["analog_tape.vhs", "film_grain.super_8", "color.warm_up"],
    clipVolume: 0.1,
    fadeIn: true,
    fadeOut: true,
    typography: { case: "upper", weight: 800, tracking: 0.08, endPlate: false, hookIn: "animate.pop_in" },
    pace: "Relaxed one- and two-beat cuts",
    look: "VHS tape, super 8 grain, warm colour",
  },
};

export function isReelStyleId(value: string): value is ReelStyleId {
  return (REEL_STYLE_IDS as readonly string[]).includes(value);
}
