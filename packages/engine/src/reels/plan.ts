/**
 * Reel planning: where the music starts, where every cut lands, which media
 * fills each shot and which part of it plays. Pure functions over numbers,
 * so a plan is testable without a project and the same on every surface.
 *
 *   music window  the loudest stretch of the track that starts on a downbeat
 *                 (a quiet intro is skipped); the reel ends on a downbeat
 *   cuts          the style's beat pattern from the first beat, the climax
 *                 pattern from two thirds in, the last shot held under the
 *                 end card
 *   shots         media in the order given (story order), the last item
 *                 saved for the final shot (the payoff); a long clip gives
 *                 different moments each time it comes back; a shot no
 *                 clip can fill is split on the beat instead of leaving a gap
 */

import type { ReelStyle } from "./styles.js";

export interface ReelMedia {
  fileId: string;
  kind: "video" | "image";
  /** Usable source range, seconds (videos). */
  start: number;
  end: number;
  label?: string;
}

export interface MusicBeats {
  bpm: number;
  /** Beat times in the music file, seconds. */
  beats: readonly number[];
  downbeats: readonly number[];
  /** Loudness per beat (0..1), parallel to `beats`. */
  beatEnergy?: readonly number[];
  /** Length of the music file, seconds. */
  duration: number;
}

export interface PlannedShot {
  fileId: string;
  kind: "video" | "image";
  /** Timeline range, seconds. */
  start: number;
  end: number;
  /** Source window (videos), seconds. */
  sourceStart: number;
  sourceEnd: number;
  /** Playback speed: 1 as shot, below 1 for a clip slowed to fill its shot. */
  speed: number;
  /** The cut into this shot is on a downbeat. */
  onDownbeat: boolean;
  /** The shot starts in the last third. */
  climax: boolean;
  label?: string;
}

export interface ReelPlan {
  /** Total length, seconds. */
  duration: number;
  bpm: number;
  /** Where the music starts in its file, seconds, or null without music. */
  musicStart: number | null;
  /** Beat and downbeat times on the timeline. */
  beats: number[];
  downbeats: number[];
  shots: PlannedShot[];
}

export interface PlanInput {
  style: ReelStyle;
  media: readonly ReelMedia[];
  music: MusicBeats | null;
  /** Target length, seconds (default: the style's). The reel ends on the last downbeat before it. */
  seconds?: number;
  /**
   * The project's frame rate: the music's in-point snaps to its frame grid
   * (as the clip will), so the beats stay where the cuts are.
   */
  frameRate?: number;
}

const EPS = 1e-6;
/** Never cut faster than this, seconds. */
export const MIN_SHOT_SECONDS = 0.2;
/** Slowest a clip may play to fill a shot. */
const MIN_SPEED = 0.5;

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** The downbeat the music should start on: the loudest `seconds` of the track (ties go to the earlier one). */
export function chooseMusicStart(music: MusicBeats, seconds: number): number {
  const candidates = music.downbeats.length > 0 ? music.downbeats : music.beats;
  if (candidates.length === 0) return 0;
  // Relative loudness, whatever scale the analysis used.
  const loudest = Math.max(...(music.beatEnergy ?? [1]), EPS);
  const energyBetween = (from: number, to: number) => {
    let sum = 0;
    let count = 0;
    music.beats.forEach((t, i) => {
      if (t >= from - EPS && t < to - EPS) {
        sum += (music.beatEnergy?.[i] ?? loudest) / loudest;
        count += 1;
      }
    });
    return count > 0 ? sum / count : 0;
  };
  let best = candidates[0]!;
  let bestScore = energyBetween(best, best + seconds);
  for (const start of candidates.slice(1)) {
    if (start + seconds > music.duration + EPS) break;
    const score = energyBetween(start, start + seconds);
    if (score > bestScore + 0.02) {
      best = start;
      bestScore = score;
    }
  }
  return best;
}

/** Beat grid of the reel's timeline: the music's beats from `start`, extended at its tempo past the track's end. */
function timelineGrid(input: PlanInput, seconds: number): { beats: number[]; downbeats: number[]; bpm: number; musicStart: number | null } {
  const { music, style } = input;
  if (!music || music.beats.length < 2 || !(music.bpm > 0)) {
    const period = 60 / style.defaultBpm;
    const beats: number[] = [];
    for (let t = 0; t <= seconds + EPS; t += period) beats.push(round3(t));
    return { beats, downbeats: beats.filter((_, i) => i % 4 === 0), bpm: style.defaultBpm, musicStart: null };
  }
  const chosen = chooseMusicStart(music, seconds);
  const start = input.frameRate && input.frameRate > 0 ? Math.round(chosen * input.frameRate) / input.frameRate : chosen;
  const beats = music.beats.filter((t) => t >= start - 0.05).map((t) => round3(Math.max(0, t - start)));
  const period = 60 / music.bpm;
  while (beats.length < 2 || beats[beats.length - 1]! < seconds) beats.push(round3((beats[beats.length - 1] ?? 0) + period));
  const inMusic = music.downbeats.filter((t) => t >= start - 0.05).map((t) => round3(Math.max(0, t - start)));
  // Past the track's last downbeat, keep counting bars from it.
  const downbeats = [...inMusic];
  const lastIndex = beats.findIndex((t) => Math.abs(t - (inMusic[inMusic.length - 1] ?? 0)) < 0.02);
  for (let i = lastIndex + 4; lastIndex >= 0 && i < beats.length; i += 4) downbeats.push(beats[i]!);
  return { beats, downbeats, bpm: music.bpm, musicStart: round3(start) };
}

/** Time of fractional beat `k` on the grid (beats are interpolated, extrapolated at the last gap). */
function timeAtBeat(beats: readonly number[], k: number): number {
  const i = Math.floor(k);
  if (i + 1 < beats.length) return beats[i]! + (k - i) * (beats[i + 1]! - beats[i]!);
  const last = beats.length - 1;
  const gap = beats[last]! - beats[last - 1]!;
  return beats[last]! + (k - last) * gap;
}

/** Cut points in beats: first shot, the pattern (climax from two thirds in), the held last shot. */
export function cutBeats(style: ReelStyle, totalBeats: number): number[] {
  if (totalBeats <= style.firstBeats + EPS) return [0, totalBeats];
  const cuts = [0, Math.min(style.firstBeats, totalBeats)];
  let k = cuts[1]!;
  for (let i = 0; ; i += 1) {
    const pattern = style.climax && k >= (totalBeats * 2) / 3 - EPS ? style.climax : style.pattern;
    const next = k + pattern[i % pattern.length]!;
    if (next > totalBeats - style.lastBeats + EPS) break;
    cuts.push(next);
    k = next;
  }
  if (totalBeats - cuts[cuts.length - 1]! > EPS) cuts.push(totalBeats);
  return cuts;
}

interface Slot {
  start: number;
  end: number;
  /** Beat indexes, so a slot that cannot be filled splits on the beat. */
  k0: number;
  k1: number;
}

/** Plan a reel: music window, cut points, and the media and source window of every shot. */
export function planReel(input: PlanInput): ReelPlan {
  const { style, media } = input;
  if (media.length === 0) throw new Error("A reel needs at least one video or image.");
  const target = Math.max(2, input.seconds ?? style.defaultSeconds);
  const grid = timelineGrid(input, target);

  // End on the last downbeat in the target (or the last beat), never past the music.
  const musicLeft = input.music && grid.musicStart !== null ? input.music.duration - grid.musicStart : Infinity;
  const limit = Math.min(target, musicLeft) + EPS;
  const downEnd = [...grid.downbeats].reverse().find((t) => t <= limit && t >= target * 0.6);
  const beatEnd = [...grid.beats].reverse().find((t) => t <= limit);
  const duration = round3(downEnd ?? beatEnd ?? Math.min(target, musicLeft));
  const totalBeats = grid.beats.findIndex((t) => Math.abs(t - duration) < 1e-3);
  const beatsInReel = totalBeats >= 0 ? totalBeats : (duration / (60 / grid.bpm));

  // Cuts sit on the frame grid, so one shot ends exactly where the next begins
  // (rounding each clip's position and length on its own left one-frame gaps).
  const fps = input.frameRate && input.frameRate > 0 ? input.frameRate : null;
  const onFrame = (t: number) => (fps ? Math.round(t * fps) / fps : round3(t));
  const cuts = cutBeats(style, beatsInReel);
  const slots: Slot[] = [];
  for (let i = 0; i + 1 < cuts.length; i += 1) {
    slots.push({ start: onFrame(timeAtBeat(grid.beats, cuts[i]!)), end: onFrame(timeAtBeat(grid.beats, cuts[i + 1]!)), k0: cuts[i]!, k1: cuts[i + 1]! });
  }
  if (slots.length > 0) slots[slots.length - 1]!.end = onFrame(duration);

  const cursors = new Map<string, number>();
  // A clip's first use starts a third of the way in: stock and phone footage often opens on a rack focus or a shake.
  const nextFrom = (m: ReelMedia, seconds: number) => cursors.get(m.fileId) ?? m.start + Math.max(0, (m.end - m.start - seconds) * 0.3);
  const fits = (m: ReelMedia, seconds: number) => m.kind === "image" || m.end - m.start >= seconds * MIN_SPEED - EPS;
  // The last item is the payoff: it closes the reel (when there are enough items to tell a story).
  const payoff = media.length >= 3 ? media[media.length - 1]! : null;
  const body = payoff ? media.slice(0, -1) : media;

  const shots: PlannedShot[] = [];
  let rotation = 0;
  const queue = [...slots];
  while (queue.length > 0) {
    const slot = queue.shift()!;
    const seconds = slot.end - slot.start;
    const isLast = queue.length === 0;
    let chosen: ReelMedia | undefined;
    if (isLast && payoff && fits(payoff, seconds)) chosen = payoff;
    for (let j = 0; !chosen && j < body.length; j += 1) {
      const m = body[(rotation + j) % body.length]!;
      if (fits(m, seconds)) {
        chosen = m;
        rotation = (rotation + j + 1) % body.length;
      }
    }
    if (!chosen) {
      // Nothing is long enough: split on the beat (down to the shortest cut) instead of leaving a gap.
      const mid = (slot.k0 + slot.k1) / 2;
      const at = onFrame(timeAtBeat(grid.beats, mid));
      if (at - slot.start >= MIN_SHOT_SECONDS && slot.end - at >= MIN_SHOT_SECONDS) {
        queue.unshift({ start: slot.start, end: at, k0: slot.k0, k1: mid }, { start: at, end: slot.end, k0: mid, k1: slot.k1 });
        continue;
      }
      chosen = [...media].sort((a, b) => b.end - b.start - (a.end - a.start))[0]!;
    }
    let sourceStart = 0;
    let sourceEnd = seconds;
    let speed = 1;
    if (chosen.kind === "video") {
      const length = chosen.end - chosen.start;
      if (length >= seconds - EPS) {
        sourceStart = nextFrom(chosen, seconds);
        if (sourceStart + seconds > chosen.end + EPS) sourceStart = chosen.start;
        // On the frame grid too: an in-point and an out-point rounded to frames on their own can lose a frame.
        sourceStart = onFrame(sourceStart);
        if (sourceStart + seconds > chosen.end + EPS) sourceStart = Math.max(chosen.start, onFrame(chosen.end - seconds - (fps ? 0.5 / fps : 0)));
        sourceEnd = sourceStart + seconds;
        // Next time this clip comes back, show a later moment.
        cursors.set(chosen.fileId, sourceEnd + Math.min(0.5, seconds / 4));
      } else {
        sourceStart = chosen.start;
        sourceEnd = chosen.end;
        speed = Math.max(MIN_SPEED, length / seconds);
      }
    }
    const onDownbeat = grid.downbeats.some((d) => Math.abs(d - slot.start) < 0.03);
    shots.push({
      fileId: chosen.fileId,
      kind: chosen.kind,
      start: slot.start,
      end: slot.end,
      sourceStart: round3(sourceStart),
      sourceEnd: round3(sourceEnd),
      speed: round3(speed),
      onDownbeat,
      climax: slot.start >= (duration * 2) / 3 - EPS,
      ...(chosen.label ? { label: chosen.label } : {}),
    });
  }
  shots.sort((a, b) => a.start - b.start);
  return {
    duration: onFrame(duration),
    bpm: grid.bpm,
    musicStart: grid.musicStart,
    beats: grid.beats.filter((t) => t <= duration + EPS),
    downbeats: grid.downbeats.filter((t) => t <= duration + EPS),
    shots,
  };
}
