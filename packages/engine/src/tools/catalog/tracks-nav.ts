/**
 * Tracks, markers, the playhead, the timeline view and the selection:
 * update_track_tool, remove_track_tool, update_marker_tool,
 * remove_marker_tool, seek_playhead_tool, select_timeline_items_tool,
 * set_timeline_view_tool and get_playhead_and_selection_tool.
 *
 * Ports of zenvi-core develop 1f80cb3d0
 * src/classes/editor_tools/tracks_nav.py (the rules in track_ops.py are
 * engine ops and timeline/navigation.ts). Track and marker edits are one
 * undo step each. The playhead, view and selection are editor state:
 *
 * - in an editor (a host with a player and a UI) the tools drive the real
 *   editor and report what it shows afterwards;
 * - without one (CLI, Zenvi Cloud) the playhead is the one saved with the
 *   project (`playhead_position`, where the editors open): seeking moves it
 *   without an undo step, reading reports it, and the selection, the view
 *   and playback are refused or reported as absent, never invented.
 */

import { pyRound } from "../../model/rounding.js";
import type { Clip, Project, Transition } from "../../model/types.js";
import { markerColor, markerName, markersInTimeOrder, removeMarkers, updateMarker, type MarkerColor } from "../../ops/markers.js";
import { removeTrack, renameTrack, setTrackLocked } from "../../ops/tracks.js";
import { projectDuration } from "../../timeline/duration.js";
import { clipEdges, navigationPositions, pickAdjacent, secondsToSeekFrame } from "../../timeline/navigation.js";
import { maxFrame, timelineEnd, timelineStart } from "../../timeline/queries.js";
import { contractTool, unavailable, type CatalogTool, type ToolCall, type ToolOutcome } from "../define.js";
import { pyFixed, pyG, pyReprString } from "../pyfmt.js";
import { unchanged } from "../receipt.js";
import type { ContractInput } from "../schemas.gen.js";
import { buildTrackStack } from "../tracks.js";
import type { EditorSelection, TimelineMode, TimelineView } from "../types.js";
import { roundTo } from "../clip-props-model.js";
import { playheadSeconds } from "./common.js";
import { ToolError, clipById, describeClip, failText, ok, resolveLayer, targetClip } from "./timeline-edit-common.js";

const EDIT = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;
const VIEW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } as const;

/** A tool body; the desktop's ToolError becomes "Error: …". */
async function run(body: () => Promise<ToolOutcome> | ToolOutcome): Promise<ToolOutcome> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof ToolError) return failText(error.message);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

function fpsFraction(project: Project): { num: number; den: number } {
  const num = Math.trunc(Number(project.fps?.num)) || 30;
  const den = Math.trunc(Number(project.fps?.den)) || 1;
  return { num, den };
}

function fpsOf(project: Project): number {
  const { num, den } = fpsFraction(project);
  return num / den;
}

/** Timeline seconds → 1-based timeline frame (`_base.seconds_to_frame`). */
function secondsToFrame(project: Project, seconds: number): number {
  return pyRound(Math.max(0, seconds) * fpsOf(project)) + 1;
}

function frameToSeconds(project: Project, frame: number): number {
  return (frame - 1) / fpsOf(project);
}

function pad2(value: number): string {
  return String(Math.trunc(value)).padStart(2, "0");
}

/** The ruler's timecode, HH:MM:SS,FF (time_parts.secondsToTime). */
export function timecode(project: Project, seconds: number): string {
  const { num, den } = fpsFraction(project);
  const ms = Math.max(0, seconds) * 1000;
  let sec = Math.floor(ms / 1000);
  const milli = ms % 1000;
  let minute = Math.floor(sec / 60);
  sec %= 60;
  const hour = Math.floor(minute / 60) % 24;
  minute %= 60;
  const fps = den ? num / den : 0;
  let frame = Math.trunc(pyRound((milli / 1000) * fps));
  if (fps > 0) frame = Math.max(0, Math.min(frame, Math.trunc(fps) - 1));
  return `${pad2(hour)}:${pad2(minute)}:${pad2(sec)},${pad2(frame)}`;
}

/** `_when`: seconds (3 places), frame and timecode of a timeline time. */
function when(project: Project, seconds: number): { seconds: number; frame: number; timecode: string } {
  const s = Math.max(0, seconds);
  return { seconds: roundTo(s, 3), frame: secondsToFrame(project, s), timecode: timecode(project, s) };
}

/** End of the last clip or transition (0 = empty timeline). */
function contentEnd(project: Project): number {
  return timelineEnd(project);
}

/** The project's length as the desktop keeps it: at least 300 s and 10 s past the last item. */
function timelineDuration(project: Project): number {
  return projectDuration(project);
}

/** The last playable frame, what End and Next Marker stop at (timeline.py GetLastFrame). */
function lastFrame(project: Project): number {
  return Math.max(1, maxFrame(project) - 1);
}

/** The first frame with content (Timeline::GetMinFrame). */
function minFrame(project: Project): number {
  return Math.max(1, pyRound(timelineStart(project) * fpsOf(project)) + 1);
}

// ---------------------------------------------------------------------------
// Player state: the editor's player, or the playhead saved with the project
// ---------------------------------------------------------------------------

interface PlayerState {
  playing: boolean;
  speed: number;
  seconds: number;
  frame: number;
  timecode: string;
}

/** `_player_state`: the playhead and transport as the player reports them (the saved playhead without one). */
function playerState(call: ToolCall): PlayerState {
  const project = call.doc.project;
  const player = call.host.player;
  const frame = secondsToFrame(project, playheadSeconds(call));
  const playing = Boolean(player?.playing);
  const speed = playing ? (player?.rate ?? 1) : 0;
  return { playing, speed, ...when(project, frameToSeconds(project, frame)), frame };
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

interface TrackRow {
  track: number | null;
  name: string;
  layer: number;
  track_id: string;
  locked: boolean;
  clips: number;
}

/** The track stack for receipts, bottom first. */
function tracks(project: Project): TrackRow[] {
  const locks = new Map(project.layers.map((l) => [Math.trunc(Number(l.number) || 0), Boolean(l.lock)]));
  const counts = new Map<number, number>();
  for (const clip of project.clips) {
    const layer = Math.trunc(Number(clip.layer) || 0);
    counts.set(layer, (counts.get(layer) ?? 0) + 1);
  }
  return buildTrackStack(project.layers).map((e) => ({
    track: e.ui_track,
    name: e.label,
    layer: e.layer_number,
    track_id: e.track_id,
    locked: locks.get(e.layer_number) ?? false,
    clips: counts.get(e.layer_number) ?? 0,
  }));
}

function trackRow(project: Project, layer: number): TrackRow {
  return tracks(project).find((r) => r.layer === layer) ?? { track: null, name: "", layer, track_id: "", locked: false, clips: 0 };
}

/** How the model should read a track: 'track 2 "B-roll"' or 'track 2'. */
function trackTitle(row: TrackRow): string {
  const number = row.track === null ? "None" : String(row.track);
  return row.name ? `track ${number} "${row.name}"` : `track ${number}`;
}

function nameClash(project: Project, name: string, excludeLayer?: number): string {
  if (!name) return "";
  for (const row of tracks(project)) {
    if (row.layer !== excludeLayer && row.name.trim().toLowerCase() === name.toLowerCase()) {
      return `another track (${trackTitle(row)}) already has this name; refer to tracks by number when names repeat`;
    }
  }
  return "";
}

async function updateTrack(call: ToolCall, input: ContractInput<"update_track_tool">): Promise<ToolOutcome> {
  const name = input.name ?? null;
  const lock = input.lock ?? null;
  if (name === null && lock === null) throw new ToolError("nothing to change: pass name and/or lock");
  const project = call.doc.project;
  const layer = resolveLayer(project, input.track);
  const newName = name === null ? null : name.trim();
  const warning = nameClash(project, newName ?? "", layer);
  const target = project.layers.find((l) => Math.trunc(Number(l.number) || 0) === layer)!;
  const changed: string[] = [];
  if (newName !== null && String(target.label ?? "") !== newName) changed.push("name");
  if (lock !== null && Boolean(target.lock) !== lock) changed.push("lock");
  if (changed.length > 0) {
    call.commit((tx) => {
      if (changed.includes("name")) renameTrack(tx, layer, newName!);
      if (changed.includes("lock")) setTrackLocked(tx, layer, lock!);
    });
  }
  const after = call.doc.project;
  const row = trackRow(after, layer);
  const parts: string[] = [];
  if (changed.includes("name")) parts.push(newName ? `renamed to '${newName}'` : "name cleared");
  if (changed.includes("lock")) parts.push(row.locked ? "locked" : "unlocked");
  const data: Record<string, unknown> = { track: row, changed, tracks: tracks(after) };
  if (warning && changed.includes("name")) data.warning = warning;
  if (parts.length > 0) return ok(call, `Track ${row.track ?? "None"} ${parts.join(" and ")}.`, data);
  const already: string[] = [];
  if (newName !== null) already.push("already has that name");
  if (lock !== null) already.push(`is already ${row.locked ? "locked" : "unlocked"}`);
  return unchanged(call.tool, `Nothing changed: ${trackTitle(row)} ${already.join(" and ")}.`, { data });
}

async function removeTrackTool(call: ToolCall, input: ContractInput<"remove_track_tool">): Promise<ToolOutcome> {
  const project = call.doc.project;
  const layer = resolveLayer(project, input.track);
  const row = trackRow(project, layer);
  if (row.locked) throw new ToolError(`${trackTitle(row)} is locked; unlock it first (update_track_tool lock=false)`);
  if (project.layers.length <= 1) throw new ToolError("the project must keep at least one track");
  const clips = project.clips.filter((c) => Math.trunc(Number(c.layer) || 0) === layer);
  const transitions = project.effects.filter((t) => Math.trunc(Number(t.layer) || 0) === layer);
  if ((clips.length > 0 || transitions.length > 0) && !input.with_clips) {
    throw new ToolError(
      `${trackTitle(row)} still has ${clips.length} clip(s) and ${transitions.length} transition(s); pass with_clips=true to delete them ` +
        "with the track, or move them to another track first",
    );
  }
  const removed = call.commit((tx) => removeTrack(tx, layer));
  const nClips = removed.removedClipIds.length;
  const nTransitions = removed.removedTransitionIds.length;
  const extra = nClips || nTransitions ? ` with ${nClips} clip(s) and ${nTransitions} transition(s)` : "";
  return ok(call, `Removed ${trackTitle(row)}${extra}. One undo restores it.`, {
    removed_track: row,
    deleted_clip_ids: removed.removedClipIds,
    deleted_transition_ids: removed.removedTransitionIds,
    tracks: tracks(call.doc.project),
  });
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

interface MarkerRow {
  marker_id: string;
  name: string;
  color: string;
  seconds: number;
  frame: number;
  timecode: string;
}

function markerRows(project: Project): MarkerRow[] {
  return markersInTimeOrder(project.markers ?? []).map((m) => ({
    marker_id: m.id,
    name: m.name,
    color: m.color,
    ...when(project, m.position),
  }));
}

function markerLabel(row: MarkerRow): string {
  return `marker${row.name ? ` '${row.name}'` : ""} at ${row.timecode}`;
}

/** Snap a marker time to the frame grid; refuse one past the end of the timeline. */
function checkMarkerTime(project: Project, seconds: number): number {
  const fps = fpsOf(project);
  const snapped = pyRound(Math.max(0, seconds) * fps) / fps;
  const duration = timelineDuration(project);
  if (duration && snapped > duration + 1e-6) {
    throw new ToolError(`${pyFixed(snapped, 3)} s is past the end of the timeline (${pyFixed(duration, 3)} s long)`);
  }
  return snapped;
}

/** Markers whose id equals `ref`, else whose name equals it (case-insensitive). */
function markersMatching(project: Project, ref: string): MarkerRow[] {
  const wanted = ref.trim();
  const rows = markerRows(project);
  const byId = rows.filter((r) => r.marker_id === wanted);
  if (byId.length > 0) return byId;
  return wanted ? rows.filter((r) => r.name.trim().toLowerCase() === wanted.toLowerCase()) : [];
}

function markerListing(rows: MarkerRow[], limit = 12): string {
  if (rows.length === 0) return "there are no markers";
  const text = rows
    .slice(0, limit)
    .map((r) => `${r.name || "unnamed"} (${r.timecode})`)
    .join(", ");
  return `markers: ${text}${rows.length > limit ? " ..." : ""}`;
}

async function updateMarkerTool(call: ToolCall, input: ContractInput<"update_marker_tool">): Promise<ToolOutcome> {
  const name = input.name ?? null;
  const color = input.color ?? "";
  const position = input.position_seconds ?? null;
  if (name === null && !color && position === null) throw new ToolError("nothing to change: pass name, color and/or position_seconds");
  const project = call.doc.project;
  const matches = markersMatching(project, input.marker);
  if (matches.length === 0) throw new ToolError(`no marker with id or name ${pyReprString(input.marker)}; ${markerListing(markerRows(project))}`);
  if (matches.length > 1) {
    throw new ToolError(
      `${matches.length} markers are named ${pyReprString(input.marker)} (${matches.map((r) => `${r.marker_id} at ${r.timecode}`).join(", ")}); pass one marker_id`,
    );
  }
  const seconds = position === null ? undefined : checkMarkerTime(project, position);
  const markerId = matches[0]!.marker_id;
  const changes = { name: name === null ? undefined : name.trim(), color: (color || undefined) as MarkerColor | undefined, position: seconds };
  // Only a real change records an undo step.
  const current = project.markers.find((m) => m.id === markerId)!;
  const willChange =
    (changes.name !== undefined && changes.name !== markerName(current)) ||
    (changes.color !== undefined && changes.color !== markerColor(current)) ||
    (changes.position !== undefined && Math.abs((Number(current.position) || 0) - changes.position) > 1e-9);
  const changed = willChange ? call.commit((tx) => updateMarker(tx, markerId, changes)) : [];
  const row = markerRows(call.doc.project).find((r) => r.marker_id === markerId)!;
  if (changed.length === 0) {
    return unchanged(call.tool, `The ${markerLabel(row)} already looks like that; nothing changed.`, { data: { marker: row, changed: [] } });
  }
  return ok(call, `Updated the ${markerLabel(row)} (${changed.join(", ")}).`, { marker: row, changed });
}

async function removeMarkerTool(call: ToolCall, input: ContractInput<"remove_marker_tool">): Promise<ToolOutcome> {
  const refs = (input.markers ?? []).map((m) => String(m).trim()).filter(Boolean);
  const at = input.at_seconds ?? null;
  const all = Boolean(input.all);
  const modes = [refs.length > 0, at !== null, all].filter(Boolean).length;
  if (modes === 0) throw new ToolError("say which markers: markers (ids or names), at_seconds, or all=true");
  if (modes > 1) throw new ToolError("use only one of markers, at_seconds or all");
  const project = call.doc.project;
  const rows = markerRows(project);
  if (rows.length === 0) throw new ToolError("the timeline has no markers");
  let targets: MarkerRow[];
  if (all) {
    targets = rows;
  } else if (at !== null) {
    const nearest = rows.reduce((best, r) => (Math.abs(r.seconds - at) < Math.abs(best.seconds - at) ? r : best));
    if (Math.abs(nearest.seconds - at) > 0.5) {
      throw new ToolError(`no marker within 0.5 s of ${pyFixed(at, 3)} s; the nearest is the ${markerLabel(nearest)}`);
    }
    targets = rows.filter((r) => r.frame === nearest.frame);
  } else {
    targets = [];
    for (const ref of refs) {
      const found = markersMatching(project, ref);
      if (found.length === 0) throw new ToolError(`no marker with id or name ${pyReprString(ref)}; ${markerListing(rows)}`);
      if (found.length > 1) {
        throw new ToolError(
          `${found.length} markers are named ${pyReprString(ref)} (${found.map((r) => `${r.marker_id} at ${r.timecode}`).join(", ")}); pass their marker_ids`,
        );
      }
      if (!targets.some((t) => t.marker_id === found[0]!.marker_id)) targets.push(found[0]!);
    }
  }
  const removed = call.commit((tx) => removeMarkers(tx, targets.map((t) => t.marker_id)));
  const summary = targets.length === 1 ? `Removed the ${markerLabel(targets[0]!)}.` : `Removed ${removed.length} markers.`;
  return ok(call, summary, { removed: targets, remaining: markerRows(call.doc.project).length });
}

// ---------------------------------------------------------------------------
// Selection (shared by seek, select and the read tool)
// ---------------------------------------------------------------------------

type Kind = "clip" | "transition" | "effect";
type Pair = [id: string, kind: Kind];

function selectionPairs(selection: EditorSelection): Pair[] {
  return [
    ...selection.clips.map((id) => [id, "clip"] as Pair),
    ...selection.transitions.map((id) => [id, "transition"] as Pair),
    ...selection.effects.map((id) => [id, "effect"] as Pair),
  ];
}

function selectionOf(pairs: Pair[]): EditorSelection {
  const of = (kind: Kind): string[] => pairs.filter((p) => p[1] === kind).map((p) => p[0]);
  return { clips: of("clip"), transitions: of("transition"), effects: of("effect") };
}

function samePair(a: Pair, b: Pair): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function itemEnd(item: { position?: unknown; start?: unknown; end?: unknown }): number {
  return (Number(item.position) || 0) + Math.max(0, (Number(item.end) || 0) - (Number(item.start) || 0));
}

/** `_describe_selection`: the selected clips, transitions and effects as receipts describe them. */
function describeSelection(project: Project, selection: EditorSelection): Record<string, unknown> {
  const clips = selection.clips
    .map((id) => clipById(project, id))
    .filter((c): c is Clip => Boolean(c))
    .map((clip) => {
      const row = describeClip(project, clip);
      const locked = project.layers.some((l) => Math.trunc(Number(l.number) || 0) === row.layer && Boolean(l.lock));
      return { ...row, locked };
    });
  const transitions = selection.transitions
    .map((id) => project.effects.find((t) => t.id === id))
    .filter((t): t is Transition => Boolean(t))
    .map((t) => {
      const layer = Math.trunc(Number(t.layer) || 0);
      return { transition_id: t.id, track: trackRow(project, layer).track, layer, position: roundTo(Number(t.position) || 0, 3), end: roundTo(itemEnd(t), 3) };
    });
  const effects: Record<string, unknown>[] = [];
  for (const id of selection.effects) {
    const clip = project.clips.find((c) => (c.effects ?? []).some((e) => e.id === id));
    const effect = clip?.effects.find((e) => e.id === id);
    if (clip && effect) effects.push({ effect_id: id, class_name: String(effect.class_name ?? ""), timeline_clip_id: clip.id });
  }
  return { clips, transitions, effects, count: clips.length + transitions.length + effects.length };
}

/** The host's selection, or null when the host has no editor selection. */
function hostSelection(call: ToolCall): EditorSelection | null {
  const read = call.host.ui?.selection;
  return read ? read.call(call.host.ui) : null;
}

// ---------------------------------------------------------------------------
// seek_playhead_tool
// ---------------------------------------------------------------------------

const SAVED_NOTE = "saved with the project; there is no preview player here";

function atEndError(project: Project, state: PlayerState): ToolError {
  return new ToolError(
    `nothing to play from ${state.timecode}: the playhead is at the end of the timeline (content ends at ${timecode(project, contentEnd(project))}). ` +
      "Play from the start with seek_playhead_tool to='start', play=true",
  );
}

async function seekPlayhead(call: ToolCall, input: ContractInput<"seek_playhead_tool">): Promise<ToolOutcome> {
  const marker = String(input.marker ?? "").trim();
  const track = String(input.track ?? "").trim();
  const to = input.to ?? "";
  const seconds = input.seconds ?? null;
  const frameArg = input.frame ?? null;
  const given = (
    [
      ["seconds", seconds !== null],
      ["frame", frameArg !== null],
      ["marker", Boolean(marker)],
      ["to", Boolean(to)],
    ] as const
  )
    .filter(([, set]) => set)
    .map(([name]) => name);
  if (given.length === 0) throw new ToolError("say where to go: seconds, frame, marker, or to=start/end/next_marker/previous_marker/next_edit/previous_edit");
  if (given.length > 1) throw new ToolError(`give only one of seconds, frame, marker or to (got ${given.join(", ")})`);
  if (track && to !== "next_edit" && to !== "previous_edit") throw new ToolError("track only applies to to='next_edit' / 'previous_edit'");

  const project = call.doc.project;
  const player = call.host.player;
  if (input.play && !player) {
    return unavailable(call.tool, "there is no preview player here to start playback; seek without play=true (the playhead is saved with the project)");
  }
  const state = playerState(call);
  const duration = timelineDuration(project);
  const last = lastFrame(project);
  let target: number;
  let label: string;
  let matched: MarkerRow | Record<string, never> = {};
  let note = "";

  if (to === "start") {
    target = minFrame(project);
    label = "start";
  } else if (to === "end") {
    target = last;
    label = "end";
    if (contentEnd(project) <= 0) note = "the timeline is empty";
  } else if (seconds !== null || frameArg !== null) {
    const at = frameArg !== null ? frameToSeconds(project, frameArg) : seconds!;
    if (duration && at > duration + 1e-6) {
      throw new ToolError(
        `${pyFixed(at, 3)} s is past the end of the timeline (${pyFixed(duration, 3)} s long; content ends at ${timecode(project, contentEnd(project))})`,
      );
    }
    target = frameArg !== null ? frameArg : secondsToFrame(project, at);
    if (at > contentEnd(project) + 1e-6) note = `past the end of the last clip (${timecode(project, contentEnd(project))}): the preview shows black`;
    label = "time";
  } else if (marker) {
    let rows = markersMatching(project, marker);
    if (rows.length === 0) {
      const ref = marker.toLowerCase();
      rows = markerRows(project).filter((r) => ref && r.name.toLowerCase().includes(ref));
    }
    if (rows.length === 0) throw new ToolError(`no marker with id or name ${pyReprString(marker)}; ${markerListing(markerRows(project))}`);
    if (rows.length > 1) note = `${rows.length} markers match ${pyReprString(marker)} (${rows.map((r) => r.timecode).join(", ")}); went to the first`;
    matched = rows[0]!;
    target = secondsToSeekFrame(project, rows[0]!.seconds);
    label = "marker";
  } else {
    const direction = to.startsWith("next") ? 1 : -1;
    let stops: number[];
    let what: string;
    if (to.endsWith("marker")) {
      const selection = hostSelection(call) ?? { clips: [], transitions: [], effects: [] };
      const nothing = selection.clips.length + selection.transitions.length + selection.effects.length === 0;
      stops = navigationPositions(project, selection, nothing ? last : undefined);
      what = nothing ? "marker" : "marker, selected-item edge or keyframe";
    } else {
      stops = clipEdges(project, track ? resolveLayer(project, track) : undefined);
      what = `clip edge${track ? " on that track" : ""}`;
    }
    const found = pickAdjacent(project, stops, state.seconds, state.frame, direction, last);
    if (!found) {
      throw new ToolError(`no ${what} ${direction > 0 ? "after" : "before"} ${state.timecode}; ${markerListing(markerRows(project))}`);
    }
    target = found[1];
    label = to;
    if (to.endsWith("marker")) matched = markerRows(project).find((r) => r.frame === target) ?? {};
  }

  // Validate playback before moving anything: an empty timeline or a target at its end cannot play.
  if (input.play && !state.playing) {
    if (contentEnd(project) <= 0) throw new ToolError("the timeline is empty: there is nothing to play");
    if (!(target > 0 && target <= last)) throw atEndError(project, { ...state, ...when(project, frameToSeconds(project, target)), frame: target });
  }

  const targetSeconds = frameToSeconds(project, target);
  let saved = false;
  if (player) {
    player.seek(targetSeconds);
    centerIfOffscreen(call, targetSeconds);
  } else {
    // No preview here: move the playhead the project saves (where the editors open), no undo step.
    call.doc.setUntracked(["playhead_position"], roundTo(targetSeconds, 6));
    saved = true;
  }
  let after = playerState(call);
  if (player && Math.abs(after.frame - target) > (state.playing ? pyRound(fpsOf(project) * 2 * Math.max(1, Math.abs(state.speed || 1))) : 1)) {
    if (targetSeconds > contentEnd(project) + 1e-6) {
      // The web editor's playhead stops at the end of the last clip.
      note = `the preview stops at the end of the last clip (${timecode(project, contentEnd(project))}); the playhead is there`;
    } else {
      throw new ToolError(`asked the player to go to frame ${target}, but it is at frame ${after.frame} (${after.timecode})`);
    }
  }
  let started = false;
  if (input.play && player && !player.playing) {
    player.play();
    started = true;
    after = playerState(call);
    if (!after.playing) throw new ToolError(`moved to ${after.timecode} but playback did not start`);
  }
  let where = after.timecode;
  if ("name" in matched && matched.name) where += ` (marker '${matched.name}')`;
  let summary = `Playhead at ${where}, frame ${after.frame}${after.playing ? ", playing" : ""}${saved ? ` (${SAVED_NOTE})` : ""}.`;
  const data: Record<string, unknown> = { ...after, target: label, started_playing: started };
  if ("marker_id" in matched) data.marker = matched;
  if (note) {
    data.note = note;
    summary += ` Note: ${note}.`;
  }
  if (saved) data.saved = true;
  return ok(call, summary, data);
}

/** `_center_if_offscreen`: scroll the timeline to the new playhead when it is out of view. */
function centerIfOffscreen(call: ToolCall, seconds: number): void {
  const ui = call.host.ui;
  const view = ui?.timelineView?.();
  if (!ui || !view) return;
  const [start, end] = view.visibleRange;
  if (seconds < start || seconds > end) ui.centerOnPlayhead();
}

// ---------------------------------------------------------------------------
// set_timeline_view_tool
// ---------------------------------------------------------------------------

function zoomState(view: TimelineView): Record<string, unknown> {
  return {
    seconds_per_100px: roundTo(view.secondsPer100px, 4),
    visible_seconds: roundTo(view.visibleSeconds, 3),
    visible_range: [roundTo(view.visibleRange[0], 3), roundTo(view.visibleRange[1], 3)],
  };
}

function modesOf(view: TimelineView): Record<TimelineMode, boolean | null> {
  return { snapping: view.snapping, razor: view.razor, timing: view.timing };
}

async function setTimelineView(call: ToolCall, input: ContractInput<"set_timeline_view_tool">): Promise<ToolOutcome> {
  const zoom = input.zoom ?? "";
  const steps = input.steps ?? 1;
  const visible = input.visible_seconds ?? null;
  const start = input.start_seconds ?? null;
  const end = input.end_seconds ?? null;
  const center = Boolean(input.center_on_playhead);
  const project = call.doc.project;
  const ranged = start !== null || end !== null;
  const zooms = (
    [
      ["zoom", Boolean(zoom)],
      ["visible_seconds", visible !== null],
      ["start_seconds/end_seconds", ranged],
    ] as const
  )
    .filter(([, set]) => set)
    .map(([name]) => name);
  if (zooms.length > 1) throw new ToolError(`use only one of ${zooms.join(", ")}`);
  const duration = timelineDuration(project);
  if (ranged) {
    if (start === null || end === null) throw new ToolError("give both start_seconds and end_seconds");
    if (end <= start) throw new ToolError("end_seconds must be after start_seconds");
    if (duration && start >= duration) throw new ToolError(`start_seconds is past the end of the timeline (${pyFixed(duration, 3)} s long)`);
  }
  if (steps !== 1 && zoom !== "in" && zoom !== "out") throw new ToolError("steps only applies to zoom 'in' / 'out'");
  const modes = (["snapping", "razor", "timing"] as const)
    .map((key) => [key, input[key] ?? null] as const)
    .filter((entry): entry is readonly [TimelineMode, boolean] => entry[1] !== null);
  if (zooms.length === 0 && !center && modes.length === 0) {
    throw new ToolError("nothing to change: pass zoom, visible_seconds, start_seconds/end_seconds, center_on_playhead or a mode");
  }
  const ui = call.host.ui!;
  if (!ui.timelineView || !ui.showTimelineRange || !ui.setTimelineMode) {
    return unavailable(call.tool, "this editor does not report or change its timeline view.");
  }
  const view = ui.timelineView();
  if (!view) throw new ToolError("the timeline is not ready yet");
  for (const [key, value] of modes) {
    if (view[key] === null && value) return unavailable(call.tool, `this editor has no ${key} mode; leave ${key} out.`);
  }

  const done: string[] = [];
  if (zoom === "in" || zoom === "out") {
    for (let i = 0; i < steps; i += 1) {
      if (zoom === "in") ui.zoomIn();
      else ui.zoomOut();
    }
    done.push(`zoomed ${zoom} ${steps} step${steps === 1 ? "" : "s"}`);
  } else if (zoom === "fit") {
    let last = contentEnd(project);
    if (last <= 0) {
      last = duration;
      done.push("the timeline is empty; showing all of it");
    } else {
      done.push(`fit every clip (0 to ${timecode(project, last)})`);
    }
    ui.showTimelineRange(0, last * 1.02);
  } else if (visible !== null) {
    const span = duration ? Math.min(visible, duration) : visible;
    let from = Math.max(0, playheadSeconds(call) - span / 2);
    if (duration) from = Math.max(0, Math.min(from, duration - span));
    ui.showTimelineRange(from, from + span);
    done.push(`showing ${pyG(span)} s around the playhead`);
  } else if (ranged) {
    const until = Math.min(end!, duration || end!);
    ui.showTimelineRange(start!, until);
    done.push(`showing ${timecode(project, start!)} to ${timecode(project, until)}`);
  }
  if (center) {
    ui.centerOnPlayhead();
    done.push("centered on the playhead");
  }
  const before = modesOf(view);
  for (const [key, value] of modes) {
    if ((before[key] ?? false) === value) {
      done.push(`${key} already ${value ? "on" : "off"}`);
      continue;
    }
    ui.setTimelineMode(key, value);
    done.push(`${key} ${value ? "on" : "off"}`);
  }
  const now = ui.timelineView() ?? view;
  return ok(call, `Timeline view: ${done.join("; ")}.`, { zoom: zoomState(now), modes: modesOf(now) });
}

// ---------------------------------------------------------------------------
// select_timeline_items_tool
// ---------------------------------------------------------------------------

/** `_overlaps`: an item under the moment `start`, or overlapping [start, end]. */
function overlaps(item: { position?: unknown; start?: unknown; end?: unknown }, start: number | null, end: number | null): boolean {
  if (start === null) return true;
  const position = Number(item.position) || 0;
  const stop = itemEnd(item);
  if (end === null || end <= start) return position <= start && start < stop;
  return position < end && stop > start;
}

async function resolveSelectTargets(call: ToolCall, input: ContractInput<"select_timeline_items_tool">, ids: { clips: string[]; transitions: string[]; effects: string[] }): Promise<Pair[]> {
  const project = call.doc.project;
  const targets: Pair[] = [];
  const add = (pair: Pair): void => {
    if (!targets.some((t) => samePair(t, pair))) targets.push(pair);
  };
  for (const id of ids.clips) {
    if (!clipById(project, id)) throw new ToolError(`no timeline clip with id ${pyReprString(id)}`);
    add([id, "clip"]);
  }
  for (const id of ids.transitions) {
    if (!project.effects.some((t) => t.id === id)) throw new ToolError(`no transition with id ${pyReprString(id)}`);
    add([id, "transition"]);
  }
  for (const id of ids.effects) {
    if (!project.clips.some((c) => (c.effects ?? []).some((e) => e.id === id))) throw new ToolError(`no effect with id ${pyReprString(id)} on any clip`);
    add([id, "effect"]);
  }
  const query = String(input.clip_query ?? "").trim();
  const track = String(input.track ?? "").trim();
  const start = input.start_seconds ?? null;
  const end = input.end_seconds ?? null;
  if (query) {
    add([(await targetClip(call, { clip_query: query, track })).id, "clip"]);
  } else if (track || start !== null) {
    const layer = track ? resolveLayer(project, track) : null;
    const found: [number, number, string, Kind][] = [];
    for (const clip of project.clips) {
      if (layer !== null && Math.trunc(Number(clip.layer) || 0) !== layer) continue;
      if (overlaps(clip, start, end)) found.push([Number(clip.position) || 0, Math.trunc(Number(clip.layer) || 0), clip.id, "clip"]);
    }
    if (input.include_transitions) {
      for (const transition of project.effects) {
        if (layer !== null && Math.trunc(Number(transition.layer) || 0) !== layer) continue;
        if (overlaps(transition, start, end)) found.push([Number(transition.position) || 0, Math.trunc(Number(transition.layer) || 0), transition.id, "transition"]);
      }
    }
    if (found.length === 0) {
      let where = track ? `on track ${track}` : "on any track";
      if (start !== null) where += ` between ${timecode(project, start)} and ${timecode(project, end ?? start)}`;
      throw new ToolError(`nothing to select ${where}`);
    }
    found.sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0) || (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0));
    for (const [, , id, kind] of found) add([id, kind]);
  }
  return targets;
}

/** The item and everything after it on its track (Alt+A, the timeline's selectRipple). */
function rippleFrom(project: Project, [id, kind]: Pair): Pair[] {
  const items: [Clip | Transition, Kind][] = [...project.clips.map((c) => [c, "clip"] as [Clip, Kind]), ...project.effects.map((t) => [t, "transition"] as [Transition, Kind])];
  const seed = items.find(([item, k]) => k === kind && item.id === id)?.[0];
  if (!seed) return [];
  const layer = seed.layer;
  const position = Number(seed.position) || 0;
  return items.filter(([item]) => item.layer === layer && (Number(item.position) || 0) >= position).map(([item, k]) => [item.id, k] as Pair);
}

async function selectTimelineItems(call: ToolCall, input: ContractInput<"select_timeline_items_tool">): Promise<ToolOutcome> {
  const strip = (list: readonly string[] | undefined): string[] => (list ?? []).map((i) => String(i).trim()).filter(Boolean);
  const ids = { clips: strip(input.timeline_clip_ids), transitions: strip(input.transition_ids), effects: strip(input.effect_ids) };
  const mode = input.mode ?? "replace";
  const start = input.start_seconds ?? null;
  const end = input.end_seconds ?? null;
  const hasTarget = Boolean(
    ids.clips.length || ids.transitions.length || ids.effects.length || String(input.clip_query ?? "").trim() || String(input.track ?? "").trim() || start !== null,
  );
  if (end !== null && start === null) throw new ToolError("end_seconds needs start_seconds");
  if (start !== null && end !== null && end < start) throw new ToolError("end_seconds must not be before start_seconds");
  if ((mode === "all" || mode === "none") && hasTarget) {
    throw new ToolError(`mode='${mode}' takes no targets; use mode='replace' with track/ids to select part of the timeline`);
  }
  if ((mode === "replace" || mode === "add" || mode === "remove") && !hasTarget) {
    throw new ToolError(`mode='${mode}' needs something to select: ids, clip_query, track or a time range`);
  }
  const ui = call.host.ui!;
  if (!ui.selection || !ui.setSelection) return unavailable(call.tool, "this editor does not let tools read or change its selection.");
  const targets = hasTarget ? await resolveSelectTargets(call, input, ids) : [];
  const project = call.doc.project;
  const before = selectionPairs(ui.selection());

  let next: Pair[];
  if (mode === "none") {
    next = [];
  } else if (mode === "all") {
    if (project.clips.length === 0 && project.effects.length === 0) throw new ToolError("the timeline has no clips or transitions to select");
    next = [...project.clips.map((c) => [c.id, "clip"] as Pair), ...project.effects.map((t) => [t.id, "transition"] as Pair)];
  } else if (mode === "replace") {
    next = targets;
  } else if (mode === "add") {
    next = [...before, ...targets.filter((t) => !before.some((b) => samePair(b, t)))];
  } else if (mode === "remove") {
    next = before.filter((b) => !targets.some((t) => samePair(b, t)));
  } else {
    const seeds = targets.length > 0 ? targets : before.filter((p) => p[1] === "clip" || p[1] === "transition");
    if (seeds.length === 0) throw new ToolError("mode='ripple' needs clips: pass ids/track, or select something first");
    next = [...before];
    for (const seed of seeds) {
      if (seed[1] !== "clip" && seed[1] !== "transition") continue;
      for (const pair of [seed, ...rippleFrom(project, seed)]) if (!next.some((p) => samePair(p, pair))) next.push(pair);
    }
  }
  ui.setSelection(selectionOf(next));
  if (input.show_properties) ui.showProperties?.();

  const selection = describeSelection(project, ui.selection());
  const parts: string[] = [];
  for (const [key, noun] of [
    ["clips", "clip"],
    ["transitions", "transition"],
    ["effects", "effect"],
  ] as const) {
    const n = (selection[key] as unknown[]).length;
    if (n) parts.push(`${n} ${noun}${n === 1 ? "" : "s"}`);
  }
  let summary = `Selection: ${parts.length > 0 ? parts.join(", ") : "nothing"}.`;
  if (mode === "remove" && !targets.some((t) => before.some((b) => samePair(b, t)))) summary += " (none of those were selected)";
  return ok(call, summary, { mode, selection });
}

// ---------------------------------------------------------------------------
// get_playhead_and_selection_tool
// ---------------------------------------------------------------------------

async function getPlayheadAndSelection(call: ToolCall): Promise<ToolOutcome> {
  const project = call.doc.project;
  const state = playerState(call);
  const markers = markerRows(project);
  const before = markers.filter((r) => r.frame < state.frame);
  const after = markers.filter((r) => r.frame > state.frame);
  const read = hostSelection(call);
  const selection = read ? describeSelection(project, read) : null;
  const view = call.host.ui?.timelineView?.() ?? null;
  const editor = Boolean(call.host.player);
  const data = {
    playhead: { frame: state.frame, seconds: state.seconds, timecode: state.timecode },
    playback: { playing: state.playing, speed: state.speed },
    selection,
    view: view ? { zoom: zoomState(view), modes: modesOf(view) } : null,
    timeline: {
      content_end: when(project, contentEnd(project)),
      duration: roundTo(timelineDuration(project), 3),
      markers: markers.length,
      previous_marker: before[before.length - 1] ?? null,
      next_marker: after[0] ?? null,
    },
  };
  const count = selection ? Number(selection.count) : 0;
  const head = `Playhead at ${state.timecode} (frame ${state.frame})`;
  if (!editor) {
    return ok(call, `${head}, saved with the project: no editor is open here, so there is no playback, selection or timeline view.`, { ...data, saved: true });
  }
  const selected = selection ? `${count} item(s) selected` : "the selection is not available here";
  return ok(call, `${head}, ${state.playing ? "playing" : "paused"}; ${selected}.`, data);
}

export const tracksNavTools: CatalogTool[] = [
  contractTool("update_track_tool", { annotations: EDIT, run: (call, input) => run(() => updateTrack(call, input)) }),
  contractTool("remove_track_tool", { annotations: EDIT, run: (call, input) => run(() => removeTrackTool(call, input)) }),
  contractTool("update_marker_tool", { annotations: EDIT, run: (call, input) => run(() => updateMarkerTool(call, input)) }),
  contractTool("remove_marker_tool", { annotations: EDIT, run: (call, input) => run(() => removeMarkerTool(call, input)) }),
  contractTool("seek_playhead_tool", { annotations: VIEW, run: (call, input) => run(() => seekPlayhead(call, input)) }),
  contractTool("select_timeline_items_tool", { annotations: VIEW, requires: ["ui"], run: (call, input) => run(() => selectTimelineItems(call, input)) }),
  contractTool("set_timeline_view_tool", { annotations: VIEW, requires: ["ui"], run: (call, input) => run(() => setTimelineView(call, input)) }),
  contractTool("get_playhead_and_selection_tool", { annotations: READ, run: (call) => run(() => getPlayheadAndSelection(call)) }),
];
