/**
 * Clip and transition frame windows, exactly as `Timeline::GetFrame` finds
 * the items that intersect a timeline frame.
 *
 * libopenshot stores position/start/end as 32-bit floats (ClipBase.h:35-38)
 * and `Duration()` is `end - start` in float (ClipBase.h:90). Then
 * (Timeline.cpp:1071-1075, :575-585):
 *
 *   start_pos   = llround(position * fps) + 1
 *   end_pos     = llround((position + Duration()) * fps)          // inclusive
 *   start_frame = llround(start * fps) + 1
 *   clip frame at timeline frame f = f - start_pos + start_frame
 *
 * Keyframes of a clip are evaluated at that clip frame.
 */

import type { Fraction } from "../model/types.js";
import { pyRound, roundHalfAway } from "../model/rounding.js";
import { fpsFloat } from "./time.js";

/** Anything with libopenshot ClipBase timing: clips and transitions. */
export interface Timed {
  position: number;
  start: number;
  end: number;
}

export interface FrameWindow {
  /** First timeline frame covered (1-based, inclusive). */
  startFrame: number;
  /** Last timeline frame covered (inclusive). `endFrame < startFrame` means empty. */
  endFrame: number;
  /** Item-local frame at `startFrame` (clips: source frame; transitions: usually 1). */
  localStartFrame: number;
}

const f32 = Math.fround;

/** `ClipBase::Duration()`: float(end) - float(start), in float. */
export function durationF32(item: Timed): number {
  return f32(f32(item.end) - f32(item.start));
}

/** The timeline frames an item covers (libopenshot semantics). */
export function frameWindow(item: Timed, fps: Fraction): FrameWindow {
  const rate = fpsFloat(fps);
  const position = f32(item.position);
  const start = f32(item.start);
  const endTime = f32(position + durationF32(item));
  return {
    startFrame: roundHalfAway(position * rate) + 1,
    endFrame: roundHalfAway(endTime * rate),
    localStartFrame: roundHalfAway(start * rate) + 1,
  };
}

/** True when timeline frame `frame` is inside the window. */
export function windowContains(window: FrameWindow, frame: number): boolean {
  return window.startFrame <= frame && frame <= window.endFrame;
}

/** Item-local frame shown at timeline frame `frame` (clip keyframes are evaluated here). */
export function localFrame(window: FrameWindow, frame: number): number {
  return frame - window.startFrame + window.localStartFrame;
}

/** Timeline frame at which item-local frame `local` is shown. */
export function timelineFrameOf(window: FrameWindow, local: number): number {
  return local - window.localStartFrame + window.startFrame;
}

/**
 * The frame `find_intersecting_clips` uses to decide which readers to open:
 * like `frameWindow().endFrame` plus one (Timeline.cpp:1182).
 */
export function nearbyEndFrame(item: Timed, fps: Fraction): number {
  return frameWindow(item, fps).endFrame + 1;
}

/**
 * The clip frame (keyframe X) for timeline time `seconds`, as the desktop
 * Properties panel computes it (properties_model.py `update_frame`):
 * `round((t - position + start) * fps) + 1` with Python rounding on the
 * float32 clip times, clamped to the clip's frames
 * `[round(start*fps)+1, round(end*fps)]` unless `clamp` is false.
 */
export function clipFrameAtTime(item: Timed, seconds: number, fps: Fraction, clamp = true): number {
  const rate = fpsFloat(fps);
  const frame = pyRound((seconds - f32(item.position) + f32(item.start)) * rate) + 1;
  if (!clamp) return frame;
  const min = pyRound(f32(item.start) * rate) + 1;
  const max = pyRound(f32(item.end) * rate);
  if (frame < min) return min;
  if (frame > max) return Math.max(min, max);
  return frame;
}

/** Timeline seconds at which clip frame (keyframe X) `frame` is shown. */
export function timeOfClipFrame(item: Timed, frame: number, fps: Fraction): number {
  return (frame - 1) / fpsFloat(fps) - item.start + item.position;
}

/**
 * Keyframe X of a clip's first frame as the desktop's Python computes it
 * (`round(start * fps_float) + 1`, Python rounding; timeline.py Fade_Triggered).
 */
export function firstClipFrame(item: Timed, fps: Fraction): number {
  return pyRound(item.start * fpsFloat(fps)) + 1;
}

/** The desktop's `end_of_clip` keyframe X: `round(end * fps_float) + 1` (Python rounding). */
export function endClipFrame(item: Timed, fps: Fraction): number {
  return pyRound(item.end * fpsFloat(fps)) + 1;
}

/** Timeline seconds where an item ends: position + (end - start). */
export function itemEnd(item: Timed): number {
  return item.position + (item.end - item.start);
}

/** Length of an item on the timeline, seconds. */
export function itemDuration(item: Timed): number {
  return item.end - item.start;
}
