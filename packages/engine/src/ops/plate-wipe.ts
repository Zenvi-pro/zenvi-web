/**
 * The occluder plate wipe (T103): a plate (a drawn blob, burst or disc, or
 * a sprite from the bin) grows from a point until it covers the whole frame
 * exactly on a cut, holds for a frame or two, then leaves (on through the
 * lens fading, shrinking back, or flying off a side) while the incoming clip
 * pulls back behind it.
 *
 * Native: the plate is one overlay clip with scale/location/alpha/rotation
 * keyframes on a track above both clips (blend Screen optional: composite
 * 14), and the pull-back is the zoom_out motion transition on the same cut
 * (ops/motion-transitions.ts), so the desktop plays it and
 * remove_motion_transition_tool can take the pull-back off. One undo step.
 */

import type { Transaction } from "../history/document.js";
import { keyframeThrough } from "../motion/keyframes.js";
import type { Ease } from "../motion/types.js";
import { Gravity, ScaleMode, type Clip, type Project } from "../model/types.js";
import { invalid } from "./errors.js";
import { rateOf } from "./internal.js";
import { applyFittedMotionTransition, type MotionCut, type MotionTransitionResult, type TransitionSfxCue } from "./motion-transitions.js";
import { placeOverlayClip } from "./overlays.js";

export const PLATE_EXITS = ["through", "shrink", "fly"] as const;
export type PlateExit = (typeof PLATE_EXITS)[number];
export type PlateDirection = "left" | "right" | "up" | "down";

/** Scale a plate starts from: a speck at its point. */
const SPECK = 0.04;
/** Margin on the cover scale: the plate's edge stays clear of the corners. */
const MARGIN = 1.05;
/** Composite value of Screen (libopenshot Clip composite choices). */
const SCREEN = 14;

export interface PlateWipeInput {
  cut: MotionCut;
  /** The plate's media-bin file (a drawn plate's SVG is added before the edit is planned). */
  fileId: string;
  /** Display aspect of the plate (width / height). */
  aspect: number;
  /**
   * The scale at which the plate covers the frame from its point. A drawn
   * plate's comes from its inscribed circle (coverScaleFor); a sprite's is
   * the caller's guess (its opaque core is unknown).
   */
  coverScale: number;
  /** Where it grows from, 0..1 of the frame. */
  x: number;
  y: number;
  /** Frames to cover, to hold covered, to leave. */
  cover: number;
  hold: number;
  exit: number;
  leave: PlateExit;
  direction: PlateDirection;
  screen: boolean;
  /** A drawn plate turns a little as it grows. */
  spin: boolean;
  pullBack: boolean;
  title: string;
  /** The plate's track (planned by the caller above both clips). */
  layer: number;
}

export interface PlateWipeResult {
  plateClipId: string;
  cut: number;
  start: number;
  frames: { cover: number; hold: number; exit: number };
  coverScale: number;
  pullBack: MotionTransitionResult | null;
  sfxCues: TransitionSfxCue[];
  warnings: string[];
}

/** The size Best Fit gives a plate of `aspect` in the frame, px. */
function fitted(project: Project, aspect: number): { w: number; h: number } {
  const W = Number(project.width);
  const H = Number(project.height);
  return aspect > W / H ? { w: W, h: W / aspect } : { w: H * aspect, h: H };
}

/**
 * The scale at which a plate whose largest inner circle has radius
 * `inscribed` × half its short side covers the frame from (x, y): that
 * circle reaches the farthest corner.
 */
export function coverScaleFor(project: Project, aspect: number, inscribed: number, x: number, y: number): number {
  const W = Number(project.width);
  const H = Number(project.height);
  const { w, h } = fitted(project, aspect);
  const far = Math.hypot(Math.max(x, 1 - x) * W, Math.max(y, 1 - y) * H);
  return (MARGIN * far) / ((inscribed * Math.min(w, h)) / 2);
}

/** The plate clip's keyframes and timing, checked before anything changes. */
export function planPlateWipe(project: Project, input: Omit<PlateWipeInput, "fileId" | "layer" | "title">): { start: number; duration: number; props: Record<string, unknown> } {
  const fps = rateOf(project);
  const { cut, cover, hold, exit } = input;
  const start = cut.cut - cover / fps;
  if (start < -1e-6) throw invalid(`the plate needs ${cover} frames before the cut at ${cut.cut.toFixed(2)}s; the timeline starts sooner`);
  const outLength = cut.outClip.end - cut.outClip.start;
  const inLength = cut.inClip.end - cut.inClip.start;
  if (outLength * fps < cover) throw invalid(`clip ${cut.outClip.id} is shorter than the plate's ${cover} frames of growth`);
  if (inLength * fps < hold + exit) throw invalid(`clip ${cut.inClip.id} is shorter than the plate's ${hold + exit} frames after the cut`);
  const S = input.coverScale;
  const lx = input.x - 0.5;
  const ly = input.y - 0.5;
  const { w, h } = fitted(project, input.aspect);
  const W = Number(project.width);
  const H = Number(project.height);
  // Clip frames: the speck at 1, covered on the cut's frame, held, then gone on the last frame.
  const frames = [1, 1 + cover, 1 + cover + hold, cover + hold + exit];
  const exitEase: Ease = input.leave === "through" ? "out" : "in";
  const eases: Ease[] = ["smooth", "in", "linear", exitEase];
  const scaleEnd = input.leave === "through" ? 1.7 * S : input.leave === "shrink" ? SPECK : S;
  let endX = lx;
  let endY = ly;
  if (input.leave === "fly") {
    // Off the frame on that side: its centre past the edge by half its size at the cover scale.
    if (input.direction === "left" || input.direction === "right") endX = (input.direction === "right" ? 1 : -1) * (0.5 + (S * w) / (2 * W));
    else endY = (input.direction === "down" ? 1 : -1) * (0.5 + (S * h) / (2 * H));
  }
  const kf = (values: number[]) => keyframeThrough(frames, values, eases);
  const props: Record<string, unknown> = {
    scale: ScaleMode.FIT,
    gravity: Gravity.CENTER,
    scale_x: kf([SPECK, S, S, scaleEnd]),
    scale_y: kf([SPECK, S, S, scaleEnd]),
    location_x: kf([lx, lx, lx, endX]),
    location_y: kf([ly, ly, ly, endY]),
    alpha: kf([1, 1, 1, input.leave === "through" ? 0 : 1]),
    ...(input.spin ? { rotation: kf([-8, 10, 12, 24]) } : {}),
    ...(input.screen ? { composite: SCREEN } : {}),
  };
  return { start: Math.max(0, start), duration: (cover + hold + exit) / fps, props };
}

/** Place the plate (and the pull-back) inside a transaction. */
export function applyPlateWipe(tx: Transaction, input: PlateWipeInput): PlateWipeResult {
  const plan = planPlateWipe(tx.project, input);
  const fps = rateOf(tx.project);
  const clip: Clip = placeOverlayClip(tx, { fileId: input.fileId, position: plan.start, duration: plan.duration, layer: input.layer, title: input.title, props: plan.props, newTrackLabel: "Plates" });
  const warnings: string[] = [];
  let pullBack: MotionTransitionResult | null = null;
  if (input.pullBack) {
    const { outClip, inClip } = input.cut;
    pullBack = applyFittedMotionTransition(tx, {
      outClipId: outClip.id,
      inClipId: inClip.id,
      preset: "zoom_out",
      frames: Math.min(120, 2 * (input.hold + input.exit)),
      direction: "auto",
      ...(outClip.layer !== inClip.layer ? { acrossTracks: true } : {}),
    });
    if (!pullBack) warnings.push("the incoming clip is too short (or already animated there) for the pull-back; the plate wipes without it");
  }
  const round = (t: number) => Math.round(t * 1000) / 1000;
  const cut = input.cut.cut;
  return {
    plateClipId: clip.id,
    cut: round(cut),
    start: round(plan.start),
    frames: { cover: input.cover, hold: input.hold, exit: input.exit },
    coverScale: Math.round(input.coverScale * 1000) / 1000,
    pullBack,
    sfxCues: [
      { time: round(plan.start), kind: "whoosh", duration: round((input.cover + input.hold) / fps) },
      { time: round(cut), kind: "hit", duration: round(3 / fps) },
    ],
    warnings,
  };
}
