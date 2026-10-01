/**
 * Where plan audio lands: timeline ↔ source ↔ audio-context time.
 *
 * All positions are integer sample frames of the source stream, so pieces
 * scheduled back to back cover contiguous samples with no drift, however
 * long playback runs.
 */

import type { AudioSegment } from "@zenvi/engine/render";

/** The part of a segment inside a timeline window. */
export interface SegmentPiece {
  segment: AudioSegment;
  /** Timeline seconds covered. */
  timelineStart: number;
  timelineEnd: number;
  /** Source sample frames covered, `[startFrame, endFrame)`, ascending even when reversed. */
  startFrame: number;
  endFrame: number;
  /** Plays the source backwards (negative segment rate). */
  reversed: boolean;
  /** |segment rate|. */
  speed: number;
}

/**
 * Clip `segment` to the timeline window `[from, to)`, in source frames at
 * `sampleRate`. Null when nothing audible remains (outside the window, zero
 * length, or a frozen rate of 0: libopenshot plays silence then, spec §2.6).
 */
export function segmentPiece(segment: AudioSegment, from: number, to: number, sampleRate: number): SegmentPiece | null {
  const speed = Math.abs(segment.rate);
  if (!(speed > 0) || !(segment.duration > 0) || !(sampleRate > 0)) return null;
  const start = Math.max(from, segment.timelineStart);
  const end = Math.min(to, segment.timelineStart + segment.duration);
  if (!(end > start)) return null;
  const reversed = segment.rate < 0;
  const sourceAt = (t: number) => segment.sourceStart + (t - segment.timelineStart) * segment.rate;
  const a = sourceAt(start);
  const b = sourceAt(end);
  const startFrame = Math.round(Math.min(a, b) * sampleRate);
  const endFrame = Math.round(Math.max(a, b) * sampleRate);
  if (endFrame <= startFrame) return null;
  return { segment, timelineStart: start, timelineEnd: end, startFrame, endFrame, reversed, speed };
}

/** A playback anchor: timeline time `timeline` sounds at context time `context`, at `rate`. */
export interface ClockAnchor {
  timeline: number;
  context: number;
  rate: number;
}

export function contextTimeOf(anchor: ClockAnchor, timeline: number): number {
  return anchor.context + (timeline - anchor.timeline) / anchor.rate;
}

export function timelineTimeOf(anchor: ClockAnchor, context: number): number {
  return anchor.timeline + (context - anchor.context) * anchor.rate;
}

/**
 * Start arguments for an `AudioBufferSourceNode` that must sound from context
 * time `when`, given that the context is already at `now` (decoding can finish
 * late): skip the part that should already have played instead of playing it
 * late. `bufferDuration` is in buffer seconds; `speed` is the node's
 * playbackRate. Null when the whole buffer is already in the past.
 */
export function lateStart(when: number, now: number, bufferDuration: number, speed: number): { when: number; offset: number; duration: number } | null {
  if (when >= now) return { when, offset: 0, duration: bufferDuration };
  const skipped = (now - when) * speed;
  if (skipped >= bufferDuration) return null;
  return { when: now, offset: skipped, duration: bufferDuration - skipped };
}
