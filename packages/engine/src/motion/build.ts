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
 *   drawings   SVG files drawn at k = the element's largest scale: scale mode
 *              Best Fit (1), gravity top left (0), scale = pose scale / k / fit
 *              with fit = min(frame width / SVG width, frame height / SVG
 *              height), so the largest pose shows at the SVG's own pixel size
 *              at the project's frame size and keeps its share of the frame at
 *              any other render size (None draws at the pixel size whatever the
 *              size: too big in a smaller export). location = (centre - element
 *              centre × scale) / frame size; origin = the element centre
 *              (rotation pivot).
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
 *              collapse differently per renderer). SVG Tiny 1.2 has no
 *              letter-spacing: Qt may draw tracked text a few % wider or
 *              narrower; boxes and tile gaps leave room for it.
 *   text       text.ts: Helvetica advance widths, boxes 10 % roomy.
 *   type       layout.ts: every word at its role's floor or larger, a share
 *              of the frame's short side in either orientation: label 3 %,
 *              body 4 %, heading 7.5 % (33 / 44 / 81 px at 1080). Text that
 *              cannot fit at its floor takes more lines (`fitType`: balanced;
 *              `fitWrapped`: greedy, a text box), then is cut with an
 *              ellipsis, or refused where a cut would lose meaning (the typed
 *              phrase). Type on a card that ends smaller (a fan's side card)
 *              is set larger by that scale.
 *   safe area  layout.ts: 9:16 and taller frames keep words, and the button a
 *              pointer clicks, out of the platform bands: top 8 %, bottom 15 %,
 *              right 11 % (left: the margin). Pictures may run under them.
 *              Groups stay on the frame's vertical axis (a centred line is at
 *              most `centredWidth`) and centre on the safe area's middle
 *              (`opticalCentre`, 0.465 H on 9:16). Other frames: the margin.
 *   portrait   9:16 layouts per template: type_search stacks brand, prompt
 *              and field centred (the phrase on up to three lines of up to
 *              84u; two in landscape) and the whole group glides up (0.3 s,
 *              in_out; elements.ts `glide`) as the suggestions open, so field
 *              and list end centred; callout puts the prefix as a kicker over
 *              the name (heading size), fills the room with the product (4:5
 *              widening to square, at most 0.84 W) and gives each label a slot
 *              above or below it, standing on a rule its leader rises or
 *              drops to; crop_labels keeps boxes and tags in the safe area and
 *              lifts the crops into a column of tiles, labels beside them;
 *              step_card stacks the header (top safe line), a 4:5 card with
 *              the label box on its top edge and the caption down to the
 *              bottom safe line; ui_cards' cascade, word_scroll's selected
 *              line, kinetic_type (center) and the end cards centre on
 *              `opticalCentre`; the editorial sheet's corner labels sit on the
 *              safe area's top and bottom lines. A crop to a card's shape
 *              centres on the points given on the footage (step_card's arrow,
 *              callout's anchors: `cropToAspect` focus, `inWindow`), so they
 *              stay in view. 16:9 keeps its layouts: only the type floors, the
 *              search group's centring and the callout product (cropped
 *              squarer beside the wider labels) change it.
 *   grid       tiles.ts places the tiles (rectangles in reveal order); montage-grid.ts
 *              counts time in slots of a beat (two on a fast tempo, half a beat in a
 *              short template): each stage's new tiles reveal one per slot, a layout
 *              step cuts on a beat (tiles already up reappear in their new places),
 *              merge / zoom_into start on a beat after the full grid has held. Every
 *              tile is a media element (Crop to its shape, corner_radius, keyed pose);
 *              a wipe is a second Crop that does not resize; a tile growing to the
 *              frame keys corner_radius to 0 (Pose.radius). No tile has a short side
 *              under 13 % of the frame's short side.
 *   tracks     `MotionPlan.tracks` stacked on the lowest free tracks above the
 *              video (add_motion_template_tool); a reel puts its music bed
 *              lowest and the scenes above it (build_reel_tool).
 */

import { layoutOf } from "./layout.js";
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
