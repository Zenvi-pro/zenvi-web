/**
 * speed_ramp_tool: the "velocity edit" in one call. The footage rushes, slows
 * to a near-freeze on the beat and rushes again (or ramps in, ramps out, holds
 * a hero slow-mo, or follows custom speed points). The speed is integrated into
 * the clip's `time` curve (ops/speed-ramp.ts), so every surface and the
 * desktop play it the same way and it stays one editable clip.
 */

import { z } from "zod";
import { isOpError } from "../../ops/errors.js";
import { sameJson } from "../../ops/internal.js";
import { shiftAfter } from "../../ops/sequence.js";
import { RAMP_EASES, RAMP_PRESETS, RAMP_MAX_SPEED, RAMP_MIN_SPEED, applySpeedRamp, planSpeedRamp, type RampPlan } from "../../ops/speed-ramp.js";
import { directTool, type CatalogTool } from "../define.js";
import { applied, refused, unchanged } from "../receipt.js";
import { ToolError, checkOverlaps, clipTitle, gridOf, newOverlaps, spanOf } from "./timeline-edit-common.js";

const TOOL = "speed_ramp_tool";

const round = (n: number, places = 3) => Math.round(n * 10 ** places) / 10 ** places;

const input = z.strictObject({
  clip_id: z.string().min(1).describe("Timeline clip id (from describe_project_tool, list_clips_tool or a receipt)."),
  preset: z
    .enum(RAMP_PRESETS)
    .describe(
      "ramp_in: starts in slow motion and accelerates into normal speed. ramp_out: normal speed, then slows down to the last frame. " +
        "hero: normal speed, a held slow-mo moment, normal speed. velocity: rush, near-freeze on the beat, rush again. custom: your own `points`.",
    ),
  points: z
    .array(z.strictObject({ at_seconds_in_clip: z.coerce.number().min(0).max(600), speed: z.coerce.number().min(RAMP_MIN_SPEED).max(RAMP_MAX_SPEED) }))
    .min(2)
    .max(64)
    .optional()
    .describe("custom: the speed (1 = normal) at each moment, seconds from the clip's start on the timeline clock, strictly increasing. The clip ends at the last point."),
  ease: z.enum(RAMP_EASES).optional().describe("How the speed changes between points (docs/TASTE.md names). Default smooth."),
  hit_at: z
    .number()
    .min(0)
    .optional()
    .describe("Timeline second (e.g. a beat from detect_beats_tool) where the slowest moment lands; hero, velocity and custom only. Default: the middle of the footage."),
  audio: z.enum(["mute", "keep"]).optional().describe("mute (default) silences the clip: sound at 0.1x is pitched-down mush. keep leaves its volume alone."),
  ripple: z.boolean().optional().describe("Move later clips on the track by the change in this clip's length (default false: refuse when a longer clip would overlap the next one)."),
  allow_overlap: z.boolean().optional().describe("Let a longer clip cover the next one."),
  slow: z.number().min(RAMP_MIN_SPEED).max(RAMP_MAX_SPEED).optional().describe("Speed at the slowest moment. Defaults: ramp 0.25, hero 0.25, velocity 0.1."),
  fast: z.number().min(RAMP_MIN_SPEED).max(RAMP_MAX_SPEED).optional().describe("Speed outside the slow moment (the rush). Defaults: ramp 1, hero 1, velocity 2.5."),
  ramp_seconds: z.number().min(0).max(30).optional().describe("Seconds each speed change takes (timeline clock). Defaults: ramp 1, hero 0.5, velocity 0.6."),
  hold_seconds: z.number().min(0).max(30).optional().describe("Seconds held at the slowest speed. Defaults: hero 1, velocity 0.15."),
});

type Input = z.infer<typeof input>;

function summary(plan: RampPlan, position: number, shifted: number): string {
  const slowest = position + plan.slowestAt;
  return (
    `Ramped the clip (${plan.preset}): ${plan.durationBefore.toFixed(2)} s -> ${plan.duration.toFixed(2)} s, ` +
    `speed ${round(plan.minSpeed, 2)}x-${round(plan.maxSpeed, 2)}x, slowest at ${slowest.toFixed(2)} s` +
    (shifted > 0 ? `; ${shifted} later item(s) rippled` : "") +
    "."
  );
}

export const speedRampTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Speed ramp",
    description:
      "Change a clip's speed smoothly over time: the velocity edit (rush, near-freeze on the beat, rush again), a ramp-in or ramp-out, or a hero slow-mo. " +
      "Give hit_at (a beat, timeline seconds) to land the slowest moment on it. Plays the footage you trimmed (the clip's in to out point) at a changing speed, " +
      "so the clip gets shorter where it rushes and longer where it slows; ripple=true moves the later clips along. Sound is muted unless audio=keep. " +
      "One undo step; the receipt has the new length, the speed range and where the slowest moment landed. Slow motion on a 30 fps or slower source below 0.5x looks choppy " +
      "(the receipt warns; optical-flow slow-mo is a later Zenvi FX render).",
    input,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: (call, args: Input) => {
      const project = call.doc.project;
      const clip = project.clips.find((c) => String(c.id) === args.clip_id);
      if (!clip) return refused(TOOL, `Error: No timeline clip with id='${args.clip_id}'.`);

      let plan: RampPlan;
      try {
        plan = planSpeedRamp(project, args.clip_id, {
          preset: args.preset,
          ease: args.ease,
          hitAt: args.hit_at,
          slow: args.slow,
          fast: args.fast,
          rampSeconds: args.ramp_seconds,
          holdSeconds: args.hold_seconds,
          ...(args.points ? { points: args.points.map((p) => ({ atSeconds: p.at_seconds_in_clip, speed: p.speed })) } : {}),
        });
      } catch (error) {
        if (isOpError(error)) return refused(TOOL, `Error: ${error.message}`);
        throw error;
      }

      const g = gridOf(project);
      const [start, end] = spanOf(clip);
      const delta = plan.duration - (end - start);
      const ripple = args.ripple ?? false;
      let overlaps: ReturnType<typeof newOverlaps> = [];
      if (!ripple && delta > g.tol) {
        try {
          overlaps = checkOverlaps(newOverlaps(project, new Map([[clip.id, { layer: clip.layer, start, end: start + plan.duration }]])), args.allow_overlap ?? false, "The longer clip");
        } catch (error) {
          if (error instanceof ToolError) return refused(TOOL, `Error: ${error.message}`);
          throw error;
        }
      }

      const mute = (args.audio ?? "mute") === "mute";
      // applySpeedRamp leaves the volume of a clip without sound alone.
      const silent = clip.reader?.has_audio === false;
      const alreadyThere =
        sameJson(clip.time?.Points, plan.points) &&
        sameJson((clip as unknown as Record<string, unknown>).zenvi_speed_ramp, plan.recipe) &&
        (!mute || silent || (clip.volume?.Points?.length === 1 && clip.volume.Points[0]!.co.Y === 0));
      if (alreadyThere) return unchanged(TOOL, `${clipTitle(clip)} already has that ramp; nothing to change.`);

      const shifted = call.commit((tx) => {
        applySpeedRamp(tx, clip.id, plan, { muteAudio: mute });
        return ripple && Math.abs(delta) > g.tol ? shiftAfter(tx, clip.layer, start + g.tol, plan.duration - (end - start), new Set([clip.id])) : [];
      }, `Speed ramp ${plan.preset}`);

      const after = call.doc.project.clips.find((c) => c.id === clip.id) ?? clip;
      const warnings = [...plan.warnings];
      if (overlaps.length > 0) warnings.push(`The longer clip now covers ${overlaps.length} other clip(s).`);
      const position = Number(after.position);
      return applied(TOOL, summary(plan, position, shifted.length), {
        warnings,
        data: {
          timeline_clip_id: clip.id,
          title: clipTitle(clip),
          preset: plan.preset,
          ease: plan.ease,
          position: round(position),
          duration_before: round(plan.durationBefore),
          duration_after: round(plan.duration),
          end: round(position + plan.duration),
          frames: plan.frames,
          speed_min: round(plan.minSpeed),
          speed_max: round(plan.maxSpeed),
          slowest_at: round(position + plan.slowestAt),
          source_in_seconds: round(plan.sourceIn / g.fps - 1 / g.fps),
          source_out_seconds: round(plan.sourceOut / g.fps),
          time_keyframes: plan.points.length,
          audio: mute ? "muted" : "kept",
          rippled: [...new Set(shifted)].sort(),
          overlaps,
        },
      });
    },
  }),
];
