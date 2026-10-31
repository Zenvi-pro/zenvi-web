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
  sceneCuts,
  trackCuts,
  type MotionTransitionInput,
  type MotionTransitionResult,
} from "../../ops/motion-transitions.js";
import { rateOf } from "../../ops/internal.js";
import { DISSOLVE_DRIFTS, applyMatchedDissolve } from "../../ops/matched-dissolve.js";
import { readBrief } from "../../brief/brief.js";
import {
  MOTION_DIRECTIONS,
  MOTION_TRANSITION_IDS,
  MOTION_TRANSITION_STYLE_IDS,
  MOTION_TRANSITION_STYLES,
  defaultFrames,
  listMotionTransitions,
  styleEvery,
  styleForBrief,
  styleStep,
  type MotionDirection,
  type MotionTransitionId,
  type MotionTransitionStyle,
} from "../../transitions/motion/index.js";
import { directTool, type CatalogTool } from "../define.js";
import { applied, refused, unchanged } from "../receipt.js";
import { ToolError, clipById, clipTitle, resolveLayer, trackName } from "./timeline-edit-common.js";
import { buildTrackStack } from "../tracks.js";

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

const PRESET_LINES = listMotionTransitions()
  .map((p) => `${p.id}${p.directions.length ? ` (${p.directions.join("/")})` : ""}`)
  .join(", ");

const common = {
  duration: z.number().min(0.03).max(4).optional().describe("Length of the move in seconds, both clips together (default per preset, from docs/TASTE.md: whip 8 frames at 30 fps, zoom 7, spin 12, glitch 5, flash 3)."),
  direction: z.enum([...MOTION_DIRECTIONS, "auto"]).optional().describe("whip/slide/squash: left, right, up, down; tilt: up, down; spin: cw, ccw. auto (default) keeps the track's current: the direction of the previous motion transition on the track, else left (tilt: up, spin: cw). Keep one direction per sequence; a whip up is a reserved accent (a camera tilt is the tilt preset)."),
  intensity: z.number().min(0.25).max(2).optional().describe("0.25-2, default 1: scales travel, zoom, blur and flash strength."),
};

const focus = {
  focus_x: z.number().min(0).max(1).optional().describe("zoom_through: point of the outgoing shot to fly into, 0 = left edge, 1 = right (default 0.5): a doorway, a face, the product."),
  focus_y: z.number().min(0).max(1).optional().describe("zoom_through: 0 = top, 1 = bottom (default 0.5)."),
};

const STYLE_CHOICES = ["auto", ...MOTION_TRANSITION_STYLE_IDS] as const;

/** One line per mix, for the schema: what it repeats, how often, what it lands on. */
const STYLE_LINES = MOTION_TRANSITION_STYLE_IDS.map((k) => {
  const def = MOTION_TRANSITION_STYLES[k];
  const every = styleEvery(k);
  return `${k} (${def.pattern.map((p) => p.preset).join(", ")}${every > 1 ? `, one cut in ${every}` : ""}; last ${def.accent.preset})`;
}).join("; ");

/** A preset on this many cuts or more reads as a template rather than an edit. */
const SAME_PRESET_WARN = 4;

const listInput = z.strictObject({});

const applyInput = z.strictObject({
  preset: z.enum(MOTION_TRANSITION_IDS).describe(`Which transition: ${PRESET_LINES}.`),
  clip1_id: z.string().max(64).optional().describe("Outgoing clip (the cut is at its end). With clip2_id omitted, the clip right after it on its track."),
  clip2_id: z.string().max(64).optional().describe("Incoming clip, starting the frame after clip1_id ends (on any track)."),
  track: z.string().max(64).optional().describe("Instead of clip ids: the track of the cut (UI track number, 1 = bottom; name; or layer number) ... (omit it with time: the scene change nearest that time)"),
  time: z.number().min(0).optional().describe("... and the cut's timeline time in seconds (the nearest cut within 0.5 s)."),
  ...common,
  ...focus,
});

const applyAllInput = z.strictObject({
  track: z
    .string()
    .max(64)
    .optional()
    .describe(
      "Track whose cuts get transitions: UI track number (1 = bottom), name, or layer number. Omit it (or \"all\") for every scene change across the tracks: scenes stacked on several tracks (a background and the blocks over it) move as one; clips that span the cut, flash frames and captions stay put.",
    ),
  preset: z.enum(MOTION_TRANSITION_IDS).optional().describe(`One transition on every cut: ${PRESET_LINES}. Prefer style: one preset on every cut reads as a template.`),
  style: z
    .enum(STYLE_CHOICES)
    .optional()
    .describe(`A mix that repeats two to four presets, on every cut or one cut in n (the rest stay hard), ending on an accent: ${STYLE_LINES}. auto (the default when preset is omitted) picks the mix for the saved brief's style (brand story → brand, flash montage → flash, wedding → gentle, travel → travel, sports → sport, match cut → punch, editorial/kinetic → editorial, hype → hype, else cinematic).`),
  ...common,
  ...focus,
});

const removeInput = z.strictObject({
  transition_id: z.string().max(64).optional().describe("The motion transition to remove (from a receipt or list_motion_transitions_tool)."),
  clip_id: z.string().max(64).optional().describe("Or: remove every motion transition touching this clip."),
  track: z.string().max(64).optional().describe("Or: remove every motion transition on this track."),
});

const dissolveInput = z.strictObject({
  clip1_id: z.string().max(64).describe("Outgoing clip."),
  clip2_id: z.string().max(64).optional().describe("Incoming clip (default: the next clip on clip1_id's track); it moves back to overlap by duration, as apply_transition_tool does."),
  duration: z.number().min(0.2).max(3).optional().describe("Blend length, seconds (default 0.8)."),
  drift: z.enum(DISSOLVE_DRIFTS).optional().describe("The move both shots share through the blend: push_in (default, a slow push) or pull_out."),
  speed: z.number().min(0.005).max(0.1).optional().describe("Scale change per second, both clips alike (default 0.03: a 3 % push a second)."),
});

type ApplyArgs = z.output<typeof applyInput>;

const round = (t: number): number => Math.round(t * 1000) / 1000;
const MAX_FRAMES = 120;

/** The op takes 2-120 frames; say the limit in seconds at the project's rate, since the caller gave seconds. */
function framesOf(project: Project, duration: number | undefined): number | undefined {
  if (duration === undefined) return undefined;
  const rate = rateOf(project);
  const frames = Math.max(2, Math.round(duration * rate));
  if (frames > MAX_FRAMES) throw new ToolError(`duration ${duration}s is ${frames} frames at ${round(rate)} fps; the most is ${round(MAX_FRAMES / rate)}s`);
  return frames;
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

/** A clip as people know it (its file name or label), for summaries; the receipt's data keeps the ids. */
function titleOf(project: Project, id: string): string {
  const clip = clipById(project, id);
  return clip ? clipTitle(clip) : id;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The cut an apply call names, as op input. */
function applyTarget(project: Project, args: ApplyArgs): Pick<MotionTransitionInput, "outClipId" | "inClipId" | "acrossTracks" | "followers"> {
  if (args.clip1_id) {
    if (args.clip2_id) return { outClipId: args.clip1_id, inClipId: args.clip2_id, acrossTracks: true };
    const clip = project.clips.find((c) => c.id === args.clip1_id);
    if (!clip) throw new ToolError(`no clip with id ${args.clip1_id}`);
    const cuts = trackCuts(project, clip.layer);
    const i = cuts.findIndex((c) => c.outClip.id === clip.id);
    if (i < 0) throw new ToolError(`no clip is cut back to back after ${clip.id} on its track; give clip2_id`);
    return { outClipId: clip.id, inClipId: cuts[i]!.inClip.id };
  }
  if (args.track === undefined && args.time !== undefined) {
    // Time alone: the scene change nearest it, on whichever tracks its shots sit (agents give the time they hear the cut at).
    const t = args.time;
    const near = sceneCuts(project).reduce<ReturnType<typeof sceneCuts>[number] | undefined>((best, c) => (!best || Math.abs(c.cut - t) < Math.abs(best.cut - t) ? c : best), undefined);
    if (!near || Math.abs(near.cut - t) > 0.5) throw new ToolError(`no scene change within 0.5 s of ${t.toFixed(2)}s; give track and time, or clip1_id`);
    // The scene's stack moves as one, as apply_motion_transitions_tool moves it.
    return { outClipId: near.outClip.id, inClipId: near.inClip.id, acrossTracks: true, followers: near.followers };
  }
  if (args.track === undefined || args.time === undefined) throw new ToolError("give clip1_id (and optionally clip2_id), or track and time");
  const layer = resolveLayer(project, args.track);
  // A montage's flash frames sit apart on a track of their own: point at the track its shots are cut on.
  if (trackCuts(project, layer).length === 0) throw new ToolError(`no cuts on ${trackName(project, layer)}: no clips play back to back there.${cutsElsewhere(project, layer)}`);
  const cut = cutNear(project, layer, args.time);
  return { outClipId: cut.outClip.id, inClipId: cut.inClip.id };
}

const LIST = "list_motion_transitions_tool";
const APPLY = "apply_motion_transition_tool";
const APPLY_ALL = "apply_motion_transitions_tool";
const REMOVE = "remove_motion_transition_tool";
const DISSOLVE = "apply_matched_dissolve_tool";


/**
 * Where the cuts are when the named track has none: agents guess "1" after
 * build_reel_tool, which puts the music on track 1 and the shots above it.
 */
function cutsElsewhere(project: Project, layer: number): string {
  const tracks = buildTrackStack(project.layers)
    .filter((t) => t.layer_number !== layer)
    .map((t) => ({ ui: t.ui_track, cuts: trackCuts(project, t.layer_number).length }))
    .filter((t) => t.cuts > 0);
  const scenes = sceneCuts(project).filter((c) => c.outClip.layer !== c.inClip.layer).length;
  const across = scenes > 0 ? ` ${scenes} scene change${scenes === 1 ? "" : "s"} cross${scenes === 1 ? "es" : ""} tracks: omit track to put transitions on every scene change.` : "";
  if (tracks.length === 0) return across;
  return ` Cuts are on ${tracks.map((t) => `track ${t.ui} (${t.cuts} cut${t.cuts === 1 ? "" : "s"})`).join(", ")}: pass track="${tracks[0]!.ui}".${across}`;
}

export const motionTransitionTools: CatalogTool[] = [
  directTool({
    name: LIST,
    title: "List motion transitions",
    description:
      "The motion transition presets (whip pans, slides, camera tilts, zoom punches, zoom-through, spins, squash, shake, glitch, white/black/invert flashes, blur dissolve) with their directions and default lengths at this project's frame rate, the style mixes for apply_motion_transitions_tool, and the motion transitions already on the timeline.",
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
      const styles = Object.fromEntries(MOTION_TRANSITION_STYLE_IDS.map((k) => [k, { pattern: MOTION_TRANSITION_STYLES[k].pattern.map((s) => s.preset), every: styleEvery(k), last_cut: MOTION_TRANSITION_STYLES[k].accent.preset }]));
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
      "Put a motion transition on one cut between two clips that play back to back on a track (or, given both clip ids, on two tracks: one starts the frame after the other ends): whip pan, slide, camera tilt, zoom punch in/out, zoom through a point (focus_x/focus_y), spin, squash and stretch, shake, glitch, white/black/invert flash or blur dissolve. " +
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
      return applied(APPLY, `${r.replaced ? "Replaced with" : "Added"} ${r.preset}${dir} on the cut at ${r.cut.toFixed(2)}s (${r.frames} frames) between ${titleOf(after, r.clips[0]!.id)} and ${titleOf(after, r.clips[1]!.id)}.`, { data: resultData(after, r) });
    },
  }),

  directTool({
    name: APPLY_ALL,
    title: "Apply motion transitions to every cut",
    description:
      "Put a motion transition on every cut of a track (clips back to back), or with track omitted on every scene change across the tracks (scenes on separate tracks, a montage with its flashes on their own track), a style mix (default: the mix for the saved brief's style; hype, cinematic, sport, flash, brand, editorial, punch, travel, gentle) or one preset everywhere. Most mixes move one cut in two to four and leave the rest hard, as the references do. " +
      "The sequence keeps ONE direction, the current (direction, default left), on every cut and never alternates; reserved moves (up, zoom-through, pull-back) are accents for the climax or last cut, and two or three presets repeated read as design where more read as noise. " +
      "Cuts whose clips are too short are skipped with a warning; cuts that already have one are replaced. One undo step; the receipt lists every transition and its sfx_cues.",
    input: applyAllInput,
    annotations: WRITE,
    run: (call, args) => {
      const project = call.doc.project;
      if (args.preset !== undefined && args.style !== undefined) return refused(APPLY_ALL, "Error: give preset or style, not both.");
      const brief = args.preset === undefined && (args.style === undefined || args.style === "auto") ? readBrief(project) : null;
      const style: MotionTransitionStyle | undefined = args.preset !== undefined ? undefined : args.style === undefined || args.style === "auto" ? styleForBrief(brief?.style) : args.style;
      const scenes = args.track === undefined || args.track.trim() === "" || args.track.trim().toLowerCase() === "all";
      let layer: number | undefined;
      let frames: number | undefined;
      try {
        if (!scenes) layer = resolveLayer(project, args.track!);
        frames = framesOf(project, args.duration);
      } catch (error) {
        if (error instanceof ToolError) return refused(APPLY_ALL, `Error: ${message(error)}`);
        throw error;
      }
      const cuts = layer === undefined ? sceneCuts(project) : trackCuts(project, layer).map((c) => ({ ...c, followers: undefined }));
      if (cuts.length === 0) {
        return unchanged(
          APPLY_ALL,
          layer === undefined ? "No scene changes: no picture clip starts on the frame after another ends, on any track." : `No cuts on ${trackName(project, layer)}: no clips play back to back there.${cutsElsewhere(project, layer)}`,
        );
      }
      const where = layer === undefined ? "the scene changes" : trackName(project, layer);
      const focusPoint = args.focus_x !== undefined || args.focus_y !== undefined ? { x: args.focus_x ?? 0.5, y: args.focus_y ?? 0.5 } : undefined;
      let hard = 0;
      const inputs = cuts.flatMap((cut, index): MotionTransitionInput[] => {
        const step = style ? styleStep(style, index, cuts.length) : { preset: args.preset as MotionTransitionId };
        if (!step) {
          hard += 1;
          return [];
        }
        const intensity = args.intensity !== undefined ? args.intensity : step.intensity;
        const direction: MotionDirection | "auto" = args.direction ?? "auto";
        const scene = cut.followers ? { acrossTracks: true, followers: cut.followers } : {};
        const aim = step.preset === "zoom_through" && focusPoint ? { focus: focusPoint } : {};
        return [{ outClipId: cut.outClip.id, inClipId: cut.inClip.id, preset: step.preset, frames, intensity, direction, ...scene, ...aim }];
      });
      const warnings: string[] = [];
      if (args.preset !== undefined && cuts.length >= SAME_PRESET_WARN) {
        warnings.push(`${args.preset} on all ${cuts.length} cuts reads as a template: style (auto reads the brief) varies the moves and leaves most cuts hard; or keep ${args.preset} on the 2-3 cuts that need it (apply_motion_transition_tool).`);
      }
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
          const r = applyMotionTransition(tx, tryInput);
          for (const f of r.skippedFollowers ?? []) warnings.push(`cut at ${r.cut.toFixed(2)}s: clip ${f.id} stays still (${f.reason})`);
          done.push(r);
        }
        return done;
      }, `Motion transitions on ${where}`);
      const after = call.doc.project;
      if (results.length === 0) return refused(APPLY_ALL, `Error: no cut on ${where} could take a transition: ${warnings.join("; ")}`);
      const moved = results.reduce((n, r) => n + r.clips.length, 0);
      const summary =
        `Added ${results.length} motion transition(s) on ${where}${style ? ` (${style}${args.style === undefined || args.style === "auto" ? `, from the brief's style ${brief?.style ? `"${brief.style}"` : "(none saved)"}` : ""})` : ""}: ${results.map((r) => `${r.preset}@${r.cut.toFixed(2)}s`).join(", ")}` +
        (hard > 0 ? `; ${hard} cut(s) stay hard (the ${style} mix moves one cut in ${styleEvery(style!)})` : "") +
        (layer === undefined ? `; ${moved} clip(s) move with them.` : ".");
      return applied(APPLY_ALL, summary, {
        warnings,
        data: { track: layer === undefined ? "all" : trackName(after, layer), ...(style ? { style } : {}), hard_cuts: hard, transitions: results.map((r) => resultData(after, r)), sfx_cues: results.flatMap((r) => r.sfxCues) },
      });
    },
  }),

  directTool({
    name: DISSOLVE,
    title: "Apply a motion-matched dissolve",
    description:
      "A dissolve between two clips through which both pictures keep moving the same way at one speed (a slow push in or pull out, linear on both): the blend reads as one camera move instead of two stills crossing (wedding, travel, brand films; dissolves only between calm, similar shots). " +
      "The incoming clip moves back to overlap like apply_transition_tool; clips with their own scale animation keep it. One undo step; the receipt lists the transition and the clips that drift.",
    input: dissolveInput,
    annotations: WRITE,
    run: (call, args) => {
      const project = call.doc.project;
      const clip = project.clips.find((c) => c.id === args.clip1_id);
      if (!clip) return refused(DISSOLVE, `Error: no clip with id ${args.clip1_id}.`);
      let inId = args.clip2_id;
      if (!inId) {
        const end = Number(clip.position) + Number(clip.end) - Number(clip.start);
        const next = project.clips
          .filter((c) => c.id !== clip.id && c.layer === clip.layer && Number(c.position) >= end - 1e-6)
          .sort((a, b) => Number(a.position) - Number(b.position))[0];
        if (!next) return refused(DISSOLVE, `Error: no clip follows ${clip.id} on its track; give clip2_id.`);
        inId = next.id;
      }
      const input = { outClipId: clip.id, inClipId: inId, duration: args.duration ?? 0.8, drift: args.drift ?? "push_in", rate: args.speed ?? 0.03 } as const;
      let r: ReturnType<typeof applyMatchedDissolve>;
      try {
        r = call.commit((tx) => applyMatchedDissolve(tx, input), "Motion-matched dissolve");
      } catch (error) {
        if (isOpError(error)) return refused(DISSOLVE, `Error: ${error.message}`);
        throw error;
      }
      const after = call.doc.project;
      const blend = round(Number(r.transition.end) - Number(r.transition.start));
      return applied(
        DISSOLVE,
        `Added a ${blend}s dissolve between ${titleOf(after, clip.id)} and ${titleOf(after, inId)}, both ${input.drift === "push_in" ? "pushing in" : "pulling out"} at ${input.rate} a second through it.`,
        {
          warnings: r.kept.map((id) => `${titleOf(after, id)} keeps its own scale animation (no drift added).`),
          data: { transition_id: r.transition.id, position: round(Number(r.transition.position)), duration: blend, drift: input.drift, speed: input.rate, drifted_clip_ids: r.drifted, kept_clip_ids: r.kept, ...(r.movedClip ? { moved_clip_id: r.movedClip.id } : {}) },
        },
      );
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
