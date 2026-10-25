/**
 * Direct editing tools for coding agents (Claude Code, Codex, Cursor) and
 * the CLI: precise operations the desktop contract has no tool for. They
 * call the same ops as the web editor's gestures and return contract-3
 * receipts. Not exposed to the Zenvi Assistant (the backend does not know
 * these names).
 */

import { z } from "zod";
import type { Project } from "../../model/types.js";
import { Interpolation } from "../../model/types.js";
import { EFFECTS } from "../../effects/registry.js";
import { fadeClip, moveClip, setClipProperty, splitClip, sliceAllAt, trimClip, trimClipEdge } from "../../ops/clips.js";
import { removeEffect, setEffectProperty } from "../../ops/effects.js";
import { addTransition } from "../../ops/transitions.js";
import { timelineEnd } from "../../timeline/queries.js";
import { directTool, type CatalogTool, type ToolCall } from "../define.js";
import { projectFps } from "../frame-time.js";
import { applied } from "../receipt.js";
import { buildTrackStack, normalizeTrackOrLayerArg } from "../tracks.js";

const EDIT = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;
const ADD = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } as const;

const clipId = z.string().min(1).describe("Timeline clip id (from describe_project_tool, list_clips_tool or a receipt).");
const track = z
  .union([z.string(), z.int()])
  .describe("Track: layer_number (preferred), track id, exact label, or ui_track counted from the bottom (1 = bottom).");
const interpolation = z.enum(["bezier", "linear", "constant"]).describe("Interpolation of a new keyframe point.");

const INTERPOLATIONS = { bezier: Interpolation.BEZIER, linear: Interpolation.LINEAR, constant: Interpolation.CONSTANT } as const;

function resolveTrack(project: Project, raw: string | number | undefined): { layer?: number; error?: string } {
  if (raw === undefined || String(raw).trim() === "") return {};
  const r = normalizeTrackOrLayerArg(String(raw), project.layers);
  return r.error ? { error: r.error } : { layer: r.layer };
}

function requireClip(call: ToolCall, id: string) {
  return (call.doc.project.clips ?? []).find((c) => String(c.id) === id);
}

export const directTools: CatalogTool[] = [
  directTool({
    name: "describe_project_tool",
    title: "Describe project",
    description:
      "Compact overview of the whole project for planning edits: settings, tracks bottom to top with their clips " +
      "(id, file, timeline window, source window, effects), transitions, markers and media-bin files. Use this before editing.",
    input: z.strictObject({}),
    annotations: READ,
    run: (call) => {
      const p = call.doc.project;
      const fps = projectFps(p);
      const files = new Map((p.files ?? []).map((f) => [String(f.id), f]));
      const stack = buildTrackStack(p.layers);
      const tracks = stack.map((t) => ({
        layer: t.layer_number,
        ui_track: t.ui_track,
        label: t.label,
        id: t.track_id,
        locked: Boolean((p.layers ?? []).find((l) => l.number === t.layer_number)?.lock),
        clips: (p.clips ?? [])
          .filter((c) => c.layer === t.layer_number)
          .sort((a, b) => a.position - b.position)
          .map((c) => ({
            id: c.id,
            title: c.title ?? "",
            file_id: c.file_id,
            file: String(files.get(String(c.file_id))?.name || String(files.get(String(c.file_id))?.path ?? "").split(/[\\/]/).pop() || ""),
            position: c.position,
            end: c.position + (c.end - c.start),
            source: [c.start, c.end],
            effects: (c.effects ?? []).map((e) => ({ id: e.id, class_name: e.class_name })),
          })),
      }));
      const data = {
        profile: p.profile,
        width: p.width,
        height: p.height,
        fps: `${fps.num}/${fps.den}`,
        duration: timelineEnd(p),
        tracks,
        transitions: (p.effects ?? []).map((t) => ({ id: t.id, title: t.title ?? "", layer: t.layer, position: t.position, duration: t.end - t.start })),
        markers: (p.markers ?? []).map((m) => ({ id: m.id, position: m.position, label: m.label ?? "" })),
        files: (p.files ?? []).map((f) => ({
          id: f.id,
          name: String(f.name || String(f.path ?? "").split(/[\\/]/).pop() || ""),
          media_type: f.media_type,
          duration: Number(f.duration) || 0,
          subclip: Boolean(f.zenvi_subclip),
        })),
      };
      const clipCount = tracks.reduce((n, t) => n + t.clips.length, 0);
      return applied(
        "describe_project_tool",
        `${p.width}x${p.height} ${data.fps} fps, ${tracks.length} track(s), ${clipCount} clip(s), ${data.transitions.length} transition(s), ${data.files.length} file(s); content ends at ${data.duration.toFixed(2)}s.`,
        { data },
        0,
      );
    },
  }),

  directTool({
    name: "list_effects_tool",
    title: "List effects",
    description: "List the libopenshot effects add_effect_tool accepts (class name, category, whether this surface renders it, parameters).",
    input: z.strictObject({ category: z.enum(["video", "audio"]).optional().describe("Only video or audio effects.") }),
    annotations: READ,
    run: (_call, input) => {
      const effects = EFFECTS.filter((e) => !input.category || e.category === input.category).map((e) => ({
        class_name: e.className,
        name: e.name,
        category: e.category,
        renders_on_web: e.supported.web,
        needs_desktop_dialog: e.needsDialog,
        params: e.params.filter((prm) => !prm.common && !prm.readonly).map((prm) => ({ key: prm.key, type: prm.type, default: prm.default, min: prm.min, max: prm.max })),
      }));
      return applied("list_effects_tool", `${effects.length} effect(s).`, { data: { effects } }, 0);
    },
  }),

  directTool({
    name: "move_clip_tool",
    title: "Move clip",
    description: "Move a clip to a new timeline position and/or another track. Positions snap to the frame grid.",
    input: z.strictObject({
      clip_id: clipId,
      position_seconds: z.number().min(0).optional().describe("New timeline start, seconds."),
      track: track.optional(),
    }),
    annotations: EDIT,
    run: (call, input) => {
      if (!requireClip(call, input.clip_id)) return `Error: No timeline clip with id='${input.clip_id}'.`;
      const t = resolveTrack(call.doc.project, input.track);
      if (t.error) return t.error;
      if (input.position_seconds === undefined && t.layer === undefined) return "Error: Pass position_seconds and/or track.";
      call.commit((tx) => moveClip(tx, input.clip_id, { position: input.position_seconds, layer: t.layer }));
      return `Moved clip ${input.clip_id}.`;
    },
  }),

  directTool({
    name: "trim_clip_tool",
    title: "Trim clip",
    description:
      "Change a clip's source in/out points (start_seconds / end_seconds, SOURCE seconds, position unchanged), " +
      "or drag one edge to a TIMELINE time (edge + at_seconds) like the timeline trim handles.",
    input: z.strictObject({
      clip_id: clipId,
      start_seconds: z.number().min(0).optional().describe("New source in point, seconds."),
      end_seconds: z.number().min(0).optional().describe("New source out point, seconds."),
      edge: z.enum(["left", "right"]).optional().describe("Edge to drag (with at_seconds)."),
      at_seconds: z.number().optional().describe("Timeline seconds to drag the edge to."),
    }),
    annotations: EDIT,
    run: (call, input) => {
      if (!requireClip(call, input.clip_id)) return `Error: No timeline clip with id='${input.clip_id}'.`;
      if (input.edge !== undefined || input.at_seconds !== undefined) {
        if (input.edge === undefined || input.at_seconds === undefined) return "Error: edge and at_seconds go together.";
        call.commit((tx) => trimClipEdge(tx, input.clip_id, input.edge!, input.at_seconds!));
        return `Trimmed the ${input.edge} edge of clip ${input.clip_id} to ${input.at_seconds}s.`;
      }
      if (input.start_seconds === undefined && input.end_seconds === undefined) return "Error: Pass start_seconds/end_seconds, or edge + at_seconds.";
      call.commit((tx) => trimClip(tx, input.clip_id, { start: input.start_seconds, end: input.end_seconds }));
      return `Trimmed clip ${input.clip_id}.`;
    },
  }),

  directTool({
    name: "split_clip_tool",
    title: "Split clip",
    description:
      "Cut a clip at a TIMELINE time (not just the playhead). keep=both (default) leaves two clips; left/right keep one side. " +
      "Without clip_id, cuts every clip and transition under that time (optionally on one track).",
    input: z.strictObject({
      clip_id: clipId.optional(),
      at_seconds: z.number().min(0).describe("Timeline seconds of the cut."),
      keep: z.enum(["both", "left", "right"]).optional().describe("Which side(s) to keep (default both)."),
      track: track.optional(),
    }),
    annotations: EDIT,
    run: (call, input) => {
      const keep = input.keep ?? "both";
      if (input.clip_id) {
        if (!requireClip(call, input.clip_id)) return `Error: No timeline clip with id='${input.clip_id}'.`;
        const result = call.commit((tx) => splitClip(tx, input.clip_id!, input.at_seconds, keep));
        return applied("split_clip_tool", `Split clip ${input.clip_id} at ${input.at_seconds}s (keep ${keep}).`, { data: result });
      }
      const t = resolveTrack(call.doc.project, input.track);
      if (t.error) return t.error;
      const result = call.commit((tx) => sliceAllAt(tx, input.at_seconds, t.layer !== undefined ? { keep, layers: [t.layer] } : { keep }));
      const n = result.clips.length + result.transitions.length;
      if (n === 0) return "No clip or transition at that time.";
      return applied("split_clip_tool", `Split ${n} item(s) at ${input.at_seconds}s (keep ${keep}).`, { data: result });
    },
  }),

  directTool({
    name: "set_clip_property_tool",
    title: "Set clip property",
    description:
      "Set one clip property the way the Properties panel does. Keyframed properties (alpha, scale_x, location_x, rotation, volume, time, …) " +
      "take a number: with at_seconds (timeline) or frame (1-based clip frame) a keyframe is written there, otherwise the value becomes constant. " +
      "Plain properties (gravity, scale, anchor, composite, waveform, title, …) are set outright. Colors take #rrggbb.",
    input: z.strictObject({
      clip_id: clipId,
      property: z.string().min(1).describe("Clip property key, e.g. alpha, scale_x, location_y, rotation, volume, gravity, title."),
      value: z.union([z.number(), z.string(), z.boolean()]).describe("New value."),
      at_seconds: z.number().optional().describe("Timeline seconds of the keyframe."),
      frame: z.int().min(1).optional().describe("1-based clip frame of the keyframe."),
      interpolation: interpolation.optional(),
    }),
    annotations: EDIT,
    run: (call, input) => {
      if (!requireClip(call, input.clip_id)) return `Error: No timeline clip with id='${input.clip_id}'.`;
      if (input.at_seconds !== undefined && input.frame !== undefined) return "Error: Pass at_seconds or frame, not both.";
      call.commit((tx) =>
        setClipProperty(tx, input.clip_id, input.property, input.value, {
          ...(input.at_seconds !== undefined ? { time: input.at_seconds } : {}),
          ...(input.frame !== undefined ? { frame: input.frame } : {}),
          ...(input.interpolation ? { interpolation: INTERPOLATIONS[input.interpolation] } : {}),
        }),
      );
      return `Set ${input.property} on clip ${input.clip_id}.`;
    },
  }),

  directTool({
    name: "set_effect_property_tool",
    title: "Set effect property",
    description: "Set one parameter of a clip effect (keyframe-aware like set_clip_property_tool). Effect ids come from describe_project_tool or add_effect_tool.",
    input: z.strictObject({
      effect_id: z.string().min(1).describe("Clip effect id."),
      property: z.string().min(1).describe("Effect parameter key (see list_effects_tool)."),
      value: z.union([z.number(), z.string(), z.boolean()]).describe("New value."),
      at_seconds: z.number().optional().describe("Timeline seconds of the keyframe."),
      frame: z.int().min(1).optional().describe("1-based frame of the parent clip."),
      interpolation: interpolation.optional(),
    }),
    annotations: EDIT,
    run: (call, input) => {
      if (input.at_seconds !== undefined && input.frame !== undefined) return "Error: Pass at_seconds or frame, not both.";
      call.commit((tx) =>
        setEffectProperty(tx, input.effect_id, input.property, input.value, {
          ...(input.at_seconds !== undefined ? { time: input.at_seconds } : {}),
          ...(input.frame !== undefined ? { frame: input.frame } : {}),
          ...(input.interpolation ? { interpolation: INTERPOLATIONS[input.interpolation] } : {}),
        }),
      );
      return `Set ${input.property} on effect ${input.effect_id}.`;
    },
  }),

  directTool({
    name: "remove_effect_tool",
    title: "Remove effect",
    description: "Remove one effect from its clip.",
    input: z.strictObject({ effect_id: z.string().min(1).describe("Clip effect id.") }),
    annotations: EDIT,
    run: (call, input) => {
      const result = call.commit((tx) => removeEffect(tx, input.effect_id));
      return applied("remove_effect_tool", `Removed effect ${input.effect_id} from clip ${result.clipId}.`, { data: result });
    },
  }),

  directTool({
    name: "fade_clip_tool",
    title: "Fade clip",
    description: "Fade a clip in and/or out (picture and sound together, like the Fade menu). 0 removes that fade.",
    input: z.strictObject({
      clip_id: clipId,
      fade_in_seconds: z.number().min(0).optional().describe("Fade-in length from the clip start."),
      fade_out_seconds: z.number().min(0).optional().describe("Fade-out length before the clip end."),
      video: z.boolean().optional().describe("Fade the picture (default: when the clip has video)."),
      audio: z.boolean().optional().describe("Fade the sound (default: when the clip has audio)."),
    }),
    annotations: EDIT,
    run: (call, input) => {
      if (!requireClip(call, input.clip_id)) return `Error: No timeline clip with id='${input.clip_id}'.`;
      if (input.fade_in_seconds === undefined && input.fade_out_seconds === undefined) return "Error: Pass fade_in_seconds and/or fade_out_seconds.";
      call.commit((tx) =>
        fadeClip(tx, input.clip_id, {
          fadeIn: input.fade_in_seconds,
          fadeOut: input.fade_out_seconds,
          video: input.video,
          audio: input.audio,
        }),
      );
      return `Faded clip ${input.clip_id}.`;
    },
  }),

  directTool({
    name: "add_transition_tool",
    title: "Add transition",
    description:
      "Add a transition (luma mask) at an exact place: track, timeline position and length. transition is a catalog id " +
      "(common/fade, extra/<name>) or a name. direction=in reveals the clip (default at a clip's start), out hides it.",
    input: z.strictObject({
      track: track,
      position_seconds: z.number().min(0).describe("Timeline start, seconds."),
      duration_seconds: z.number().positive().describe("Length, seconds."),
      transition: z.string().min(1).describe("Catalog id or name, e.g. common/fade or 'wipe left to right'."),
      direction: z.enum(["in", "out"]).optional().describe("Default: oriented like a desktop drop."),
    }),
    annotations: ADD,
    run: (call, input) => {
      const t = resolveTrack(call.doc.project, input.track);
      if (t.error) return t.error;
      if (t.layer === undefined) return "Error: track is required.";
      const transition = call.commit((tx) =>
        addTransition(tx, {
          layer: t.layer!,
          position: input.position_seconds,
          duration: input.duration_seconds,
          maskId: input.transition,
          ...(input.direction ? { direction: input.direction } : {}),
        }),
      );
      return applied("add_transition_tool", `Added transition ${transition.id} (${String(transition.title ?? input.transition)}).`, {
        data: { transitionId: transition.id },
      });
    },
  }),

  directTool({
    name: "probe_media_tool",
    title: "Probe media",
    description: "Read a media file's stream info (duration, size, fps, codecs, audio) without importing it.",
    input: z.strictObject({ path: z.string().min(1).describe("Media path or URL the host can read.") }),
    annotations: READ,
    requires: ["media"],
    run: async (call, input) => {
      const info = await call.host.media!.probe(input.path);
      const fps = info.fps && info.fps.den ? `${info.fps.num}/${info.fps.den}` : "?";
      return applied(
        "probe_media_tool",
        `${input.path}: ${info.has_video ? `${info.width}x${info.height} ${fps} fps` : "no video"}, ` +
          `${info.has_audio ? `${info.channels} ch ${info.sample_rate} Hz` : "no audio"}, ${Number(info.duration).toFixed(2)}s.`,
        { data: info },
        0,
      );
    },
  }),
];

