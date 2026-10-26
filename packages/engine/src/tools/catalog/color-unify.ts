/**
 * unify_grade_tool: grade continuity across a cut. Each footage clip is
 * measured on frames spread across it (isolated renders, its effects on),
 * corrected on its own ColorGrade toward one target (a reference clip or
 * file, or the clips' median look in a neutral band) until exposure, white
 * balance, saturation and contrast sit within tools/color-unify.ts's
 * tolerance, then one shared LUT look can go on top. Everything is one undo
 * step; the receipt lists every clip's stats before and after.
 *
 * The measuring is match_color_to_reference_tool's (catalog/color-agent.ts:
 * LookProfiles of isolated renders). The correction is solved per clip from
 * ColorGrade's own pixel math (tools/color-unify.ts), where match_color
 * copies one clip's correction to all of them.
 */

import { z } from "zod";
import type { Clip, Effect } from "../../model/types.js";
import { setClipEffects } from "../../ops/effects.js";
import { editedWhileRendering } from "../color-frames.js";
import { assessGradeOutcome, findColorGrade, SCALAR_DEFAULTS, SCALAR_KEYS, scalarY } from "../color-agent.js";
import { roundTo } from "../color-stats.js";
import {
  bandScore,
  closestToTarget,
  gradeSpread,
  outOfBand,
  solveUnifyKnobs,
  unifyGap,
  unifyStats,
  unifyTarget,
  UNIFY_KEYS,
  UNIFY_TOLERANCE,
  type UnifyKnobs,
} from "../color-unify.js";
import { directTool, type CatalogTool, type ToolCall } from "../define.js";
import { applied, refused, unchanged } from "../receipt.js";
import {
  colorTool,
  effectFactory,
  filterUnlocked,
  mergedGradeEffects,
  profileClipDense,
  profileMediaFile,
  resolveLutFile,
  type ProfilePack,
} from "./color-agent.js";
import { clipHasPicture } from "./effects-color-common.js";
import { resolveLayer, ToolError } from "./timeline-edit-common.js";

type Json = Record<string, unknown>;

const TOOL = "unify_grade_tool";
/** Frames measured per clip by default: enough for a median that ignores a flash, few enough for a 40-shot reel. */
const DEFAULT_SAMPLES = 5;

const input = z.strictObject({
  timeline_clip_ids: z
    .array(z.string().min(1))
    .min(1)
    .max(120)
    .optional()
    .describe("Clips to unify. Default: every footage clip (video or photo; not SVG titles, cards or audio) on unlocked tracks."),
  track: z.string().optional().describe("Only the footage clips on this track (UI track number or name)."),
  reference_clip_id: z
    .string()
    .optional()
    .describe("Timeline clip whose look the others match (it is not corrected). Default: the clips' median look, pulled into a neutral band."),
  reference_file_id: z.string().optional().describe("Media-bin video or image whose look the clips match, instead of a timeline clip."),
  strength: z
    .number()
    .min(0.1)
    .max(1)
    .optional()
    .describe("Share of each correction applied, 0.1-1 (default 1). Lower keeps more of each shot's own character."),
  look: z
    .string()
    .optional()
    .describe(
      "A LUT look laid over every unified clip after the correction (list_looks_tool ids, e.g. 'teal_cinema', 'warm_cinema'), so the look lands on matched plates.",
    ),
  look_intensity: z.number().min(0).max(1).optional().describe("Strength of the look, 0-1 (default the LUT's own, 1)."),
  samples: z.number().int().min(1).max(16).optional().describe(`Frames measured per clip (default ${DEFAULT_SAMPLES}).`),
  max_iterations: z
    .number()
    .int()
    .min(1)
    .max(6)
    .optional()
    .describe("Measure-and-correct passes per clip (default 4; a pass that clips the picture is dropped and retried gentler)."),
  dry_run: z.boolean().optional().describe("Measure and report the corrections without changing anything."),
});
type Input = z.output<typeof input>;

/** Footage worth grading: picture, and not a generated SVG/HTML card (titles, flashes, end cards keep their colours). */
function isFootage(clip: Clip): boolean {
  if (!clipHasPicture(clip)) return false;
  const path = String((clip.reader as unknown as Json | undefined)?.path ?? "").toLowerCase();
  return !/\.(svg|html?)$/.test(path);
}

function subjectsOf(call: ToolCall, args: Input, warnings: string[]): Clip[] {
  const project = call.doc.project;
  let clips: Clip[];
  if (args.timeline_clip_ids) {
    const ids = filterUnlocked(project, args.timeline_clip_ids, warnings);
    clips = ids.map((id) => project.clips.find((c) => c.id === id)!);
    for (const clip of clips.filter((c) => !clipHasPicture(c))) warnings.push(`clip ${clip.id} has no picture — skipped`);
    clips = clips.filter(clipHasPicture);
  } else {
    clips = project.clips.filter(isFootage);
    const ids = filterUnlocked(
      project,
      clips.map((c) => c.id),
      warnings,
    );
    clips = clips.filter((c) => ids.includes(c.id));
  }
  if (args.track) {
    const layer = resolveLayer(project, args.track);
    clips = clips.filter((c) => Number(c.layer) === layer);
  }
  return [...clips].sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
}

interface ClipOutcome {
  clip: Clip;
  before: Json;
  after: Json;
  effects: Effect[];
  /** not_corrected: out of the band, but no pass helped (nothing to solve, or every pass clipped the picture). */
  status: "in_band" | "unified" | "closer" | "not_corrected" | "unmeasured";
  passes: number;
}

/** The ColorGrade's scalar knobs that differ from neutral, and its LUT: what a receipt needs to say about a grade. */
function gradeKnobs(grade: Json): Json {
  const knobs: Json = {};
  for (const key of SCALAR_KEYS) {
    const value = scalarY(grade, key);
    if (value !== null && Math.abs(value - (SCALAR_DEFAULTS[key] ?? 0)) > 1e-4) knobs[key] = roundTo(value, 4);
  }
  if (grade.lut_path) knobs.lut_path = grade.lut_path;
  return knobs;
}

/** The knobs as the clip's first ColorGrade has them (neutral without one). */
function knobsOf(effects: readonly Effect[]): UnifyKnobs {
  const grade = (findColorGrade(effects) as Json | null) ?? {};
  return {
    exposure: scalarY(grade, "exposure") ?? 0,
    contrast: scalarY(grade, "contrast") ?? 0,
    temperature: scalarY(grade, "temperature") ?? 0,
    tint: scalarY(grade, "tint") ?? 0,
  };
}

/** Correct one clip toward the target on a working copy of its effects, re-measuring after each pass. */
async function unifyClip(
  call: ToolCall,
  clip: Clip,
  pack: ProfilePack,
  target: Json,
  opts: { strength: number; samples: number; maxIterations: number; create: (cn: string) => Json },
): Promise<ClipOutcome> {
  const before = pack.profile;
  let effects: Effect[] = [...(clip.effects ?? [])];
  if (!before.present) return { clip, before, after: before, effects, status: "unmeasured", passes: 0 };
  if (outOfBand(before, target).length === 0) return { clip, before, after: before, effects, status: "in_band", passes: 0 };
  // With strength below 1 the clip aims part of the way: a target between its own look and the shared one.
  const goal: Json = { ...target };
  for (const key of UNIFY_KEYS) {
    const a = Number(before[key]);
    const b = Number(target[key]);
    if (Number.isFinite(a) && Number.isFinite(b)) goal[key] = a + (b - a) * opts.strength;
  }
  let current = before;
  let passes = 0;
  // Halved after a pass that had to be dropped, so the next one tries a gentler step.
  let damping = 0.85;
  for (let it = 0; it < opts.maxIterations && damping > 0.1; it += 1) {
    const knobs = knobsOf(effects);
    const next = solveUnifyKnobs(current, goal, knobs, damping);
    const changes = Object.fromEntries((Object.keys(next) as (keyof UnifyKnobs)[]).filter((k) => next[k] !== knobs[k]).map((k) => [k, next[k]]));
    if (Object.keys(changes).length === 0) break;
    const tried = mergedGradeEffects(effects, changes, opts.create).effects;
    const measured = (await profileClipDense(call, { ...clip, effects: tried }, opts.samples)).profile;
    passes += 1;
    if (!measured.present) break;
    // A pass that clips the picture or does not move toward the target is dropped; the last good one stays.
    const outcome = assessGradeOutcome(current, measured, goal, false);
    const clipped = (outcome.reasons as string[]).some((r) => r.startsWith("clipped_"));
    if (clipped || bandScore(measured, goal) >= bandScore(current, goal) - 1e-6) {
      damping /= 2;
      continue;
    }
    effects = tried;
    current = measured;
    if (outOfBand(current, goal).length === 0) break;
  }
  const status = current === before ? "not_corrected" : outOfBand(current, goal).length === 0 ? "unified" : "closer";
  return { clip, before, after: current, effects, status, passes };
}

export const colorUnifyTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Unify grade",
    description:
      "Grade continuity for a whole cut: measures every footage clip's exposure, white balance, saturation and contrast on frames across it, " +
      "corrects each clip's ColorGrade toward one target (a reference clip/file, or the clips' median look in a neutral band) until it sits within " +
      "tolerance, then optionally lays one LUT look over all of them. Use after cutting and before the look, so bright daylight and near-black " +
      "shots stop jumping on the cut. One undo step; the receipt lists before/after stats per clip.",
    input,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    requires: ["frames"],
    run: (call, args: Input) =>
      colorTool(call, async () => {
        const project = call.doc.project;
        if (args.reference_clip_id && args.reference_file_id) return refused(TOOL, "Error: pass reference_clip_id or reference_file_id, not both");
        const warnings: string[] = [];
        let subjects: Clip[];
        try {
          subjects = subjectsOf(call, args, warnings);
        } catch (error) {
          if (error instanceof ToolError) return refused(TOOL, `Error: ${error.message}`);
          throw error;
        }
        const lut = args.look ? await resolveLutFile(call, args.look) : "";

        // The target: a reference's measured look, or the clips' median in the neutral band.
        let refPack: ProfilePack | null = null;
        let reference: Json;
        if (args.reference_clip_id) {
          const ref = project.clips.find((c) => c.id === args.reference_clip_id);
          if (!ref) return refused(TOOL, `Error: reference clip ${args.reference_clip_id} not found`);
          subjects = subjects.filter((c) => c.id !== ref.id);
          refPack = await profileClipDense(call, ref, args.samples ?? DEFAULT_SAMPLES);
          reference = { kind: "clip", timeline_clip_id: ref.id };
        } else if (args.reference_file_id) {
          const file = project.files.find((f) => String(f.id) === args.reference_file_id);
          if (!file) return refused(TOOL, `Error: media-bin file ${args.reference_file_id} not found`);
          refPack = await profileMediaFile(call, file);
          reference = { kind: "file", file_id: file.id };
        } else {
          reference = { kind: "median" };
        }
        if (refPack && !refPack.profile.present)
          return refused(TOOL, `Error: could not measure the reference's look (${String(refPack.profile.error ?? "no frames")})`);
        if (subjects.length === 0) {
          const why = warnings.length > 0 ? ` (${warnings.join("; ")})` : "";
          return refused(TOOL, `Error: no footage clips to unify${why}; pass timeline_clip_ids or add video to the timeline`);
        }
        if (!refPack && subjects.length < 2 && !lut)
          return refused(TOOL, "Error: unifying needs two or more clips, or a reference_clip_id / reference_file_id to match");

        const samples = args.samples ?? DEFAULT_SAMPLES;
        const packs: ProfilePack[] = [];
        for (const clip of subjects) {
          if (call.signal?.aborted) return refused(TOOL, "Error: cancelled; nothing changed");
          packs.push(await profileClipDense(call, clip, samples));
        }
        const target = refPack ? refPack.profile : unifyTarget(packs.map((p) => p.profile));
        if (!refPack) {
          const closest = closestToTarget(
            packs.map((p) => p.profile),
            target,
          );
          if (closest >= 0) reference.closest_clip_id = subjects[closest]!.id;
        }

        const create = effectFactory(project);
        const outcomes: ClipOutcome[] = [];
        for (const [i, clip] of subjects.entries()) {
          if (call.signal?.aborted) return refused(TOOL, "Error: cancelled; nothing changed");
          outcomes.push(
            await unifyClip(call, clip, packs[i]!, target, {
              strength: args.strength ?? 1,
              samples,
              maxIterations: args.max_iterations ?? 4,
              create,
            }),
          );
        }

        // The shared look goes over every unified clip (and a reference clip), after its correction.
        const lookIds = new Set(lut ? subjects.map((c) => c.id) : []);
        if (lut && args.reference_clip_id && filterUnlocked(project, [args.reference_clip_id], []).length > 0) lookIds.add(args.reference_clip_id);
        const finalEffects = new Map<string, Effect[]>(outcomes.map((o) => [o.clip.id, o.effects]));
        if (lut) {
          const lutPatch: Json = { path: lut };
          if (args.look_intensity !== undefined) lutPatch.strength = args.look_intensity;
          for (const id of lookIds) {
            const base = finalEffects.get(id) ?? [...(project.clips.find((c) => c.id === id)!.effects ?? [])];
            finalEffects.set(id, mergedGradeEffects(base, { lut: lutPatch }, create).effects);
          }
        }

        const before = outcomes.map((o) => o.before);
        const after = outcomes.map((o) => o.after);
        const rows = outcomes.map((o) => {
          const row: Json = {
            timeline_clip_id: o.clip.id,
            title: o.clip.title ?? "",
            status: o.status,
            passes: o.passes,
            before: unifyStats(o.before),
            after: unifyStats(o.after),
            gap_before: unifyGap(o.before, target),
            gap_after: unifyGap(o.after, target),
            out_of_band: outOfBand(o.after, target),
          };
          const grade = findColorGrade(finalEffects.get(o.clip.id) ?? []);
          row.grade = grade ? gradeKnobs(grade as Json) : null;
          return row;
        });
        const counts = {
          unified: 0,
          in_band: 0,
          closer: 0,
          not_corrected: 0,
          unmeasured: 0,
        };
        for (const o of outcomes) counts[o.status] += 1;
        const data: Json = {
          reference,
          target: unifyStats(target),
          tolerance: UNIFY_TOLERANCE,
          spread_before: gradeSpread(before),
          spread_after: gradeSpread(after),
          clips: rows,
          look: lut
            ? {
                look: args.look,
                lut_path: lut,
                intensity: args.look_intensity ?? null,
                timeline_clip_ids: [...lookIds],
              }
            : null,
          counts,
        };
        const writes = [...finalEffects].filter(
          ([id, effects]) => JSON.stringify(effects) !== JSON.stringify(project.clips.find((c) => c.id === id)?.effects ?? []),
        );
        const spreadWords = (s: Json): string => `luma ${String(s.avg_luma ?? "?")}, warm/cool ${String(s.warm_cool ?? "?")}`;
        const summary =
          `${counts.unified} of ${outcomes.length} clip(s) brought within the band, ${counts.in_band} already in it` +
          (counts.closer > 0 ? `, ${counts.closer} closer but not within it` : "") +
          (counts.not_corrected > 0 ? `, ${counts.not_corrected} out of it that no correction helped` : "") +
          (counts.unmeasured > 0 ? `, ${counts.unmeasured} not measured` : "") +
          `; spread ${spreadWords(data.spread_before as Json)} → ${spreadWords(data.spread_after as Json)}` +
          (lut ? `; look ${args.look} on ${lookIds.size} clip(s)` : "");
        if (args.dry_run || writes.length === 0) {
          data.applied = false;
          return args.dry_run
            ? applied(TOOL, `Dry run: ${summary}. Nothing changed.`, { data, warnings }, 0)
            : unchanged(TOOL, `Nothing to change: ${summary}`, {
                data,
                warnings,
              });
        }
        // The renders take a while: write nothing over an edit that landed meanwhile.
        for (const [id] of writes) {
          const original = subjects.find((c) => c.id === id) ?? project.clips.find((c) => c.id === id)!;
          const stale = editedWhileRendering(call, original, ["effects"]);
          if (stale) return refused(TOOL, `Error: ${stale}`);
        }
        call.commit((tx) => {
          for (const [id, effects] of writes) setClipEffects(tx, id, effects);
        }, "Unify grade");
        data.applied = true;
        data.undo = "one step";
        return applied(TOOL, `Unified the grade: ${summary}.`, {
          data,
          warnings,
          clips: writes.map(([id]) => ({ id })),
        });
      }),
  }),
];
