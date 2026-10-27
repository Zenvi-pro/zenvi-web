/**
 * Motion transition tools: list_motion_transitions_tool,
 * apply_motion_transition_tool, apply_motion_transitions_tool,
 * remove_motion_transition_tool.
 *
 * Direct tools (not in the desktop contract): whips, zoom punches, spins,
 * glitches and flashes on a seamless cut, made of clip keyframes and
 * libopenshot effects (ops/motion-transitions.ts), so Zenvi desktop plays the
 * result with no new code. Every call is one undo step; receipts carry
 * `sfx_cues` so sound design can put a whoosh or hit on each transition.
 */

import { z } from "zod";
import type { Project } from "../../model/types.js";
import { isOpError } from "../../ops/errors.js";
import {
  applyMotionTransition,
  cutNear,
  listProjectMotionTransitions,
  motionRecords,
  planMotionTransitionEdit,
  removeMotionTransition,
  trackCuts,
  type MotionTransitionInput,
  type MotionTransitionResult,
} from "../../ops/motion-transitions.js";
import { rateOf } from "../../ops/internal.js";
import {
  MOTION_DIRECTIONS,
  MOTION_TRANSITION_IDS,
  MOTION_TRANSITION_STYLE_IDS,
  MOTION_TRANSITION_STYLES,
  defaultFrames,
  listMotionTransitions,
  styleStep,
  type MotionDirection,
  type MotionTransitionId,
  type MotionTransitionStyle,
} from "../../transitions/motion/index.js";
import { directTool, type CatalogTool } from "../define.js";
import { applied, refused, unchanged } from "../receipt.js";
import { ToolError, resolveLayer, trackName } from "./timeline-edit-common.js";
import { buildTrackStack } from "../tracks.js";

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

const PRESET_LINES = listMotionTransitions()
  .map((p) => `${p.id}${p.directions.length ? ` (${p.directions.join("/")})` : ""}`)
  .join(", ");

const common = {
  duration: z.number().min(0.03).max(4).optional().describe("Length of the move in seconds, both clips together (default per preset, from docs/TASTE.md: whip 8 frames at 30 fps, zoom 7, spin 12, glitch 5, flash 3)."),
  direction: z.enum([...MOTION_DIRECTIONS, "auto"]).optional().describe("whip/slide/squash: left, right, up, down; spin: cw, ccw. auto (default) keeps the track's current: the direction of the previous motion transition on the track, else left (spin: cw). Keep one direction per sequence; up is a reserved accent."),
  intensity: z.number().min(0.25).max(2).optional().describe("0.25-2, default 1: scales travel, zoom, blur and flash strength."),
};

const listInput = z.strictObject({});

const applyInput = z.strictObject({
  preset: z.enum(MOTION_TRANSITION_IDS).describe(`Which transition: ${PRESET_LINES}.`),
  clip1_id: z.string().max(64).optional().describe("Outgoing clip (the cut is at its end). With clip2_id omitted, the clip right after it on its track."),
  clip2_id: z.string().max(64).optional().describe("Incoming clip, cut back to back after clip1_id on the same track."),
  track: z.string().max(64).optional().describe("Instead of clip ids: the track of the cut (UI track number, 1 = bottom; name; or layer number) ..."),
  time: z.number().min(0).optional().describe("... and the cut's timeline time in seconds (the nearest cut within 0.5 s)."),
  ...common,
  focus_x: z.number().min(0).max(1).optional().describe("zoom_through: point to fly into, 0 = left edge, 1 = right (default 0.5)."),
  focus_y: z.number().min(0).max(1).optional().describe("zoom_through: 0 = top, 1 = bottom (default 0.5)."),
});

const applyAllInput = z.strictObject({
  track: z.string().max(64).describe("Track whose cuts get transitions: UI track number (1 = bottom), name, or layer number."),
  preset: z.enum(MOTION_TRANSITION_IDS).optional().describe(`One transition on every cut: ${PRESET_LINES}. Give this or style.`),
  style: z.enum(MOTION_TRANSITION_STYLE_IDS as [MotionTransitionStyle, ...MotionTransitionStyle[]]).optional().describe("A mix that repeats two or three presets: hype (whip, whip, crash zoom; the last cut a pull-back arrival) or cinematic (slide, blur dissolve; the last cut a zoom-through)."),
  ...common,
});

const removeInput = z.strictObject({
  transition_id: z.string().max(64).optional().describe("The motion transition to remove (from a receipt or list_motion_transitions_tool)."),
  clip_id: z.string().max(64).optional().describe("Or: remove every motion transition touching this clip."),
  track: z.string().max(64).optional().describe("Or: remove every motion transition on this track."),
});

type ApplyArgs = z.output<typeof applyInput>;

const round = (t: number): number => Math.round(t * 1000) / 1000;

function framesOf(project: Project, duration: number | undefined): number | undefined {
  return duration === undefined ? undefined : Math.max(2, Math.round(duration * rateOf(project)));
}

function resultData(project: Project, r: MotionTransitionResult): Record<string, unknown> {
  return {
    transition_id: r.id,
    preset: r.preset,
    direction: r.direction,
    intensity: r.intensity,
    frames: r.frames,
    duration: round(r.frames / rateOf(project)),
    cut: r.cut,
    track: trackName(project, r.layer),
    clips: r.clips.map((c) => ({ clip_id: c.id, role: c.role, frames: c.frames, properties: c.properties, effect_ids: c.effectIds })),
    sfx_cues: r.sfxCues,
    ...(r.replaced ? { replaced: r.replaced } : {}),
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The cut an apply call names, as op input. */
function applyTarget(project: Project, args: ApplyArgs): Pick<MotionTransitionInput, "outClipId" | "inClipId"> {
  if (args.clip1_id) {
    if (args.clip2_id) return { outClipId: args.clip1_id, inClipId: args.clip2_id };
    const clip = project.clips.find((c) => c.id === args.clip1_id);
    if (!clip) throw new ToolError(`no clip with id ${args.clip1_id}`);
    const cuts = trackCuts(project, clip.layer);
    const i = cuts.findIndex((c) => c.outClip.id === clip.id);
    if (i < 0) throw new ToolError(`no clip is cut back to back after ${clip.id} on its track; give clip2_id`);
    return { outClipId: clip.id, inClipId: cuts[i]!.inClip.id };
  }
  if (args.track === undefined || args.time === undefined) throw new ToolError("give clip1_id (and optionally clip2_id), or track and time");
  const layer = resolveLayer(project, args.track);
  const cut = cutNear(project, layer, args.time);
  return { outClipId: cut.outClip.id, inClipId: cut.inClip.id };
}

const LIST = "list_motion_transitions_tool";
const APPLY = "apply_motion_transition_tool";
const APPLY_ALL = "apply_motion_transitions_tool";
const REMOVE = "remove_motion_transition_tool";


/**
 * Where the cuts are when the named track has none: agents guess "1" after
 * build_reel_tool, which puts the music on track 1 and the shots above it.
 */
function cutsElsewhere(project: Project, layer: number): string {
  const tracks = buildTrackStack(project.layers)
    .filter((t) => t.layer_number !== layer)
    .map((t) => ({ ui: t.ui_track, cuts: trackCuts(project, t.layer_number).length }))
    .filter((t) => t.cuts > 0);
  if (tracks.length === 0) return "";
  return ` Cuts are on ${tracks.map((t) => `track ${t.ui} (${t.cuts} cut${t.cuts === 1 ? "" : "s"})`).join(", ")}: pass track="${tracks[0]!.ui}".`;
}

export const motionTransitionTools: CatalogTool[] = [
  directTool({
    name: LIST,
    title: "List motion transitions",
    description:
      "The motion transition presets (whip pans, zoom punches, zoom-through, spins, squash, shake, glitch, white/black/invert flashes, blur dissolve) with their directions and default lengths at this project's frame rate, the style mixes for apply_motion_transitions_tool, and the motion transitions already on the timeline.",
    input: listInput,
    annotations: READ,
    run: (call) => {
      const project = call.doc.project;
      const fps = rateOf(project);
      const presets = listMotionTransitions().map((p) => ({
        preset: p.id,
        title: p.title,
        description: p.description,
        directions: p.directions,
        default_frames: defaultFrames(p.id, fps),
        default_duration: round(defaultFrames(p.id, fps) / fps),
        sfx: p.sfx,
      }));
      const styles = Object.fromEntries(MOTION_TRANSITION_STYLE_IDS.map((k) => [k, { pattern: MOTION_TRANSITION_STYLES[k].pattern.map((s) => s.preset), last_cut: MOTION_TRANSITION_STYLES[k].accent.preset }]));
      const onTimeline = listProjectMotionTransitions(project).map((r) => ({
        transition_id: r.id,
        preset: r.preset,
        direction: r.direction,
        frames: r.frames,
        cut: round(r.cut),
        track: trackName(project, r.layer),
        clip1_id: r.outClipId,
        clip2_id: r.inClipId,
      }));
      return applied(LIST, `${presets.length} motion transitions; ${onTimeline.length} on the timeline.`, { data: { presets, styles, on_timeline: onTimeline } }, 0);
    },
  }),

  directTool({
    name: APPLY,
    title: "Apply a motion transition",
    description:
      "Put a motion transition on one cut between two clips that play back to back on a track: whip pan, slide, zoom punch in/out, zoom through a point, spin, squash and stretch, shake, glitch, white/black/invert flash or blur dissolve. " +
      "The outgoing clip's last frames accelerate out and the incoming clip's first frames settle in, smear peaking on the cut; no overlap, nothing moves on the timeline, the frame stays covered. " +
      "Existing animation on the clips (Ken Burns, keyframes) keeps playing outside the transition. Re-applying on the same cut replaces it. One undo step; the receipt lists the clips, frames, effects and sfx_cues (whoosh/hit/glitch times for sound design).",
    input: applyInput,
    annotations: WRITE,
    run: (call, args) => {
      const project = call.doc.project;
      let input: MotionTransitionInput;
      try {
        input = {
          ...applyTarget(project, args),
          preset: args.preset,
          direction: args.direction ?? "auto",
          frames: framesOf(project, args.duration),
          intensity: args.intensity,
          focus: args.focus_x !== undefined || args.focus_y !== undefined ? { x: args.focus_x ?? 0.5, y: args.focus_y ?? 0.5 } : undefined,
        };
        planMotionTransitionEdit(project, input);
      } catch (error) {
        if (error instanceof ToolError || isOpError(error)) return refused(APPLY, `Error: ${message(error)}`);
        throw error;
      }
      const r = call.commit((tx) => applyMotionTransition(tx, input), `Motion transition ${args.preset}`);
      const after = call.doc.project;
      const dir = r.direction ? ` ${r.direction}` : "";
      return applied(APPLY, `${r.replaced ? "Replaced with" : "Added"} ${r.preset}${dir} on the cut at ${r.cut.toFixed(2)}s (${r.frames} frames) between ${r.clips[0]!.id} and ${r.clips[1]!.id}.`, { data: resultData(after, r) });
    },
  }),

  directTool({
    name: APPLY_ALL,
    title: "Apply motion transitions to every cut",
    description:
      "Put a motion transition on every cut of a track (clips back to back), one preset everywhere or a style mix (hype: whip, whip, crash zoom, repeated, landing on a pull-back; cinematic: slide, blur dissolve, repeated, ending in a zoom-through). " +
      "The sequence keeps ONE direction, the current (direction, default left), on every cut and never alternates; reserved moves (up, zoom-through, pull-back) are accents for the climax or last cut, and two or three presets repeated read as design where more read as noise. " +
      "Cuts whose clips are too short are skipped with a warning; cuts that already have one are replaced. One undo step; the receipt lists every transition and its sfx_cues.",
    input: applyAllInput,
    annotations: WRITE,
    run: (call, args) => {
      const project = call.doc.project;
      if ((args.preset === undefined) === (args.style === undefined)) return refused(APPLY_ALL, "Error: give preset or style (one of them).");
      let layer: number;
      try {
        layer = resolveLayer(project, args.track);
      } catch (error) {
        if (error instanceof ToolError) return refused(APPLY_ALL, `Error: ${message(error)}`);
        throw error;
      }
      const cuts = trackCuts(project, layer);
      if (cuts.length === 0) return unchanged(APPLY_ALL, `No cuts on ${trackName(project, layer)}: no clips play back to back there.${cutsElsewhere(project, layer)}`);
      const frames = framesOf(project, args.duration);
      const inputs = cuts.map((cut, index): MotionTransitionInput => {
        const step = args.style ? styleStep(args.style, index, cuts.length) : { preset: args.preset as MotionTransitionId };
        const intensity = args.intensity !== undefined ? args.intensity : step.intensity;
        const direction: MotionDirection | "auto" = args.direction ?? "auto";
        return { outClipId: cut.outClip.id, inClipId: cut.inClip.id, preset: step.preset, frames, intensity, direction };
      });
      const warnings: string[] = [];
      const results = call.commit((tx) => {
        const done: MotionTransitionResult[] = [];
        for (const input of inputs) {
          // A preset without the requested direction (spin vs left) falls back to auto rather than failing the mix.
          const tryInput = input.direction !== undefined && input.direction !== "auto" && !directionFits(input.preset, input.direction) ? { ...input, direction: "auto" as const } : input;
          try {
            planMotionTransitionEdit(tx.project, tryInput);
          } catch (error) {
            if (!isOpError(error)) throw error;
            warnings.push(`cut ${input.outClipId} → ${input.inClipId}: skipped (${error.message})`);
            continue;
          }
          done.push(applyMotionTransition(tx, tryInput));
        }
        return done;
      }, `Motion transitions on ${trackName(project, layer)}`);
      const after = call.doc.project;
      if (results.length === 0) return refused(APPLY_ALL, `Error: no cut on ${trackName(project, layer)} could take a transition: ${warnings.join("; ")}`);
      const summary = `Added ${results.length} motion transition(s) on ${trackName(after, layer)}${args.style ? ` (${args.style})` : ""}: ${results.map((r) => `${r.preset}@${r.cut.toFixed(2)}s`).join(", ")}.`;
      return applied(APPLY_ALL, summary, {
        warnings,
        data: { track: trackName(after, layer), transitions: results.map((r) => resultData(after, r)), sfx_cues: results.flatMap((r) => r.sfxCues) },
      });
    },
  }),

  directTool({
    name: REMOVE,
    title: "Remove a motion transition",
    description:
      "Remove motion transitions (by id, every one touching a clip, or every one on a track) and put the clips back exactly as they were: the keyframes and effects the transition added go, the clips' own animation stays, edits made since outside the transition are kept. One undo step.",
    input: removeInput,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: (call, args) => {
      const project = call.doc.project;
      const given = [args.transition_id, args.clip_id, args.track].filter((v) => v !== undefined && v !== "").length;
      if (given !== 1) return refused(REMOVE, "Error: give exactly one of transition_id, clip_id or track.");
      const all = listProjectMotionTransitions(project);
      let ids: string[];
      try {
        if (args.transition_id) {
          ids = all.some((r) => r.id === args.transition_id) ? [args.transition_id] : [];
          if (ids.length === 0) return refused(REMOVE, `Error: no motion transition with id ${args.transition_id}.`);
        } else if (args.clip_id) {
          const clip = project.clips.find((c) => c.id === args.clip_id);
          if (!clip) return refused(REMOVE, `Error: no clip with id ${args.clip_id}.`);
          ids = motionRecords(clip).map((r) => r.id);
        } else {
          const layer = resolveLayer(project, args.track);
          ids = all.filter((r) => r.layer === layer).map((r) => r.id);
        }
      } catch (error) {
        if (error instanceof ToolError) return refused(REMOVE, `Error: ${message(error)}`);
        throw error;
      }
      if (ids.length === 0) return unchanged(REMOVE, "No motion transitions there; nothing to remove.");
      let changed: string[];
      try {
        changed = call.commit((tx) => [...new Set(ids.flatMap((id) => removeMotionTransition(tx, id)))], "Remove motion transition");
      } catch (error) {
        if (isOpError(error)) return refused(REMOVE, `Error: ${error.message}`);
        throw error;
      }
      return applied(REMOVE, `Removed ${ids.length} motion transition(s); restored clips ${changed.join(", ")}.`, { data: { removed: ids, clip_ids: changed } });
    },
  }),
];

function directionFits(preset: MotionTransitionId, direction: MotionDirection): boolean {
  return listMotionTransitions().find((p) => p.id === preset)!.directions.includes(direction);
}
