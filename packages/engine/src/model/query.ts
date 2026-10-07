/**
 * Lookups by id. Read-only helpers over a project snapshot (zenvi-core
 * `classes/query.py` `Clip.get(id=…)`, `File.get`, `Transition.get`,
 * `Track.get`, `Marker.get`, `Effect.get`).
 */

import type { Clip, Effect, Layer, Marker, Project, ProjectFile, Transition } from "./types.js";

export function findClip(project: Project, id: string): Clip | undefined {
  return project.clips.find((clip) => clip.id === id);
}

export function findFile(project: Project, id: string): ProjectFile | undefined {
  return project.files.find((file) => file.id === id);
}

export function findTransition(project: Project, id: string): Transition | undefined {
  return project.effects.find((transition) => transition.id === id);
}

export function findMarker(project: Project, id: string): Marker | undefined {
  return project.markers.find((marker) => marker.id === id);
}

/** The track whose `number` is `layer` (what `clip.layer` refers to). */
export function findLayer(project: Project, layer: number): Layer | undefined {
  return project.layers.find((l) => l.number === layer);
}

export function findLayerById(project: Project, id: string): Layer | undefined {
  return project.layers.find((l) => l.id === id);
}

export interface ClipEffectRef {
  clip: Clip;
  effect: Effect;
  /** Index of the effect in `clip.effects`. */
  index: number;
}

/** A clip effect by its id, searching every clip (desktop `Effect.get(id=…)`). */
export function findClipEffect(project: Project, effectId: string): ClipEffectRef | undefined {
  for (const clip of project.clips) {
    const effects = clip.effects ?? [];
    const index = effects.findIndex((effect) => effect.id === effectId);
    if (index >= 0) return { clip, effect: effects[index]!, index };
  }
  return undefined;
}

/** Clips that play `fileId`. */
export function clipsUsingFile(project: Project, fileId: string): Clip[] {
  return project.clips.filter((clip) => clip.file_id === fileId);
}
