/**
 * What every template generator takes and returns. A generator is a pure
 * function of its input: the frame, where it starts on the timeline, its
 * length, the beat grid, a palette, the media it may show and its content.
 * It returns elements (elements.ts) and the cue frames where something
 * enters; `planOf` (keyframes.ts) turns them into timeline layers.
 */

import type { Layout } from "./layout.js";
import type { TemplateBeats } from "./grid.js";
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
  /** Draw the template's own background (end_card, type_search, word_scroll). */
  backdrop?: boolean;
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
