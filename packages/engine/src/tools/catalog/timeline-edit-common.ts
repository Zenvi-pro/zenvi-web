/**
 * What the timeline-edit tools share: the frame grid, which clips a call
 * targets, track names and lock refusals, overlap refusals and the clip rows
 * of their receipts.
 *
 * Ports of zenvi-core develop 1f80cb3d0 src/classes/editor_tools/_base.py
 * (resolve_layer, resolve_clip, resolve_clips, describe_clip, ok/fail) and
 * src/classes/editor_tools/timeline_edit_common.py (snap, tolerance,
 * targets, require_unlocked, check_overlaps). A caller-side problem is a
 * `ToolError`; `editorRun` turns it into the desktop's "Error: <message>".
 */

import type { Clip, Project } from "../../model/types.js";
import { pyRound } from "../../model/rounding.js";
import { plannedOverlaps, type OverlapHit, type PlannedItem, type PlannedSpan } from "../../ops/sequence.js";
import type { ToolCall, ToolOutcome } from "../define.js";
import { pyFixed, pyFloat, pyReprString, pyStr } from "../pyfmt.js";
import { applied, unchanged, type ToolReceipt } from "../receipt.js";
import { layerNumberToDisplayIndex, normalizeTrackOrLayerArg, resolvePlacementTrack, type TrackResolution } from "../tracks.js";
import { resolveClip } from "./common.js";

/** A caller-side problem or an impossible request (desktop `ToolError`): answered as "Error: <message>". */
export class ToolError extends Error {}

/** _base.fail: one line, "Error: " prefixed. */
export function failText(message: string): string {
  const line = String(message).split(/\s+/).filter(Boolean).join(" ");
  return line.startsWith("Error") ? line : `Error: ${line}`;
}

/** Run a tool body; a `ToolError` becomes the desktop's error text. */
export async function editorRun(body: () => Promise<ToolOutcome> | ToolOutcome): Promise<ToolOutcome> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof ToolError) return failText(error.message);
    throw error;
  }
}

function oneLine(summary: string): string {
  return String(summary).split(/\s+/).filter(Boolean).join(" ");
}

/** _base.ok: a one-line summary with the tool's receipt object as `data`. */
export function ok(call: ToolCall, summary: string, data: Record<string, unknown>): ToolReceipt {
  return applied(call.tool, oneLine(summary), { data });
}

/** A call that changed nothing (desktop `ok(..., changed=False)`): no undo step. */
export function nothingChanged(call: ToolCall, summary: string, data: Record<string, unknown>): ToolReceipt {
  return unchanged(call.tool, oneLine(summary), { data: { changed: false, ...data } });
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** The project frame grid in seconds (timeline_edit_common frame_seconds / snap / tolerance). */
export interface Grid {
  fps: number;
  /** One frame. */
  frame: number;
  /** Half a frame: anything closer is the same instant on the timeline. */
  tol: number;
  /** Round to the frame grid (`round(t * fps) / fps`). */
  snap(seconds: number): number;
}

export function gridOf(project: Project): Grid {
  const num = Math.trunc(Number(project.fps?.num)) || 30;
  const den = Math.trunc(Number(project.fps?.den)) || 1;
  const fps = num / den;
  return { fps, frame: 1 / fps, tol: 0.5 / fps, snap: (seconds) => pyRound(seconds * fps) / fps };
}

/** `round(value, 3)`. */
export function r3(value: number): number {
  return Number(pyFixed(Number(value) || 0, 3));
}

/** `f"{x:.2f}"`. */
export function f2(value: number): string {
  return pyFixed(value, 2);
}

/** [position, position + max(0, end - start)) of a clip or transition. */
export function spanOf(item: { position: number; start: number; end: number }): [number, number] {
  const position = Number(item.position) || 0;
  return [position, position + Math.max(0, (Number(item.end) || 0) - (Number(item.start) || 0))];
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

/** _base.ui_track_number: the UI track (1 = bottom) of a layer number, or null. */
export function uiTrack(project: Project, layer: number): number | null {
  return layerNumberToDisplayIndex(layer, project.layers);
}

/** timeline_edit_common.track_name: "track 2", or "layer N" for a layer without a track. */
export function trackName(project: Project, layer: number): string {
  const ui = uiTrack(project, layer);
  return ui ? `track ${ui}` : `layer ${layer}`;
}

/** _base.resolve_layer: UI track number, label, track id or layer number → layer number. */
export function resolveLayer(project: Project, track: unknown): number {
  return requireTrack(track, (text) => normalizeTrackOrLayerArg(text, project.layers)).layer;
}

/** _base.resolve_placement_layer: resolveLayer, or up to three tracks past the top to add (resolvePlacementTrack). */
export function resolvePlacementLayer(project: Project, track: unknown): { layer: number; newTracks: number } {
  return requireTrack(track, (text) => resolvePlacementTrack(text, project.layers));
}

function requireTrack(track: unknown, resolve: (text: string) => TrackResolution): { layer: number; newTracks: number } {
  const text = track === undefined || track === null ? "" : String(track).trim();
  if (!text) throw new ToolError("a track is required (UI track number, name, or layer number)");
  const resolved = resolve(text);
  if (resolved.error) throw new ToolError(resolved.error);
  if (resolved.layer === undefined) throw new ToolError(`no track matches ${pyReprString(String(track))}`);
  return { layer: resolved.layer, newTracks: resolved.newTracks ?? 0 };
}

/** timeline_edit_common.require_unlocked: refuse when any of these tracks is locked. */
export function requireUnlockedTracks(project: Project, layers: Iterable<number>, what = ""): void {
  const lockedNumbers = new Set(project.layers.filter((l) => l.lock).map((l) => l.number));
  const locked = [...new Set(layers)].filter((n) => lockedNumbers.has(n)).sort((a, b) => a - b);
  if (locked.length === 0) return;
  const names = locked.map((n) => trackName(project, n)).join(", ");
  const [verb, pronoun] = locked.length === 1 ? ["is", "it"] : ["are", "them"];
  throw new ToolError(`${names} ${verb} locked${what ? ` (${what})` : ""}; unlock ${pronoun} first (Track menu > Unlock Track)`);
}

/** timeline_edit_common.track_numbers_bottom_up: layer numbers, UI track 1 first. */
export function layersBottomUp(project: Project): number[] {
  return [...project.layers].map((l) => l.number).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

/** timeline_edit_common.is_image: a still image (any length on the timeline). */
export function isImageClip(clip: Clip): boolean {
  const reader = clip.reader as unknown as Record<string, unknown> | undefined;
  return Boolean(reader?.has_single_image) || reader?.media_type === "image";
}

/** timeline_edit_common.title: the clip's title, else its id. */
export function clipTitle(clip: Clip): string {
  return String(clip.title || clip.id);
}

export function clipById(project: Project, id: string): Clip | undefined {
  return project.clips.find((c) => c.id === id);
}

/** One clip as the desktop's receipts describe it (_base.describe_clip). */
export interface ClipRow {
  timeline_clip_id: string;
  title: string;
  file_id: string;
  track: number | null;
  layer: number;
  position: number;
  end: number;
  duration: number;
  source_in: number;
  source_out: number;
}

/** _base.describe_clip: a clip's place on the timeline and in its source. */
export function describeClip(project: Project, clip: Clip): ClipRow {
  const [start, end] = spanOf(clip);
  return {
    timeline_clip_id: String(clip.id),
    title: String(clip.title ?? ""),
    file_id: String(clip.file_id ?? ""),
    track: uiTrack(project, clip.layer),
    layer: clip.layer,
    position: r3(start),
    end: r3(end),
    duration: r3(end - start),
    source_in: r3(Number(clip.start) || 0),
    source_out: r3(Number(clip.end) || 0),
  };
}

/** The many-clips target every batch tool takes (_base.CLIPS_TARGET). */
export interface ClipsTarget {
  timeline_clip_ids?: readonly string[];
  clip_query?: string;
  track?: string;
  scope?: string;
}

/** True when the call names clips by ids, a query or a scope. */
export function clipsGiven(target: ClipsTarget): boolean {
  return (target.timeline_clip_ids?.length ?? 0) > 0 || Boolean(target.clip_query?.trim()) || Boolean(target.scope?.trim());
}

/** _base.resolve_clip: one clip by id, description, or the clip under the playhead / the only clip. */
export async function targetClip(call: ToolCall, target: { timeline_clip_id?: string; clip_query?: string; track?: string }): Promise<Clip> {
  const resolved = await resolveClip(call, target);
  if (!resolved.ok) throw new ToolError(resolved.error || "could not resolve the timeline clip");
  return resolved.clip;
}

function clipsByIds(project: Project, ids: readonly string[]): Clip[] {
  return ids.map((raw) => {
    const clip = clipById(project, String(raw).trim());
    if (!clip) throw new ToolError(`no timeline clip with id=${pyReprString(String(raw))}`);
    return clip;
  });
}

/** Clip ids selected in the host's timeline (desktop `window.selected_clips`). */
export function selectedClipIds(call: ToolCall): string[] {
  const clips = new Set(call.doc.project.clips.map((c) => c.id));
  return (call.host.ui?.selectedIds?.() ?? []).filter((id) => clips.has(id));
}

/**
 * The clips a batch tool acts on (_base.resolve_clips + timeline_edit_common
 * .targets): explicit ids, the selection, a whole track, everything, or one
 * described clip; de-duplicated, in timeline order. Never empty.
 */
export async function targetClips(call: ToolCall, target: ClipsTarget): Promise<Clip[]> {
  const project = call.doc.project;
  const scope = (target.scope ?? "").trim().toLowerCase();
  let clips: Clip[];
  if ((target.timeline_clip_ids?.length ?? 0) > 0) {
    clips = clipsByIds(project, target.timeline_clip_ids!);
  } else if (scope === "selected") {
    const ids = selectedClipIds(call);
    if (ids.length === 0) throw new ToolError("no clips are selected in the timeline");
    clips = clipsByIds(project, ids);
  } else if (scope === "track" || scope === "all") {
    clips = [...project.clips];
    if (scope === "track") {
      const layer = resolveLayer(project, target.track);
      clips = clips.filter((c) => c.layer === layer);
    }
    if (clips.length === 0) throw new ToolError(scope === "all" ? "the timeline has no clips" : `track ${pyStr(target.track ?? "")} has no clips`);
  } else {
    clips = [await targetClip(call, { clip_query: target.clip_query, track: target.track })];
  }
  const seen = new Set<string>();
  const out = clips.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  return out.sort((a, b) => Number(a.position) - Number(b.position) || a.layer - b.layer);
}

// ---------------------------------------------------------------------------
// Overlaps
// ---------------------------------------------------------------------------

/** One overlap as the desktop's receipts list it. */
export interface OverlapRow {
  timeline_clip_id: string;
  title: string;
  overlaps: string;
  overlaps_title: string;
  track: number | null;
  seconds: number;
}

function overlapRow(project: Project, hit: OverlapHit): OverlapRow {
  return {
    timeline_clip_id: hit.clipId,
    title: hit.title,
    overlaps: hit.overlapsId,
    overlaps_title: hit.overlapsTitle,
    track: uiTrack(project, hit.layer),
    seconds: r3(hit.seconds),
  };
}

/** timeline_edit_common.new_overlaps, in receipt rows. */
export function newOverlaps(
  project: Project,
  changes: ReadonlyMap<string, PlannedSpan>,
  newItems: readonly PlannedItem[] = [],
): OverlapRow[] {
  return plannedOverlaps(project, changes, newItems, gridOf(project).tol).map((hit) => overlapRow(project, hit));
}

/**
 * timeline_edit_common.check_overlaps: refuse the edit when it would cover
 * other clips, unless the caller allowed it. Returns the overlaps.
 */
export function checkOverlaps(hits: OverlapRow[], allowOverlap: boolean, what: string, rippleHint = true): OverlapRow[] {
  if (hits.length > 0 && !allowOverlap) {
    const first = hits[0]!;
    const more = hits.length > 1 ? ` (+${hits.length - 1} more)` : "";
    let options = "pass allow_overlap=true to overlap anyway";
    if (rippleHint) options = `pass ripple=true to push the later clips along, or ${options}`;
    throw new ToolError(
      `${what} would overlap ${pyReprString(first.overlaps_title)} (${first.overlaps}) on track ${pyStr(first.track)} ` +
        `by ${pyFloat(first.seconds)} s${more}; ${options}`,
    );
  }
  return hits;
}
