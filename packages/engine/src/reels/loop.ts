/**
 * Music shorter than the reel: loop whole phrases of it on a bar line so the
 * reel runs the length that was asked for. Round 7: a 30 s ask over a 26 s
 * track ended at 26.2 s (product launch) and 25.3 s (fitness), because the
 * grid never runs past the music.
 *
 * The phrase repeated is the stretch just before the track's last bar line,
 * four bars at a time (the shortest run of phrases that covers what is
 * missing), so the repeat continues what was playing and the track's own
 * ending still ends the reel. Without bar lines nothing loops.
 */

import type { MusicBeats } from "./plan.js";

/** One stretch of the music file on the looped clock. */
export interface MusicSegment {
  /** Where it starts on the looped clock, seconds. */
  at: number;
  /** Source range in the music file, seconds. */
  from: number;
  to: number;
}

export interface LoopedMusic {
  /** The beats, downbeats and energy on the looped clock; `duration` is the looped length. */
  music: MusicBeats;
  /** The file's stretches in order, back to back on the looped clock. */
  segments: MusicSegment[];
  /** Seconds of each repeat, and how many. */
  loopSeconds: number;
  repeats: number;
}

const EPS = 1e-6;
const BARS_PER_PHRASE = 4;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * `music` looped to last at least `seconds` plus a bar (the reel may end on
 * the bar line after its target), or null when it is long enough already or
 * has no bar lines to loop on.
 */
export function loopMusic(music: MusicBeats, seconds: number): LoopedMusic | null {
  // A bar of four beats: the slack planReelGrid may run past its target.
  const bar = (4 * 60) / Math.max(1, music.bpm);
  if (music.duration >= seconds + bar - EPS) return null;
  const downs = music.downbeats.filter((t) => t >= -EPS && t <= music.duration + EPS);
  if (downs.length < 2) return null;
  const last = downs[downs.length - 1]!;
  const first = downs[0]!;
  const missing = seconds + bar - music.duration;
  // Whole phrases (4 bars) when the track has them, else whole bars.
  const barsAvailable = downs.length - 1;
  const step = barsAvailable >= BARS_PER_PHRASE ? BARS_PER_PHRASE : 1;
  const barLength = (last - first) / barsAvailable;
  let bars = step;
  while (bars + step <= barsAvailable && bars * barLength < missing - EPS) bars += step;
  const loopFrom = downs[downs.length - 1 - bars]!;
  const loopSeconds = last - loopFrom;
  const repeats = Math.ceil((missing - EPS) / loopSeconds);

  const segments: MusicSegment[] = [{ at: 0, from: 0, to: last }];
  for (let k = 0; k < repeats; k += 1) segments.push({ at: last + k * loopSeconds, from: loopFrom, to: last });
  segments.push({ at: last + repeats * loopSeconds, from: last, to: music.duration });

  const beats: number[] = [];
  const downbeats: number[] = [];
  const energy: number[] = [];
  for (const s of segments) {
    const inside = (t: number) => t >= s.from - EPS && t < s.to - EPS;
    music.beats.forEach((t, i) => {
      if (!inside(t)) return;
      beats.push(round3(s.at + t - s.from));
      if (music.beatEnergy) energy.push(music.beatEnergy[i] ?? 0);
    });
    for (const t of music.downbeats) if (inside(t)) downbeats.push(round3(s.at + t - s.from));
  }
  return {
    music: { ...music, beats, downbeats, ...(music.beatEnergy ? { beatEnergy: energy } : {}), duration: round3(music.duration + repeats * loopSeconds) },
    segments,
    loopSeconds: round3(loopSeconds),
    repeats,
  };
}

/** The file's stretches that play from `start` for `duration` on the looped clock, placed from timeline 0. */
export function segmentsBetween(segments: readonly MusicSegment[], start: number, duration: number): MusicSegment[] {
  const end = start + duration;
  return segments.flatMap((s) => {
    const sEnd = s.at + (s.to - s.from);
    const a = Math.max(start, s.at);
    const b = Math.min(end, sEnd);
    return b - a > EPS ? [{ at: round3(a - start), from: round3(s.from + a - s.at), to: round3(s.from + b - s.at) }] : [];
  });
}

/** What a loop did, for a receipt's warnings. */
export function loopNote(original: MusicBeats, loop: LoopedMusic, seconds: number): string {
  const from = loop.segments[1]!.from;
  const bars = Math.round((loop.loopSeconds * original.bpm) / 240);
  return `The music is ${round3(original.duration)} s, shorter than the ${round3(seconds)} s asked: ${bars} bar(s) from ${round3(from)} s repeat ${loop.repeats === 1 ? "once" : `${loop.repeats} times`}, cut on bar lines, so the reel runs the full length.`;
}

/** File times (hits, onsets) on the looped clock: each stretch carries the times inside it. */
export function onLoopedClock(segments: readonly MusicSegment[], times: readonly number[]): number[] {
  return segments.flatMap((s) => times.filter((t) => t >= s.from - EPS && t < s.to - EPS).map((t) => round3(s.at + t - s.from)));
}
