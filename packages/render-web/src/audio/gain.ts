/**
 * Segment gain envelopes → Web Audio automation.
 *
 * The planner samples the volume keyframe (with mixing and transition fades
 * folded in) into a piecewise-linear envelope; `AudioParam` automation
 * reproduces it exactly: a `setValueAtTime` at the start of each scheduled
 * piece, then `linearRampToValueAtTime` to every envelope point inside it and
 * to the value at its end.
 */

import type { GainPoint } from "@zenvi/engine/render";

/**
 * Envelope value at `t` (seconds from the segment start), approaching from
 * the left: at a step (two points with the same `t`) the value before it.
 * Constant beyond the ends, 1 when empty.
 */
export function gainAt(points: readonly GainPoint[], t: number): number {
  if (points.length === 0) return 1;
  const first = points[0]!;
  if (t <= first.t) return first.gain;
  for (let i = 1; i < points.length; i += 1) {
    const right = points[i]!;
    if (t <= right.t) {
      const left = points[i - 1]!;
      const span = right.t - left.t;
      return span > 0 ? left.gain + ((right.gain - left.gain) * (t - left.t)) / span : right.gain;
    }
  }
  return points[points.length - 1]!.gain;
}

/** Envelope value just after `t`: at a step, the value after it. */
export function gainAfter(points: readonly GainPoint[], t: number): number {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (points[i]!.t === t) return points[i]!.gain;
  }
  return gainAt(points, t);
}

export type GainEvent = { kind: "set" | "ramp"; t: number; value: number };

/**
 * Automation for the envelope between `from` and `to` (segment-relative
 * seconds). Playback runs forward, so it starts from the value after `from`
 * and ends on the value before `to`; steps inside become zero-length ramps.
 */
export function gainEvents(points: readonly GainPoint[], from: number, to: number): GainEvent[] {
  const events: GainEvent[] = [{ kind: "set", t: from, value: gainAfter(points, from) }];
  for (const point of points) {
    if (point.t > from && point.t < to) events.push({ kind: "ramp", t: point.t, value: point.gain });
  }
  if (to > from) events.push({ kind: "ramp", t: to, value: gainAt(points, to) });
  return events;
}

/** True when the envelope is 1 everywhere in `[from, to]` (no gain node needed). */
export function isUnityGain(points: readonly GainPoint[], from: number, to: number): boolean {
  return gainEvents(points, from, to).every((e) => Math.abs(e.value - 1) < 1e-9);
}
