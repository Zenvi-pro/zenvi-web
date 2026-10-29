/**
 * What every template generator takes and returns. A generator is a pure
 * function of its input: the frame, where it starts on the timeline, its
 * length, the beat grid, a palette, the media it may show and its content.
 * It returns elements (elements.ts) and the cue frames where something
 * enters; `planOf` (keyframes.ts) turns them into timeline layers.
 */

import type { Layout } from "./layout.js";
import type { TemplateBeats } from "./grid.js";
import type { GridLayoutId } from "./tiles.js";
import type { Element, MotionFrame, MotionMedia, Palette } from "./types.js";

export const MOTION_TEMPLATE_IDS = [
  "ui_cards",
  "type_search",
  "word_scroll",
  "crop_labels",
  "callout",
  "kinetic_type",
  "step_card",
  "grid_background",
  "end_card",
  "grid",
  "card_cascade",
  "compare",
  "window_cascade",
  "pass_wipe",
] as const;
export type MotionTemplateId = (typeof MOTION_TEMPLATE_IDS)[number];

export function isMotionTemplateId(value: string): value is MotionTemplateId {
  return (MOTION_TEMPLATE_IDS as readonly string[]).includes(value);
}

/** A point on a picture or the frame, 0..1 from the top left. */
export interface NormPoint {
  x: number;
  y: number;
}

/** A box on the frame, 0..1 (centre and size). */
export interface NormBox extends NormPoint {
  w: number;
  h: number;
}

/** How the montage grid reveals a tile on its beat. */
export const GRID_REVEALS = ["pop", "slide", "wipe", "fade", "cut"] as const;
export type GridReveal = (typeof GRID_REVEALS)[number];

/** A slow camera move over the whole field: push in, pull out, or pan (the field overscanned so no edge shows). */
export const GRID_DRIFTS = ["in", "out", "left", "right", "up", "down"] as const;
export type GridDrift = (typeof GRID_DRIFTS)[number];

/**
 * The grid template's options (layout names and tile counts: tiles.ts). Sizes
 * are px on a frame whose short side is 1080 (they scale with the frame).
 */
export interface GridOptions {
  layout?: GridLayoutId;
  /** Tiles in the layout (default per layout). */
  tiles?: number;
  /** Layout steps instead of `tiles`: tile counts in increasing order, the grid re-cut on a beat for each. */
  steps?: readonly number[];
  /** A band narrower than the frame: "16:9", "21:9", a number (width / height); default the whole frame. */
  band?: string | number;
  gutter?: number;
  radius?: number;
  reveal?: GridReveal;
  /** The last tile to arrive grows to fill the frame. */
  merge?: boolean;
  /** The camera pushes into this tile (1-based, in the final layout) until it fills the frame. */
  zoomInto?: number;
  /** repeat: seconds each copy runs ahead of the one before (copies out of phase); default 0. */
  phase?: number;
  /** repeat: alternate copies mirrored so their edges meet (kaleidoscope always is). */
  mirror?: boolean;
  /** A slow camera move over the whole field for the template's length. */
  drift?: GridDrift;
}

/**
 * Content of a template. Each template reads the fields it documents
 * (TEMPLATE_DOCS) and refuses what it cannot use.
 */
export interface MotionContent {
  /** The main text: the typed phrase, the headline, the end card's title, a step's caption, the product name. */
  text?: string;
  subtitle?: string;
  /** A word list (word_scroll). */
  words?: readonly string[];
  /** Media-bin files: cards, tiles, the shot, the product. */
  fileIds?: readonly string[];
  /** Short labels: card chips, crop boxes, callouts. */
  labels?: readonly string[];
  /** Second lines of callouts (a spec, a number). */
  values?: readonly string[];
  /** Callout anchors on the product picture, or the point a step's label arrow points at. */
  points?: readonly NormPoint[];
  /** Crop boxes on the frame. */
  boxes?: readonly NormBox[];
  /** A button's label (type_search, ui_cards). */
  button?: string;
  /** A small tag (kinetic_type, end_card). */
  tag?: string;
  /** Step number (step_card). */
  step?: number;
  /** Word to mark with the highlighter (kinetic_type), 0-based. */
  highlight?: number;
  /** Look variant: grid_background paper | editorial | dots | plain; end_card logo | save | plain. */
  variant?: string;
  align?: "left" | "center";
  position?: "top" | "center" | "bottom";
  /** Draw the template's own background (end_card, type_search, word_scroll; grid defaults to on). */
  backdrop?: boolean;
  /** The montage grid's layout and timing options. */
  grid?: GridOptions;
  /** Keep the clips' own sound (card_cascade: each card's while it is the newest; compare: the first clip's). */
  sound?: boolean;
  /** compare: end on the last clip alone, the split growing back into one full frame. */
  replay?: boolean;
}

export interface TemplateInput {
  frame: MotionFrame;
  layout: Layout;
  /** Length, frames. */
  frames: number;
  beats: TemplateBeats;
  palette: Palette;
  /** Media the content names, by file id (checked before the generator runs). */
  media: ReadonlyMap<string, MotionMedia>;
  content: MotionContent;
}

export interface TemplateOutput {
  elements: Element[];
  cues: number[];
  /** What the template changed to fit (the tool's receipt warnings). */
  warnings?: string[];
}

/** A content problem the caller can fix (the tool refuses with this message). */
export class MotionInputError extends Error {
  override readonly name = "MotionInputError";
}

export function refuse(message: string): never {
  throw new MotionInputError(message);
}

export interface TemplateSpec {
  id: MotionTemplateId;
  /** One line: what it looks like and how it moves. */
  summary: string;
  /** Content fields it reads, for the tool description. */
  reads: string;
  /** Natural length in beats for this content at `bpm` (the tool's default duration). */
  beats(content: MotionContent, bpm: number): number;
  /** Media the content must name (by role) — validated before generation. */
  media: "none" | "optional" | "required";
  build(input: TemplateInput): TemplateOutput;
}
