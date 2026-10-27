/**
 * The beat grid as a template sees it: beat k after the template's start, as
 * a whole frame from that start. Built on the reel planner's grid
 * (reels/plan.ts `timeAtBeat`, `onFrameGrid`), so a motion layer placed on a
 * beat lands on the same frame as a reel cut on that beat.
 */

import { timeAtBeat } from "../reels/plan.js";
import type { BeatGrid } from "./types.js";

/** A beat counts as "at" the start when it is less than this many seconds before it. */
const ON_BEAT = 0.02;
/** Entrances skip every other beat when beats come faster than this, seconds. */
const FASTEST_EVENT = 0.38;

/** A steady grid at `bpm` from `offset` seconds, long enough to cover `seconds`. */
export function tempoGrid(bpm: number, seconds: number, offset = 0): BeatGrid {
  if (!(bpm > 0)) throw new Error(`bpm must be above 0 (got ${bpm})`);
  const period = 60 / bpm;
  const beats: number[] = [];
  for (let t = offset; t <= offset + seconds + period; t += period) beats.push(Math.round(t * 1000) / 1000);
  return { bpm, beats, downbeats: beats.filter((_, i) => i % 4 === 0) };
}

/** A grid from beat times (seconds), tempo from their median gap; every fourth beat a downbeat unless given. */
export function gridFromBeats(times: readonly number[], downbeats?: readonly number[]): BeatGrid {
  const beats = [...new Set(times.filter((t) => Number.isFinite(t) && t >= 0))].sort((a, b) => a - b);
  if (beats.length < 2) throw new Error("a beat grid needs at least two beats");
  const gaps = beats.slice(1).map((t, i) => t - beats[i]!).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)]!;
  return { bpm: 60 / median, beats, downbeats: downbeats && downbeats.length > 0 ? [...downbeats].sort((a, b) => a - b) : beats.filter((_, i) => i % 4 === 0) };
}

/** Beats between entrances at `bpm`: 1, or 2 when the beat is too fast to follow. */
export function entranceStep(bpm: number): number {
  return 60 / bpm < FASTEST_EVENT ? 2 : 1;
}

export class TemplateBeats {
  /** Index in `grid.beats` of the template's beat 0. */
  private readonly first: number;
  readonly period: number;
  /** Beats between entrances: 1, or 2 when the beat is too fast to follow. */
  readonly step: number;

  constructor(
    readonly grid: BeatGrid,
    /** The template's start on the timeline, seconds (on the frame grid). */
    readonly start: number,
    readonly fps: number,
  ) {
    if (grid.beats.length < 2) throw new Error("a beat grid needs at least two beats");
    let first = grid.beats.findIndex((t) => t >= start - ON_BEAT);
    if (first < 0) {
      // Past the last beat: extend the grid at its last gap.
      const last = grid.beats.length - 1;
      const gap = grid.beats[last]! - grid.beats[last - 1]!;
      first = last + Math.ceil((start - ON_BEAT - grid.beats[last]!) / gap);
    }
    this.first = first;
    this.period = 60 / grid.bpm;
    this.step = entranceStep(grid.bpm);
  }

  /** Timeline seconds of beat `k` (fractional beats interpolate). */
  time(k: number): number {
    return timeAtBeat(this.grid.beats, this.first + k);
  }

  /** Frame of beat `k` from the template's start (never before frame 0). */
  frame(k: number): number {
    return Math.max(0, Math.round((this.time(k) - this.start) * this.fps));
  }

  /** Frame of entrance `n`: every `step` beats from `offset`. */
  event(n: number, offset = 0): number {
    return this.frame(offset + n * this.step);
  }

  /** Whole beats from beat 0 that fit in `frames` (the template's length). */
  countIn(frames: number): number {
    let k = 0;
    while (this.frame(k + 1) <= frames) k += 1;
    return k;
  }

  /**
   * Frames of `count` entrances from beat `first`, each needing `tail`
   * frames to finish inside `frames`: every `step` beats, else every beat,
   * else every half beat (still the beat grid), else all on beat `first`.
   */
  entrances(count: number, frames: number, tail: number, first = 0): number[] {
    if (count <= 0) return [];
    for (const step of [this.step, 1, 0.5]) {
      const out = Array.from({ length: count }, (_, i) => this.frame(first + i * step));
      if (out[out.length - 1]! + tail <= frames) return out;
    }
    return Array.from({ length: count }, () => this.frame(first));
  }

  /** The first whole beat whose frame comes after `frame`. */
  beatAfter(frame: number): number {
    let k = 0;
    while (this.frame(k) <= frame) k += 1;
    return k;
  }

  /** Frames of a span of `beats` starting at beat `k` (at least one frame). */
  span(k: number, beats: number): number {
    return Math.max(1, this.frame(k + beats) - this.frame(k));
  }
}
