/**
 * Review of an edit: what a person sees when they watch the cut, as numbers
 * and a short list of problems with timestamps (review_edit_tool).
 */

import type { ShotSwap } from "./swaps.js";
export type PaceProfile = "fast" | "medium" | "slow";

/** How long things may last before they read as a slideshow, per kind of edit. */
export interface PaceLimits {
  /** Longest shot that still feels cut, seconds. */
  maxHold: number;
  /** Fewest cuts per second. */
  minCutsPerSecond: number;
  /** Longest stretch without sound, seconds. */
  maxSilence: number;
}

export interface ReviewShot {
  index: number;
  /** Timeline seconds. */
  start: number;
  end: number;
  duration: number;
  clipId: string;
  fileId: string;
  name: string;
  kind: "video" | "image";
  /** Source seconds the shot shows, for spotting reused footage. */
  sourceStart: number;
  sourceEnd: number;
  /** A transform keyframe moves it (push, pan, spin). */
  moves: boolean;
}

export interface ReviewCut {
  /** Timeline seconds where the next shot starts. */
  time: number;
  /** Index of the shot before and after (`ReviewShot.index`). */
  from: number;
  to: number;
  /** "transition" when a transition overlaps the cut. */
  style: "cut" | "transition";
}

/** A stretch of the timeline no footage covers. */
export interface EmptyStretch {
  start: number;
  end: number;
  /** A title sits on it (text on a plain background, often deliberate). */
  title: boolean;
}

export interface TextReview {
  /** Title/graphic clips in the range. */
  clips: number;
  /** Most on screen at once. */
  peak: number;
  /** Title clips that appear per second of the range. */
  perSecond: number;
  /** Share of the range with at least one on screen, 0-1. */
  coverage: number;
}

export interface TextBox {
  clipId: string;
  /** Frame fractions 0-1, origin top-left. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ShotStats {
  count: number;
  min: number;
  median: number;
  mean: number;
  max: number;
}

export interface TimelineReview {
  fps: number;
  /** The reviewed range, timeline seconds. */
  range: { start: number; end: number };
  shots: ReviewShot[];
  cuts: ReviewCut[];
  empty: EmptyStretch[];
  /** Short colour clips over footage: white/black flash frames made on the timeline. */
  colorFlashes: { start: number; end: number; clipId: string }[];
  text: TextReview;
  /** Titles' clip id, window and name, for reading-time and safe-area checks. */
  titleClips: { clipId: string; start: number; end: number; path: string }[];
  stats: ShotStats;
  cutsPerSecond: number;
  longestShot: { start: number; seconds: number; name: string } | null;
  /** A still image with no camera move, held the longest. */
  longestStaticHold: { start: number; seconds: number; name: string } | null;
  /** Stretches no audio clip covers. */
  silentGaps: { start: number; end: number }[];
  audioClips: number;
}

export type Severity = "high" | "medium" | "low";

export interface ReviewProblem {
  code: string;
  severity: Severity;
  /** Timeline seconds the problem starts at. */
  at: number;
  /** Where it ends, when it spans time. */
  until?: number;
  message: string;
  /** Every place it happens, when more than one. */
  times?: number[];
  /** What to do about it. */
  fix: string;
  /** Shots (`ReviewShot.index`) a swap would fix, for the footage problems. */
  shots?: number[];
  /** The swaps for them (review/swaps.ts), when the bin has footage to swap in. */
  swaps?: ShotSwap[];
}

export interface BeatAlignment {
  bpm: number;
  /** Cuts that land within the tolerance of a beat, 0-1. */
  onBeat: number;
  /** Cuts that land on a beat or a strong onset (hit, whoosh), 0-1. */
  onTransient: number;
  /** Seconds either side of a beat or onset that still counts. */
  tolerance: number;
  /** Cuts that miss, worst first: how early (-) or late (+) they are against the nearest beat/onset. */
  misses: { time: number; offset: number; nearest: number }[];
}

export interface MixReview {
  /** Integrated loudness, LUFS (EBU R128), null when the host cannot measure. */
  lufs: number | null;
  /** True peak (EBU R128), dBFS. */
  peakDb: number | null;
  silences: { start: number; end: number }[];
}
