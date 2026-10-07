/**
 * Structural validation of project JSON.
 *
 * Checks the shapes the engine relies on and nothing more: every object is
 * "loose" (unknown keys are allowed and kept), top-level keys are optional
 * (missing ones are filled from the default project), and collection items
 * must carry the fields timeline math reads (ids, positions, trims, track
 * numbers). Any property that holds a `Points` list must be a keyframe
 * libopenshot can load (numeric coordinates), because `Keyframe::SetJsonValue`
 * throws on anything else.
 *
 * The schema only validates; `parseProject` keeps the input's own objects so
 * key order and unknown keys survive exactly.
 */

import { z } from "zod";
import type { ProjectIssue } from "./errors.js";
import { formatIssuePath } from "./errors.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const record = z.record(z.string(), z.unknown());

const coordinate = z.looseObject({
  X: z.number().optional(),
  Y: z.number().optional(),
});

const keyframePoint = z.looseObject({
  co: coordinate.optional(),
  handle_left: coordinate.optional(),
  handle_right: coordinate.optional(),
  handle_type: z.number().optional(),
  interpolation: z.number().optional(),
});

const keyframe = z.looseObject({ Points: z.array(keyframePoint) });

/**
 * Validate every keyframe held directly by `value` (a clip, effect or
 * transition), including the channels of color keyframes (`wave_color.red`).
 */
function checkKeyframes(value: Record<string, unknown>, ctx: z.RefinementCtx): void {
  const check = (candidate: unknown, path: (string | number)[]): void => {
    const result = keyframe.safeParse(candidate);
    if (result.success) return;
    for (const issue of result.error.issues) {
      ctx.addIssue({ code: "custom", message: issue.message, path: [...path, ...(issue.path as (string | number)[])] });
    }
  };
  for (const [key, prop] of Object.entries(value)) {
    if (!isRecord(prop)) continue;
    if ("Points" in prop) {
      check(prop, [key]);
      continue;
    }
    for (const [channel, inner] of Object.entries(prop)) {
      if (isRecord(inner) && "Points" in inner) check(inner, [key, channel]);
    }
  }
}

const fraction = z.looseObject({ num: z.number().positive(), den: z.number().positive() });

const effect = z
  .looseObject({
    id: z.string().min(1),
    type: z.string().optional(),
    class_name: z.string().optional(),
  })
  .superRefine(checkKeyframes);

const file = z.looseObject({
  id: z.string().min(1),
  path: z.string(),
  duration: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  fps: z.looseObject({ num: z.number(), den: z.number() }).optional(),
  has_audio: z.boolean().optional(),
  has_video: z.boolean().optional(),
  media_type: z.string().optional(),
});

const clip = z
  .looseObject({
    id: z.string().min(1),
    file_id: z.string(),
    position: z.number(),
    start: z.number(),
    end: z.number(),
    layer: z.number(),
    reader: record.optional(),
    effects: z.array(effect).optional(),
  })
  .superRefine(checkKeyframes);

const transition = z
  .looseObject({
    id: z.string().min(1),
    position: z.number(),
    start: z.number(),
    end: z.number(),
    layer: z.number(),
    reader: record.optional(),
  })
  .superRefine(checkKeyframes);

const layer = z.looseObject({
  id: z.string().min(1),
  number: z.number(),
  label: z.string().optional(),
  lock: z.boolean().optional(),
});

const marker = z.looseObject({
  id: z.string().min(1),
  position: z.number(),
});

/** Top level. Every key is optional: `parseProject` fills missing ones. */
export const projectSchema = z.looseObject({
  id: z.string().min(1).optional(),
  fps: fraction.optional(),
  display_ratio: fraction.optional(),
  pixel_ratio: fraction.optional(),
  width: z.int().positive().optional(),
  height: z.int().positive().optional(),
  sample_rate: z.int().positive().optional(),
  channels: z.int().nonnegative().optional(),
  channel_layout: z.int().optional(),
  settings: record.optional(),
  clips: z.array(clip).optional(),
  effects: z.array(transition).optional(),
  files: z.array(file).optional(),
  duration: z.number().nonnegative().optional(),
  scale: z.number().positive().optional(),
  tick_pixels: z.number().positive().optional(),
  playhead_position: z.number().nonnegative().optional(),
  profile: z.string().optional(),
  // The desktop saves the export dialog's widget states as a list.
  export_settings: z.union([z.array(z.unknown()), record, z.null()]).optional(),
  export_overrides: z.union([record, z.null()]).optional(),
  layers: z.array(layer).optional(),
  markers: z.array(marker).optional(),
  progress: z.array(z.unknown()).optional(),
  history: z
    .union([
      z.looseObject({ undo: z.array(z.unknown()).optional(), redo: z.array(z.unknown()).optional() }),
      z.null(),
    ])
    .optional(),
  version: z
    .looseObject({ "openshot-qt": z.string().optional(), libopenshot: z.string().optional() })
    .optional(),
});

/** Validate `json` against the project schema. Returns every problem found. */
export function validateProject(json: unknown): ProjectIssue[] {
  if (!isRecord(json)) return [{ path: "", message: "expected a JSON object" }];
  const result = projectSchema.safeParse(json);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({ path: formatIssuePath(issue.path), message: issue.message }));
}
