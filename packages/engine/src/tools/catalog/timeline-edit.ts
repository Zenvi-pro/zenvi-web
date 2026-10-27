/**
 * Timeline structure tools: add_clips_to_timeline_tool, move_clips_tool,
 * trim_clips_tool, slice_clips_tool, remove_gaps_tool, duplicate_clips_tool,
 * align_clips_tool.
 *
 * Ports of zenvi-core develop 1f80cb3d0
 * src/classes/editor_tools/timeline_edit.py. Each tool validates everything
 * first (a refusal leaves history untouched), then records its whole edit in
 * one `call.commit` through the engine ops, and answers the desktop's one
 * summary line with its receipt object as `data`.
 */

import type { Transaction } from "../../history/document.js";
import type { Clip, Project, ProjectFile, Transition } from "../../model/types.js";
import { DEFAULT_IMAGE_LENGTH, DEFAULT_TRANSITION_LENGTH, basename } from "../../model/defaults.js";
import { findTransition } from "../../model/query.js";
import { alignedPositions, closeAllGaps } from "../../ops/arrange.js";
import { closeGap, moveClip, splitClip, splitTransition, trimClip } from "../../ops/clips.js";
import { fitLengths, placeFiles, type PlaceFileEntry } from "../../ops/add-to-timeline.js";
import { duplicateItems, remapLayers, shiftAfter, trackEnd, transitionsBetween, type PlannedItem, type PlannedSpan } from "../../ops/sequence.js";
import { ensureTrack } from "../../ops/overlays.js";
import { moveTransition } from "../../ops/transitions.js";
import { clipTimeBounds } from "../../model/timing.js";
import { listGaps, itemsOnLayer } from "../../timeline/queries.js";
import { TRANSITIONS } from "../../transitions/catalog.js";
import { contractTool, type CatalogTool, type ToolCall } from "../define.js";
import { sourceWindowForFile } from "../placement.js";
import { pyFixed, pyG, pyReprString } from "../pyfmt.js";
import type { ContractInput } from "../schemas.gen.js";
import { defaultUnderlayLayerNumber, newTracksNote } from "../tracks.js";
import { fileById, playheadSeconds, selectedTrack } from "./common.js";
import {
  ToolError,
  checkOverlaps,
  clipById,
  clipTitle,
  clipsGiven,
  describeClip,
  editorRun,
  f2,
  gridOf,
  isImageClip,
  newOverlaps,
  nothingChanged,
  ok,
  r3,
  requireUnlockedTracks,
  resolveLayer,
  resolvePlacementLayer,
  spanOf,
  targetClips,
  trackName,
  uiTrack,
  type OverlapRow,
} from "./timeline-edit-common.js";

const EDIT = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;
const ADD = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

/** time_arg: a negative time means the playhead. */
function timeArg(call: ToolCall, seconds: number | undefined): number {
  return seconds === undefined || seconds < 0 ? playheadSeconds(call) : seconds;
}

// ---------------------------------------------------------------------------
// add_clips_to_timeline_tool (Project Files ▸ Add to Timeline)
// ---------------------------------------------------------------------------

function stemOf(file: string): string {
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

/** timeline_edit._transition_choice: '' → none; 'random' → every mask; a name → one mask (catalog id). */
function transitionChoice(name: string): { mask?: string; pool?: string[]; label?: string } {
  let key = name.trim().toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
  for (const ext of [".svg", ".png", ".jpg"]) if (key.endsWith(ext)) key = key.slice(0, -ext.length);
  if (["", "none", "cut", "hard_cut"].includes(key)) return {};
  if (TRANSITIONS.length === 0) throw new ToolError("no transition images are installed");
  if (key === "random") return { pool: TRANSITIONS.map((t) => t.id) };
  if (["crossfade", "cross_fade", "dissolve", "cross_dissolve"].includes(key)) key = "fade";
  // Like the desktop's {stem: path} dict: an extra mask with a common mask's stem wins.
  const stems = new Map<string, string>();
  for (const t of TRANSITIONS) stems.set(stemOf(t.file).toLowerCase(), t.id);
  const exact = stems.get(key);
  if (exact) return { mask: exact, label: key };
  const near = [...stems.keys()].filter((s) => s.includes(key)).sort();
  if (near.length === 1) return { mask: stems.get(near[0]!)!, label: near[0]! };
  const sample = (near.length > 0 ? near : [...stems.keys()].sort()).slice(0, 8);
  throw new ToolError(
    `unknown transition ${pyReprString(name)}; use 'fade' (crossfade), 'random', or a name such as ${sample.join(", ")} ` +
      "(list_transitions_tool lists all)",
  );
}

interface PlacementEntry {
  file: ProjectFile;
  name: string;
  image: boolean;
  start: number | null;
  length: number;
  fixed: boolean;
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

async function addClipsToTimeline(call: ToolCall, input: ContractInput<"add_clips_to_timeline_tool">) {
  const project = call.doc.project;
  const g = gridOf(project);
  const fileIds = input.file_ids ?? [];
  const items = input.items ?? [];
  if (fileIds.length > 0 && items.length > 0) throw new ToolError("give file_ids (whole files) or items (with in/out points), not both");
  const specs: { file_id: string; source_start?: number; source_end?: number }[] =
    fileIds.length > 0 ? fileIds.map((id) => ({ file_id: id })) : items.map((it) => ({ ...it }));
  if (specs.length === 0) throw new ToolError("say which files to place: file_ids or items (list_files_tool lists the project files)");
  const fade = input.fade ?? "none";
  const transitionName = input.transition ?? "";
  if (fade !== "none" && transitionName.trim()) {
    throw new ToolError("choose a transition or fades, not both (fade applies only without a transition)");
  }
  // The desktop's Default Image / Transition Length preferences; the web uses their defaults.
  const imageLength = input.image_seconds || DEFAULT_IMAGE_LENGTH;
  const choice = transitionChoice(transitionName);
  const hasTransition = Boolean(choice.mask || choice.pool);
  const transitionLength = input.transition_seconds || DEFAULT_TRANSITION_LENGTH;
  const fadeSeconds = input.fade_seconds ?? 2.0;
  const overlap = hasTransition ? transitionLength : fade !== "none" ? fadeSeconds : 0;
  const minClip = input.min_clip_seconds ?? 1.0;
  const fitTotal = input.fit_total_seconds ?? 0;

  let entries: PlacementEntry[] = specs.map((spec) => {
    const fid = String(spec.file_id ?? "").trim();
    const file = fid ? fileById(project, fid) : undefined;
    if (!file) throw new ToolError(`no project file with id=${pyReprString(fid)} (list_files_tool lists them)`);
    const name = String(file.name || basename(String(file.path || fid)));
    const sArg = spec.source_start === undefined || spec.source_start < 0 ? null : spec.source_start;
    const eArg = spec.source_end === undefined || spec.source_end < 0 ? null : spec.source_end;
    if (file.media_type === "image" || Boolean(file.has_single_image)) {
      const length = eArg !== null ? eArg - (sArg ?? 0) : imageLength;
      if (length <= g.tol) throw new ToolError(`${name}: an image needs a positive on-screen length`);
      return { file, name, image: true, start: null, length, fixed: eArg !== null };
    }
    const [lo, hi] = sourceWindowForFile(file);
    let s = sArg ?? lo;
    let e = eArg ?? hi;
    if (s < lo - g.tol || e > hi + g.tol || e - s <= g.tol) {
      throw new ToolError(`${name}: source range ${f2(s)}-${f2(e)} s is outside the file (${f2(lo)}-${f2(hi)} s)`);
    }
    s = Math.max(lo, g.snap(s));
    e = Math.min(hi, g.snap(e));
    return { file, name, image: false, start: s, length: e - s, fixed: sArg !== null || eArg !== null };
  });

  const order = input.order ?? "as_given";
  if (order === "shuffle") entries = shuffled(entries);
  else if (order === "name") entries = [...entries].sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0));

  const n = entries.length;
  const keep = entries.map((entry, i) => {
    const sides = n === 1 ? 0 : i === 0 || i === n - 1 ? 1 : 2;
    const need = sides * overlap + g.frame;
    if (entry.length < need - g.tol) {
      throw new ToolError(
        `${entry.name} is ${f2(entry.length)} s, too short for ${f2(overlap)} s ${hasTransition ? "transitions" : "fades"} on ${sides} side(s); ` +
          `shorten ${hasTransition ? "transition_seconds" : "fade_seconds"} or leave it out`,
      );
    }
    return Math.max(minClip, need);
  });

  const total = entries.reduce((sum, e) => sum + e.length, 0) - (n - 1) * overlap;
  let fitNote = "";
  const trimmedIds: string[] = [];
  if (fitTotal > 0 && total > fitTotal + g.tol) {
    const budget = fitTotal + (n - 1) * overlap;
    const lengths = fitLengths(
      entries.map((e) => e.length),
      entries.map((e) => e.fixed),
      keep,
      budget,
      g.frame,
      g.tol,
    );
    if (!lengths) {
      const shortest = entries.reduce((sum, e, i) => sum + (e.fixed ? e.length : Math.min(e.length, keep[i]!)), 0) - (n - 1) * overlap;
      throw new ToolError(
        `cannot fit ${n} clips into ${pyFixed(fitTotal, 1)} s: with at least ${pyFixed(minClip, 1)} s each (plus transition overlaps) ` +
          `the shortest possible sequence is ${pyFixed(shortest, 1)} s; lower min_clip_seconds, use fewer clips, or raise fit_total_seconds`,
      );
    }
    entries.forEach((entry, i) => {
      const length = lengths[i]!;
      if (length < entry.length - 1e-9) {
        // Keep the middle: heads and tails are usually shaky.
        if (!entry.image) entry.start = g.snap(entry.start! + (entry.length - length) / 2);
        entry.length = length;
        trimmedIds.push(entry.file.id);
      }
    });
    fitNote = `, trimmed ${trimmedIds.length} clip(s) to fit ${pyG(fitTotal)} s`;
  } else if (fitTotal > 0) {
    fitNote = `, already within ${pyG(fitTotal)} s so nothing was trimmed`;
  }

  const { layer, newTracks } = input.track?.trim()
    ? resolvePlacementLayer(project, input.track)
    : { layer: selectedTrack(call)?.number ?? defaultUnderlayLayerNumber(project.layers), newTracks: 0 };
  requireUnlockedTracks(project, [layer]);
  const startSeconds = input.start_seconds ?? -1;
  const start = startSeconds >= 0 ? g.snap(startSeconds) : g.snap(trackEnd(project, layer));

  const planned: PlannedItem[] = [];
  let position = start;
  entries.forEach((entry, i) => {
    if (i > 0) position -= overlap;
    planned.push({ label: entry.name, layer, start: position, end: position + entry.length });
    position += entry.length;
  });
  checkOverlaps(newOverlaps(project, new Map(), planned), input.allow_overlap ?? false, "Placing these clips", false);

  const placement: PlaceFileEntry[] = entries.map((entry) =>
    entry.image ? { fileId: entry.file.id, end: entry.length } : { fileId: entry.file.id, start: entry.start!, end: entry.start! + entry.length },
  );
  const result = call.commit((tx) => {
    if (newTracks > 0) ensureTrack(tx, layer);
    return placeFiles(tx, placement, start, layer, {
      ...(fade !== "none" ? { fade } : {}),
      fadeLength: fadeSeconds,
      ...(choice.mask ? { transition: choice.mask } : {}),
      ...(choice.pool ? { randomTransitions: choice.pool } : {}),
      transitionLength,
      imageLength,
      ...(input.zoom && input.zoom !== "none" ? { zoom: input.zoom } : {}),
      transitionFirstClip: false,
    });
  });

  const after = call.doc.project;
  const placed = result.clipIds.map((id) => clipById(after, id)).filter((c): c is Clip => c !== undefined).map((c) => describeClip(after, c));
  const end = Math.max(...placed.map((p) => p.end));
  const how = choice.mask
    ? `, ${choice.label} transitions`
    : choice.pool
      ? ", random transitions"
      : fade !== "none"
        ? `, fade ${fade}`
        : "";
  return ok(
    call,
    `Placed ${placed.length} clip(s) on ${trackName(after, layer)}${newTracksNote(newTracks)} from ${f2(start)} s to ${f2(end)} s (${pyFixed(end - start, 1)} s${how}${fitNote}).`,
    {
      track: uiTrack(after, layer),
      start: r3(start),
      end: r3(end),
      total_seconds: r3(end - start),
      clips: placed,
      transition_ids: result.transitionIds,
      trimmed_file_ids: trimmedIds,
      overlap_seconds: r3(overlap),
      ...(newTracks > 0 ? { new_tracks: newTracks } : {}),
    },
  );
}

// ---------------------------------------------------------------------------
// move_clips_tool (move / nudge / reorder)
// ---------------------------------------------------------------------------

type Item = Clip | Transition;

function isClip(project: Project, item: Item): item is Clip {
  return project.clips.some((c) => c.id === item.id);
}

/**
 * Where each source track goes for a destination track; `newTracks` is how
 * many tracks the caller must add on top first (the destination named one to
 * three past the top, as placement tools allow).
 */
function layerMapFor(project: Project, sources: Set<number>, destTrack: string): { map: Map<number, number>; newTracks: number } {
  const { layer: dest, newTracks } = resolvePlacementLayer(project, destTrack);
  const map = remapLayers(project, sources, dest, newTracks);
  if (!map) {
    throw new ToolError(
      `moving these clips' ${sources.size} tracks onto ${trackName(project, dest)} needs a track that does not exist; add one first (add_track_tool)`,
    );
  }
  return { map, newTracks };
}

/** Add the tracks a remapped selection lands on, up to the highest one (ensureTrack adds the empty ones between). */
function ensureMappedTracks(tx: Transaction, project: Project, layerMap: ReadonlyMap<number, number>): void {
  const top = Math.max(0, ...project.layers.map((l) => l.number));
  const highest = Math.max(...layerMap.values());
  if (highest > top) ensureTrack(tx, highest);
}

/**
 * Summary notes for the tracks a move/copy added: `[on the named track, at the end]`. A
 * selection from several tracks can name an existing track while lower sources' tracks are
 * the new ones, so the count goes at the end instead of "on a new track".
 */
function addedTracksNotes(newTracks: number, namedIsNew: boolean): [string, string] {
  if (newTracks <= 0) return ["", ""];
  return namedIsNew ? [newTracksNote(newTracks), ""] : ["", `; ${newTracks} track${newTracks === 1 ? "" : "s"} added on top`];
}

async function moveClips(call: ToolCall, input: ContractInput<"move_clips_tool">) {
  const project = call.doc.project;
  if (!clipsGiven(input)) throw new ToolError("say which clips to move: timeline_clip_ids, clip_query, or scope");
  const clips = await targetClips(call, input);
  const ids = new Set(clips.map((c) => c.id));
  const positionSeconds = input.position_seconds ?? -1;
  const bySeconds = input.by_seconds ?? 0;
  const byFrames = input.by_frames ?? 0;
  const afterId = (input.after_clip_id ?? "").trim();
  const beforeId = (input.before_clip_id ?? "").trim();
  const toTrack = (input.to_track ?? "").trim();
  const ripple = input.ripple ?? false;
  const allowOverlap = input.allow_overlap ?? false;
  const modes = [positionSeconds >= 0, bySeconds !== 0, byFrames !== 0, Boolean(afterId), Boolean(beforeId)].filter(Boolean).length;
  if (modes > 1) throw new ToolError("give only one of position_seconds, by_seconds, by_frames, after_clip_id, before_clip_id");
  if (modes === 0 && !toTrack) {
    throw new ToolError("nothing to do: give position_seconds, by_seconds, by_frames, after_clip_id, before_clip_id or to_track");
  }

  let anchor: Clip | undefined;
  if (afterId || beforeId) {
    const aid = afterId || beforeId;
    anchor = clipById(project, aid);
    if (!anchor) throw new ToolError(`no timeline clip with id=${pyReprString(aid)}`);
    if (ids.has(anchor.id)) throw new ToolError("the anchor clip is one of the clips being moved");
    if (toTrack) throw new ToolError("after_clip_id/before_clip_id already choose the track (the anchor's); drop to_track");
  }

  const srcLayers = new Set(clips.map((c) => c.layer));
  const mapped = anchor
    ? layerMapFor(project, srcLayers, String(uiTrack(project, anchor.layer)))
    : toTrack
      ? layerMapFor(project, srcLayers, toTrack)
      : { map: new Map([...srcLayers].map((n) => [n, n])), newTracks: 0 };
  const { map: layerMap, newTracks } = mapped;
  requireUnlockedTracks(project, [...srcLayers, ...layerMap.values()]);

  const g = gridOf(project);
  const spans = new Map(clips.map((c) => [c.id, spanOf(c)]));
  const gStart = Math.min(...[...spans.values()].map(([s]) => s));
  const gEnd = Math.max(...[...spans.values()].map(([, e]) => e));
  const length = gEnd - gStart;
  const before = new Map(clips.map((c) => [c.id, { layer: c.layer, position: spans.get(c.id)![0] }]));
  // id → [item, new position, new layer]
  const movedItems = new Map<string, [Item, number, number]>();
  let hits: OverlapRow[] = [];

  if (!ripple) {
    let delta = 0;
    if (positionSeconds >= 0) delta = g.snap(positionSeconds) - gStart;
    else if (byFrames) delta = byFrames * g.frame;
    else if (bySeconds) delta = g.snap(gStart + bySeconds) - gStart;
    else if (anchor) {
      const [aStart, aEnd] = spanOf(anchor);
      delta = afterId ? aEnd - gStart : aStart - length - gStart;
    }
    if (gStart + delta < -g.tol) throw new ToolError(`that would start the clip(s) at ${f2(gStart + delta)} s, before the timeline start`);
    const changes = new Map<string, PlannedSpan>();
    for (const c of clips) {
      const [s, e] = spans.get(c.id)!;
      const newLayer = layerMap.get(c.layer)!;
      const p = Math.max(0, s + delta);
      changes.set(c.id, { layer: newLayer, start: p, end: p + (e - s) });
      movedItems.set(c.id, [c, p, newLayer]);
    }
    if (clips.every((c) => Math.abs(changes.get(c.id)!.start - spans.get(c.id)![0]) <= g.tol && changes.get(c.id)!.layer === c.layer)) {
      throw new ToolError("the clips are already there; nothing moved");
    }
    hits = checkOverlaps(newOverlaps(project, changes), allowOverlap, "Moving the clip(s)");
  } else {
    if (srcLayers.size !== 1 || new Set(layerMap.values()).size !== 1) throw new ToolError("ripple moves clips of one track at a time");
    const src = [...srcLayers][0]!;
    const dst = [...layerMap.values()][0]!;
    const between = project.clips.filter((c) => c.layer === src && !ids.has(c.id) && gStart + g.tol < spanOf(c)[0] && spanOf(c)[0] < gEnd - g.tol);
    if (between.length > 0) {
      throw new ToolError(`ripple needs one contiguous run of clips; ${pyReprString(clipTitle(between[0]!))} sits between them`);
    }
    const inner = transitionsBetween(project, clips.map((c) => c.id), g.tol);
    const moving = new Set([...ids, ...inner.map((t) => t.id)]);

    // 1. close the hole at the source (positions after the close, by id)
    const pos = new Map<string, number>();
    const objs = new Map<string, Item>();
    for (const item of [...itemsOnLayer(project, src), ...(dst !== src ? itemsOnLayer(project, dst) : [])]) {
      objs.set(item.id, item);
      pos.set(item.id, Number(item.position) || 0);
    }
    const later = itemsOnLayer(project, src).filter((i) => !moving.has(i.id) && pos.get(i.id)! > gStart + g.tol);
    const freed = later.length > 0 ? Math.min(length, Math.min(...later.map((i) => pos.get(i.id)!)) - gStart) : 0;
    for (const i of later) pos.set(i.id, pos.get(i.id)! - freed);

    // 2. the insertion time in the closed-up timeline
    const closed = (t: number): number => (dst !== src || t <= gStart ? t : Math.max(gStart, t - freed));
    let insertAt: number;
    if (anchor) {
      const aStart = pos.get(anchor.id)!;
      const [s0, e0] = spanOf(anchor);
      insertAt = afterId ? aStart + (e0 - s0) : aStart;
    } else if (positionSeconds >= 0) {
      insertAt = closed(g.snap(positionSeconds));
    } else if (byFrames || bySeconds) {
      insertAt = closed(g.snap(gStart + (byFrames ? byFrames * g.frame : bySeconds)));
    } else if (dst !== src) {
      insertAt = gStart;
    } else {
      throw new ToolError("the clips are already there; nothing moved");
    }
    insertAt = Math.max(0, insertAt);

    // 3. open room at the destination
    for (const item of itemsOnLayer(project, dst).filter((i) => isClip(project, i))) {
      if (moving.has(item.id)) continue;
      const s = pos.get(item.id)!;
      const [s0, e0] = spanOf(item);
      const e = s + (e0 - s0);
      if (s < insertAt - g.tol && e > insertAt + g.tol && !allowOverlap) {
        throw new ToolError(
          `${f2(insertAt)} s falls inside ${pyReprString(clipTitle(item as Clip))} (${f2(s)}-${f2(e)} s); insert at its start or end, ` +
            "slice it first (slice_clips_tool), or pass allow_overlap=true",
        );
      }
    }
    for (const item of itemsOnLayer(project, dst)) {
      if (!moving.has(item.id) && pos.get(item.id)! >= insertAt - g.tol) pos.set(item.id, pos.get(item.id)! + length);
    }

    // 4. the moved clips (and the transitions between them)
    for (const item of [...clips, ...inner]) {
      objs.set(item.id, item);
      const p = insertAt + (spanOf(item)[0] - gStart);
      pos.set(item.id, p);
      movedItems.set(item.id, [item, p, dst]);
    }
    for (const [id, item] of objs) {
      if (movedItems.has(id)) continue;
      if (Math.abs(pos.get(id)! - (Number(item.position) || 0)) > 1e-9) movedItems.set(id, [item, pos.get(id)!, item.layer]);
    }
  }

  call.commit((tx) => {
    ensureMappedTracks(tx, project, layerMap);
    for (const [id, [item, newPos, newLayer]] of movedItems) {
      const to = { position: g.snap(newPos), ...(item.layer !== newLayer ? { layer: newLayer } : {}) };
      if (isClip(project, item)) moveClip(tx, id, to);
      else moveTransition(tx, id, to);
    }
  });

  const after = call.doc.project;
  const moved: Record<string, unknown>[] = [];
  const shifted: string[] = [];
  for (const [id, [item, newPos, newLayer]] of movedItems) {
    if (ids.has(id)) {
      const was = before.get(id)!;
      moved.push({
        timeline_clip_id: id,
        title: clipTitle(item as Clip),
        from: { track: uiTrack(after, was.layer), position: r3(was.position) },
        to: { track: uiTrack(after, newLayer), position: r3(g.snap(newPos)) },
      });
    } else if (isClip(project, item)) {
      shifted.push(id);
    }
  }
  const first = (moved[0]?.to ?? {}) as { position?: number };
  const named = layerMap.get(clips[0]!.layer)!;
  const [onNamed, added] = addedTracksNotes(newTracks, !project.layers.some((l) => l.number === named));
  const summary =
    `Moved ${moved.length} clip(s) to ${trackName(after, named)}${onNamed} at ${f2(first.position ?? 0)} s` +
    (shifted.length > 0 ? `; ${shifted.length} later clip(s) shifted` : "") +
    (hits.length > 0 ? `; overlaps ${hits.length} clip(s)` : "") +
    added +
    ".";
  return ok(call, summary, { moved, shifted: shifted.sort(), overlaps: hits, ripple, ...(newTracks > 0 ? { new_tracks: newTracks } : {}) });
}

// ---------------------------------------------------------------------------
// trim_clips_tool
// ---------------------------------------------------------------------------

async function trimClips(call: ToolCall, input: ContractInput<"trim_clips_tool">) {
  const project = call.doc.project;
  if (!clipsGiven(input)) throw new ToolError("say which clips to trim: timeline_clip_ids, clip_query, or scope");
  const trimStart = input.trim_start_seconds ?? 0;
  const trimEnd = input.trim_end_seconds ?? 0;
  const sourceStart = input.source_start ?? -1;
  const sourceEnd = input.source_end ?? -1;
  const duration = input.duration_seconds ?? 0;
  const ripple = input.ripple ?? false;
  if (trimStart && sourceStart >= 0) throw new ToolError("give trim_start_seconds or source_start, not both");
  if ([Boolean(trimEnd), sourceEnd >= 0, duration > 0].filter(Boolean).length > 1) {
    throw new ToolError("give only one of trim_end_seconds, source_end, duration_seconds");
  }
  if (!(trimStart || trimEnd || sourceStart >= 0 || sourceEnd >= 0 || duration > 0)) {
    throw new ToolError("nothing to trim: give trim_start_seconds, trim_end_seconds, source_start, source_end or duration_seconds");
  }
  const clips = await targetClips(call, input);
  requireUnlockedTracks(project, clips.map((c) => c.layer));

  const g = gridOf(project);
  interface Plan {
    clip: Clip;
    s: number;
    e: number;
    pos: number;
    ns: number;
    ne: number;
    np: number;
  }
  let plans: Plan[] = clips.map((clip) => {
    const name = clipTitle(clip);
    const s = Number(clip.start) || 0;
    const e = Number(clip.end) || 0;
    const pos = Number(clip.position) || 0;
    let ns = sourceStart >= 0 ? sourceStart : s + trimStart;
    let ne = sourceEnd >= 0 ? sourceEnd : duration > 0 ? ns + duration : e - trimEnd;
    ns = g.snap(ns);
    ne = g.snap(ne);
    if (ns < -g.tol) {
      throw new ToolError(`${name}: there are only ${f2(s)} s of source before its in point, so the start can be extended by at most ${f2(s)} s`);
    }
    ns = Math.max(0, ns);
    if (!isImageClip(clip)) {
      const maxLen = clipTimeBounds(clip as unknown as Record<string, unknown>, project.fps).maxDuration;
      if (maxLen && ne > maxLen + g.tol) {
        throw new ToolError(`${name}: the source is ${f2(maxLen)} s long, so its out point can be at most ${f2(maxLen)} s (it is ${f2(e)} s now)`);
      }
      if (maxLen) ne = Math.min(ne, maxLen);
    }
    if (ne - ns < g.frame - g.tol) {
      throw new ToolError(
        `${name}: that leaves ${pyFixed(Math.max(0, ne - ns), 3)} s; a clip needs at least one frame (delete it with delete_from_timeline_tool instead)`,
      );
    }
    const np = ripple ? pos : pos + (ns - s);
    if (np < -g.tol) {
      throw new ToolError(`${name}: extending its start by ${f2(s - ns)} s would put it before 0 s on the timeline; move it later first or pass ripple=true`);
    }
    return { clip, s, e, pos, ns, ne, np: Math.max(0, np) };
  });

  plans = plans.filter((p) => Math.abs(p.ns - p.s) > 1e-9 || Math.abs(p.ne - p.e) > 1e-9);
  if (plans.length === 0) return nothingChanged(call, "Nothing changed: the clips already have those in/out points.", { clips: [] });

  let hits: OverlapRow[] = [];
  if (!ripple) {
    const changes = new Map<string, PlannedSpan>(plans.map((p) => [p.clip.id, { layer: p.clip.layer, start: p.np, end: p.np + (p.ne - p.ns) }]));
    hits = checkOverlaps(newOverlaps(project, changes), input.allow_overlap ?? false, "The trim");
  }

  const ordered = [...plans].sort((a, b) => b.pos - a.pos);
  const shifted = call.commit((tx) => {
    const moved: string[] = [];
    for (const p of ordered) {
      trimClip(tx, p.clip.id, { start: p.ns, end: p.ne });
      moveClip(tx, p.clip.id, { position: g.snap(p.np) });
      // Everything that starts after this clip moves, including a clip that overlaps
      // its tail (a crossfade partner) and the transition between them.
      if (ripple) moved.push(...shiftAfter(tx, p.clip.layer, p.pos + g.tol, p.ne - p.ns - (p.e - p.s), new Set([p.clip.id])));
    }
    return moved;
  });
  const results = ordered
    .map((p) => ({
      timeline_clip_id: p.clip.id,
      title: clipTitle(p.clip),
      before: { position: r3(p.pos), source_in: r3(p.s), source_out: r3(p.e), duration: r3(p.e - p.s) },
      after: { position: r3(p.np), source_in: r3(p.ns), source_out: r3(p.ne), duration: r3(p.ne - p.ns) },
    }))
    .reverse();
  const one = results[0]!.after;
  const summary =
    `Trimmed ${results.length} clip(s)` +
    (results.length === 1 ? `: now ${f2(one.source_in)}-${f2(one.source_out)} s of the source, ${f2(one.duration)} s long` : "") +
    (shifted.length > 0 ? `; ${shifted.length} later item(s) rippled` : "") +
    ".";
  return ok(call, summary, { clips: results, shifted: [...new Set(shifted)].sort(), overlaps: hits, ripple });
}

// ---------------------------------------------------------------------------
// slice_clips_tool (Slice menu / razor)
// ---------------------------------------------------------------------------

async function sliceClips(call: ToolCall, input: ContractInput<"slice_clips_tool">) {
  const project = call.doc.project;
  const keep = input.keep ?? "both";
  const ripple = input.ripple ?? false;
  const includeTransitions = input.include_transitions ?? true;
  if (keep === "both" && ripple) throw new ToolError("ripple only applies when one side is kept (keep='left' or 'right')");
  const g = gridOf(project);
  const t = g.snap(timeArg(call, input.at_seconds));
  const inside = (item: Item): boolean => {
    const [s, e] = spanOf(item);
    return s + g.tol < t && t < e - g.tol;
  };
  const scope = (input.scope ?? "").trim().toLowerCase();
  const locked = new Set(project.layers.filter((l) => l.lock).map((l) => l.number));
  const skipped: Record<string, unknown>[] = [];
  let clips: Clip[];
  let transitions: Transition[] = [];
  if ((input.timeline_clip_ids?.length ?? 0) > 0 || input.clip_query?.trim() || scope === "selected") {
    clips = await targetClips(call, input);
    for (const c of clips) {
      if (!inside(c)) {
        const [s, e] = spanOf(c);
        throw new ToolError(`${pyReprString(clipTitle(c))} (${f2(s)}-${f2(e)} s) is not under ${f2(t)} s; cut inside the clip`);
      }
    }
    requireUnlockedTracks(project, clips.map((c) => c.layer));
    if (scope === "selected" && includeTransitions) {
      const selected = new Set(call.host.ui?.selectedIds?.() ?? []);
      transitions = project.effects.filter((tr) => selected.has(tr.id) && inside(tr));
    }
  } else if (scope === "track" || scope === "all") {
    const wanted = scope === "track" ? new Set([resolveLayer(project, input.track)]) : new Set(project.layers.map((l) => l.number));
    if (scope === "track") requireUnlockedTracks(project, wanted);
    clips = project.clips.filter((c) => wanted.has(c.layer) && inside(c));
    if (includeTransitions) transitions = project.effects.filter((tr) => wanted.has(tr.layer) && inside(tr));
    for (const c of clips.filter((c) => locked.has(c.layer))) {
      skipped.push({ timeline_clip_id: c.id, title: clipTitle(c), track: uiTrack(project, c.layer) });
    }
    clips = clips.filter((c) => !locked.has(c.layer));
    transitions = transitions.filter((tr) => !locked.has(tr.layer));
    if (clips.length === 0 && transitions.length === 0) {
      const where = scope === "track" ? ` on ${trackName(project, [...wanted][0]!)}` : "";
      const extra = skipped.length > 0 ? ` (${skipped.length} clip(s) on locked tracks skipped)` : "";
      throw new ToolError(`nothing to slice under ${f2(t)} s${where}${extra}`);
    }
  } else {
    throw new ToolError("say what to slice: timeline_clip_ids, clip_query, or scope ('selected', 'track', 'all')");
  }

  // Keep-left cuts one frame later so the left part keeps the frame at the cut
  // (Slice_Triggered); a cut that reaches the end leaves the item as it is.
  const cutAt = keep === "left" ? t + g.frame : t;
  const cuts = (item: Item): boolean => {
    const [s, e] = spanOf(item);
    return s < cutAt - 1e-9 && cutAt < e - 1e-9;
  };
  const pieces = call.commit((tx) => {
    const out: Record<string, unknown>[] = [];
    for (const c of clips) {
      const now = clipById(tx.project, c.id);
      let right: string | null = null;
      let changed = false;
      if (now && cuts(now)) {
        const result = splitClip(tx, c.id, t, keep, { ripple });
        right = keep === "both" ? result.rightId : null;
        changed = true;
      }
      out.push({
        timeline_clip_id: c.id,
        title: clipTitle(c),
        left: keep === "both" || keep === "left" ? c.id : null,
        right: keep === "both" ? right : keep === "right" ? c.id : null,
        changed,
      });
    }
    for (const tr of transitions) {
      const now = findTransition(tx.project, tr.id);
      if (now && cuts(now)) splitTransition(tx, tr.id, t, keep, { ripple });
    }
    if (clips.length > 0 && !out.some((p) => p.changed)) throw new ToolError(`the editor did not slice anything at ${f2(t)} s`);
    return out;
  });
  const summary =
    `Sliced ${clips.length} clip(s)` +
    (transitions.length > 0 ? ` and ${transitions.length} transition(s)` : "") +
    ` at ${f2(t)} s, kept ${keep}` +
    (ripple ? " and closed the gap" : "") +
    (skipped.length > 0 ? `; skipped ${skipped.length} on locked tracks` : "") +
    ".";
  return ok(call, summary, {
    at_seconds: r3(t),
    keep,
    pieces,
    transition_ids: transitions.map((tr) => tr.id),
    skipped_locked: skipped,
    ripple,
  });
}

// ---------------------------------------------------------------------------
// remove_gaps_tool (Remove Gap / Remove All Gaps)
// ---------------------------------------------------------------------------

function removeGaps(call: ToolCall, input: ContractInput<"remove_gaps_tool">) {
  const project = call.doc.project;
  const from = input.from_seconds ?? 0;
  const onlyFirst = input.only_first ?? false;
  let todo: number[];
  if (input.track?.trim()) {
    todo = [resolveLayer(project, input.track)];
  } else {
    const used = [...new Set(project.clips.map((c) => c.layer))].sort((a, b) => a - b);
    todo = used.filter((n) => listGaps(project, n, from).length > 0);
    if (todo.length > 1) {
      throw new ToolError(
        `${todo.map((n) => trackName(project, n)).join(", ")} have gaps; say which track (closing gaps on several tracks at once would pull them out of sync)`,
      );
    }
  }
  requireUnlockedTracks(project, todo);

  const closed: { track: number | null; gaps: number[][]; closed_seconds: number }[] = [];
  const movedIds = new Set<string>();
  call.commit((tx) => {
    for (const layer of todo) {
      let gaps = listGaps(tx.project, layer, from);
      if (gaps.length === 0) continue;
      let moved: string[];
      if (onlyFirst) {
        gaps = gaps.slice(0, 1);
        moved = closeGap(tx, layer, gaps[0]!.start, gaps[0]!.end);
      } else {
        moved = closeAllGaps(tx, layer, gaps[0]!.start);
      }
      for (const id of moved) movedIds.add(id);
      closed.push({
        track: uiTrack(project, layer),
        gaps: gaps.map((gap) => [r3(gap.start), r3(gap.end)]),
        closed_seconds: r3(gaps.reduce((sum, gap) => sum + (gap.end - gap.start), 0)),
      });
    }
  });
  if (closed.length === 0) {
    const where = todo.length > 0 ? ` on ${trackName(project, todo[0]!)}` : "";
    return nothingChanged(call, `No gaps to remove${where} after ${f2(from)} s.`, { closed: [] });
  }
  const total = closed.reduce((sum, c) => sum + c.closed_seconds, 0);
  const count = closed.reduce((sum, c) => sum + c.gaps.length, 0);
  return ok(call, `Closed ${count} gap(s) (${f2(total)} s) on track ${closed[0]!.track}; ${movedIds.size} item(s) moved left.`, {
    closed,
    moved: [...movedIds].sort(),
  });
}

// ---------------------------------------------------------------------------
// duplicate_clips_tool (Copy + Paste / Duplicate)
// ---------------------------------------------------------------------------

async function duplicateClips(call: ToolCall, input: ContractInput<"duplicate_clips_tool">) {
  const project = call.doc.project;
  if (!clipsGiven(input)) throw new ToolError("say which clips to duplicate: timeline_clip_ids, clip_query, or scope");
  const clips = await targetClips(call, input);
  const srcLayers = new Set(clips.map((c) => c.layer));
  const toTrack = (input.to_track ?? "").trim();
  const { map: layerMap, newTracks } = toTrack ? layerMapFor(project, srcLayers, toTrack) : { map: new Map([...srcLayers].map((n) => [n, n])), newTracks: 0 };
  const destLayers = new Set(layerMap.values());
  requireUnlockedTracks(project, destLayers, "the copies' destination");

  const g = gridOf(project);
  const copies = input.copies ?? 1;
  const ripple = input.ripple ?? false;
  const allowOverlap = input.allow_overlap ?? false;
  const spans = new Map(clips.map((c) => [c.id, spanOf(c)]));
  const gStart = Math.min(...[...spans.values()].map(([s]) => s));
  const gEnd = Math.max(...[...spans.values()].map(([, e]) => e));
  const length = gEnd - gStart;
  const positionSeconds = input.position_seconds ?? -1;
  const base = positionSeconds >= 0 ? g.snap(positionSeconds) : gEnd;
  // Only crossfades between two copied clips; a clip's incoming/outgoing one stays behind.
  const inner = input.include_transitions ?? true ? transitionsBetween(project, clips.map((c) => c.id), g.tol) : [];

  const planned: PlannedItem[] = [];
  for (let k = 0; k < copies; k += 1) {
    const offset = base + k * length - gStart;
    for (const c of clips) {
      const [s, e] = spans.get(c.id)!;
      planned.push({ label: `copy ${k + 1} of ${clipTitle(c)}`, layer: layerMap.get(c.layer)!, start: s + offset, end: e + offset });
    }
  }
  let hits: OverlapRow[] = [];
  if (ripple) {
    for (const layer of destLayers) {
      for (const item of project.clips.filter((c) => c.layer === layer).sort((a, b) => a.position - b.position)) {
        const [s, e] = spanOf(item);
        if (s < base - g.tol && e > base + g.tol && !allowOverlap) {
          throw new ToolError(
            `${f2(base)} s falls inside ${pyReprString(clipTitle(item))} (${f2(s)}-${f2(e)} s); insert at its start or end, slice it first, or pass allow_overlap=true`,
          );
        }
      }
    }
  } else {
    hits = checkOverlaps(newOverlaps(project, new Map(), planned), allowOverlap, "The copies");
  }

  const { created, transitionIds, shifted } = call.commit((tx) => {
    ensureMappedTracks(tx, project, layerMap);
    const pushed: string[] = [];
    if (ripple) for (const layer of destLayers) pushed.push(...shiftAfter(tx, layer, base, copies * length));
    const batches: Record<string, unknown>[][] = [];
    const newTransitions: string[] = [];
    for (let k = 0; k < copies; k += 1) {
      // From the positions before the ripple, like the desktop.
      const offset = base + k * length - gStart;
      const result = duplicateItems(tx, {
        clips: clips.map((c) => ({ id: c.id, position: spans.get(c.id)![0] + offset, layer: layerMap.get(c.layer)! })),
        transitions: inner.map((t) => ({ id: t.id, position: Number(t.position) + offset, layer: layerMap.get(t.layer) ?? t.layer })),
      });
      batches.push(
        result.clips.map(({ copy, of }) => ({
          timeline_clip_id: copy.id,
          copy_of: of,
          track: uiTrack(tx.project, copy.layer),
          position: r3(copy.position),
          end: r3(spanOf(copy)[1]),
        })),
      );
      newTransitions.push(...result.transitionIds);
    }
    return { created: batches, transitionIds: newTransitions, shifted: pushed };
  });
  const first = created[0]![0]! as { position: number; track: number | null };
  const pushedClips = shifted.filter((id) => project.clips.some((c) => c.id === id)).length;
  const [onFirst, added] = addedTracksNotes(newTracks, (first.track ?? 0) > project.layers.length);
  const summary =
    `Made ${copies} cop${copies === 1 ? "y" : "ies"} of ${clips.length} clip(s); the first starts at ${f2(first.position)} s on track ${first.track}${onFirst}` +
    (shifted.length > 0 ? `; ${pushedClips} later clip(s) pushed` : "") +
    (hits.length > 0 ? `; overlaps ${hits.length} clip(s)` : "") +
    added +
    ".";
  return ok(call, summary, {
    copies: created,
    transition_ids: transitionIds,
    shifted: [...new Set(shifted)].sort(),
    overlaps: hits,
    ...(newTracks > 0 ? { new_tracks: newTracks } : {}),
  });
}

// ---------------------------------------------------------------------------
// align_clips_tool (Align Left / Right)
// ---------------------------------------------------------------------------

async function alignClips(call: ToolCall, input: ContractInput<"align_clips_tool">) {
  const project = call.doc.project;
  if (!clipsGiven(input)) throw new ToolError("say which clips to align: timeline_clip_ids, clip_query, or scope");
  const clips = await targetClips(call, input);
  const toSeconds = input.to_seconds ?? -1;
  const edge = input.edge ?? "start";
  if (clips.length < 2 && toSeconds < 0) throw new ToolError("aligning needs at least two clips (or to_seconds to line one clip up with a time)");
  requireUnlockedTracks(project, clips.map((c) => c.layer));
  const g = gridOf(project);
  const positions = alignedPositions(clips, edge === "end", toSeconds >= 0 ? g.snap(toSeconds) : undefined);
  const changes = new Map<string, PlannedSpan>();
  for (const c of clips) {
    const [s, e] = spanOf(c);
    const p = g.snap(positions.get(c.id)!);
    if (p < -g.tol) throw new ToolError(`${pyReprString(clipTitle(c))} would start at ${f2(p)} s, before the timeline start`);
    if (Math.abs(p - s) > g.tol) changes.set(c.id, { layer: c.layer, start: Math.max(0, p), end: Math.max(0, p) + (e - s) });
  }
  if (changes.size === 0) return nothingChanged(call, `The clips' ${edge}s are already lined up.`, { moved: [] });
  const hits = checkOverlaps(newOverlaps(project, changes), input.allow_overlap ?? false, "Aligning", false);
  call.commit((tx) => {
    for (const [id, planned] of changes) moveClip(tx, id, { position: planned.start });
  });
  const moved = clips
    .filter((c) => changes.has(c.id))
    .map((c) => ({ timeline_clip_id: c.id, title: clipTitle(c), from: r3(spanOf(c)[0]), to: r3(changes.get(c.id)!.start) }));
  const firstChange = [...changes.values()][0]!;
  const at = edge === "start" ? firstChange.start : firstChange.end;
  return ok(call, `Aligned the ${edge}s of ${clips.length} clip(s) at ${f2(at)} s (${moved.length} moved).`, {
    edge,
    at_seconds: r3(at),
    moved,
    overlaps: hits,
  });
}

// ---------------------------------------------------------------------------

export const timelineEditTools: CatalogTool[] = [
  contractTool("add_clips_to_timeline_tool", { annotations: ADD, run: (call, input) => editorRun(() => addClipsToTimeline(call, input)) }),
  contractTool("move_clips_tool", { annotations: EDIT, run: (call, input) => editorRun(() => moveClips(call, input)) }),
  contractTool("trim_clips_tool", { annotations: EDIT, run: (call, input) => editorRun(() => trimClips(call, input)) }),
  contractTool("slice_clips_tool", { annotations: EDIT, run: (call, input) => editorRun(() => sliceClips(call, input)) }),
  contractTool("remove_gaps_tool", { annotations: EDIT, run: (call, input) => editorRun(() => removeGaps(call, input)) }),
  contractTool("duplicate_clips_tool", { annotations: ADD, run: (call, input) => editorRun(() => duplicateClips(call, input)) }),
  contractTool("align_clips_tool", { annotations: EDIT, run: (call, input) => editorRun(() => alignClips(call, input)) }),
];
