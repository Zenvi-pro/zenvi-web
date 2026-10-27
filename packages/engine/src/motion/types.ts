/**
 * Motion templates: the data a template generator returns. A plan is a list
 * of layers; each layer is one timeline clip (an SVG drawing or a media-bin
 * file) with its placement in frames and its clip keyframes as libopenshot
 * JSON, so every surface (desktop, web editor, CLI, cloud) places and draws it
 * the same way. Generators work in whole frames from the template's start, so
 * every clip edge and keyframe is on the frame grid by construction.
 */

import type { Effect } from "../model/types.js";
import type { Drawing } from "./svg.js";

export interface MotionFrame {
  width: number;
  height: number;
  /** Frames per second (num / den). */
  fps: number;
}

/** Beats on the timeline, seconds (from the reel plan, `detect_beats_tool`, or a tempo). */
export interface BeatGrid {
  bpm: number;
  beats: readonly number[];
  downbeats: readonly number[];
}

/** A video or photo from the media bin that a template shows. */
export interface MotionMedia {
  fileId: string;
  kind: "video" | "image";
  /** Display size, pixel aspect applied. */
  width: number;
  height: number;
  /** Seconds of video (0 for photos). */
  duration: number;
}

/** Colours of a template, as #rrggbb. */
export interface Palette {
  name: PaletteId;
  /** The field: paper, a dark void, a flat colour. */
  background: string;
  /** Cards, label boxes, fields. */
  surface: string;
  ink: string;
  muted: string;
  /** Grid lines, rules, borders. */
  line: string;
  accent: string;
  /** Text on the accent. */
  accentInk: string;
  /** A second accent: the editorial blue, the tutorial highlighter. */
  second: string;
  shadow: string;
  shadowOpacity: number;
  dark: boolean;
}

export const PALETTE_IDS = ["ui_light", "ui_dark", "editorial", "callout", "tutorial"] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

/** How a segment of motion arrives at its key (a CSS cubic-bezier, linear, or a hold). */
export type Ease = "linear" | "hold" | "smooth" | "out" | "out_strong" | "out_back" | "in" | "in_out";

/**
 * An element's pose: its centre on the frame (px), scale relative to rest,
 * opacity, rotation (degrees), and an extra horizontal stretch `sx` (a line
 * drawing on from its start: the element's centre is that start). `radius`
 * is a media card's corner radius on screen (px) at that pose; without it
 * the corners keep the card's own radius, scaled with the pose.
 */
export interface Pose {
  x: number;
  y: number;
  s: number;
  alpha: number;
  rotation: number;
  sx?: number;
  radius?: number;
}

/** A key of an element's motion at a template frame; `ease` shapes the segment that ends here. */
export interface Key {
  frame: number;
  pose: Pose;
  ease: Ease;
}

/**
 * An SVG drawing. `draw(k)` draws it at `k` times its rest size (`width` ×
 * `height`, frame px); (`cx`, `cy`) is the element's centre inside the
 * drawing, the point poses place and rotations turn about.
 */
export interface SvgSource {
  kind: "svg";
  /** File name stem (unique within a plan). */
  name: string;
  width: number;
  height: number;
  cx: number;
  cy: number;
  draw(k: number): Drawing;
}

/** A crop window of a source, as fractions of each side (libopenshot Crop with resize). */
export interface CropWindow {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * A media-bin file. `fit`: the picture (or its `crop` window) at `width` px
 * wide, moved by poses, corners rounded by `radius` px. `fill`: it covers the
 * frame (scale mode Crop); poses may only scale and fade it.
 */
export interface MediaSource {
  kind: "media";
  media: MotionMedia;
  mode: "fit" | "fill";
  width: number;
  radius: number;
  crop?: CropWindow;
  /** Source in-point, seconds (videos). */
  start: number;
  /** Playback speed (below 1 when a short clip is slowed to fill its time). */
  speed: number;
  /** Keep the clip's own sound (default: muted under the music). */
  sound?: boolean;
  /** Mirrored left-right (x) or top-bottom (y): a negative scale, centred (a kaleidoscope segment). */
  flip?: { x: boolean; y: boolean };
}

/** One clip of a template while it is being designed: what it shows, when, and how it moves. */
export interface Element {
  name: string;
  /** Track in the template's stack, 0 = lowest. */
  track: number;
  /** First frame and end frame (exclusive), from the template's start. */
  from: number;
  to: number;
  source: SvgSource | MediaSource;
  /** At least one key; one key = a still element. */
  keys: Key[];
  effects?: Omit<Effect, "id">[];
  /**
   * The beat this element's entrance belongs to, when it starts a few frames
   * after it (a keystroke, an arrowhead after its line). Default `from`.
   */
  cue?: number;
  /** It runs past the frame by design (a scrolling list). */
  bleed?: boolean;
}

/** A drawn SVG as a layer carries it: the text and its size. */
export interface LayerSvg {
  kind: "svg";
  name: string;
  svg: string;
  width: number;
  height: number;
}

export interface LayerMedia {
  kind: "media";
  fileId: string;
  /** Source in and out points, seconds, before `speed`. */
  start: number;
  end: number;
  speed: number;
  sound: boolean;
}

/** One timeline clip of a plan. */
export interface MotionLayer {
  name: string;
  track: number;
  /** First frame (from the plan's start) and length, frames. */
  start: number;
  frames: number;
  source: LayerSvg | LayerMedia;
  /** Clip keys to set: scale mode, gravity, keyframes (libopenshot JSON), corner_radius. */
  props: Record<string, unknown>;
  effects: Omit<Effect, "id">[];
  /** Frame of the beat (or the template's start) this layer's entrance belongs to. */
  cue: number;
  /** It runs past the frame by design. */
  bleed: boolean;
}

export interface MotionPlan {
  template: string;
  /** Length, frames. */
  frames: number;
  /** Tracks the layers use (track numbers 0 … tracks - 1). */
  tracks: number;
  layers: MotionLayer[];
  /** Frames where something enters or changes: the template's start or a beat (half beat) of the grid. */
  cues: number[];
}
