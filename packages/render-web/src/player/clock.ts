/**
 * Playback clocks: timeline time now.
 *
 * With audio, the AudioContext is the master: video follows what is being
 * heard (`getOutputTimestamp` accounts for output latency), so it can never
 * drift from sound. Without audio, `performance.now()` drives it. Either way
 * the renderer shows the frame the clock says and drops the ones it misses.
 */

import { timelineTimeOf, type ClockAnchor } from "../audio/schedule.js";

export interface PlaybackClock {
  readonly kind: "audio" | "performance";
  /** Timeline seconds now. */
  now(): number;
}

/** Wall-clock playback: timeline `timeline` at `performanceMs`, advancing at `rate`. */
export function performanceClock(anchor: { timeline: number; performanceMs: number; rate: number }, nowMs: () => number): PlaybackClock {
  return {
    kind: "performance",
    now: () => anchor.timeline + ((nowMs() - anchor.performanceMs) / 1000) * anchor.rate,
  };
}

/** What an AudioContext can tell about its output. */
export interface AudioClockSource {
  readonly currentTime: number;
  readonly baseLatency?: number;
  readonly outputLatency?: number;
  getOutputTimestamp?(): AudioTimestamp;
}

/** Context time of the sample being heard right now. */
export function audibleContextTime(context: AudioClockSource, nowMs: () => number): number {
  const stamp = context.getOutputTimestamp?.();
  if (stamp && typeof stamp.contextTime === "number" && typeof stamp.performanceTime === "number" && stamp.performanceTime > 0) {
    return stamp.contextTime + (nowMs() - stamp.performanceTime) / 1000;
  }
  return context.currentTime - (context.outputLatency ?? context.baseLatency ?? 0);
}

/**
 * Audio-driven playback. Holds at the anchor's timeline time until its
 * context time is heard, and never runs backwards (output timestamps jitter).
 */
export function audioClock(anchor: ClockAnchor, context: AudioClockSource, nowMs: () => number): PlaybackClock {
  let last = anchor.timeline;
  return {
    kind: "audio",
    now: () => {
      const heard = audibleContextTime(context, nowMs);
      const t = timelineTimeOf(anchor, Math.max(anchor.context, heard));
      last = anchor.rate >= 0 ? Math.max(last, t) : Math.min(last, t);
      return last;
    },
  };
}
