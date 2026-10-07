/**
 * Which decoded picture shows a plan's source time.
 *
 * libopenshot numbers source pictures by rounding: picture p is frame
 * `round((pts_p - first_pts) * fps) + 1` (`FFmpegReader.cpp:2557-2690`,
 * libopenshot-semantics §5.2 and §6). A plan asks for source frame k as the
 * time `(k-1)/fps`, so the picture to show is the last one whose pts lies
 * strictly below `first_pts + (k - 0.5)/fps`. Mediabunny sinks return "the last
 * sample whose timestamp is <= t", so we query just under that half-frame
 * boundary. This makes lookups immune to pts jitter (29.97 fps timestamps that
 * land a hair before or after the ideal grid) and still picks "the frame at or
 * before t" for variable frame rate media.
 */

/** Guard so a picture exactly on a half-frame boundary rounds up, like C `round`. */
export const HALF_FRAME_EPSILON = 1e-6;

/**
 * Tolerance when the frame rate is unknown: absorbs timebase rounding (WebM
 * stores milliseconds) without reaching the next picture below 250 fps.
 */
export const UNKNOWN_RATE_TOLERANCE = 0.002;

/**
 * Container timestamp to request for `sourceTime` (seconds from the first
 * picture). `timeOffset` is the container timestamp of that first picture;
 * `frameDuration` is 1/fps of the source, or null when unknown.
 */
export function decodeTimestamp(sourceTime: number, timeOffset: number, frameDuration: number | null): number {
  const t = Number.isFinite(sourceTime) ? Math.max(0, sourceTime) : 0;
  const half = frameDuration !== null && frameDuration > 0 ? frameDuration / 2 : UNKNOWN_RATE_TOLERANCE;
  return timeOffset + t + Math.max(0, half - HALF_FRAME_EPSILON);
}

/** A decoded picture's presentation interval, `[start, end)`. */
export interface FrameSpan {
  start: number;
  end: number;
}

export function spanCovers(span: FrameSpan, timestamp: number): boolean {
  return span.start <= timestamp && timestamp < span.end;
}

/**
 * End of a picture's interval: the next picture's timestamp when known, else
 * its own duration, else one nominal frame.
 */
export function spanEnd(start: number, duration: number, nextStart: number | null, frameDuration: number | null): number {
  if (nextStart !== null && nextStart > start) return nextStart;
  if (duration > 0) return start + duration;
  if (frameDuration !== null && frameDuration > 0) return start + frameDuration;
  return start + HALF_FRAME_EPSILON;
}

export type CursorAction = "reuse" | "advance" | "reseek";

/**
 * What a sequential decode cursor should do to reach `timestamp`.
 *
 * - `reuse`: the cursor's current picture already covers it.
 * - `advance`: decode forward from the cursor (cheaper than seeking because no
 *   keyframe lies between the cursor and the target).
 * - `reseek`: start a new decode at the keyframe before the target (going
 *   backwards, or past the next keyframe so decoding from the cursor would do
 *   more work than decoding from that keyframe).
 */
export function cursorAction(current: FrameSpan | null, nextKeyframe: number | null, timestamp: number): CursorAction {
  if (!current) return "reseek";
  if (spanCovers(current, timestamp)) return "reuse";
  if (timestamp < current.start) return "reseek";
  if (nextKeyframe !== null && timestamp >= nextKeyframe) return "reseek";
  return "advance";
}
