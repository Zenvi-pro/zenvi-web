/**
 * One motion template, from its input to a plan of timeline layers.
 *
 * Porting to Zenvi desktop (Python): the generators are pure and data-driven;
 * a port reproduces these rules and can diff its plans against this code's
 * (the plan is plain JSON, deterministic for a given input).
 *
 *   time       whole frames from the template's start. A clip's keyframe X is
 *              frame - clip start + 1, plus round(in-point × fps) for media
 *              clips: libopenshot evaluates keyframes at the clip's source
 *              frame (timeline/windows.ts). In-points are put on the frame grid.
 *   beats      TemplateBeats (grid.ts) over the reel planner's grid; entrances
 *              at beats and half beats; staggered parts record their beat in
 *              `cue` (MotionLayer.cue).
 *   drawings   SVG files at their own pixel size: scale mode None (3), gravity
 *              top left (0), drawn at k = the element's largest scale so the
 *              scale_x/scale_y points top out at exactly 1 (libopenshot sizes a
 *              None clip's raster by the largest points, keeping the aspect,
 *              then scales again). location = (centre - element centre × scale)
 *              / frame size; origin = the element centre (rotation pivot).
 *   media      scale mode Best Fit (1), gravity centre (4); scale = rest width
 *              / fitted width × pose scale, location = (centre - frame centre)
 *              / frame size; card shapes from a Crop effect with resize; corners
 *              from corner_radius (a share of the picture's short side).
 *   easing     one bezier per segment on every property (the desktop keyframe
 *              menu's presets, keyframes.ts PRESET_OF), so a drawing and the
 *              media under it move as one.
 *   SVG        svg.ts: rect/line/polyline/path/circle/text/tspan only; Qt's
 *              SVG renderer reads a font-family list as one name, so the port
 *              should write one installed family (a Helvetica/Arial-metric sans,
 *              a 0.6 em monospace: not Consolas, which is narrower); a word
 *              space rides on the previous word's span (whitespace-only spans
 *              collapse differently per renderer).
 *   text       text.ts: Helvetica advance widths, boxes 10 % roomy.
 *   tracks     `MotionPlan.tracks` stacked on the lowest free tracks above the
 *              video (add_motion_template_tool); a reel puts its music bed
 *              lowest and the scenes above it (build_reel_tool).
 */

import { layoutOf } from "./elements.js";
import { TemplateBeats } from "./grid.js";
import { planOf } from "./keyframes.js";
import { TEMPLATES } from "./templates/index.js";
import { refuse, type MotionContent, type MotionTemplateId } from "./template.js";
import type { BeatGrid, MotionFrame, MotionMedia, MotionPlan, Palette } from "./types.js";

export interface BuildTemplateInput {
  template: MotionTemplateId;
  frame: MotionFrame;
  /** Timeline start, seconds (on the frame grid). */
  start: number;
  /** Length, seconds (default: the template's natural length in beats). */
  seconds?: number;
  grid: BeatGrid;
  palette: Palette;
  /** Media the content names, by file id. */
  media: ReadonlyMap<string, MotionMedia>;
  content: MotionContent;
}

/** Shortest template, frames. */
const MIN_FRAMES = 6;

/** Length in frames of a template that starts at `start`: `seconds`, or its natural number of beats. */
export function templateFrames(input: Pick<BuildTemplateInput, "template" | "frame" | "start" | "seconds" | "grid" | "content">): number {
  if (input.seconds !== undefined) return Math.max(MIN_FRAMES, Math.round(input.seconds * input.frame.fps));
  const beats = new TemplateBeats(input.grid, input.start, input.frame.fps);
  return Math.max(MIN_FRAMES, beats.frame(TEMPLATES[input.template].beats(input.content, input.grid.bpm)));
}

export function buildMotionTemplate(input: BuildTemplateInput): MotionPlan {
  const spec = TEMPLATES[input.template];
  if (!spec) refuse(`unknown motion template ${input.template}`);
  const frames = templateFrames(input);
  const beats = new TemplateBeats(input.grid, input.start, input.frame.fps);
  const layout = layoutOf(input.frame);
  const out = spec.build({ frame: input.frame, layout, frames, beats, palette: input.palette, media: input.media, content: input.content });
  return planOf(spec.id, frames, out.elements, out.cues, input.frame);
}
