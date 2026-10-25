/**
 * What the effects-color tools share: which clips a call targets, which
 * clips can take an effect, effect lookup by id, and the clip labels their
 * refusals use.
 *
 * Ports of zenvi-core develop (1f80cb3d0) src/classes/editor_tools/
 * effects_color.py (`clip_has_picture`, `clip_has_sound`, `_clip_label`,
 * `compatibility_problem`, `target_clips`, `split_compatible`,
 * `clip_effects`, `find_effect`) and _base.py (`resolve_clips`, `is_locked`).
 */

import type { Clip, Effect, Project } from "../../model/types.js";
import type { ToolCall } from "../define.js";
import { pyReprString, pyStr } from "../pyfmt.js";
import { AUDIO_REACTIVE_EFFECTS, effectKind } from "./effect-catalog.js";
import { clipById, resolveLayer, selectedClipIds, ToolError, uiTrack } from "./timeline-edit-common.js";
import { resolveClip } from "./common.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readerOf(clip: Clip): Record<string, unknown> {
  return isRecord(clip.reader) ? (clip.reader as unknown as Record<string, unknown>) : {};
}

/** effects_color.clip_has_picture. */
export function clipHasPicture(clip: Clip): boolean {
  const reader = readerOf(clip);
  if (reader.media_type === "audio") return false;
  return reader.has_video === undefined || reader.has_video === null ? true : Boolean(reader.has_video);
}

/** effects_color.clip_has_sound. */
export function clipHasSound(clip: Clip): boolean {
  const reader = readerOf(clip);
  if (reader.media_type === "image") return false;
  return reader.has_audio === undefined || reader.has_audio === null ? true : Boolean(reader.has_audio);
}

/** _base.is_locked. */
export function isLocked(project: Project, layer: number): boolean {
  return project.layers.some((l) => Number(l.number) === Number(layer) && Boolean(l.lock));
}

/** effects_color._clip_label: `ID (title, track N)`. */
export function clipLabel(project: Project, clip: Clip): string {
  return `${clip.id} (${clip.title || "clip"}, track ${pyStr(uiTrack(project, Number(clip.layer) || 0))})`;
}

export function lockedMessage(project: Project, clip: Clip): string {
  return `clip ${clipLabel(project, clip)} is on a locked track; unlock the track first`;
}

/** effects_color.compatibility_problem: why `className` cannot go on this clip, or null. */
export function compatibilityProblem(project: Project, clip: Clip, className: string): string | null {
  if (isLocked(project, Number(clip.layer) || 0)) return lockedMessage(project, clip);
  if (effectKind(className) === "audio") {
    if (!clipHasSound(clip)) return `${className} is an audio effect and clip ${clipLabel(project, clip)} has no sound`;
  } else if (!clipHasPicture(clip) && !AUDIO_REACTIVE_EFFECTS.has(className)) {
    return `${className} is a video effect and clip ${clipLabel(project, clip)} is audio-only`;
  }
  return null;
}

/** The clip targeting arguments every effects-color tool takes (effects_color.TARGETS). */
export interface EffectTargets {
  timeline_clip_id?: string;
  clip_query?: string;
  track?: string;
  timeline_clip_ids?: readonly string[];
  scope?: string;
  occurrence?: number;
  position_near?: number | null;
}

/** _base.resolve_clips: explicit ids (in order), the selection, a whole track or everything; never empty. */
export function resolveClipsList(call: ToolCall, ids: readonly string[] | undefined, scope = "", track = ""): Clip[] {
  const project = call.doc.project;
  const s = scope.trim().toLowerCase();
  if (ids && ids.length > 0) {
    return ids.map((raw) => {
      const clip = clipById(project, String(raw).trim());
      if (!clip) throw new ToolError(`no timeline clip with id=${pyReprString(String(raw))}`);
      return clip;
    });
  }
  if (s === "selected") {
    const selected = selectedClipIds(call);
    if (selected.length === 0) throw new ToolError("no clips are selected in the timeline");
    return resolveClipsList(call, selected);
  }
  if (s === "track" || s === "all") {
    let clips = [...project.clips];
    if (s === "track") {
      const layer = resolveLayer(project, track);
      clips = clips.filter((c) => Number(c.layer) === layer);
    }
    clips.sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0) || (Number(a.layer) || 0) - (Number(b.layer) || 0));
    if (clips.length === 0) throw new ToolError(s === "all" ? "the timeline has no clips" : `track ${track} has no clips`);
    return clips;
  }
  return [];
}

/** _base.resolve_clip: one clip by id, description, or the clip under the playhead / the only clip. */
export async function resolveOneClip(
  call: ToolCall,
  target: { timeline_clip_id?: string; clip_query?: string; track?: string; occurrence?: number; position_near?: number | null },
): Promise<Clip> {
  const resolved = await resolveClip(call, target);
  if (!resolved.ok) throw new ToolError(resolved.error || "could not resolve the timeline clip");
  return resolved.clip;
}

/**
 * effects_color.target_clips: explicit ids / query / one clip (explicit), or
 * a selection / track / all scope (only the selection counts as explicit).
 */
export async function targetClips(call: ToolCall, t: EffectTargets): Promise<{ clips: Clip[]; explicit: boolean }> {
  let ids = (t.timeline_clip_ids ?? []).map((i) => String(i).trim()).filter(Boolean);
  const single = String(t.timeline_clip_id ?? "").trim();
  if (single) ids = [single, ...ids.filter((i) => i !== single)];
  if (ids.length > 0) return { clips: resolveClipsList(call, ids), explicit: true };
  const scope = String(t.scope ?? "");
  if (scope) return { clips: resolveClipsList(call, undefined, scope, String(t.track ?? "")), explicit: scope === "selected" };
  const clip = await resolveOneClip(call, {
    clip_query: t.clip_query ?? "",
    track: t.track ?? "",
    occurrence: t.occurrence ?? 0,
    position_near: t.position_near ?? null,
  });
  return { clips: [clip], explicit: true };
}

export interface SkippedClip {
  timeline_clip_id: string;
  reason: string;
}

/** effects_color.split_compatible: clips that can take `className`, and skipped notes (a problem on an explicit clip refuses). */
export function splitCompatible(
  project: Project,
  clips: readonly Clip[],
  explicit: boolean,
  className: string,
): { ok: Clip[]; skipped: SkippedClip[] } {
  const ok: Clip[] = [];
  const skipped: SkippedClip[] = [];
  for (const clip of clips) {
    const problem = compatibilityProblem(project, clip, className);
    if (problem) {
      if (explicit) throw new ToolError(problem);
      skipped.push({ timeline_clip_id: clip.id, reason: problem });
    } else {
      ok.push(clip);
    }
  }
  if (ok.length === 0) throw new ToolError(skipped[0]?.reason ?? "no clips to change");
  return { ok, skipped };
}

/** effects_color.clip_effects: the clip's effect dicts. */
export function clipEffects(clip: Clip): Effect[] {
  return Array.isArray(clip.effects) ? clip.effects.filter((e) => isRecord(e)) : [];
}

/** effects_color.find_effect: the clip and effect for an effect id anywhere on the timeline. */
export function findEffect(project: Project, effectId: unknown): { clip: Clip; effect: Effect } {
  const id = String(effectId ?? "").trim();
  for (const clip of project.clips) {
    for (const effect of clipEffects(clip)) {
      if (String(effect.id) === id) return { clip, effect };
    }
  }
  throw new ToolError(`no effect with id=${pyReprString(String(effectId ?? ""))} on the timeline (get_clip_effects_tool lists them)`);
}
