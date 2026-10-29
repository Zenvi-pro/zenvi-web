/**
 * The rhythm checks of a fast-cut render — what a few stills cannot show and
 * an ear can: shot lengths that never vary (a metronome, not a rhythm curve),
 * a shot that goes still after its main action (dead air), a piece whose
 * brightness or colour never moves (no value rhythm, a climax that looks like
 * every other shot), and cuts with no sound on them.
 *
 * Adapted from the QA report of Tweenkit's kinetic-cut-video skill (MIT,
 * © 2026 wmzspace: scripts/build.py `qa`; see plugins/zenvi/skills/zenvi-styles/NOTICE).
 * Its thresholds are kept: lengths quantised to a quarter second, a still
 * stretch over 0.6 s, a luma spread under 0.2, a hue spread under 0.05, an
 * onset at a cut under 4x the median onset.
 */

import type { PictureSeries } from "../tools/types.js";
import type { Problem, Shot } from "./render.js";

/** An edit whose shots average this or less is fast-cut: these checks apply to it. */
export const FAST_CUT_SECONDS = 2.5;
/** Mean luma change per 1/15 s under this is still (Tweenkit: 0.35/255 a frame at 30 fps, twice at half the rate). */
const STILL_MOTION = 0.7 / 255;
const MAX_STILL_SECONDS = 0.6;
const MIN_LUMA_SPREAD = 0.2;
const MIN_HUE_SPREAD = 0.05;
/** Shots with less mean chroma than this are grey: their hue is noise. */
const GREY_CHROMA = 0.03;
/** A cut's onset must be this many times the median onset of the mix. */
const ONSET_RATIO = 4;

export interface ShotPicture {
  index: number;
  /** Mean luma 0-1. */
  luma: number;
  /** Hue of the shot's mean chroma, degrees; null for a grey shot. */
  hue: number | null;
  chroma: number;
  /** Longest stretch with almost no picture change, seconds. */
  longestStill: number;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
const fmt = (v: number): string => `${r2(v).toFixed(2)}s`;

/** Each shot's mean luma and colour and its longest still stretch, from the sampled picture. */
export function shotPictures(series: PictureSeries, shots: readonly Shot[]): ShotPicture[] {
  const step = 1 / Math.max(1, series.fps);
  const out: ShotPicture[] = [];
  for (const shot of shots) {
    const idx: number[] = [];
    series.t.forEach((t, i) => {
      if (t >= shot.start && t < shot.end) idx.push(i);
    });
    if (idx.length < 3) continue;
    const mean = (xs: readonly number[]): number => idx.reduce((s, i) => s + xs[i]!, 0) / idx.length;
    const u = mean(series.u);
    const v = mean(series.v);
    const chroma = Math.hypot(u, v);
    // The first two samples of a shot carry the cut's own change.
    let run = 0;
    let best = 0;
    for (const i of idx.slice(2)) {
      run = series.motion[i]! < STILL_MOTION ? run + 1 : 0;
      best = Math.max(best, run);
    }
    out.push({
      index: shot.index,
      luma: r2(mean(series.luma)),
      hue: chroma < GREY_CHROMA ? null : Math.round(((Math.atan2(v, u) * 180) / Math.PI + 360) % 360),
      chroma: Math.round(chroma * 1000) / 1000,
      longestStill: r2(best * step),
    });
  }
  return out;
}

/**
 * How strongly the audio starts something at each of `times`: the largest
 * rise of 10 ms RMS within 40 ms before to 50 ms after, over the median rise
 * of the whole mix (Tweenkit's onset test). 0 for silence.
 */
export function onsetRatios(samples: Float32Array, sampleRate: number, times: readonly number[]): number[] {
  const hop = Math.max(1, Math.round(sampleRate / 100));
  const n = Math.floor(samples.length / hop);
  const rise = new Float64Array(n);
  let prev = 0;
  for (let f = 0; f < n; f += 1) {
    let sum = 0;
    for (let k = f * hop; k < (f + 1) * hop; k += 1) sum += samples[k]! * samples[k]!;
    const e = Math.sqrt(sum / hop);
    rise[f] = Math.max(0, e - prev);
    prev = e;
  }
  const positive = Array.from(rise).filter((x) => x > 0).sort((a, b) => a - b);
  const median = (positive[Math.floor(positive.length / 2)] ?? 0) + 1e-9;
  return times.map((t) => {
    const at = Math.round(t * 100);
    let peak = 0;
    for (let f = Math.max(0, at - 4); f < Math.min(n, at + 5); f += 1) peak = Math.max(peak, rise[f]!);
    return positive.length === 0 ? 0 : r2(peak / median);
  });
}

export interface RhythmReview {
  /** True when the checks applied (4+ shots averaging FAST_CUT_SECONDS or less). */
  fastCut: boolean;
  pictures: ShotPicture[];
  /** Cuts (seconds) with no clear sound on them; null when the audio was not read. */
  weakCuts: number[] | null;
  problems: Problem[];
}

/**
 * The rhythm problems of `shots` (warnings: a slow edit may want all of
 * these). `onsets` are `onsetRatios` at every cut but the first shot's start.
 * The last shot is the end's hold and is not asked to move.
 */
export function rhythmReview(shots: readonly Shot[], duration: number, series: PictureSeries | undefined, onsets: readonly number[] | null, frozen: readonly { start: number; end: number }[] = []): RhythmReview {
  const fastCut = shots.length >= 4 && duration / shots.length <= FAST_CUT_SECONDS;
  const pictures = series ? shotPictures(series, shots) : [];
  const cuts = shots.slice(1).map((s) => s.start);
  const weakCuts = onsets ? cuts.filter((c, i) => c < duration - 0.05 && onsets[i]! < ONSET_RATIO) : null;
  if (!fastCut) return { fastCut, pictures, weakCuts, problems: [] };
  const problems: Problem[] = [];
  const lengths = shots.map((s) => s.end - s.start);
  const distinct = new Set(lengths.map((l) => Math.round(l * 4) / 4)).size;
  if (distinct <= Math.max(1, Math.floor(shots.length / 4))) {
    problems.push({
      kind: "uniform_shot_lengths",
      severity: "warning",
      message: `shot lengths are nearly uniform (${distinct} distinct in ${shots.length} shots, about ${fmt(lengths.reduce((a, b) => a + b, 0) / shots.length)} each): vary them (1 / 2 / 4 / 8 beats) into a curve — set-up, speed-up, breath, climax, hold`,
    });
  }
  const last = shots[shots.length - 1]?.index;
  for (const p of pictures) {
    if (p.index === last || p.longestStill <= MAX_STILL_SECONDS) continue;
    const shot = shots.find((s) => s.index === p.index)!;
    if (frozen.some((f) => f.start < shot.end && shot.start < f.end)) continue;
    problems.push({
      kind: "static_shot",
      severity: "warning",
      at: shot.start,
      message: `shot #${p.index} (${fmt(shot.start)}) sits ${fmt(p.longestStill)} with almost no motion: add a second layer of motion (a slow push, a drift, particles) or a second event after its main action`,
    });
  }
  if (pictures.length >= 3) {
    const lumas = pictures.map((p) => p.luma);
    if (Math.max(...lumas) - Math.min(...lumas) < MIN_LUMA_SPREAD) {
      problems.push({
        kind: "flat_brightness",
        severity: "warning",
        message: `brightness barely changes across shots (${Math.min(...lumas).toFixed(2)}–${Math.max(...lumas).toFixed(2)}): plan a value rhythm — at least one bright, inverted or accent-filled shot, and a climax that breaks the look`,
      });
    }
  }
  const hued = pictures.filter((p) => p.hue !== null);
  if (pictures.length >= 4 && hued.length >= 4) {
    const rad = hued.map((p) => (p.hue! * Math.PI) / 180);
    const spread = 1 - Math.hypot(rad.reduce((s, a) => s + Math.cos(a), 0) / rad.length, rad.reduce((s, a) => s + Math.sin(a), 0) / rad.length);
    if (spread < MIN_HUE_SPREAD) {
      problems.push({ kind: "flat_hue", severity: "warning", message: "every shot sits on the same hue: bring in the accent or a contrasting colour as a full-frame moment somewhere" });
    }
  }
  if (weakCuts && weakCuts.length > 0) {
    problems.push({
      kind: "cut_without_sound",
      severity: "warning",
      at: weakCuts[0]!,
      message: `${weakCuts.length} of ${cuts.length} cuts have no clear sound on them (${weakCuts.slice(0, 8).map(fmt).join(", ")}${weakCuts.length > 8 ? ", …" : ""}): put a hit, a drum or a timbre change on every cut (add_sfx_tool, auto_sound_design_tool)`,
    });
  }
  return { fastCut, pictures, weakCuts, problems };
}
