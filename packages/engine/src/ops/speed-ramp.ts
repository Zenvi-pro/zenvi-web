/**
 * Speed ramps: a clip whose playback speed changes continuously (the
 * "velocity edit": rush, near-freeze on the beat, rush again).
 *
 * A ramp is a speed curve over the clip's output time. Integrating it gives
 * the source frame shown on every output frame, and that is written as the
 * clip's libopenshot `time` curve (X = clip frame, Y = source frame, both
 * 1-based in the clip's project-frame domain, exactly the shape `retime_clip`
 * writes). The curve gets one linear key per output frame wherever the speed
 * changes, so playback speed is continuous and the frame planner needs no new
 * code (`Clip::GetOrCreateFrame`, Clip.cpp:749-765; audio follows the same
 * curve in `apply_timemapping`, Clip.cpp:585-720). Keys are integers like the
 * desktop saves them (`clamp_timing_to_media`).
 *
 * Presets spend the clip's current source span [in, out] (the footage the
 * user trimmed), so the clip never runs past its source; its length follows
 * from the curve. `custom` takes explicit points and may read on to the end
 * of the media.
 */

import type { Transaction } from "../history/document.js";
import type { Clip, Keyframe, KeyframePoint, Project } from "../model/types.js";
import { Interpolation } from "../model/types.js";
import { pyRound } from "../model/rounding.js";
import { readerBounds } from "../model/timing.js";
import { openshotPoint } from "../keyframe/edit.js";
import { invalid, requireFinite } from "./errors.js";
import { fpsOf, rateOf, replaceClip, requireEditableClip, withClampedTiming } from "./internal.js";
import { setClipProperty } from "./clips.js";
import { repeatIsActive } from "./presets.js";
import { retimeClip, timeCurveIsReversed } from "./retime.js";

export const RAMP_PRESETS = ["ramp_in", "ramp_out", "hero", "velocity", "custom"] as const;
export type RampPreset = (typeof RAMP_PRESETS)[number];

/** docs/TASTE.md "Easing": the named curves as cubic-bezier control points. */
const EASES = {
  smooth: [0.33, 0, 0.2, 1],
  out: [0.16, 1, 0.3, 1],
  entrance: [0.16, 1, 0.3, 1],
  in: [0.7, 0, 0.84, 0],
  exit: [0.7, 0, 0.84, 0],
  "in-out": [0.65, 0, 0.35, 1],
  in_out: [0.65, 0, 0.35, 1],
  snap: [0.2, 0, 0, 1],
  linear: [0, 0, 1, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export const RAMP_EASES = Object.keys(EASES) as [keyof typeof EASES, ...(keyof typeof EASES)[]];
export type RampEase = keyof typeof EASES;

/** The slowest speed a ramp may reach and the fastest (set_clip_speed allows 1/16x..16x per call). */
export const RAMP_MIN_SPEED = 0.02;
export const RAMP_MAX_SPEED = 16;
/** A ramp longer than this is almost certainly a mistake (a near-zero speed integrates forever). */
const MAX_RAMP_SECONDS = 600;

export interface RampPoint {
  /** Seconds from the clip's start, on the output (timeline) clock. */
  atSeconds: number;
  /** 1 = normal speed. */
  speed: number;
}

export interface RampRequest {
  preset: RampPreset;
  /** `custom`: the speed at each moment (at least two, strictly increasing times). */
  points?: readonly RampPoint[];
  ease?: RampEase;
  /** Timeline second where the slowest moment lands (hero, velocity, custom). */
  hitAt?: number;
  /** Speed at the slowest moment. Default per preset. */
  slow?: number;
  /** Speed outside the slow moment (the rush). Default per preset. */
  fast?: number;
  /** Seconds each speed change takes. Default per preset. */
  rampSeconds?: number;
  /** Seconds held at the slowest speed. Default per preset. */
  holdSeconds?: number;
}

export interface RampPlan {
  preset: RampPreset;
  ease: RampEase;
  /** Output frames the ramped clip plays. */
  frames: number;
  /** Output length, seconds (`frames / fps`). */
  duration: number;
  /** The clip's length before the ramp, seconds. */
  durationBefore: number;
  /** First clip frame of the time curve (`round(start * fps) + 1`). */
  startX: number;
  /** Source frames (project rate) shown first and last, 1-based. */
  sourceIn: number;
  sourceOut: number;
  /** The new `time` keyframe points (one per frame where speed changes). */
  points: KeyframePoint[];
  /** Speed on each output frame, for receipts and tests. */
  speeds: number[];
  minSpeed: number;
  maxSpeed: number;
  /** Seconds from the clip's start to the slowest moment. */
  slowestAt: number;
  warnings: string[];
  /** What the curve was built from (stored on the clip as `zenvi_speed_ramp`). */
  recipe: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Speed curves
// ---------------------------------------------------------------------------

/** CSS-style cubic-bezier timing function: progress `u` in 0..1 → eased 0..1 (sampled once, then interpolated). */
function bezierEase([x1, y1, x2, y2]: readonly [number, number, number, number]): (u: number) => number {
  if (x1 === y1 && x2 === y2) return (u) => u;
  const coord = (a: number, b: number, s: number) => 3 * a * (1 - s) * (1 - s) * s + 3 * b * (1 - s) * s * s + s * s * s;
  const size = 1024;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= size; i += 1) {
    xs.push(coord(x1, x2, i / size));
    ys.push(coord(y1, y2, i / size));
  }
  return (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    let lo = 0;
    let hi = size;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid]! <= u) lo = mid;
      else hi = mid;
    }
    const span = xs[hi]! - xs[lo]!;
    return span <= 0 ? ys[lo]! : ys[lo]! + ((ys[hi]! - ys[lo]!) * (u - xs[lo]!)) / span;
  };
}

/** Speed `speed` from `at` seconds on; between two knots the speed eases from one to the other. */
interface Knot {
  at: number;
  speed: number;
}

function speedCurve(knots: readonly Knot[], ease: RampEase): (t: number) => number {
  const shape = bezierEase(EASES[ease]);
  return (t) => {
    const first = knots[0]!;
    if (t <= first.at) return first.speed;
    for (let i = 1; i < knots.length; i += 1) {
      const a = knots[i - 1]!;
      const b = knots[i]!;
      if (t < b.at) return a.speed + (b.speed - a.speed) * shape((t - a.at) / (b.at - a.at));
    }
    return knots[knots.length - 1]!.speed;
  };
}

/** Source seconds consumed over `seconds` while the speed eases from `from` to `to`. */
function easeSpan(from: number, to: number, seconds: number, ease: RampEase): number {
  const shape = bezierEase(EASES[ease]);
  const steps = 200;
  let sum = 0;
  for (let i = 0; i < steps; i += 1) sum += from + (to - from) * shape((i + 0.5) / steps);
  return (sum / steps) * seconds;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

interface Shape {
  slow: number;
  fast: number;
  ramp: number;
  hold: number;
}

const PRESET_SHAPE: Readonly<Record<Exclude<RampPreset, "custom">, Shape>> = {
  // Starts in slow motion and accelerates into the shot.
  ramp_in: { slow: 0.25, fast: 1, ramp: 1, hold: 0 },
  // Plays at speed, then eases into slow motion that carries the cut.
  ramp_out: { slow: 0.25, fast: 1, ramp: 1, hold: 0 },
  // Normal speed, a held slow-mo moment, normal speed.
  hero: { slow: 0.25, fast: 1, ramp: 0.5, hold: 1 },
  // Rush, near-freeze on the beat, rush again.
  velocity: { slow: 0.1, fast: 2.5, ramp: 0.6, hold: 0.15 },
};

function checkSpeed(value: number, name: string): number {
  const v = requireFinite(value, name);
  if (!(v >= RAMP_MIN_SPEED && v <= RAMP_MAX_SPEED)) throw invalid(`${name} must be between ${RAMP_MIN_SPEED} and ${RAMP_MAX_SPEED} (got ${v}).`);
  return v;
}

function checkSeconds(value: number, name: string, max: number): number {
  const v = requireFinite(value, name);
  if (!(v >= 0 && v <= max)) throw invalid(`${name} must be between 0 and ${max} seconds (got ${v}).`);
  return v;
}

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

/** Source frames consumed by output frame `i` (speed integrated across the frame). */
function frameSpan(speed: (t: number) => number, i: number, rate: number): number {
  const steps = 16;
  let sum = 0;
  for (let k = 0; k < steps; k += 1) sum += speed((i + (k + 0.5) / steps) / rate);
  return sum / steps;
}

interface Integrated {
  /** Cumulative source frames before output frame i; length frames + 1. */
  cumulative: number[];
  /** True when the source ran out before the curve ended. */
  exhausted: boolean;
}

/**
 * Step the curve one output frame at a time until it has spent `budget`
 * source frames (a clamp at the end of the footage) or, with `endFrame`, until
 * that frame.
 */
function integrate(speed: (t: number) => number, rate: number, budget: number, endFrame?: number): Integrated {
  const cap = Math.ceil(MAX_RAMP_SECONDS * rate);
  const cumulative = [0];
  let total = 0;
  for (let i = 0; i < cap; i += 1) {
    if (endFrame !== undefined && i >= endFrame) return { cumulative, exhausted: false };
    const span = frameSpan(speed, i, rate);
    if (total + span >= budget - 1e-9) {
      cumulative.push(budget);
      return { cumulative, exhausted: true };
    }
    total += span;
    cumulative.push(total);
  }
  throw invalid(`That ramp would run longer than ${MAX_RAMP_SECONDS} seconds; raise the slowest speed or trim the clip.`);
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

interface SourceWindow {
  /** First and last source frame the clip plays now (project frames, 1-based). */
  first: number;
  last: number;
  /** Frames in the media, when known. */
  mediaFrames: number | null;
}

function sourceWindow(project: Project, clip: Clip): SourceWindow {
  const fps = fpsOf(project);
  const rate = rateOf(project);
  const mediaFrames = readerBounds(clip.reader, fps).frames;
  const points = Array.isArray(clip.time?.Points) ? [...clip.time.Points].sort((a, b) => Number(a?.co?.X) - Number(b?.co?.X)) : [];
  if (points.length >= 2) {
    const first = Math.trunc(pyRound(Number(points[0]!.co.Y)));
    const last = Math.trunc(pyRound(Number(points[points.length - 1]!.co.Y)));
    return { first, last, mediaFrames };
  }
  const first = Math.trunc(pyRound(Number(clip.start) * rate)) + 1;
  const last = Math.trunc(pyRound(Number(clip.end) * rate));
  return { first, last, mediaFrames };
}

function requireRampable(project: Project, clip: Clip): void {
  const reader = (clip.reader ?? {}) as unknown as Record<string, unknown>;
  if (reader.has_single_image === true || reader.has_video === false) throw invalid(`Clip ${clip.id} has no moving picture to ramp.`);
  if (repeatIsActive(clip)) throw invalid(`Clip ${clip.id} is looped; reset it first (set_clip_speed_tool reset=true).`);
  const points = Array.isArray(clip.time?.Points) ? clip.time.Points : [];
  if (points.length >= 2 && timeCurveIsReversed(clip.time)) throw invalid(`Clip ${clip.id} plays backwards; reset its speed first (set_clip_speed_tool reset=true).`);
  if (points.length > 2 && !("zenvi_speed_ramp" in clip)) {
    throw invalid(`Clip ${clip.id} already has a custom time curve (freeze frame or a desktop speed ramp); reset its speed first (set_clip_speed_tool reset=true).`);
  }
  if (Number(project.fps?.num) <= 0) throw invalid("The project has no frame rate.");
}

function sourceFps(clip: Clip): number | null {
  const fps = (clip.reader as unknown as { fps?: { num?: number; den?: number } } | undefined)?.fps;
  const num = Number(fps?.num);
  const den = Number(fps?.den);
  return num > 0 && den > 0 ? num / den : null;
}

/** The speed knots of a preset, given where the slowest moment lands (seconds from the clip start). */
function presetKnots(preset: Exclude<RampPreset, "custom">, shape: Shape, peak: number): Knot[] {
  const { slow, fast, ramp, hold } = shape;
  if (preset === "ramp_in") return [{ at: 0, speed: slow }, { at: ramp, speed: fast }];
  const lead = peak - hold / 2 - ramp;
  return [
    { at: 0, speed: fast },
    { at: lead, speed: fast },
    { at: lead + ramp, speed: slow },
    { at: lead + ramp + hold, speed: slow },
    { at: lead + 2 * ramp + hold, speed: fast },
  ];
}

/**
 * Plan a speed ramp for `clip`: validate everything and build the new `time`
 * curve without touching the project. Throws `OpError` (invalid_argument) for a
 * request that cannot be honoured.
 */
export function planSpeedRamp(project: Project, clipId: string, request: RampRequest): RampPlan {
  const clip = requireEditableClip(project, clipId);
  requireRampable(project, clip);
  const preset = request.preset;
  if (!RAMP_PRESETS.includes(preset)) throw invalid(`preset must be one of ${RAMP_PRESETS.join(", ")}.`);
  const ease: RampEase = request.ease ?? "smooth";
  if (!(ease in EASES)) throw invalid(`ease must be one of ${RAMP_EASES.join(", ")}.`);
  const rate = rateOf(project);
  const warnings: string[] = [];
  const window = sourceWindow(project, clip);
  const span = window.last - window.first + 1;
  if (span < 2) throw invalid(`Clip ${clip.id} is too short to ramp.`);
  const position = Number(clip.position) || 0;
  const durationBefore = Number(clip.end) - Number(clip.start);

  let hit: number | undefined;
  if (request.hitAt !== undefined) {
    if (preset === "ramp_in" || preset === "ramp_out") {
      throw invalid(`hit_at needs hero, velocity or custom; for ${preset} place the clip where the slow moment should land.`);
    }
    hit = pyRound((requireFinite(request.hitAt, "hit_at") - position) * rate) / rate;
    if (hit <= 0) throw invalid(`hit_at ${request.hitAt} s is before the clip starts at ${position} s; move the clip earlier or pick a later beat.`);
  }

  let curve: (t: number) => number;
  let endFrame: number | undefined;
  let budget = span;
  let recipe: Record<string, unknown>;

  if (preset === "custom") {
    const given = request.points;
    if (!given || given.length < 2) throw invalid("custom needs points: at least two {at_seconds_in_clip, speed}.");
    if (given.length > 64) throw invalid("custom takes at most 64 points.");
    let knots: Knot[] = given.map((p, i) => ({
      at: checkSeconds(p.atSeconds, `points[${i}].at_seconds_in_clip`, MAX_RAMP_SECONDS),
      speed: checkSpeed(p.speed, `points[${i}].speed`),
    }));
    for (let i = 1; i < knots.length; i += 1) {
      if (!(knots[i]!.at > knots[i - 1]!.at)) throw invalid("points must have strictly increasing at_seconds_in_clip.");
    }
    if (hit !== undefined) {
      // The slowest knot lands on the beat: slide the whole curve along the clip.
      const slowest = knots.reduce((a, b) => (b.speed < a.speed ? b : a));
      const shift = hit - slowest.at;
      if (knots[0]!.at + shift < -1e-9) throw invalid(`hit_at ${request.hitAt} s is too early: the points before the slowest one need ${(slowest.at - knots[0]!.at).toFixed(2)} s of lead-in.`);
      knots = knots.map((k) => ({ at: k.at + shift, speed: k.speed }));
      if (knots[0]!.at > 1e-9) knots.unshift({ at: 0, speed: knots[0]!.speed });
    }
    curve = speedCurve(knots, ease);
    endFrame = Math.max(1, Math.trunc(pyRound(knots[knots.length - 1]!.at * rate)));
    // Explicit points may read on past the clip's out point, up to the end of the media.
    budget = (window.mediaFrames ?? window.last) - window.first + 1;
    recipe = { preset, ease, points: knots.map((k) => ({ at_seconds_in_clip: Math.round(k.at * 1000) / 1000, speed: k.speed })) };
  } else {
    const base = PRESET_SHAPE[preset];
    const shape: Shape = {
      slow: checkSpeed(request.slow ?? base.slow, "slow"),
      fast: checkSpeed(request.fast ?? base.fast, "fast"),
      ramp: checkSeconds(request.rampSeconds ?? base.ramp, "ramp_seconds", 30),
      hold: checkSeconds(request.holdSeconds ?? base.hold, "hold_seconds", 30),
    };
    if (shape.slow > shape.fast) throw invalid(`slow (${shape.slow}) must not be faster than fast (${shape.fast}).`);
    if (preset === "ramp_out") {
      // Cruise, then slow down so the last source frame is the slowest: the cruise
      // length is whatever is left of the footage after the ease.
      const eased = easeSpan(shape.fast, shape.slow, shape.ramp, ease);
      const cruise = span / rate - eased;
      if (!(cruise > 0)) throw invalid(`Clip ${clip.id} is too short for a ${shape.ramp} s ramp-out: it has ${(span / rate).toFixed(2)} s of footage; shorten ramp_seconds.`);
      const cruiseOut = cruise / shape.fast;
      curve = speedCurve([{ at: 0, speed: shape.fast }, { at: cruiseOut, speed: shape.fast }, { at: cruiseOut + shape.ramp, speed: shape.slow }], ease);
    } else if (preset === "ramp_in") {
      curve = speedCurve(presetKnots(preset, shape, 0), ease);
    } else {
      let peak = hit;
      const minPeak = shape.hold / 2 + shape.ramp;
      if (peak === undefined) {
        // No beat given: centre the slow moment on the footage.
        const spent = (t: number) => {
          const c = speedCurve(presetKnots(preset, shape, t), ease);
          let sum = 0;
          const steps = Math.max(1, Math.round(t * rate));
          for (let i = 0; i < steps; i += 1) sum += frameSpan(c, i, rate);
          return sum;
        };
        let lo = minPeak;
        let hi = minPeak + span / 2 / rate / shape.fast + 1 / rate;
        if (spent(lo) >= span / 2) hi = lo;
        for (let i = 0; i < 30 && hi - lo > 0.5 / rate; i += 1) {
          const mid = (lo + hi) / 2;
          if (spent(mid) < span / 2) lo = mid;
          else hi = mid;
        }
        peak = pyRound(((lo + hi) / 2) * rate) / rate;
      } else if (peak < minPeak - 1e-9) {
        // The beat is too close to the clip start for the full ease: shorten it.
        const shorter = peak - shape.hold / 2;
        if (shorter < 1 / rate) {
          throw invalid(`hit_at ${request.hitAt} s is only ${peak.toFixed(2)} s after the clip starts; the slow moment needs ${minPeak.toFixed(2)} s of lead-in (ramp_seconds ${shape.ramp} + half of hold_seconds ${shape.hold}). Move the clip earlier or lower ramp_seconds.`);
        }
        warnings.push(`ramp_seconds shortened from ${shape.ramp} to ${shorter.toFixed(2)} s so the slowest moment lands on hit_at.`);
        shape.ramp = shorter;
      }
      curve = speedCurve(presetKnots(preset, shape, peak), ease);
      hit = peak;
    }
    recipe = { preset, ease, slow: shape.slow, fast: shape.fast, ramp_seconds: shape.ramp, hold_seconds: shape.hold };
  }

  const stepped = integrate(curve, rate, budget, endFrame);
  const frames = stepped.cumulative.length - 1;
  if (frames < 2) throw invalid("That ramp leaves the clip under two frames long.");

  // The curve ran the footage out before it finished (ramp_in and ramp_out end that way by design).
  if (stepped.exhausted && preset !== "ramp_in" && preset !== "ramp_out") {
    const seconds = frames / rate;
    if (endFrame !== undefined && hit !== undefined && seconds < hit) {
      throw invalid(`The media runs out ${seconds.toFixed(2)} s into the clip, before the slowest point at ${hit.toFixed(2)} s. Lower the speeds before it or pick an earlier hit_at.`);
    }
    if (endFrame !== undefined) {
      warnings.push(`The media ends ${seconds.toFixed(2)} s into the ramp; the clip is cut there and the last points are not reached.`);
    } else if (hit !== undefined) {
      const shape = recipe as { ramp_seconds: number; hold_seconds: number };
      if (seconds < hit) {
        throw invalid(`The footage runs out ${seconds.toFixed(2)} s into the clip, before the slow moment at ${hit.toFixed(2)} s. Lower fast, trim the clip's out point later, or pick an earlier hit_at.`);
      }
      if (seconds < hit + shape.hold_seconds / 2 + shape.ramp_seconds) {
        warnings.push(`The footage runs out ${seconds.toFixed(2)} s into the clip, before the speed-up after the slow moment finishes.`);
      }
    }
  }
  if (frames / rate > MAX_RAMP_SECONDS) throw invalid(`That ramp would run longer than ${MAX_RAMP_SECONDS} seconds.`);

  const speeds: number[] = [];
  for (let i = 0; i < frames; i += 1) speeds.push((stepped.cumulative[i + 1]! - stepped.cumulative[i]!));
  // The slowest moment: the middle of the first run of minimum-speed frames.
  const minSpeed = Math.min(...speeds);
  const maxSpeed = Math.max(...speeds);
  const firstMin = speeds.findIndex((s) => s <= minSpeed + 1e-6);
  let lastMin = firstMin;
  while (lastMin + 1 < speeds.length && speeds[lastMin + 1]! <= minSpeed + 1e-6) lastMin += 1;
  const slowestAt = (firstMin + (lastMin - firstMin) / 2 + 0.5) / rate;

  const startX = Math.trunc(pyRound(Number(clip.start) * rate)) + 1;
  const sourceIn = window.first;
  const exact: number[] = stepped.cumulative.map((c) => sourceIn + c);
  // The last key is the final source frame once the footage is spent; it is the curve's end, not a shown frame.
  const lastSource = sourceIn + budget - 1;
  if (stepped.exhausted) exact[frames] = lastSource;
  for (let i = 0; i < frames; i += 1) exact[i] = Math.min(exact[i]!, lastSource);
  const sourceOut = Math.trunc(pyRound(exact[frames]!));

  const keep = (i: number): boolean => {
    if (i === 0 || i === frames) return true;
    // Constant speed: the neighbours' differences are equal, so the key adds nothing.
    return Math.abs(exact[i + 1]! - exact[i]! - (exact[i]! - exact[i - 1]!)) > 1e-6;
  };
  const points: KeyframePoint[] = [];
  for (let i = 0; i <= frames; i += 1) {
    if (keep(i)) points.push(openshotPoint(startX + i, Math.max(1, Math.trunc(pyRound(exact[i]!))), Interpolation.LINEAR));
  }

  const fpsOfSource = sourceFps(clip);
  if (fpsOfSource !== null && fpsOfSource <= 30.5 && minSpeed < 0.5) {
    warnings.push(
      `Slowing a ${Math.round(fpsOfSource * 100) / 100} fps source to ${Math.round(minSpeed * 100) / 100}x repeats frames and will look choppy; optical-flow slow-mo is a later Zenvi FX render.`,
    );
  }

  return {
    preset,
    ease,
    frames,
    duration: frames / rate,
    durationBefore,
    startX,
    sourceIn,
    sourceOut,
    points,
    speeds,
    minSpeed,
    maxSpeed,
    slowestAt,
    warnings,
    recipe,
  };
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

export interface ApplyRampOptions {
  /** Silence the clip's sound (pitch-bent audio at 0.1x is rarely wanted). Default true. */
  muteAudio?: boolean;
}

/**
 * Write a planned ramp: the clip's other keyframes are rescaled to its new
 * length like `retime_clip`, then the `time` curve is replaced by the ramp's.
 * Returns the new clip.
 */
export function applySpeedRamp(tx: Transaction, clipId: string, plan: RampPlan, opts: ApplyRampOptions = {}): Clip {
  const project = tx.project;
  const clip = requireEditableClip(project, clipId);
  const fps = fpsOf(project);
  const rate = rateOf(project);
  const newEnd = Number(clip.start) + plan.frames / rate;
  const retimed = retimeClip(clip, newEnd, fps, 1, clip.position);
  if (!retimed) throw invalid(`Clip ${clipId} cannot take that ramp.`);
  const time: Keyframe = { ...(retimed.time ?? {}), Points: plan.points };
  const next = withClampedTiming(
    { ...retimed, time, zenvi_speed_ramp: plan.recipe } as unknown as Record<string, unknown>,
    project,
    clip,
  ) as unknown as Clip;
  const replaced = replaceClip(tx, clip, next);
  const hasAudio = (replaced.reader as unknown as { has_audio?: boolean } | undefined)?.has_audio !== false;
  if ((opts.muteAudio ?? true) && hasAudio) return setClipProperty(tx, clipId, "volume", 0);
  return replaced;
}
