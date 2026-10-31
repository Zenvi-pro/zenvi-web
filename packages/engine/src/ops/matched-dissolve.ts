/**
 * A motion-matched dissolve: a plain dissolve (the desktop's fade
 * transition, overlapping the clips) through which both pictures keep moving
 * the same way at one speed, so the blend reads as one camera move instead of
 * two stills crossing (bench round 7: "plain dissolves" in the wedding film).
 *
 * The outgoing clip drifts over its last stretch (the blend and a second
 * before it) and the incoming one from its first frame on, both linear at
 * `rate` (scale per second), so their velocities match through the blend;
 * the incoming drift stops after DRIFT_IN seconds, long after the blend.
 * The drift multiplies the clip's own (static) scale, so a clip framed at
 * 1.5 stays framed and the frame stays covered. A clip with its own scale
 * animation keeps it (and is reported) rather than being overwritten.
 */

import type { Transaction } from "../history/document.js";
import { makeKeyframePoint } from "../keyframe/edit.js";
import { Interpolation, type Clip, type Fraction, type Keyframe, type Transition } from "../model/types.js";
import { clipFrameAtTime } from "../timeline/windows.js";
import { invalid, requireClip, requireFinite } from "./errors.js";
import { fpsOf, patchClip } from "./internal.js";
import { applyTransitionBetween } from "./transitions.js";

export const DISSOLVE_DRIFTS = ["push_in", "pull_out"] as const;
export type DissolveDrift = (typeof DISSOLVE_DRIFTS)[number];

/** Seconds of drift before the blend on the outgoing clip. */
const LEAD = 1;
/** Longest the incoming clip drifts, seconds. */
const DRIFT_IN = 4;

export interface MatchedDissolveInput {
  outClipId: string;
  inClipId: string;
  /** Blend length, seconds. */
  duration: number;
  drift: DissolveDrift;
  /** Scale change per second, 0.005-0.1. */
  rate: number;
}

export interface MatchedDissolveResult {
  transition: Transition;
  movedClip?: Clip;
  /** Clips that got the drift. */
  drifted: string[];
  /** Clips that keep their own scale animation. */
  kept: string[];
}

const animated = (kf: unknown): boolean => Array.isArray((kf as Keyframe | undefined)?.Points) && (kf as Keyframe).Points.length > 1;

/** A still curve's value (the clip's framing), 1 when it has none. */
function staticValue(kf: unknown): number {
  const y = Number((kf as Keyframe | undefined)?.Points?.[0]?.co?.Y);
  return Number.isFinite(y) && y > 0 ? y : 1;
}

/** A linear ramp between timeline times `a` and `b`, `from` → `to`, at clip frames (windows.ts clipFrameAtTime). */
function ramp(clip: Clip, a: number, b: number, from: number, to: number, fps: Fraction): Keyframe {
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  const timed = { position: Number(clip.position), start: Number(clip.start), end: Number(clip.end) };
  return { Points: [makeKeyframePoint(clipFrameAtTime(timed, a, fps), round(from), Interpolation.LINEAR), makeKeyframePoint(clipFrameAtTime(timed, b, fps), round(to), Interpolation.LINEAR)] };
}

export function applyMatchedDissolve(tx: Transaction, input: MatchedDissolveInput): MatchedDissolveResult {
  const rate = requireFinite(input.rate, "rate");
  if (!(rate >= 0.005 && rate <= 0.1)) throw invalid(`rate must be 0.005 to 0.1 scale per second (got ${rate}).`);
  if (!(DISSOLVE_DRIFTS as readonly string[]).includes(input.drift)) throw invalid(`drift must be ${DISSOLVE_DRIFTS.join(" or ")}.`);
  const fps = fpsOf(tx.project);
  const { transition, movedClip } = applyTransitionBetween(tx, input.outClipId, input.inClipId, "fade", input.duration);
  const out = requireClip(tx.project, input.outClipId);
  const inc = requireClip(tx.project, input.inClipId);
  const drifted: string[] = [];
  const kept: string[] = [];
  const write = (clip: Clip, a: number, b: number): void => {
    if (animated(clip.scale_x) || animated(clip.scale_y)) {
      kept.push(clip.id);
      return;
    }
    const grow = rate * (b - a);
    // A push grows the picture through the window; a pull shrinks it back to full frame.
    const [from, to] = input.drift === "push_in" ? [1, 1 + grow] : [1 + grow, 1];
    const sx = staticValue(clip.scale_x);
    const sy = staticValue(clip.scale_y);
    patchClip(tx, clip.id, { scale_x: ramp(clip, a, b, sx * from, sx * to, fps), scale_y: ramp(clip, a, b, sy * from, sy * to, fps) });
    drifted.push(clip.id);
  };
  const outEnd = Number(out.position) + Number(out.end) - Number(out.start);
  const blendStart = Number(transition.position);
  write(out, Math.max(Number(out.position), blendStart - LEAD), outEnd);
  const inStart = Number(inc.position);
  const inEnd = inStart + Number(inc.end) - Number(inc.start);
  // The incoming drift starts at its first frame, inside the blend, at the same speed as the outgoing one.
  write(inc, inStart, Math.min(inEnd, inStart + Math.max(DRIFT_IN, Number(transition.end) - Number(transition.start))));
  return { transition, ...(movedClip ? { movedClip } : {}), drifted, kept };
}
