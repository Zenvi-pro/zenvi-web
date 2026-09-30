/**
 * Transition operations (`project.effects[]`, libopenshot `Mask`).
 *
 * Desktop: zenvi-core src/windows/views/timeline.py `addTransition`,
 * `add_missing_transition`, `update_transition_data`,
 * `Reverse_Transition_Triggered`; tool_handlers.py `apply_transition`
 * (`add_transition_between_clips`, `add_transition_to_clip`).
 */

import type { Transaction } from "../history/document.js";
import type { Clip, Transition } from "../model/types.js";
import { OpError } from "./errors.js";
import type { Edge, KeyframeAt, PropertyValue } from "./types.js";

function notImplemented(op: string): never {
  throw new OpError("unsupported", `not implemented: ${op}`);
}

/**
 * `in`: the top clip appears (mask brightness animates 1 → -1, the desktop
 * default for a transition at a clip's start). `out`: the top clip disappears
 * (-1 → 1, desktop "Reverse").
 */
export type TransitionDirection = "in" | "out";

export interface AddTransitionInput {
  /** Track number the transition applies to. */
  layer: number;
  /** Timeline start, seconds. */
  position: number;
  /** Length, seconds (> 0). */
  duration: number;
  /** Catalog id from `transitions/catalog` (e.g. `"common/fade"`). Give this or `path`. */
  maskId?: string;
  /** Explicit mask image path (user transitions). */
  path?: string;
  /** Default `in`. */
  direction?: TransitionDirection;
  /** Display title. Default the catalog name / file name. */
  title?: string;
  id?: string;
}

/** Add a transition with the desktop's default brightness/contrast keyframes. */
export function addTransition(tx: Transaction, input: AddTransitionInput): Transition {
  void tx;
  void input;
  return notImplemented("addTransition");
}

export interface ApplyTransitionResult {
  transition: Transition;
  /** The clip that was moved to create the overlap, when one had to move. */
  movedClip?: Clip;
}

/**
 * Put a transition between two clips (zenvi-core `add_transition_between_clips`):
 * the later clip is moved so the two overlap by `duration` (on the same track)
 * and a transition named `name` (catalog id or display name, fuzzy-matched like
 * the desktop) is added over the overlap on the top clip's track.
 */
export function applyTransitionBetween(
  tx: Transaction,
  clipAId: string,
  clipBId: string,
  name: string,
  duration: number,
): ApplyTransitionResult {
  void tx;
  void clipAId;
  void clipBId;
  void name;
  void duration;
  return notImplemented("applyTransitionBetween");
}

/**
 * Put a transition at the start (fade in) or end (fade out) of one clip
 * (zenvi-core `add_transition_to_clip`).
 */
export function applyTransitionToClip(
  tx: Transaction,
  clipId: string,
  name: string,
  placement: "start" | "end",
  duration: number,
): Transition {
  void tx;
  void clipId;
  void name;
  void placement;
  void duration;
  return notImplemented("applyTransitionToClip");
}

export interface MoveTransitionInput {
  position?: number;
  layer?: number;
}

export function moveTransition(tx: Transaction, transitionId: string, to: MoveTransitionInput): Transition {
  void tx;
  void transitionId;
  void to;
  return notImplemented("moveTransition");
}

/**
 * Drag one edge of a transition to `timelineSeconds`. The brightness/contrast
 * keyframes are rescaled to the new length like the desktop does, so the
 * animation still spans the whole transition.
 */
export function trimTransition(tx: Transaction, transitionId: string, edge: Edge, timelineSeconds: number): Transition {
  void tx;
  void transitionId;
  void edge;
  void timelineSeconds;
  return notImplemented("trimTransition");
}

/** Flip a transition's direction (desktop Reverse_Transition_Triggered). */
export function reverseTransition(tx: Transaction, transitionId: string): Transition {
  void tx;
  void transitionId;
  return notImplemented("reverseTransition");
}

export function removeTransition(tx: Transaction, transitionId: string): string {
  void tx;
  void transitionId;
  return notImplemented("removeTransition");
}

/**
 * Set a transition property (`brightness`, `contrast`, `replace_image`,
 * `title`, …) with the same keyframe rules as `setClipProperty`; `at.frame` is
 * relative to the transition start. Setting `mask` (a catalog id or path)
 * swaps the mask image.
 */
export function setTransitionProperty(
  tx: Transaction,
  transitionId: string,
  prop: string,
  value: PropertyValue,
  at: KeyframeAt = {},
): Transition {
  void tx;
  void transitionId;
  void prop;
  void value;
  void at;
  return notImplemented("setTransitionProperty");
}
