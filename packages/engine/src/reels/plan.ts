/**
 * Reel planning: where the music starts, where every cut lands, which media
 * fills each shot and which part of it plays. Pure functions over numbers,
 * so a plan is testable without a project and the same on every surface.
 *
 *   music window  the loudest stretch of the track that starts on a downbeat
 *                 (a quiet intro is skipped); the reel ends on a downbeat
 *   cuts          the style's beat pattern from the first beat, the climax
 *                 pattern from two thirds in (from the first bar line there
 *                 when the style winds up into a drop: the shot before it
 *                 holds `windupBeats`), the last shot held under the end card
 *   shots         media in the order given (story order), the last item
 *                 saved for the final shot (the payoff); a clip comes back
 *                 no sooner than 3 s after it was last on screen while
 *                 another one can fill the shot, and a long clip gives
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
  /** The shot starts in the climax (the last third, or from the drop). */
  climax: boolean;
  /** The shot winds up into the drop (the style's `windupBeats`, ending on the climax's first downbeat). */
  windup?: boolean;
  label?: string;
}

export interface ReelPlan {
  /** Total length, seconds. */
  duration: number;
  /** `ReelGrid.lengthNote`: the length and why. */
  lengthNote: string;
  bpm: number;
  /** Where the music starts in its file, seconds, or null without music. */
  musicStart: number | null;
  /** Beat and downbeat times on the timeline. */
  beats: number[];
  downbeats: number[];
  shots: PlannedShot[];
  /** Timeline second of the drop (the climax's first cut, on a downbeat), or null when the style has no wind-up or the reel is too short. */
  drop: number | null;
  /** Shots that bring a clip back sooner than `REUSE_GAP_SECONDS` after it was last on screen (too few clips for the pace). */
  closeRepeats: number;
  /** Distinct clips the busiest `REUSE_GAP_SECONDS` of the cut needs so none comes back that soon. */
  clipsNeeded: number;
}

export interface PlanInput {
  style: ReelStyle;
  media: readonly ReelMedia[];
  music: MusicBeats | null;
  /** Target length, seconds (default: the style's), rounded to whole bars as `planReelGrid` says. */
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
/** A clip is not back on screen sooner than this, seconds, while another clip can fill the shot. */
export const REUSE_GAP_SECONDS = 3;

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
function timelineGrid(music: MusicBeats | null, fallbackBpm: number, frameRate: number | undefined, seconds: number): { beats: number[]; downbeats: number[]; bpm: number; musicStart: number | null } {
  if (!music || music.beats.length < 2 || !(music.bpm > 0)) {
    const period = 60 / fallbackBpm;
    const beats: number[] = [];
    // One bar of slack past the target: the reel may end on the bar line after it.
    for (let t = 0; t <= seconds + 4 * period + EPS; t += period) beats.push(round3(t));
    return { beats, downbeats: beats.filter((_, i) => i % 4 === 0), bpm: fallbackBpm, musicStart: null };
  }
  const chosen = chooseMusicStart(music, seconds);
  const start = frameRate && frameRate > 0 ? Math.round(chosen * frameRate) / frameRate : chosen;
  const beats = music.beats.filter((t) => t >= start - 0.05).map((t) => round3(Math.max(0, t - start)));
  const period = 60 / music.bpm;
  while (beats.length < 2 || beats[beats.length - 1]! < seconds + 4 * period) beats.push(round3((beats[beats.length - 1] ?? 0) + period));
  const inMusic = music.downbeats.filter((t) => t >= start - 0.05).map((t) => round3(Math.max(0, t - start)));
  // Past the track's last downbeat, keep counting bars from it.
  const downbeats = [...inMusic];
  const lastIndex = beats.findIndex((t) => Math.abs(t - (inMusic[inMusic.length - 1] ?? 0)) < 0.02);
  for (let i = lastIndex + 4; lastIndex >= 0 && i < beats.length; i += 4) downbeats.push(beats[i]!);
  return { beats, downbeats, bpm: music.bpm, musicStart: round3(start) };
}

/** Time of fractional beat `k` on the grid (beats are interpolated, extrapolated at the last gap). */
export function timeAtBeat(beats: readonly number[], k: number): number {
  const i = Math.floor(k);
  if (i + 1 < beats.length) return beats[i]! + (k - i) * (beats[i + 1]! - beats[i]!);
  const last = beats.length - 1;
  const gap = beats[last]! - beats[last - 1]!;
  return beats[last]! + (k - last) * gap;
}

/**
 * The beat of the drop: the first bar line at or after two thirds in, when
 * the style winds up into it and there is room for the wind-up after the
 * first shot and for the last shot after it; else null.
 */
export function dropBeat(style: ReelStyle, totalBeats: number): number | null {
  const windup = style.accents?.windupBeats ?? 0;
  if (!(windup > 0)) return null;
  const drop = Math.ceil((totalBeats * 2) / 3 / 4 - EPS) * 4;
  // A bar of the body before the wind-up, and the climax at least a bar before the last shot.
  if (drop - windup < style.firstBeats + 4 - EPS || drop + 4 > totalBeats - style.lastBeats + EPS) return null;
  return drop;
}

/** Cut points in beats: first shot, the pattern (climax from two thirds in, or from the drop after a wind-up), the held last shot. */
export function cutBeats(style: ReelStyle, totalBeats: number): number[] {
  if (totalBeats <= style.firstBeats + EPS) return [0, totalBeats];
  const cuts = [0, Math.min(style.firstBeats, totalBeats)];
  const drop = dropBeat(style, totalBeats);
  const climaxAt = drop ?? (totalBeats * 2) / 3;
  let k = cuts[1]!;
  for (let i = 0; ; i += 1) {
    const pattern = style.climax && k >= climaxAt - EPS ? style.climax : style.pattern;
    const next = k + pattern[i % pattern.length]!;
    if (drop !== null && k < drop - EPS && next > drop - style.accents!.windupBeats + EPS) {
      // The wind-up: the body stops where it starts (a sliver of a shot before it is absorbed), it holds into the drop.
      const windupAt = drop - style.accents!.windupBeats;
      if (windupAt - k < 0.5 - EPS && cuts.length > 2) cuts.pop();
      if (windupAt - cuts[cuts.length - 1]! > EPS) cuts.push(windupAt);
      cuts.push(drop);
      k = drop;
      i = -1;
      continue;
    }
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

/** Seconds on the frame grid of `frameRate` (to the millisecond without one). */
export function onFrameGrid(seconds: number, frameRate?: number): number {
  return frameRate && frameRate > 0 ? Math.round(seconds * frameRate) / frameRate : round3(seconds);
}

/** The timeline's beat grid and the reel's length, before any shot is planned. */
export interface ReelGrid {
  /** Length, seconds: a downbeat (or beat) of the grid, not yet on the frame grid. */
  duration: number;
  /** The length in beats (fractional when it is not on a beat). */
  beatsInReel: number;
  /** The final length and why, for the tool's summary ("10.29s, ends on a bar line at 140 BPM: …"). */
  lengthNote: string;
  bpm: number;
  /** Where the music starts in its file, seconds, or null without music. */
  musicStart: number | null;
  /** Beat and downbeat times on the timeline (they run past `duration`). */
  beats: number[];
  downbeats: number[];
}

export interface ReelGridInput {
  music: MusicBeats | null;
  /**
   * Target length, seconds: the reel ends on the first bar line at or after
   * it when that is at most a bar later, else on the nearest bar line (or
   * beat), never past the music.
   */
  seconds: number;
  /** Tempo of the grid when there is no music. */
  fallbackBpm: number;
  /** See `PlanInput.frameRate`. */
  frameRate?: number;
}

/** The music window and the beat grid of a reel, and where it ends (never past the music). */
export function planReelGrid(input: ReelGridInput): ReelGrid {
  const target = input.seconds;
  const grid = timelineGrid(input.music, input.fallbackBpm, input.frameRate, target);
  const bar = (4 * 60) / grid.bpm;
  const musicLeft = input.music && grid.musicStart !== null ? input.music.duration - grid.musicStart : Infinity;
  const inMusic = (t: number) => t > EPS && t <= musicLeft + EPS;
  // Whole bars: the first bar line at or after the target when it is at most a
  // bar later (asking for 10s gives 10.29s at 140 BPM, not 8.57s), else the
  // nearest one; never past the music.
  const bars = grid.downbeats.filter(inMusic);
  const up = bars.find((t) => t >= target - EPS);
  const nearest = [...bars].filter((t) => t >= target * 0.6).sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || b - a)[0];
  const downEnd = up !== undefined && up - target <= bar + EPS ? up : nearest;
  const beatEnd = [...grid.beats].reverse().find((t) => t <= Math.min(target, musicLeft) + EPS && t > EPS);
  const duration = round3(downEnd ?? beatEnd ?? Math.min(target, musicLeft));
  const totalBeats = grid.beats.findIndex((t) => Math.abs(t - duration) < 1e-3);
  const beatsInReel = totalBeats >= 0 ? totalBeats : duration / (60 / grid.bpm);
  const asked = `${round3(target)}s asked for`;
  const onBar = `ends on a bar line at ${Math.round(grid.bpm)} BPM`;
  let why: string;
  if (downEnd === undefined) why = beatEnd === undefined ? `the music runs out before the ${asked}` : `ends on the last beat before the ${asked} (no bar line fits)`;
  else if (Math.abs(duration - target) < 0.02) why = `${onBar}, as asked`;
  else if (downEnd === up) why = `${onBar}: the first one at or after the ${asked}`;
  else if (up === undefined && musicLeft < target) why = `${onBar}: the music runs out before the ${asked}`;
  else why = `${onBar}: the nearest one to the ${asked}`;
  const lengthNote = `${duration.toFixed(2)}s, ${why}`;
  return { duration, beatsInReel, lengthNote, bpm: grid.bpm, musicStart: grid.musicStart, beats: grid.beats, downbeats: grid.downbeats };
}

/** Plan a reel: music window, cut points, and the media and source window of every shot. */
export function planReel(input: PlanInput): ReelPlan {
  const { style, media } = input;
  if (media.length === 0) throw new Error("A reel needs at least one video or image.");
  const target = Math.max(2, input.seconds ?? style.defaultSeconds);
  const grid = planReelGrid({ music: input.music, seconds: target, fallbackBpm: style.defaultBpm, frameRate: input.frameRate });
  const { duration, beatsInReel } = grid;

  // Cuts sit on the frame grid, so one shot ends exactly where the next begins
  // (rounding each clip's position and length on its own left one-frame gaps).
  const fps = input.frameRate && input.frameRate > 0 ? input.frameRate : null;
  const onFrame = (t: number) => onFrameGrid(t, fps ?? undefined);
  const cuts = cutBeats(style, beatsInReel);
  const slots: Slot[] = [];
  for (let i = 0; i + 1 < cuts.length; i += 1) {
    slots.push({ start: onFrame(timeAtBeat(grid.beats, cuts[i]!)), end: onFrame(timeAtBeat(grid.beats, cuts[i + 1]!)), k0: cuts[i]!, k1: cuts[i + 1]! });
  }
  if (slots.length > 0) slots[slots.length - 1]!.end = onFrame(duration);
  const drop = dropBeat(style, beatsInReel);
  const dropAt = drop !== null ? onFrame(timeAtBeat(grid.beats, drop)) : null;
  const climaxAt = dropAt ?? (duration * 2) / 3;

  const cursors = new Map<string, number>();
  // A clip's first use starts a third of the way in: stock and phone footage often opens on a rack focus or a shake.
  const nextFrom = (m: ReelMedia, seconds: number) => cursors.get(m.fileId) ?? m.start + Math.max(0, (m.end - m.start - seconds) * 0.3);
  const fits = (m: ReelMedia, seconds: number) => m.kind === "image" || m.end - m.start >= seconds * MIN_SPEED - EPS;
  // Source stretches each clip has shown: a clip that comes back shows a moment not seen yet while it has one.
  const shown = new Map<string, [number, number][]>();
  const fresh = (m: ReelMedia, seconds: number): number | null => {
    if (m.kind === "image") return m.start;
    // Too short for the slot (it plays slowed down whole): fresh until it has been on.
    if (m.end - m.start < seconds - EPS) return shown.has(m.fileId) ? null : m.start;
    return freshFrom(m, seconds, nextFrom(m, seconds), shown.get(m.fileId) ?? []);
  };
  // The last item is the payoff: it closes the reel (when there are enough items to tell a story).
  const payoff = media.length >= 3 ? media[media.length - 1]! : null;
  const body = payoff ? media.slice(0, -1) : media;

  const shots: PlannedShot[] = [];
  // When each clip was last on screen (its shot's end).
  const lastSeen = new Map<string, number>();
  let rotation = 0;
  const queue = [...slots];
  while (queue.length > 0) {
    const slot = queue.shift()!;
    const seconds = slot.end - slot.start;
    const isLast = queue.length === 0;
    let chosen: ReelMedia | undefined;
    if (isLast && payoff && fits(payoff, seconds)) chosen = payoff;
    if (!chosen) {
      // Story order, skipping clips seen in the last few seconds and, while a rested one has a moment not shown yet, the
      // rested ones that have shown everything; with none rested, the one seen longest ago.
      const seen = (j: number) => lastSeen.get(body[(rotation + j) % body.length]!.fileId) ?? -Infinity;
      const rested = (j: number) => seen(j) <= slot.start - REUSE_GAP_SECONDS + EPS;
      let pick = -1;
      let exhausted = -1;
      for (let j = 0; j < body.length; j += 1) {
        const m = body[(rotation + j) % body.length]!;
        if (!fits(m, seconds)) continue;
        if (rested(j)) {
          if (fresh(m, seconds) !== null) {
            pick = j;
            break;
          }
          if (exhausted < 0) exhausted = j;
        } else if (pick < 0 || seen(j) < seen(pick) - EPS) pick = j;
      }
      if (exhausted >= 0 && !(pick >= 0 && rested(pick))) pick = exhausted;
      if (pick >= 0) {
        chosen = body[(rotation + pick) % body.length]!;
        rotation = (rotation + pick + 1) % body.length;
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
        // A moment not shown yet (from the cursor on, else from the top), else the cursor's, wrapping to the start.
        sourceStart = fresh(chosen, seconds) ?? nextFrom(chosen, seconds);
        if (sourceStart + seconds > chosen.end + EPS) sourceStart = chosen.start;
        // On the frame grid too: an in-point and an out-point rounded to frames on their own can lose a frame.
        sourceStart = onFrame(sourceStart);
        if (sourceStart + seconds > chosen.end + EPS) sourceStart = Math.max(chosen.start, onFrame(chosen.end - seconds - (fps ? 0.5 / fps : 0)));
        sourceEnd = sourceStart + seconds;
        shown.set(chosen.fileId, [...(shown.get(chosen.fileId) ?? []), [sourceStart, sourceEnd]]);
        // Next time this clip comes back, show a later moment.
        cursors.set(chosen.fileId, sourceEnd + Math.min(0.5, seconds / 4));
      } else {
        sourceStart = chosen.start;
        sourceEnd = chosen.end;
        speed = Math.max(MIN_SPEED, length / seconds);
      }
    }
    const onDownbeat = grid.downbeats.some((d) => Math.abs(d - slot.start) < 0.03);
    lastSeen.set(chosen.fileId, slot.end);
    shots.push({
      fileId: chosen.fileId,
      kind: chosen.kind,
      start: slot.start,
      end: slot.end,
      sourceStart: round3(sourceStart),
      sourceEnd: round3(sourceEnd),
      speed: round3(speed),
      onDownbeat,
      climax: slot.start >= climaxAt - EPS,
      ...(dropAt !== null && Math.abs(slot.end - dropAt) < EPS && slot.k1 - slot.k0 >= style.accents!.windupBeats - EPS ? { windup: true } : {}),
      ...(chosen.label ? { label: chosen.label } : {}),
    });
  }
  shots.sort((a, b) => a.start - b.start);
  const reuse = reuseStats(shots);
  return {
    duration: onFrame(duration),
    lengthNote: grid.lengthNote,
    bpm: grid.bpm,
    musicStart: grid.musicStart,
    beats: grid.beats.filter((t) => t <= duration + EPS),
    downbeats: grid.downbeats.filter((t) => t <= duration + EPS),
    shots,
    drop: dropAt,
    ...reuse,
  };
}

/**
 * The earliest in-point at or after `from` (else at or after the clip's own
 * start) of a `seconds`-long stretch of `m` that overlaps no `shown` stretch;
 * null when no such stretch is left. The earliest such start is `from`, the
 * clip's start or the end of a shown stretch.
 */
export function freshFrom(m: Pick<ReelMedia, "start" | "end">, seconds: number, from: number, shown: readonly [number, number][]): number | null {
  const fits = (s: number) => s >= m.start - EPS && s + seconds <= m.end + EPS && shown.every(([a, b]) => s + seconds <= a + EPS || s >= b - EPS);
  const ends = shown.map(([, b]) => b).sort((a, b) => a - b);
  return [from, ...ends.filter((e) => e >= from), m.start, ...ends].find(fits) ?? null;
}

/** How many shots bring a clip back within `REUSE_GAP_SECONDS`, and how many clips the busiest stretch needs. */
export function reuseStats(shots: readonly Pick<PlannedShot, "fileId" | "start" | "end">[]): { closeRepeats: number; clipsNeeded: number } {
  let closeRepeats = 0;
  let clipsNeeded = 0;
  shots.forEach((shot, i) => {
    const earlier = shots.slice(0, i).filter((s) => s.fileId === shot.fileId);
    const last = earlier[earlier.length - 1];
    if (last && shot.start - last.end < REUSE_GAP_SECONDS - EPS) closeRepeats += 1;
    // Shots on screen in the gap after this one starts: each needs its own clip.
    clipsNeeded = Math.max(clipsNeeded, shots.filter((s) => s.start >= shot.start - EPS && s.start < shot.start + REUSE_GAP_SECONDS - EPS).length);
  });
  return { closeRepeats, clipsNeeded };
}
