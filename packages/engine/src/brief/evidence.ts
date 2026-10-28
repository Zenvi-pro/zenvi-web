/**
 * What a finished project shows of the tools that built it. The brief names
 * each borrowed technique's tools; a technique counts as used when one of its
 * tools left a mark on the timeline. Tools that leave nothing a later reader
 * can tell apart from a hand edit (a montage of plain cuts) have no entry:
 * their techniques are reported as unverified, never as missing.
 */

import { listProjectMotionTransitions } from "../ops/motion-transitions.js";
import type { Clip, Project, ProjectFile } from "../model/types.js";
import { isSfxClip, KINETIC_CAPTIONS_KEY } from "../sfx/moments.js";
import { isColorGradeEffect } from "../tools/color-agent.js";

type Evidence = (project: Project) => boolean;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const clipHas = (key: string): Evidence => (p) => p.clips.some((c) => (c as Record<string, unknown>)[key] !== undefined && (c as Record<string, unknown>)[key] !== null);

const effectWhere = (test: (effect: Record<string, unknown>) => boolean): Evidence => (p) => p.clips.some((c) => (c.effects ?? []).some((e) => test(e as Record<string, unknown>)));

function linkKind(item: Clip | ProjectFile): string {
  return String(record((item as Record<string, unknown>).zenvi_link).kind ?? "");
}

const linked = (kind: string): Evidence => (p) => p.files.some((f) => linkKind(f) === kind) || p.clips.some((c) => linkKind(c) === kind);

const look = (name: string): Evidence => effectWhere((e) => e.zenvi_look === name);

const motionTransitions: Evidence = (p) => listProjectMotionTransitions(p).length > 0;
const composite = clipHas("zenvi_composite");
const sfx: Evidence = (p) => p.clips.some(isSfxClip);
const grade = effectWhere(isColorGradeEffect);
const titles: Evidence = (p) => p.clips.some((c) => /\.svg$/i.test(String(c.reader?.path ?? "")));

const EVIDENCE: Readonly<Record<string, Evidence>> = {
  apply_motion_transitions_tool: motionTransitions,
  apply_motion_transition_tool: motionTransitions,
  apply_transition_tool: (p) => p.effects.length > 0,
  add_transition_tool: (p) => p.effects.length > 0,
  add_transitions_between_clips_tool: (p) => p.effects.length > 0,
  kinetic_captions_tool: clipHas(KINETIC_CAPTIONS_KEY),
  add_captions_tool: effectWhere((e) => e.class_name === "Caption"),
  add_kinetic_title_tool: clipHas("zenvi_kinetic_title"),
  add_title_tool: titles,
  add_animated_title_tool: titles,
  add_motion_block_tool: linked("zenvi-motion"),
  add_3d_scene_tool: linked("blender"),
  apply_fx_tool: linked("zenvi-fx"),
  text_behind_subject_tool: composite,
  replace_background_tool: composite,
  subject_glow_tool: composite,
  pop_out_tool: composite,
  speed_ramp_tool: clipHas("zenvi_speed_ramp"),
  unify_grade_tool: grade,
  color_grade_clip_tool: grade,
  apply_look_tool: (p) => grade(p) || effectWhere((e) => typeof e.zenvi_look === "string")(p),
  add_vignette_tool: look("vignette"),
  add_shape_mask_tool: look("shape_mask"),
  add_sfx_tool: sfx,
  auto_sound_design_tool: sfx,
};

/** Tools whose mark this module can read. */
export function hasEvidence(tool: string): boolean {
  return tool in EVIDENCE;
}

/** Whether `tool` left its mark on `project` (null: the tool leaves none this module can read). */
export function toolUsed(project: Project, tool: string): boolean | null {
  const test = EVIDENCE[tool];
  return test ? test(project) : null;
}
