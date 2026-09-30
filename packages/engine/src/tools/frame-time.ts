/**
 * The agent frame grid: seconds <-> 0-indexed project frames.
 *
 * Port of zenvi-core src/classes/frame_time.py (contract ref b63c39be7), the
 * "single authority for seconds <-> project-frame conversion" the desktop's
 * agent tools, receipts and placement math use. Rounding is half-up exactly as
 * frame_time.round_half_up computes it (`floor(v + 0.5)` for v >= 0), so a
 * receipt's landedFrame matches the desktop's for the same project.
 */

import type { Fraction, Project } from "../model/types.js";

/** A frame rate: an exact fraction, or a positive integer. */
export type Fps = Fraction | number;

function num(fps: Fps): number {
  return typeof fps === "number" ? fps : fps.num;
}

function den(fps: Fps): number {
  return typeof fps === "number" ? 1 : fps.den;
}

function requireRate(fps: Fps): void {
  const n = num(fps);
  const d = den(fps);
  if (!Number.isFinite(n) || !Number.isFinite(d) || n <= 0 || d <= 0) {
    throw new RangeError(`fps must be positive, got ${n}/${d}`);
  }
}

function requireFinite(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number, got ${String(value)}`);
  }
  return value;
}

/** `float(Fraction(num, den))`. */
export function fpsFloat(fps: Fps): number {
  requireRate(fps);
  return num(fps) / den(fps);
}

/**
 * frame_time.round_half_up: halves round away from zero, computed the way the
 * Python does (`math.floor(v + 0.5)` / `math.ceil(v - 0.5)`), including its
 * behaviour at values like 0.49999999999999994.
 */
export function roundHalfUp(value: number): number {
  requireFinite(value, "value");
  const r = value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
  return r === 0 ? 0 : r;
}

/** Seconds to a 0-indexed project frame (half-up). frame_time.to_frame. */
export function toFrame(seconds: number, fps: Fps): number {
  requireFinite(seconds, "seconds");
  return roundHalfUp(seconds * fpsFloat(fps));
}

/** A 0-indexed project frame to seconds: `float(Fraction(frame) / fps)`. */
export function toSeconds(frame: number, fps: Fps): number {
  requireRate(fps);
  if (!Number.isInteger(frame)) throw new RangeError(`frame must be an int, got ${String(frame)}`);
  // frame * den is exact for any realistic frame count, and the division is
  // correctly rounded, so this is the same double as Python's float(Fraction).
  return (frame * den(fps)) / num(fps);
}

/** Snap seconds to the nearest frame boundary. */
export function snap(seconds: number, fps: Fps): number {
  return toSeconds(toFrame(seconds, fps), fps);
}

/** 1-indexed OpenShot Point X for a time in seconds. */
export function keyframeX(seconds: number, fps: Fps): number {
  return toFrame(seconds, fps) + 1;
}

/** Frame count spanned by [start, end), at least 1 (frame_time.duration_frames). */
export function durationFrames(start: number, end: number, fps: Fps): number {
  requireFinite(start, "start");
  requireFinite(end, "end");
  if (end <= start) {
    if (end === start) return 1;
    return Math.max(1, toFrame(end, fps) - toFrame(start, fps));
  }
  return Math.max(1, roundHalfUp((end - start) * fpsFloat(fps)));
}

/**
 * Quantize position/start/end keeping the duration in whole frames, so
 * repeated trims cannot gain or lose frames (frame_time.quantize_span).
 */
export function quantizeSpan(position: number, start: number, end: number, fps: Fps): [number, number, number] {
  const posFrame = toFrame(position, fps);
  const startFrame = toFrame(start, fps);
  const dur = durationFrames(start, end, fps);
  return [toSeconds(posFrame, fps), toSeconds(startFrame, fps), toSeconds(startFrame + dur, fps)];
}

/** Seconds of a 1-indexed Point X. */
export function keyframeXToSeconds(x: number, fps: Fps): number {
  return toSeconds(Math.trunc(x) - 1, fps);
}

/**
 * The project frame rate (clip_utils.project_fps_fraction): `project.fps`
 * when it is a valid fraction, else 30/1.
 */
export function projectFps(project: Pick<Project, "fps"> | null | undefined): Fraction {
  const fps = project?.fps as { num?: unknown; den?: unknown } | undefined;
  const n = Math.trunc(Number(fps?.num));
  const d = Math.trunc(Number(fps?.den));
  if (Number.isFinite(n) && Number.isFinite(d) && n > 0 && d > 0) return { num: n, den: d };
  return { num: 30, den: 1 };
}
