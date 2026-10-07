/**
 * Before/after timeline snapshots and the receipt delta between them.
 *
 * Port of zenvi-core src/classes/agent_tools/snapshot.py (ref b63c39be7).
 * Frame numbers come from the agent frame grid (frame-time.ts), so receipts
 * report the same frames the desktop does.
 *
 * Two deliberate additions: the snapshot also records tracks and markers (the
 * desktop's execute_tool passes neither, so its receipts never fill
 * `createdTracks`/`markers`), and `track` is the 1-based track index from the
 * bottom, the same `track` list_clips_tool and get_timeline_state_tool report.
 */

import type { Project } from "../model/types.js";
import { durationFrames, projectFps, toFrame, type Fps } from "./frame-time.js";
import {
  MUTATION_CLIP_LIMIT,
  SHIFT_GROUP_MINIMUM,
  makeReceipt,
  type CreatedTrack,
  type ReceiptClip,
  type ReceiptShift,
  type ReceiptStatus,
  type ToolReceipt,
  type WatchSuggested,
} from "./receipt.js";

export interface ClipPlacement {
  clipId: string;
  track: number;
  startFrame: number;
  durationFrames: number;
  position: number;
  start: number;
  end: number;
  layer: number;
  title: string;
}

export interface TimelineSnapshot {
  placements: Map<string, ClipPlacement>;
  /** Track ids bottom to top. */
  trackIds: string[];
  /** Track number per track id. */
  trackNumbers: Map<string, number>;
  markers: Map<string, Record<string, unknown>>;
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function samePlace(a: ClipPlacement, b: ClipPlacement): boolean {
  return a.track === b.track && a.startFrame === b.startFrame && a.durationFrames === b.durationFrames;
}

/** Snapshot a project's timeline (snapshot.py timeline_snapshot + tracks and markers). */
export function timelineSnapshot(project: Project, fps: Fps = projectFps(project)): TimelineSnapshot {
  const layers = [...(project.layers ?? [])].sort((a, b) => num(a.number) - num(b.number));
  const trackIndex = new Map<number, number>();
  layers.forEach((layer, i) => trackIndex.set(num(layer.number), i + 1));

  const placements = new Map<string, ClipPlacement>();
  for (const clip of project.clips ?? []) {
    const clipId = String(clip.id ?? "");
    if (!clipId) continue;
    const position = num(clip.position);
    const start = num(clip.start);
    const end = clip.end === undefined || clip.end === null ? start : num(clip.end);
    const layer = Math.trunc(num(clip.layer));
    placements.set(clipId, {
      clipId,
      track: trackIndex.get(layer) ?? layer,
      startFrame: toFrame(position, fps),
      durationFrames: durationFrames(start, end, fps),
      position,
      start,
      end,
      layer,
      title: String(clip.title || (clip as { label?: unknown }).label || ""),
    });
  }

  const markers = new Map<string, Record<string, unknown>>();
  for (const marker of project.markers ?? []) {
    const id = String(marker.id ?? "");
    if (id) markers.set(id, { ...marker });
  }

  return {
    placements,
    trackIds: layers.map((l) => String(l.id)),
    trackNumbers: new Map(layers.map((l) => [String(l.id), num(l.number)])),
    markers,
  };
}

function clipRow(placement: ClipPlacement, requestedFrame?: number): ReceiptClip {
  const row: ReceiptClip = {
    id: placement.clipId,
    track: placement.track,
    layer: placement.layer,
    position: placement.position,
    start: placement.start,
    end: placement.end,
    durationFrames: placement.durationFrames,
    landedFrame: placement.startFrame,
    title: placement.title,
  };
  if (requestedFrame !== undefined) row.requestedFrame = requestedFrame;
  return row;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** What changed between two snapshots, in receipt vocabulary. */
export interface TimelineDelta {
  clips: ReceiptClip[];
  clipsNote?: string;
  shifted: ReceiptShift[];
  removedClipIds: string[];
  createdTracks: CreatedTrack[];
  markers: Record<string, unknown>[];
  removedMarkerIds: string[];
}

export interface DeltaOptions {
  /** Clip ids the tool knows it touched (reported even when their placement did not move). */
  touched?: Iterable<string>;
  /** Requested frame per clip id, for placement tools. */
  requestedFrames?: ReadonlyMap<string, number>;
}

/**
 * Diff two snapshots (snapshot.py mutation_result, minus the receipt
 * wrapper): new and changed clips become rows, same-track moves by the same
 * delta of at least SHIFT_GROUP_MINIMUM clips collapse into `shifted` groups.
 */
export function timelineDelta(before: TimelineSnapshot, after: TimelineSnapshot, options: DeltaOptions = {}): TimelineDelta {
  const touched = new Set(options.touched ?? []);
  const changed = new Set<string>();
  for (const id of touched) if (after.placements.has(id)) changed.add(id);
  for (const id of after.placements.keys()) if (!before.placements.has(id)) changed.add(id);

  const pureShifts = new Map<string, { from: number; delta: number }>();
  for (const [id, placement] of after.placements) {
    const prior = before.placements.get(id);
    if (!prior || samePlace(prior, placement) || changed.has(id)) continue;
    if (prior.track === placement.track && prior.durationFrames === placement.durationFrames) {
      pureShifts.set(id, { from: prior.startFrame, delta: placement.startFrame - prior.startFrame });
    } else {
      changed.add(id);
    }
  }

  const grouped = new Map<string, string[]>();
  for (const [id, shift] of pureShifts) {
    const key = `${after.placements.get(id)!.track}|${shift.delta}`;
    const ids = grouped.get(key) ?? [];
    ids.push(id);
    grouped.set(key, ids);
  }
  const shifted: ReceiptShift[] = [];
  for (const ids of grouped.values()) {
    if (ids.length >= SHIFT_GROUP_MINIMUM) {
      shifted.push({
        track: after.placements.get(ids[0]!)!.track,
        fromFrame: Math.min(...ids.map((id) => pureShifts.get(id)!.from)),
        by: pureShifts.get(ids[0]!)!.delta,
        count: ids.length,
      });
    } else {
      for (const id of ids) changed.add(id);
    }
  }
  shifted.sort((a, b) => num(a.track) - num(b.track) || num(a.fromFrame) - num(b.fromFrame));

  const removedClipIds = [...before.placements.keys()].filter((id) => !after.placements.has(id)).sort();

  const beforeTracks = new Set(before.trackIds);
  const createdTracks: CreatedTrack[] = [];
  after.trackIds.forEach((id, index) => {
    if (!beforeTracks.has(id)) createdTracks.push({ index, id, layer: after.trackNumbers.get(id) });
  });

  const removedMarkerIds = [...before.markers.keys()].filter((id) => !after.markers.has(id)).sort();
  const markers: Record<string, unknown>[] = [];
  for (const [id, marker] of after.markers) {
    const prior = before.markers.get(id);
    if (!prior || !sameJson(prior, marker)) markers.push(marker);
  }

  let clips: ReceiptClip[] = [...changed]
    .sort()
    .map((id) => after.placements.get(id))
    .filter((p): p is ClipPlacement => p !== undefined)
    .map((p) => clipRow(p, options.requestedFrames?.get(p.clipId)));
  let clipsNote: string | undefined;
  if (clips.length > MUTATION_CLIP_LIMIT) {
    clipsNote = `Showing ${MUTATION_CLIP_LIMIT} of ${clips.length} changed clips.`;
    clips = clips.slice(0, MUTATION_CLIP_LIMIT);
  }

  const delta: TimelineDelta = { clips, shifted, removedClipIds, createdTracks, markers, removedMarkerIds };
  if (clipsNote !== undefined) delta.clipsNote = clipsNote;
  return delta;
}

export interface MutationResultOptions extends DeltaOptions {
  status?: ReceiptStatus;
  notes?: string[];
  warnings?: string[];
  watchSuggested?: WatchSuggested | null;
  data?: unknown;
  undoSteps?: number;
}

/** snapshot.py mutation_result: a whole receipt from two snapshots. */
export function mutationResult(
  before: TimelineSnapshot,
  after: TimelineSnapshot,
  tool: string,
  summary: string,
  options: MutationResultOptions = {},
): ToolReceipt {
  const status = options.status ?? "applied";
  const delta = timelineDelta(before, after, options);
  const undoSteps = status === "applied" ? (options.undoSteps ?? 1) : 0;
  return makeReceipt(status, tool, summary, undoSteps, {
    ...delta,
    warnings: options.warnings,
    notes: options.notes,
    watchSuggested: options.watchSuggested ?? null,
    data: options.data,
  });
}

/** snapshot.py requested_vs_landed. */
export function requestedVsLanded(
  requestedSeconds: number,
  landedSeconds: number,
  fps: Fps,
): { requestedFrame: number; landedFrame: number; requestedSeconds: number; landedSeconds: number } {
  const requestedFrame = toFrame(requestedSeconds, fps);
  const landedFrame = toFrame(landedSeconds, fps);
  const d = typeof fps === "number" ? 1 : fps.den;
  const n = typeof fps === "number" ? fps : fps.num;
  return {
    requestedFrame,
    landedFrame,
    requestedSeconds: (requestedFrame * d) / n,
    landedSeconds: (landedFrame * d) / n,
  };
}
