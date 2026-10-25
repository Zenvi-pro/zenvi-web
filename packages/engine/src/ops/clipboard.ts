/**
 * Copy and paste of timeline items.
 *
 * Desktop: zenvi-core src/windows/views/timeline.py `Copy_Triggered`
 * (whole items, or only some properties: keyframe groups, effects) and
 * `_handle_paste_callback` (whole items land with their offsets from the
 * left-most item kept and their tracks mapped onto a stack of tracks from
 * the target track downwards, new ids, new effect ids; partial data is
 * applied onto selected items), main_window.py `track_stack_from` /
 * `create_track_below`.
 */

import type { Transaction } from "../history/document.js";
import type { Clip, Effect, Project, Transition } from "../model/types.js";
import { COPY_KEYFRAME_GROUPS } from "../keyframe/rules.js";
import { findClip, findTransition } from "../model/query.js";
import { OpError, invalid, requireFinite, requireUnlocked } from "./errors.js";
import { ensureLayer, ids, isRecord, patchClip, patchTransition, reassignEffectIds, sameJson } from "./internal.js";
import { trackBelowOrCreate } from "./tracks.js";
import type { ClipboardData, CopyPart } from "./types.js";

/** Clip keys each Copy ▸ Keyframes submenu copies (Copy_Triggered, keyframe_rules.COPY_KEYFRAME_GROUPS). */
const CLIP_PARTS: Record<Exclude<CopyPart, "all" | "brightness" | "contrast">, readonly string[]> = {
  keyframes: COPY_KEYFRAME_GROUPS.all,
  alpha: COPY_KEYFRAME_GROUPS.alpha,
  scale: COPY_KEYFRAME_GROUPS.scale,
  shear: COPY_KEYFRAME_GROUPS.shear,
  rotation: COPY_KEYFRAME_GROUPS.rotation,
  location: COPY_KEYFRAME_GROUPS.location,
  time: COPY_KEYFRAME_GROUPS.time,
  volume: COPY_KEYFRAME_GROUPS.volume,
  effects: ["effects"],
};

/** Transition keys for the transition Copy ▸ Keyframes submenu. */
const TRANSITION_PARTS: Partial<Record<CopyPart, readonly string[]>> = {
  keyframes: ["brightness", "contrast"],
  brightness: ["brightness"],
  contrast: ["contrast"],
};

function pick(item: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { id: item.id };
  for (const key of keys) if (key in item) out[key] = structuredClone(item[key]);
  return out;
}

export interface CopyOptions {
  /** What to copy: whole items (default) or one Copy ▸ Keyframes / Effects group. */
  part?: CopyPart;
}

/**
 * Deep-copy the clips and transitions with the given ids (optionally only
 * one property group). Unknown ids are refused with `not_found`. Pure: does
 * not change the project.
 */
export function copyItems(project: Project, itemIds: readonly string[], opts: CopyOptions = {}): ClipboardData {
  if (!Array.isArray(itemIds) || itemIds.length === 0) throw invalid("Give at least one clip or transition id.");
  const part = opts.part ?? "all";
  const clips: Clip[] = [];
  const transitions: Transition[] = [];
  for (const id of new Set(itemIds)) {
    const clip = findClip(project, id);
    if (clip) {
      if (part === "all") clips.push(structuredClone(clip));
      else if (part in CLIP_PARTS) clips.push(pick(clip, CLIP_PARTS[part as keyof typeof CLIP_PARTS]) as Clip);
      continue;
    }
    const transition = findTransition(project, id);
    if (transition) {
      if (part === "all") transitions.push(structuredClone(transition));
      else if (TRANSITION_PARTS[part]) transitions.push(pick(transition, TRANSITION_PARTS[part]!) as Transition);
      continue;
    }
    throw new OpError("not_found", `No clip or transition with id ${id}.`, { id });
  }
  if (clips.length === 0 && transitions.length === 0) throw invalid(`Nothing to copy for part ${part}.`);
  const all = [...clips, ...transitions];
  const byPosition = (a: { position?: number }, b: { position?: number }) => (a.position ?? 0) - (b.position ?? 0);
  clips.sort(byPosition);
  transitions.sort(byPosition);
  return {
    kind: "zenvi/clipboard",
    version: 1,
    part,
    clips,
    transitions,
    origin: {
      position: part === "all" ? Math.min(...all.map((i) => Number(i.position ?? 0))) : 0,
      layer: part === "all" ? Math.max(...all.map((i) => Number(i.layer ?? 0))) : 0,
    },
  };
}

/** main_window.py `track_stack_from`: `count` tracks from `layer` downwards. */
function trackStack(tx: Transaction, layer: number, count: number): number[] {
  ensureLayer(tx, layer);
  const tracks = [layer];
  let current = layer;
  while (tracks.length < count) {
    current = trackBelowOrCreate(tx, current);
    if (tracks.includes(current)) break;
    tracks.push(current);
  }
  return tracks;
}

export interface PasteTarget {
  /** Timeline seconds where the copied selection's left-most item lands. */
  position: number;
  /**
   * Track where the copied selection's top track lands; lower tracks map
   * onto the tracks below it (created when missing). Default: each item's
   * own track.
   */
  layer?: number;
}

export interface PasteResult {
  clipIds: string[];
  transitionIds: string[];
}

function requireClipboard(data: ClipboardData): void {
  if (!isRecord(data) || data.kind !== "zenvi/clipboard" || !Array.isArray(data.clips) || !Array.isArray(data.transitions)) {
    throw invalid("Not Zenvi clipboard data.");
  }
}

/**
 * Paste whole copied items at `target` with fresh ids (and fresh effect
 * ids), keeping their offsets from the left-most copied item. Returns the new
 * ids. Partial copies (keyframes, effects) are pasted onto items with
 * `pasteOnto`.
 */
export function pasteItems(tx: Transaction, data: ClipboardData, target: PasteTarget): PasteResult {
  requireClipboard(data);
  if ((data.part ?? "all") !== "all") throw invalid("This clipboard holds properties; paste them onto a selection.");
  const position = requireFinite(target?.position, "position");
  if (position < 0) throw invalid("position must be >= 0.");
  if (target.layer !== undefined) {
    if (!Number.isInteger(target.layer) || target.layer <= 0) throw invalid("layer must be a positive track number.");
    requireUnlocked(tx.project, target.layer);
  }
  const items = [...data.clips, ...data.transitions];
  if (items.length === 0) return { clipIds: [], transitionIds: [] };
  const left = Math.min(...items.map((i) => Number(i.position ?? 0)));
  const top = Math.max(...items.map((i) => Number(i.layer ?? 0)));
  const shift = position - left;
  const sources = [...new Set(items.map((i) => Math.trunc(Number(i.layer ?? 0))))].sort((a, b) => b - a);
  // Validate before recording: the tracks the items will land on must be unlocked.
  if (target.layer !== undefined) {
    const below = tx.project.layers
      .filter((l) => l.number < target.layer!)
      .sort((a, b) => b.number - a.number)
      .slice(0, sources.length - 1);
    for (const layer of below) requireUnlocked(tx.project, layer.number);
  } else {
    for (const layer of sources) requireUnlocked(tx.project, layer);
  }
  let layerMap = new Map<number, number>();
  if (target.layer !== undefined) {
    const targets = trackStack(tx, target.layer, sources.length);
    layerMap = new Map(sources.map((s, i) => [s, targets[i] ?? target.layer! - (top - s)]));
  }
  const nextId = ids(tx.project);
  const result: PasteResult = { clipIds: [], transitionIds: [] };
  const place = (item: Clip | Transition, key: "clips" | "effects"): string => {
    const copy = structuredClone(item) as Record<string, unknown>;
    copy.id = nextId();
    reassignEffectIds(copy, nextId);
    copy.position = Number(item.position ?? 0) + shift;
    copy.layer = layerMap.get(Math.trunc(Number(item.layer ?? 0))) ?? Number(item.layer ?? 0);
    ensureLayer(tx, copy.layer as number);
    tx.insert([key], copy);
    return copy.id as string;
  };
  for (const clip of data.clips) result.clipIds.push(place(clip, "clips"));
  for (const transition of data.transitions) result.transitionIds.push(place(transition, "effects"));
  return result;
}

/** Keys never copied onto another item (they place it). */
const PLACEMENT_KEYS = new Set(["id", "position", "layer", "start", "end"]);

/**
 * Paste copied properties onto existing items (desktop paste onto a
 * selection, `apply_clipboard_data`): clip data goes onto clips, transition
 * data onto transitions, never overwriting id/position/layer/start/end.
 * Effects merge by class (same class updated, others appended, new ids).
 * Returns the ids of the items changed.
 */
export function pasteOnto(tx: Transaction, data: ClipboardData, targetIds: readonly string[]): string[] {
  requireClipboard(data);
  if (!Array.isArray(targetIds) || targetIds.length === 0) throw invalid("Give the ids to paste onto.");
  const sourceClip = data.clips[0];
  const sourceTransition = data.transitions[0];
  const plan: { id: string; kind: "clip" | "transition" }[] = [];
  for (const id of new Set(targetIds)) {
    const clip = findClip(tx.project, id);
    const transition = clip ? undefined : findTransition(tx.project, id);
    if (!clip && !transition) throw new OpError("not_found", `No clip or transition with id ${id}.`, { id });
    requireUnlocked(tx.project, (clip ?? transition)!.layer);
    if (clip && sourceClip && sourceClip.id !== id) plan.push({ id, kind: "clip" });
    if (transition && sourceTransition && sourceTransition.id !== id) plan.push({ id, kind: "transition" });
  }
  const nextId = ids(tx.project);
  const changed: string[] = [];
  for (const { id, kind } of plan) {
    const source = (kind === "clip" ? sourceClip : sourceTransition) as unknown as Record<string, unknown>;
    const current = (kind === "clip" ? findClip(tx.project, id) : findTransition(tx.project, id)) as unknown as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (PLACEMENT_KEYS.has(key)) continue;
      if (key === "effects" && Array.isArray(value)) {
        const effects = ((current.effects as Effect[] | undefined) ?? []).map((e) => ({ ...e }));
        for (const effect of value as Effect[]) {
          const copy = { ...structuredClone(effect), id: nextId() } as Effect;
          const existing = effects.findIndex((e) => e.class_name && e.class_name === copy.class_name);
          if (existing >= 0) effects[existing] = { ...effects[existing]!, ...copy };
          else effects.push(copy);
        }
        patch.effects = effects;
      } else {
        patch[key] = structuredClone(value);
      }
    }
    const after = kind === "clip" ? patchClip(tx, id, patch) : patchTransition(tx, id, patch);
    if (!sameJson(after, current)) changed.push(id);
  }
  return changed;
}
