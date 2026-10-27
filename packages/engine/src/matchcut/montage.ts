/**
 * Match-cut montage timing: where every cut of a "full circle" edit lands.
 * Pure functions over numbers, like reels/plan.ts (whose music window and
 * beat grid it reuses).
 *
 *   opening hold  the first shot holds to the first downbeat after ~1 s
 *   body          shots of 3-8 frames, chosen by dynamic programming over
 *                 the frame grid: a cut on an onset (hit) or a downbeat earns
 *                 the most, a beat less, an eighth or sixteenth note a
 *                 little; shot lengths are pulled toward a length that
 *                 shrinks from 7 to 3 frames, so the chain speeds up
 *   end hold      the last shot starts on a downbeat and holds ~1.6 s to the
 *                 end of the bar
 *
 * Clips go in the order given: the first opens, the last closes (the
 * payoff), the body cycles through the others and comes back to a clip at
 * a later moment of it.
 */

import { planReelGrid, type MusicBeats } from "../reels/plan.js";

export interface MontageMusic extends MusicBeats {
  /** Strong onsets (hits) in the music file, seconds. */
  onsets: readonly number[];
}

export interface MontageInput {
  /** How many clips there are, in order. */
  clips: number;
  /** Project frame rate. */
  fps: number;
  music: MontageMusic | null;
  /** Target length, seconds (default: one pass through the clips, at least 8 s). */
  seconds?: number;
  /** Body shot length range, frames (default 3-8). */
  minFrames?: number;
  maxFrames?: number;
  /** Tempo of the grid without music. */
  fallbackBpm?: number;
}

export interface MontageShot {
  /** Index into the clips. */
  clip: number;
  /** How many times this clip was used before (0 the first time). */
  use: number;
  /** Timeline seconds, on the frame grid. */
  start: number;
  end: number;
  frames: number;
  role: "open" | "body" | "close";
  /** The cut into this shot lands on a downbeat / an onset (within a frame). */
  onDownbeat: boolean;
  onOnset: boolean;
}

export interface MontagePlan {
  duration: number;
  bpm: number;
  /** Where the music starts in its file, seconds (null without music). */
  musicStart: number | null;
  beats: number[];
  downbeats: number[];
  shots: MontageShot[];
}

const OPEN_SECONDS = 1;
const CLOSE_SECONDS = 1.6;
/** Default length when one pass through the clips is shorter. */
const MIN_DEFAULT_SECONDS = 8;
/** Weights of a cut on each kind of musical event. */
const WEIGHT = { onset: 1, downbeat: 1, beat: 0.7, eighth: 0.35, sixteenth: 0.15 };
/** How strongly shot lengths keep to the accelerating target length (per frame², vs the weights). */
const PACE = 0.1;
/**
 * What each cut costs before its event weight: without it more cuts always
 * score more, and every shot shrinks to the minimum on sixteenth notes.
 */
const CUT_COST = 0.4;

/** Event weight per frame index of the timeline: the strongest event within half a frame. */
function cutWeights(totalFrames: number, fps: number, grid: { beats: number[]; downbeats: number[] }, onsets: readonly number[]): Float32Array {
  const w = new Float32Array(totalFrames + 1);
  const mark = (t: number, weight: number) => {
    const f = Math.round(t * fps);
    if (f >= 0 && f <= totalFrames && w[f]! < weight) w[f] = weight;
  };
  const beats = grid.beats;
  for (let i = 0; i + 1 < beats.length; i += 1) {
    const a = beats[i]!;
    const gap = beats[i + 1]! - a;
    mark(a, WEIGHT.beat);
    mark(a + gap / 2, WEIGHT.eighth);
    mark(a + gap / 4, WEIGHT.sixteenth);
    mark(a + (3 * gap) / 4, WEIGHT.sixteenth);
  }
  for (const t of grid.downbeats) mark(t, WEIGHT.downbeat);
  for (const t of onsets) mark(t, WEIGHT.onset);
  return w;
}

/**
 * Cut frames between `from` and `to` (both cuts) with every shot `min`-`max`
 * frames long, maximising the event weights under the pace pull. Null when
 * the stretch cannot be split that way.
 */
function bodyCuts(from: number, to: number, min: number, max: number, weights: Float32Array): number[] | null {
  const span = to - from;
  if (span < min) return null;
  const best = new Float64Array(span + 1).fill(Infinity);
  const prev = new Int32Array(span + 1).fill(-1);
  best[0] = 0;
  for (let f = min; f <= span; f += 1) {
    // The target length shrinks from 7 to 3 frames across the body.
    const pace = 7 - 4 * (f / span);
    for (let len = min; len <= max && len <= f; len += 1) {
      const before = best[f - len]!;
      if (!Number.isFinite(before)) continue;
      const cost = before + CUT_COST - weights[from + f]! + PACE * (len - pace) ** 2;
      if (cost < best[f]!) {
        best[f] = cost;
        prev[f] = f - len;
      }
    }
  }
  if (!Number.isFinite(best[span]!)) return null;
  const cuts: number[] = [];
  for (let f = span; f > 0; f = prev[f]!) cuts.push(from + f);
  cuts.push(from);
  return cuts.reverse();
}

/**
 * Which clip fills each body shot: the middle clips in chain order, then
 * back and forth through the chain (the opener joins after the first pass),
 * never the same twice in a row. Neighbours stay neighbours, so the shapes
 * still rhyme, but the chain does not loop: a loop of the same 7 shapes
 * read as repetitive in the full-circle E2E reel.
 */
export function bodyOrder(clips: number, shots: number): number[] {
  if (clips === 1) return Array.from({ length: shots }, () => 0);
  if (clips === 2) return Array.from({ length: shots }, (_, i) => (i % 2 === 0 ? 1 : 0));
  const middle = Array.from({ length: clips - 2 }, (_, i) => i + 1);
  const later = [0, ...middle];
  const out: number[] = [];
  let pass = middle;
  let forward = true;
  while (out.length < shots) {
    for (const clip of pass) {
      if (out.length >= shots) break;
      if (out[out.length - 1] !== clip) out.push(clip);
    }
    forward = !forward;
    pass = forward ? later : [...later].reverse();
  }
  return out;
}

/** Plan a match-cut montage: music window, the opening and end holds, and every cut. */
export function planMontage(input: MontageInput): MontagePlan {
  if (input.clips < 1) throw new Error("A montage needs at least one clip.");
  const fps = input.fps > 0 ? input.fps : 30;
  const min = Math.max(1, Math.round(input.minFrames ?? 3));
  const max = Math.max(min, Math.round(input.maxFrames ?? 8));
  const onePass = OPEN_SECONDS + CLOSE_SECONDS + (Math.max(0, input.clips - 2) * (min + max)) / 2 / fps;
  const target = Math.max(2, input.seconds ?? Math.max(MIN_DEFAULT_SECONDS, onePass));
  const grid = planReelGrid({ music: input.music, seconds: target, fallbackBpm: input.fallbackBpm ?? 120, frameRate: fps });
  const total = Math.round(grid.duration * fps);
  const onsets = input.music && grid.musicStart !== null ? input.music.onsets.map((t) => t - grid.musicStart!).filter((t) => t >= 0) : [];
  const weights = cutWeights(total, fps, grid, onsets);
  const frameOf = (t: number) => Math.round(t * fps);
  const downFrames = grid.downbeats.map(frameOf).filter((f) => f > 0 && f < total);
  const beatFrames = grid.beats.map(frameOf).filter((f) => f > 0 && f < total);

  // Opening hold: to the first downbeat (else beat) after ~1 s.
  const openMin = Math.round(Math.min(OPEN_SECONDS, total / 4) * fps);
  let openEnd = downFrames.find((f) => f >= openMin && f <= openMin + 2.5 * fps) ?? beatFrames.find((f) => f >= openMin) ?? openMin;
  // End hold: from the last downbeat (else beat) leaving ~1.6 s.
  const closeMax = total - Math.round(Math.min(CLOSE_SECONDS, total / 4) * fps);
  let closeStart = [...downFrames].reverse().find((f) => f <= closeMax && f >= closeMax - 1.5 * fps) ?? [...beatFrames].reverse().find((f) => f <= closeMax) ?? closeMax;
  if (input.clips === 1 || closeStart - openEnd < min) {
    // Too short for a body (or nothing to cut to): an opening and a closing shot.
    openEnd = Math.max(1, Math.min(openEnd, Math.round(total / 2)));
    closeStart = openEnd;
  }
  let cuts = closeStart > openEnd ? bodyCuts(openEnd, closeStart, min, max, weights) : [openEnd];
  // A body that cannot be split exactly (a hold under `min` frames) is cut every `min`, the remainder going to the end hold.
  if (!cuts) {
    cuts = [];
    for (let f = openEnd; f <= closeStart - min; f += min) cuts.push(f);
    closeStart = cuts[cuts.length - 1]! + min;
    cuts.push(closeStart);
  }
  // Two clips alternate 1, 0, 1, …: an odd body would end on the closing clip, so its last shot joins the end hold.
  if (input.clips === 2 && cuts.length % 2 === 0) cuts.pop();
  const bounds = [0, ...cuts, total];
  const bodyCount = bounds.length - 3;
  const order = bodyOrder(input.clips, bodyCount);
  const uses = new Map<number, number>();
  const shots: MontageShot[] = [];
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    const role = i === 0 ? "open" : i === bounds.length - 2 ? "close" : "body";
    const clip = role === "open" ? 0 : role === "close" ? input.clips - 1 : order[i - 1]!;
    const use = uses.get(clip) ?? 0;
    uses.set(clip, use + 1);
    const a = bounds[i]!;
    const b = bounds[i + 1]!;
    shots.push({
      clip,
      use,
      start: a / fps,
      end: b / fps,
      frames: b - a,
      role,
      onDownbeat: i > 0 && downFrames.some((f) => Math.abs(f - a) <= 1),
      onOnset: i > 0 && onsets.some((t) => Math.abs(frameOf(t) - a) <= 1),
    });
  }
  return {
    duration: total / fps,
    bpm: grid.bpm,
    musicStart: grid.musicStart,
    beats: grid.beats.filter((t) => t <= grid.duration + 1e-6),
    downbeats: grid.downbeats.filter((t) => t <= grid.duration + 1e-6),
    shots,
  };
}
