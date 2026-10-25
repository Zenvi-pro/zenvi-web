/**
 * Timeline queries: stacking order, what is where, gaps, layers.
 *
 * Sorting follows libopenshot (Timeline.h:48-70): clips by layer ascending
 * then position ascending (ties keep JSON order); higher layers draw on top,
 * and on one layer a clip that starts later draws over an earlier one.
 * Seconds-based queries use [position, position + (end - start)) and are
 * meant for editing; frame-based queries reproduce `Timeline::GetFrame` and
 * are meant for rendering.
 */

import type { Clip, Fraction, Layer, Project, Transition } from "../model/types.js";
import { frameWindow, itemEnd, windowContains, type Timed } from "./windows.js";

/** Clips in libopenshot draw order (bottom to top). Does not mutate. */
export function sortClips<T extends Clip>(clips: readonly T[]): T[] {
  return clips
    .map((clip, index) => ({ clip, index }))
    .sort(
      (a, b) =>
        a.clip.layer - b.clip.layer ||
        // libopenshot compares the float32 positions it stores.
        Math.fround(a.clip.position) - Math.fround(b.clip.position) ||
        a.index - b.index,
    )
    .map((e) => e.clip);
}

/**
 * Transitions in libopenshot apply order: layer asc, position asc, `order`
 * descending (CompareEffects, Timeline.h:64-70), ties in JSON order.
 */
export function sortTransitions<T extends Transition>(transitions: readonly T[]): T[] {
  return transitions
    .map((t, index) => ({ t, index }))
    .sort(
      (a, b) =>
        a.t.layer - b.t.layer ||
        Math.fround(a.t.position) - Math.fround(b.t.position) ||
        (b.t.order ?? 0) - (a.t.order ?? 0) ||
        a.index - b.index,
    )
    .map((e) => e.t);
}

/** True when `seconds` is inside [position, position + duration). */
export function coversTime(item: Timed, seconds: number): boolean {
  return item.position <= seconds && seconds < itemEnd(item);
}

export interface AtTimeOptions {
  /** Only this track. */
  layer?: number;
}

/** Clips covering timeline time `seconds`, bottom to top. */
export function clipsAt(project: Project, seconds: number, opts: AtTimeOptions = {}): Clip[] {
  return sortClips(
    project.clips.filter((c) => (opts.layer === undefined || c.layer === opts.layer) && coversTime(c, seconds)),
  );
}

/**
 * The clip drawn on top at `seconds` (highest track; on that track the one
 * that starts last), or undefined.
 */
export function topClipAt(project: Project, seconds: number, opts: AtTimeOptions = {}): Clip | undefined {
  const clips = clipsAt(project, seconds, opts);
  return clips[clips.length - 1];
}

/** Transitions covering `seconds`, in apply order. */
export function transitionsAt(project: Project, seconds: number, opts: AtTimeOptions = {}): Transition[] {
  return sortTransitions(
    project.effects.filter((t) => (opts.layer === undefined || t.layer === opts.layer) && coversTime(t, seconds)),
  );
}

/** Clips `Timeline::GetFrame` composites at timeline frame `frame`, bottom to top. */
export function clipsAtFrame(project: Project, frame: number): Clip[] {
  return sortClips(project.clips.filter((c) => windowContains(frameWindow(c, project.fps), frame)));
}

/**
 * The clip on `layer` that receives timeline effects (transitions) at
 * `frame`: among intersecting clips on the layer, the one with the largest
 * start frame, the first in draw order winning ties (`is_top_clip`,
 * Timeline.cpp:1080-1090).
 */
export function topClipOnLayerAtFrame(project: Project, layer: number, frame: number): Clip | undefined {
  let best: Clip | undefined;
  let bestStart = -Infinity;
  for (const clip of sortClips(project.clips)) {
    if (clip.layer !== layer) continue;
    const window = frameWindow(clip, project.fps);
    if (!windowContains(window, frame)) continue;
    if (window.startFrame > bestStart) {
      best = clip;
      bestStart = window.startFrame;
    }
  }
  return best;
}

/** Transitions that apply at timeline frame `frame` on `layer`, in apply order (Timeline.cpp:569-607). */
export function transitionsAtFrame(project: Project, layer: number, frame: number): Transition[] {
  return sortTransitions(
    project.effects.filter((t) => t.layer === layer && windowContains(frameWindow(t, project.fps), frame)),
  );
}

/** Clips on one track, by position. */
export function clipsOnLayer(project: Project, layer: number): Clip[] {
  return sortClips(project.clips.filter((c) => c.layer === layer));
}

/** Transitions on one track, by position. */
export function transitionsOnLayer(project: Project, layer: number): Transition[] {
  return sortTransitions(project.effects.filter((t) => t.layer === layer));
}

/** Clips and transitions on one track, by position (desktop gap logic uses both). */
export function itemsOnLayer(project: Project, layer: number): (Clip | Transition)[] {
  return [...project.clips.filter((c) => c.layer === layer), ...project.effects.filter((t) => t.layer === layer)].sort(
    (a, b) => a.position - b.position,
  );
}

/** Timeline seconds where the last clip or transition ends (libopenshot `calculate_max_duration`). */
export function timelineEnd(project: Project): number {
  let end = 0;
  for (const clip of project.clips) end = Math.max(end, itemEnd(clip));
  for (const transition of project.effects) end = Math.max(end, itemEnd(transition));
  return end;
}

/** Seconds where the first clip or transition starts (0 when empty). */
export function timelineStart(project: Project): number {
  const starts = [...project.clips, ...project.effects].map((i) => i.position);
  return starts.length ? Math.min(...starts) : 0;
}

/**
 * libopenshot `Timeline::GetMaxFrame`: the last frame with content
 * (`ceil(maxTime * fps - 1e-4)`, 1 for a sliver of content, 0 when empty).
 */
export function maxFrame(project: Project, fps: Fraction = project.fps): number {
  const frames = timelineEnd(project) * (fps.num / fps.den);
  const epsilon = 1e-4;
  if (frames > 0 && frames < epsilon) return 1;
  const frame = Math.ceil(frames - epsilon);
  return frame === 0 ? 0 : frame; // int64 has no -0
}

export interface Gap {
  start: number;
  end: number;
}

/** Positions closer than this are the same instant (zenvi-core timeline_ops.EPSILON). */
const GAP_EPSILON = 1e-6;

/**
 * Every empty stretch on `layer` that ends after `afterSeconds`
 * (zenvi-core develop timeline_ops.list_gaps): walk items by position,
 * tracking the furthest right edge; an item that starts after both that edge
 * and `afterSeconds` closes a gap. A gap before the first item counts; the
 * open space after the last item does not.
 */
export function listGaps(project: Project, layer: number, afterSeconds = 0): Gap[] {
  const gaps: Gap[] = [];
  let foundStart = 0;
  for (const item of itemsOnLayer(project, layer)) {
    const left = item.position;
    const right = left + Math.max(0, item.end - item.start);
    if (left > foundStart + GAP_EPSILON && left > afterSeconds) gaps.push({ start: foundStart, end: left });
    foundStart = Math.max(foundStart, right);
  }
  return gaps;
}

/**
 * The first empty stretch on `layer` that ends after `atSeconds`, like the
 * desktop timeline context menu (timeline.py ShowTimelineMenu,
 * timeline_ops.find_gap). Null when none.
 */
export function findGap(project: Project, layer: number, atSeconds: number): Gap | null {
  return listGaps(project, layer, atSeconds)[0] ?? null;
}

/** Every gap on a layer, from the timeline start. */
export function gapsOnLayer(project: Project, layer: number): Gap[] {
  const gaps: Gap[] = [];
  let edge = 0;
  for (const item of itemsOnLayer(project, layer)) {
    if (item.position > edge) gaps.push({ start: edge, end: item.position });
    edge = Math.max(edge, itemEnd(item));
  }
  return gaps;
}

/** Tracks bottom to top (ascending `number`). */
export function sortedLayers(project: Project): Layer[] {
  return [...project.layers].sort((a, b) => a.number - b.number);
}

/** The top track (drawn last), or undefined when there are none. */
export function topLayer(project: Project): Layer | undefined {
  const layers = sortedLayers(project);
  return layers[layers.length - 1];
}

/** The bottom track. */
export function bottomLayer(project: Project): Layer | undefined {
  return sortedLayers(project)[0];
}

/** The track directly above `layer`, if any. */
export function layerAbove(project: Project, layer: number): Layer | undefined {
  return sortedLayers(project).find((l) => l.number > layer);
}

/** The track directly below `layer`, if any. */
export function layerBelow(project: Project, layer: number): Layer | undefined {
  const below = sortedLayers(project).filter((l) => l.number < layer);
  return below[below.length - 1];
}

/**
 * Track position counted from the bottom, 1-based ("Track 1" is the bottom
 * track on the desktop). 0 when the track does not exist.
 */
export function layerIndex(project: Project, layer: number): number {
  return sortedLayers(project).findIndex((l) => l.number === layer) + 1;
}

/** Items on `layer` that overlap [start, end) in seconds (excluding `ignoreIds`). */
export function overlapping(
  project: Project,
  layer: number,
  start: number,
  end: number,
  ignoreIds: ReadonlySet<string> = new Set(),
): Clip[] {
  return project.clips.filter(
    (c) => c.layer === layer && !ignoreIds.has(c.id) && c.position < end && itemEnd(c) > start,
  );
}
