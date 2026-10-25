/**
 * Where Previous / Next Marker and Previous / Next Edit stop, in timeline
 * seconds, and the frame a navigation seek lands on.
 *
 * Port of zenvi-core develop 1f80cb3d0 src/classes/track_ops.py
 * (navigation_positions, _object_positions, _keyframe_times,
 * adjacent_position, seconds_to_seek_frame) and editor_tools/tracks_nav.py
 * `_clip_edges`.
 */

import { pyRound } from "../model/rounding.js";
import type { Clip, Project, Transition } from "../model/types.js";

/** Two navigation stops closer than this (seconds) count as the same place. */
export const NAVIGATION_EPSILON = 0.001;

/** What is selected in an editor, for navigation. */
export interface NavigationSelection {
  clips?: readonly string[];
  transitions?: readonly string[];
  effects?: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fpsFloat(project: Project): number {
  const num = Number(project.fps?.num) || 30;
  const den = Number(project.fps?.den) || 1;
  return num / den;
}

/** Keyframe times strictly inside (lower, upper) anywhere in a property tree. */
function keyframeTimes(value: unknown, toSeconds: (x: number) => number, lower: number, upper: number, out: number[]): void {
  if (isRecord(value)) {
    if (Array.isArray(value.Points)) {
      for (const point of value.Points) {
        const x = isRecord(point) && isRecord(point.co) ? Number(point.co.X) : Number.NaN;
        if (!Number.isFinite(x)) continue;
        const t = toSeconds(x);
        if (lower < t && t < upper) out.push(t);
      }
      return;
    }
    for (const child of Object.values(value)) keyframeTimes(child, toSeconds, lower, upper, out);
  } else if (Array.isArray(value)) {
    for (const child of value) keyframeTimes(child, toSeconds, lower, upper, out);
  }
}

/** The edges (first and last frame) and keyframes of a clip or transition, in timeline seconds. */
function objectPositions(item: Clip | Transition, fps: number): number[] {
  const frame = 1 / fps;
  const startTime = Number(item.position) || 0;
  const start = Number(item.start) || 0;
  const stopTime = startTime - start + (Number(item.end) || 0) - frame;
  const positions = [startTime, stopTime];
  for (const value of Object.values(item)) {
    keyframeTimes(value, (x) => (x - 1) / fps - start + startTime, startTime, stopTime, positions);
  }
  return positions;
}

/**
 * Every place Previous / Next Marker stops at, in timeline seconds (unique):
 * the timeline start and every marker; with nothing selected also the last
 * frame (`lastFrame`); otherwise the edges and keyframes of the selected
 * clips and transitions, or (when effects are selected) their clips' edges
 * and the effects' keyframes.
 */
export function navigationPositions(project: Project, selection: NavigationSelection = {}, lastFrame?: number): number[] {
  const fps = fpsFloat(project);
  const frame = 1 / fps;
  const clips = selection.clips ?? [];
  const transitions = selection.transitions ?? [];
  const effects = selection.effects ?? [];
  const positions = [0.0];
  if (clips.length === 0 && transitions.length === 0 && effects.length === 0 && lastFrame !== undefined) {
    positions.push((lastFrame - 1) / fps);
  }
  for (const marker of project.markers ?? []) {
    const position = Number(marker.position);
    if (Number.isFinite(position)) positions.push(position);
  }
  if (effects.length > 0) {
    for (const effectId of effects) {
      const parent = project.clips.find((c) => (c.effects ?? []).some((e) => e.id === effectId));
      const effect = parent?.effects.find((e) => e.id === effectId);
      if (!parent || !effect) continue;
      const startTime = Number(parent.position) || 0;
      const origin = startTime - (Number(parent.start) || 0);
      const stopTime = origin + (Number(parent.end) || 0) - frame;
      positions.push(startTime, stopTime);
      for (const value of Object.values(effect)) keyframeTimes(value, (x) => (x - 1) / fps + origin, startTime, stopTime, positions);
    }
  } else {
    for (const id of clips) {
      const clip = project.clips.find((c) => c.id === id);
      if (clip) positions.push(...objectPositions(clip, fps));
    }
    for (const id of transitions) {
      const transition = project.effects.find((t) => t.id === id);
      if (transition) positions.push(...objectPositions(transition, fps));
    }
  }
  return [...new Set(positions)];
}

/** Every clip start and end (a cut point), optionally only on one track (`_clip_edges`). */
export function clipEdges(project: Project, layer?: number): number[] {
  const edges: number[] = [];
  for (const clip of project.clips) {
    if (layer !== undefined && Math.trunc(Number(clip.layer) || 0) !== layer) continue;
    const position = Number(clip.position) || 0;
    edges.push(position, position + Math.max(0, (Number(clip.end) || 0) - (Number(clip.start) || 0)));
  }
  return edges;
}

/** The nearest stop before (direction < 0) or after (direction > 0) `current`, or undefined. */
export function adjacentPosition(positions: Iterable<number>, current: number, direction: number): number | undefined {
  let best: number | undefined;
  for (const p of positions) {
    if (Math.abs(p - current) <= NAVIGATION_EPSILON) continue;
    if (direction < 0 ? p < current && (best === undefined || p > best) : p > current && (best === undefined || p < best)) best = p;
  }
  return best;
}

/** Timeline seconds → the 1-based frame navigation seeks to (clamped to the last frame). */
export function secondsToSeekFrame(project: Project, seconds: number, lastFrame?: number): number {
  let frame = pyRound(seconds * fpsFloat(project)) + 1;
  if (lastFrame !== undefined) frame = Math.min(frame, lastFrame);
  return Math.max(1, frame);
}

/**
 * The nearest stop in `direction` that actually moves the playhead off
 * `currentFrame` (tracks_nav `_pick_adjacent`): [seconds, frame], or undefined.
 */
export function pickAdjacent(
  project: Project,
  candidates: Iterable<number>,
  currentSeconds: number,
  currentFrame: number,
  direction: number,
  lastFrame?: number,
): [number, number] | undefined {
  let remaining = [...new Set(candidates)];
  for (;;) {
    const target = adjacentPosition(remaining, currentSeconds, direction);
    if (target === undefined) return undefined;
    const frame = secondsToSeekFrame(project, target, lastFrame);
    if (frame !== currentFrame) return [target, frame];
    remaining = remaining.filter((p) => p !== target);
  }
}
