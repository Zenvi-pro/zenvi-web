/**
 * Timeline structure tools: add_track_tool, add_marker_tool,
 * delete_from_timeline_tool (+ its deprecated aliases remove_clip_tool and
 * delete_clips_on_track_tool), slice_clip_at_playhead_tool.
 *
 * Ports of zenvi-core: add_track and add_marker from develop 1f80cb3d0
 * editor_tools/tracks_nav.py; from src/classes/tool_handlers.py (ref
 * b63c39be7) delete_from_timeline / _delete_one_clip / _delete_whole_track
 * (with develop's ripple), slice_clip_at_playhead.
 */

import type { Project } from "../../model/types.js";
import { deleteClips, sliceAllAt, splitClip } from "../../ops/clips.js";
import { addMarker } from "../../ops/markers.js";
import { addTrack, type AddTrackOptions } from "../../ops/tracks.js";
import { removeTransition } from "../../ops/transitions.js";
import { sortedLayers } from "../../timeline/queries.js";
import { contractTool, type CatalogTool, type ToolCall } from "../define.js";
import { pyFixed, pyReprString } from "../pyfmt.js";
import { formatTrackLabelForLlm, lockedTrackError, normalizeTrackOrLayerArg } from "../tracks.js";
import { boolArg, playheadSeconds, resolveClip, text } from "./common.js";
import { parseSecondsArg, TimeArgError } from "../placement.js";

interface DeleteArgs {
  timeline_clip_id?: string;
  clip_query?: string;
  track?: string;
  scope?: "auto" | "clip" | "track";
  occurrence?: string | number;
  position_near?: string | number | null;
  include_transitions?: boolean;
  /** Close the gap the deleted clip leaves (one clip only; zenvi-core develop timeline_ops.close_gap_at). */
  ripple?: string | boolean;
}

function layerOf(value: unknown): number {
  const n = Math.trunc(Number(value ?? 0));
  return Number.isFinite(n) ? n : 0;
}

async function deleteOneClip(call: ToolCall, args: DeleteArgs): Promise<string> {
  const resolved = await resolveClip(call, args);
  if (!resolved.ok) return resolved.error || "Error: Could not resolve timeline clip.";
  const project = call.doc.project;
  const clip = resolved.clip;
  const layer = layerOf(clip.layer);
  const position = Number(clip.position) || 0;
  const title = String(clip.title || (clip as { label?: unknown }).label || "clip");
  const locked = lockedTrackError(layer, project.layers);
  if (locked) return locked;
  const trackLabel = formatTrackLabelForLlm(layer, project.layers);
  const ripple = boolArg(args.ripple);
  const positions = (p: Project): Map<string, number> =>
    new Map([...p.clips, ...p.effects].filter((item) => layerOf(item.layer) === layer).map((item) => [String(item.id), Number(item.position)]));
  const before = positions(project);
  call.commit((tx) => deleteClips(tx, [String(clip.id)], { ripple }));
  const head = `Deleted timeline clip ${String(clip.id)} (${pyReprString(title)}) from track ${trackLabel} at ${pyFixed(position, 2)}s`;
  if (ripple) {
    const after = positions(call.doc.project);
    const moved = [...after].filter(([id, pos]) => before.get(id) !== pos).length;
    return `${head} and closed the gap: ${moved} later item(s) on that track moved left. 1 undo step.`;
  }
  return `${head}. Other clips on that track are unchanged (gap left, no ripple). 1 undo step.`;
}

function deleteWholeTrack(call: ToolCall, track: string, includeTransitions: boolean): string {
  const project: Project = call.doc.project;
  const resolved = normalizeTrackOrLayerArg(track, project.layers);
  if (resolved.error) return resolved.error;
  if (resolved.layer === undefined) return "Error: Unknown track or layer.";
  const layer = resolved.layer;
  const locked = lockedTrackError(layer, project.layers);
  if (locked) return locked;
  const trackLabel = formatTrackLabelForLlm(layer, project.layers);
  const clipIds = (project.clips ?? []).filter((c) => layerOf(c.layer) === layer).map((c) => String(c.id));
  const transitionIds = includeTransitions
    ? (project.effects ?? []).filter((t) => layerOf(t.layer) === layer).map((t) => String(t.id))
    : [];
  if (clipIds.length > 0 || transitionIds.length > 0) {
    call.commit((tx) => {
      // Transitions first: they may reference the clips' time ranges.
      for (const id of transitionIds) removeTransition(tx, id);
      if (clipIds.length > 0) deleteClips(tx, clipIds);
    });
  }
  return `Deleted ${clipIds.length} clips and ${transitionIds.length} transitions on track ${trackLabel}. 1 undo step.`;
}

async function deleteFromTimeline(call: ToolCall, args: DeleteArgs): Promise<string> {
  const hasClipTarget = Boolean(text(args.timeline_clip_id) || text(args.clip_query));
  const hasTrack = Boolean(text(args.track));
  let mode = String(args.scope ?? "auto").trim().toLowerCase();
  if (!["auto", "clip", "track"].includes(mode)) {
    return `Error: scope must be 'auto', 'clip' or 'track' (got ${pyReprString(String(args.scope))}).`;
  }
  if (mode === "auto") mode = hasClipTarget ? "clip" : hasTrack ? "track" : "";
  if (!mode) {
    return (
      "Error: delete_from_timeline_tool needs a target. Pass " +
      "timeline_clip_id (from list_clips_tool) or clip_query to " +
      "delete one placement, or track to clear a whole track."
    );
  }
  if (mode === "track") {
    if (!hasTrack) return "Error: scope='track' needs track.";
    if (hasClipTarget) {
      return (
        "Error: scope='track' clears the whole track, but a single " +
        "clip was also named (timeline_clip_id/clip_query). Drop the " +
        "clip target to clear the track, or use scope='clip' to " +
        "delete just that clip."
      );
    }
    return deleteWholeTrack(call, text(args.track), args.include_transitions ?? true);
  }
  if (!hasClipTarget) {
    return (
      "Error: scope='clip' needs timeline_clip_id or clip_query. Use " +
      "list_clips_tool to get a timeline_clip_id, or pass clip_query " +
      "with track/occurrence/position_near."
    );
  }
  return deleteOneClip(call, args);
}

const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;
const ADDITIVE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

/** "track 3 ('Music')": a track by its UI number (1 = bottom), like the desktop's receipts. */
function trackTitle(project: Project, layerId: string): string {
  const stack = sortedLayers(project);
  const index = stack.findIndex((l) => l.id === layerId);
  const label = stack[index]?.label;
  return `track ${index + 1}${label ? ` (${pyReprString(label)})` : ""}`;
}

const TRACK_REF = "a UI track number (1 = bottom), track name, track id (L3) or layer number";

export const timelineTools: CatalogTool[] = [
  // zenvi-core develop editor_tools/tracks_nav.py add_track (track_ops.insert_track).
  contractTool("add_track_tool", {
    annotations: ADDITIVE,
    run: (call, input) => {
      const position = input.position ?? "top";
      const relativeTo = text(input.relative_to);
      // label: the web's older name for `name`.
      const name = text(input.name) || text(input.label);
      const count = input.count ?? 1;
      let relative: number | undefined;
      let relativeId = "";
      if (position === "above" || position === "below") {
        if (!relativeTo) return `Error: position='${position}' needs relative_to: the track to add it ${position} (${TRACK_REF}).`;
        const resolved = normalizeTrackOrLayerArg(relativeTo, call.doc.project.layers);
        if (resolved.error) return resolved.error;
        const reference = call.doc.project.layers.find((l) => l.number === resolved.layer);
        if (!reference) return `Error: Unknown track ${pyReprString(relativeTo)}.`;
        relative = reference.number;
        relativeId = reference.id;
      } else if (relativeTo) {
        return `Error: relative_to only applies to position 'above' or 'below'; got position='${position}'.`;
      }
      const upward = position === "top" || position === "above";
      const created = call.commit((tx) => {
        const ids: string[] = [];
        for (let i = 0; i < count; i += 1) {
          // Several named tracks read '<name> 1' .. '<name> N' bottom to top, whichever way the block grows.
          const label = (count > 1 && name ? `${name} ${upward ? i + 1 : count - i}` : name) || undefined;
          let at: AddTrackOptions = {};
          if (ids.length > 0) {
            // Keep the block together: next to the previous new track (found by id; numbers may have moved).
            const previous = tx.project.layers.find((l) => l.id === ids[ids.length - 1])!;
            at = upward ? { above: previous.number } : { below: previous.number };
          } else if (position === "bottom") {
            const lowest = sortedLayers(tx.project)[0];
            if (lowest) at = { below: lowest.number };
          } else if (relative !== undefined) {
            at = position === "above" ? { above: relative } : { below: relative };
          }
          ids.push(addTrack(tx, { ...at, label }).id);
        }
        return ids;
      });
      const project = call.doc.project;
      const titles = created.map((id) => trackTitle(project, id));
      // The reference track by its number after the insert.
      const where = relativeId ? `${position} ${trackTitle(project, relativeId)}` : `at the ${position}`;
      const head = created.length === 1 ? `Added ${titles[0]} ${where}.` : `Added ${created.length} tracks (${titles.join(", ")}) ${where}.`;
      return `${head} Track numbers count from the bottom.`;
    },
  }),

  // zenvi-core develop editor_tools/tracks_nav.py add_marker.
  contractTool("add_marker_tool", {
    annotations: ADDITIVE,
    run: (call, input) => {
      let position: number;
      try {
        position = parseSecondsArg(input.position_seconds, null, "position_seconds") ?? playheadSeconds(call);
      } catch (error) {
        if (error instanceof TimeArgError) return `Error: ${error.message}`;
        throw error;
      }
      // The web editor shows a marker's `label`; label and text are the web's older names for `name`.
      const label = text(input.name) || text(input.label) || text(input.text);
      const color = input.color ?? "blue";
      call.commit((tx) => addMarker(tx, Math.max(0, position), label || undefined, { icon: `${color}.png`, vector: color }));
      return "Marker added.";
    },
  }),

  contractTool("delete_from_timeline_tool", {
    annotations: DESTRUCTIVE,
    run: (call, input) => deleteFromTimeline(call, input as DeleteArgs),
  }),

  contractTool("remove_clip_tool", {
    annotations: DESTRUCTIVE,
    deprecated: true,
    run: (call, input) =>
      deleteFromTimeline(call, {
        timeline_clip_id: input.timeline_clip_id,
        clip_query: input.clip_query,
        track: input.track,
        scope: "clip",
        occurrence: input.occurrence,
        position_near: input.position_near,
      }),
  }),

  contractTool("delete_clips_on_track_tool", {
    annotations: DESTRUCTIVE,
    deprecated: true,
    run: (call, input) => {
      if (!text(input.track)) return "Error: track is required.";
      return deleteFromTimeline(call, { track: input.track, scope: "track", include_transitions: input.include_transitions ?? true });
    },
  }),

  contractTool("slice_clip_at_playhead_tool", {
    annotations: ADDITIVE,
    run: async (call, input) => {
      const project = call.doc.project;
      const at = playheadSeconds(call);
      // query.py `intersect`: position <= t <= position + (end - start).
      const covers = (item: { position?: unknown; start?: unknown; end?: unknown }): boolean => {
        const pos = Number(item.position) || 0;
        return pos <= at && at <= pos + ((Number(item.end) || 0) - (Number(item.start) || 0));
      };
      // The desktop slices everything under the playhead; the contract also lets the
      // agent aim at one clip (timeline_clip_id / clip_query) or one track.
      if (text(input.timeline_clip_id) || text(input.clip_query)) {
        const resolved = await resolveClip(call, input);
        if (!resolved.ok) return resolved.error;
        if (!covers(resolved.clip)) return "No clip or transition at the playhead.";
        const clipId = String(resolved.clip.id);
        call.commit((tx) => splitClip(tx, clipId, at, "both"));
        return "Sliced 1 item(s) at the playhead; both sides kept.";
      }
      let layers: number[] | undefined;
      if (text(input.track)) {
        const track = normalizeTrackOrLayerArg(text(input.track), project.layers);
        if (track.error) return track.error;
        if (track.layer !== undefined) layers = [track.layer];
      }
      const onTrack = (layer: unknown): boolean => !layers || layers.includes(layerOf(layer));
      const clips = (project.clips ?? []).filter((c) => covers(c) && onTrack(c.layer));
      const transitions = (project.effects ?? []).filter((t) => covers(t) && onTrack(t.layer));
      if (clips.length === 0 && transitions.length === 0) return "No clip or transition at the playhead.";
      call.commit((tx) => sliceAllAt(tx, at, layers ? { keep: "both", layers } : { keep: "both" }));
      return `Sliced ${clips.length + transitions.length} item(s) at the playhead; both sides kept.`;
    },
  }),
];
