/**
 * Timeline structure tools: add_track_tool, add_marker_tool,
 * delete_from_timeline_tool (+ its deprecated aliases remove_clip_tool and
 * delete_clips_on_track_tool), slice_clip_at_playhead_tool.
 *
 * Ports of zenvi-core src/classes/tool_handlers.py (ref b63c39be7): add_track
 * (actionAddTrackBelow_trigger), add_marker (actionAddMarker_trigger),
 * delete_from_timeline / _delete_one_clip / _delete_whole_track,
 * slice_clip_at_playhead.
 */

import type { Project } from "../../model/types.js";
import { deleteClips, sliceAllAt, splitClip } from "../../ops/clips.js";
import { addMarker } from "../../ops/markers.js";
import { addTrack } from "../../ops/tracks.js";
import { removeTransition } from "../../ops/transitions.js";
import { contractTool, type CatalogTool, type ToolCall } from "../define.js";
import { pyFixed, pyReprString } from "../pyfmt.js";
import { formatTrackLabelForLlm, lockedTrackError, normalizeTrackOrLayerArg } from "../tracks.js";
import { playheadSeconds, resolveClip, selectedTrack, text } from "./common.js";
import { parseSecondsArg, TimeArgError } from "../placement.js";

interface DeleteArgs {
  timeline_clip_id?: string;
  clip_query?: string;
  track?: string;
  scope?: "auto" | "clip" | "track";
  occurrence?: string | number;
  position_near?: string | number | null;
  include_transitions?: boolean;
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
  call.commit((tx) => deleteClips(tx, [String(clip.id)]));
  return (
    `Deleted timeline clip ${String(clip.id)} (${pyReprString(title)}) from track ${trackLabel} ` +
    `at ${pyFixed(position, 2)}s. Other clips on that track are unchanged ` +
    "(gap left, no ripple). 1 undo step."
  );
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

export const timelineTools: CatalogTool[] = [
  contractTool("add_track_tool", {
    annotations: ADDITIVE,
    run: (call, input) => {
      // label is a web extra (the desktop's add_track takes no arguments).
      const label = text(input.label);
      const selected = selectedTrack(call);
      call.commit((tx) =>
        addTrack(tx, selected ? { below: Math.trunc(Number(selected.number)), label: label || undefined } : { label: label || undefined }),
      );
      return "Track added.";
    },
  }),

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
      const label = text(input.label) || text(input.text);
      call.commit((tx) => addMarker(tx, Math.max(0, position), label || undefined));
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
