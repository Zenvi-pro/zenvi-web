/**
 * The clip property model behind the clip-props tools: which properties a
 * timeline clip has (libopenshot's own `Clip.PropertiesJSON`: labels,
 * types, ranges, choices), which of them can be animated, what values a
 * model may send for each (choice names like "Best Fit" or "multiply",
 * colours, numbers inside the editor's limits), and where a keyframe lands
 * for a time given in clip, timeline or source seconds.
 *
 * Port of zenvi-core develop 1f80cb3d0
 * src/classes/editor_tools/clip_props_model.py. The desktop reads the schema
 * from a detached libopenshot Clip; the engine has the same tables, generated
 * from libopenshot 1.0 (model/libopenshot-defaults.data.ts). Refusals throw
 * the desktop's `ToolError` with its wording.
 */

import { COLOR_CHANNELS } from "../keyframe/color.js";
import { curvePoints, editorPoint, keyframeValue, maxTransformMultiple, pointX, pointY } from "../keyframe/rules.js";
import { expandCompact } from "../model/compact.js";
import { LIBOPENSHOT_CLIP_JSON, LIBOPENSHOT_CLIP_PROPERTIES } from "../model/libopenshot-defaults.data.js";
import type { PropertyMeta } from "../model/properties.js";
import { pyRound } from "../model/rounding.js";
import { videoLengthToProjectFrames } from "../model/timing.js";
import { Interpolation, type Clip, type KeyframePoint, type Project } from "../model/types.js";
import { KEYFRAME_BEZIER_PRESETS } from "../ops/keyframes.js";
import { ToolError } from "./catalog/timeline-edit-common.js";
import { parsePythonFloat } from "./coerce.js";
import { pyFixed, pyFloat, pyG, pyRepr, pyReprString } from "./pyfmt.js";
import { TextToolError, parseEditorColor, type Rgba } from "./titles-text.js";

export { COLOR_CHANNELS };

export const INTERPOLATION_NAMES: Readonly<Record<number, string>> = {
  [Interpolation.BEZIER]: "bezier",
  [Interpolation.LINEAR]: "linear",
  [Interpolation.CONSTANT]: "constant",
};

/** libopenshot's handle_right X/Y, handle_left X/Y. */
const DEFAULT_HANDLES = [0.5, 0.0, 0.5, 1.0] as const;

/** Keys the generic tools refuse, with the reason the model is told. */
const REFUSED: Readonly<Record<string, string>> = {
  id: "the clip id is read-only",
  duration: "duration is read-only; trim the clip's start/end with the timeline editing tools",
  position: "position is the clip's place on the timeline; move it with the timeline editing tools",
  start: "start is the clip's trim in point; trim it with the timeline editing tools",
  end: "end is the clip's trim out point; trim it with the timeline editing tools",
  layer: "layer is the clip's track; move it to another track with the timeline editing tools",
};
const NOT_RENDERED = /^perspective_c[1-4]_[xy]$/;

/** The Volume menu's 130% ceiling (audio_mix.MAX_LEVEL). */
export const MAX_VOLUME = 1.3;
/** Ranges the editor itself goes beyond libopenshot's nominal ones. */
const RANGE_OVERRIDES: Readonly<Record<string, readonly [number, number]>> = {
  // Slide presets move a picture-in-picture a full frame past its offset.
  location_x: [-10.0, 10.0],
  location_y: [-10.0, 10.0],
  // Spin presets add a full turn to the current angle.
  rotation: [-3600.0, 3600.0],
  volume: [0.0, MAX_VOLUME],
};
const SCALE_KEYS = new Set(["scale_x", "scale_y", "shear_x", "shear_y"]);

const PROPERTY_ALIASES: Readonly<Record<string, string>> = {
  opacity: "alpha",
  blend: "composite",
  blend_mode: "composite",
  blendmode: "composite",
  parent: "parentObjectId",
  parent_object_id: "parentObjectId",
  frame_number: "display",
  volume_mixing: "mixing",
  enable_audio: "has_audio",
  enable_video: "has_video",
  scale_mode: "scale",
  fit: "scale",
  anchor_point: "gravity",
};

const ON_OFF = { true: "On", false: "Off", yes: "On", no: "Off", enabled: "On", disabled: "Off" };
const CHOICE_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  scale: { fit: "Best Fit", contain: "Best Fit", fill: "Crop", cover: "Crop", distort: "Stretch", original: "None" },
  gravity: { top: "Top Center", bottom: "Bottom Center", centre: "Center", middle: "Center", topmiddle: "Top Center", bottommiddle: "Bottom Center" },
  composite: {
    over: "Normal",
    sourceover: "Normal",
    plus: "Add",
    additive: "Add",
    burn: "Color Burn",
    dodge: "Color Dodge",
    colourburn: "Color Burn",
    colourdodge: "Color Dodge",
  },
  has_audio: ON_OFF,
  has_video: ON_OFF,
  waveform: { true: "Yes", false: "No", on: "Yes", off: "No", show: "Yes", hide: "No" },
};

/** `_norm`: lower case without spaces, underscores, dashes, slashes or brackets. */
function norm(text: unknown): string {
  return String(text).trim().toLowerCase().replace(/[\s_\-/()]+/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// libopenshot's clip schema
// ---------------------------------------------------------------------------

const PROPS: Readonly<Record<string, PropertyMeta>> = LIBOPENSHOT_CLIP_PROPERTIES;
/** `Clip.Json()` of a detached clip (the shapes properties default to). */
const SHAPES: Readonly<Record<string, unknown>> = Object.freeze(expandCompact<Record<string, unknown>>(LIBOPENSHOT_CLIP_JSON));
/** `Clip.Json()` also has these, which the engine's table leaves out. */
const SHAPE_KEYS = new Set([...Object.keys(SHAPES), "id", "reader"]);

function shape(key: string): unknown {
  return SHAPES[key];
}

/** `PropertiesJSON(1)`'s value for a default clip: what an unset property reads as. */
function propertyDefault(key: string): unknown {
  const value = shape(key);
  if (isRecord(value) && Array.isArray(value.Points)) {
    const first = curvePoints(value)[0];
    return first ? pointY(first) : 0.0;
  }
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return 0.0;
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

export type Choice = readonly [name: string, value: number | string | boolean];

export interface PropertyInfo {
  key: string;
  label: string;
  /** float | int | color | string */
  kind: string;
  keyframable: boolean;
  choices: readonly Choice[];
  minimum: number | null;
  maximum: number | null;
  default: unknown;
}

export function isChoice(info: PropertyInfo): boolean {
  return info.choices.length > 0;
}

function choiceName(info: PropertyInfo, value: unknown): string | undefined {
  for (const [name, val] of info.choices) {
    if (Number(val) === Number(value) && value !== null && value !== undefined && value !== "") return name;
  }
  return undefined;
}

/** PropertyInfo.describe: label, type, keyframable and the choices or the range. */
export function describeInfo(info: PropertyInfo): Record<string, unknown> {
  const out: Record<string, unknown> = { label: info.label, type: info.kind, keyframable: info.keyframable };
  if (info.choices.length > 0) out.choices = info.choices.map(([name]) => name);
  else if (info.minimum !== null && (info.kind === "float" || info.kind === "int")) {
    out.min = info.minimum;
    out.max = info.maximum;
  }
  return out;
}

/** Every key the clip tools can read and set, sorted. */
export function settableKeys(): string[] {
  return Object.keys(PROPS)
    .filter((key) => !(key in REFUSED))
    .sort();
}

/** A property key from its key, label ("Scale X") or a common alias ("opacity"); refusals otherwise. */
export function resolveKey(name: unknown): string {
  const raw = String(name ?? "").trim();
  if (!raw) throw new ToolError("a property name is required");
  let key: string | undefined;
  if (raw in PROPS || SHAPE_KEYS.has(raw)) {
    key = raw;
  } else {
    const wanted = norm(raw);
    key = Object.keys(PROPS).find((k) => norm(k) === wanted);
    key ??= Object.entries(PROPS).find(([, meta]) => norm(meta.name ?? "") === wanted)?.[0];
    key ??= PROPERTY_ALIASES[raw.toLowerCase()] ?? PROPERTY_ALIASES[wanted];
    if (!key && NOT_RENDERED.test(raw.toLowerCase())) key = raw.toLowerCase();
  }
  if (!key) throw new ToolError(`unknown clip property ${pyReprString(raw)}; settable: ${settableKeys().join(", ")}`);
  if (NOT_RENDERED.test(key)) {
    throw new ToolError(
      `${key}: libopenshot 1.0 does not render perspective corners, so the editor does not offer them; use scale, shear, rotation or location instead`,
    );
  }
  if (key in REFUSED) throw new ToolError(`${key}: ${REFUSED[key]}`);
  if (!(key in PROPS)) throw new ToolError(`${key} is not a clip property the editor shows; settable: ${settableKeys().join(", ")}`);
  return key;
}

/** A keyframe (`Points`) or a colour keyframe (`red` …). */
export function isCurve(value: unknown): boolean {
  return isRecord(value) && (Array.isArray(value.Points) || "red" in value);
}

/** `clip_data.get(key, shapes.get(key))`. */
function currentValue(clip: Record<string, unknown>, key: string): unknown {
  return key in clip ? clip[key] : shape(key);
}

function projectFpsFloat(project: Project): number {
  const num = Math.trunc(Number(project.fps?.num)) || 30;
  const den = Math.trunc(Number(project.fps?.den)) || 1;
  return num / den;
}

/** What one property is on this clip: type, range (the editor's limits), choices, animatable. */
export function propertyInfo(key: string, clip: Clip, project: Project): PropertyInfo {
  const meta = PROPS[key]!;
  const data = clip as Record<string, unknown>;
  const kind = String(meta.type || "float");
  const keyframable = isCurve(currentValue(data, key)) || isCurve(shape(key));
  const choices: Choice[] = (meta.choices ?? []).map((c) => [String(c.name), c.value] as const);
  let lo: number | null = meta.min;
  let hi: number | null = meta.max;
  const override = RANGE_OVERRIDES[key];
  if (override) {
    [lo, hi] = override;
  } else if (SCALE_KEYS.has(key)) {
    const reader = isRecord(data.reader) ? data.reader : {};
    const path = String(reader.path ?? "").toLowerCase();
    const m = maxTransformMultiple(project.width, project.height, path.endsWith(".svg"));
    [lo, hi] = [-m, m];
  } else if (key === "time") {
    // time maps clip frames to SOURCE frames: its values run over the media's frames.
    let frames = videoLengthToProjectFrames(isRecord(data.reader) ? data.reader : {}, project.fps);
    if (!frames) frames = pyRound((Number(data.end) || 0) * projectFpsFloat(project)) + 1;
    [lo, hi] = [1.0, Math.max(1, Math.trunc(frames))];
  }
  if (kind === "color") [lo, hi] = [0.0, 255.0];
  return { key, label: String(meta.name || key), kind, keyframable, choices, minimum: lo, maximum: hi, default: propertyDefault(key) };
}

/** Python `float(str(value).strip())`, including inf and nan (which the callers refuse as not finite). */
function pythonFloat(text: string): number | null {
  const t = text.trim().toLowerCase();
  const special = /^([+-]?)(inf|infinity|nan)$/.exec(t);
  if (special) return special[2] === "nan" ? Number.NaN : special[1] === "-" ? -Infinity : Infinity;
  return parsePythonFloat(t);
}

/** A colour, or the property's refusal. */
function colorValue(value: unknown): Rgba {
  try {
    return parseEditorColor(value);
  } catch (error) {
    if (error instanceof TextToolError) throw new ToolError(error.message);
    throw error;
  }
}

/** The value stored in project data for what the model sent; refusals with the desktop's wording. */
export function coerceValue(info: PropertyInfo, value: unknown, project: Project, clipId = ""): number | string | boolean | Rgba {
  const where = clipId ? `${info.key} on clip ${clipId}` : info.key;
  if (info.kind === "color") return colorValue(value);
  if (info.key === "parentObjectId") return coerceParent(value, clipId, project);
  if (info.choices.length > 0) return coerceChoice(info, value, where);
  if (info.kind === "string") return value === null || value === undefined ? "" : typeof value === "string" ? value : pyStrValue(value);
  if (typeof value === "boolean" || value === null || value === undefined) {
    throw new ToolError(`${where} must be a number, got ${pyRepr(value ?? null)}`);
  }
  let number: number | null;
  if (typeof value === "number") {
    number = value;
  } else {
    const text = pyStrValue(value).trim();
    const parsed = pythonFloat(text.replace(/%+$/, ""));
    number = parsed === null ? null : text.endsWith("%") ? parsed / 100 : parsed;
  }
  if (number === null) throw new ToolError(`${where} must be a number, got ${pyRepr(value)}`);
  if (!Number.isFinite(number)) throw new ToolError(`${where} must be finite, got ${pyRepr(value)}`);
  if (info.minimum !== null && info.maximum !== null && !(info.minimum - 1e-9 <= number && number <= info.maximum + 1e-9)) {
    throw new ToolError(`${where} must be between ${pyG(info.minimum)} and ${pyG(info.maximum)}, got ${pyG(number)}`);
  }
  if (info.kind === "int") {
    if (Math.abs(number - pyRound(number)) > 1e-9) throw new ToolError(`${where} must be a whole number, got ${pyRepr(value)}`);
    return pyRound(number);
  }
  return number;
}

function pyStrValue(value: unknown): string {
  return typeof value === "string" ? value : pyRepr(value);
}

/** A choice's stored value: `int(val) if float(val).is_integer() else val`. */
function storedChoice(val: number | string | boolean): number | string | boolean {
  const n = Number(val);
  return Number.isInteger(n) ? n : val;
}

function coerceChoice(info: PropertyInfo, value: unknown, where: string): number | string | boolean {
  const names = info.choices.map(([name]) => name);
  let wanted: string;
  if (typeof value === "boolean") {
    wanted = norm(value ? "on" : "off");
    if (info.key === "waveform") wanted = norm(value ? "yes" : "no");
  } else if (typeof value === "number") {
    for (const [, val] of info.choices) if (Number(val) === value) return storedChoice(val);
    throw new ToolError(`${where} must be one of ${pyRepr(names)} (or their values), got ${pyRepr(value)}`);
  } else {
    const text = value === null || value === undefined ? "None" : pyStrValue(value);
    const number = pythonFloat(text);
    if (number !== null) {
      for (const [, val] of info.choices) if (Number(val) === number) return storedChoice(val);
      throw new ToolError(`${where} must be one of ${pyRepr(names)} (or their values), got ${pyFloat(number)}`);
    }
    wanted = norm(text);
  }
  const alias = CHOICE_ALIASES[info.key]?.[wanted];
  for (const [name, val] of info.choices) {
    if (norm(name) === wanted || (alias !== undefined && name === alias)) return storedChoice(val);
  }
  throw new ToolError(`${where} must be one of ${pyRepr(names)}, got ${pyRepr(value ?? null)}`);
}

/** parentObjectId: '' (none), another clip's id, or a tracked object '<effect id>-<index>'. */
function coerceParent(value: unknown, clipId: string, project: Project): string {
  const text = String(value ?? "").trim();
  if (["", "none", "null"].includes(text.toLowerCase())) return "";
  if (text === clipId) throw new ToolError("a clip cannot be its own parent");
  if (project.clips.some((c) => c.id === text)) return text;
  const effectId = text.includes("-") ? text.slice(0, text.lastIndexOf("-")) : text;
  for (const clip of project.clips) {
    for (const effect of clip.effects ?? []) {
      if (isRecord(effect) && effect.id === effectId && effect.objects) return text;
    }
  }
  throw new ToolError(
    `parentObjectId ${pyReprString(text)} is neither a timeline clip id nor a tracked object (<tracker effect id>-<object index>)`,
  );
}

/** A static (non-keyframe) value in the JSON type the clip already uses (a bool stays a bool). */
export function storedStatic(info: PropertyInfo, value: unknown, current: unknown): unknown {
  if (typeof current === "boolean" && info.choices.length > 0) return Boolean(value);
  return value;
}

/** Python `round(x, digits)` (ties to even on the binary value). */
export function roundTo(x: number, digits: number): number {
  const value = Number(pyFixed(x, digits));
  return value === 0 ? 0 : value;
}

/** How a value reads in receipts: '#rrggbbaa' for colours, the choice name, numbers to 6 places. */
export function displayValue(info: PropertyInfo, raw: unknown): unknown {
  if (info.kind === "color" && Array.isArray(raw)) {
    return `#${(raw as number[]).map((c) => Math.trunc(c).toString(16).padStart(2, "0")).join("")}`;
  }
  if (info.choices.length > 0) return choiceName(info, raw) ?? raw;
  if (typeof raw === "number" && !Number.isInteger(raw)) return roundTo(raw, 6);
  return raw;
}

// ---------------------------------------------------------------------------
// Mirroring (negative scale) and gravity
// ---------------------------------------------------------------------------

export const GRAVITY_NAMES = ["Top Left", "Top Center", "Top Right", "Left", "Center", "Right", "Bottom Left", "Bottom Center", "Bottom Right"] as const;
/**
 * libopenshot 1.0 draws a clip with a negative scale leftward (upward) from
 * its gravity anchor, so it only mirrors in place when that axis is centred;
 * anchored to an edge it lands off-screen.
 */
const CENTERED: Readonly<Record<"scale_x" | "scale_y", readonly number[]>> = { scale_x: [1, 4, 7], scale_y: [3, 4, 5] };

/** Why mirroring on this axis would push the clip off-screen, or undefined when it is safe. */
export function mirrorBlocker(scaleKey: "scale_x" | "scale_y", gravity: unknown): string | undefined {
  // Python int(gravity): numbers truncate, whole-number text parses, anything else is Center.
  let g = 4;
  if (typeof gravity === "number" && Number.isFinite(gravity)) g = Math.trunc(gravity);
  else if (typeof gravity === "boolean") g = Number(gravity);
  else if (typeof gravity === "string" && /^\s*[+-]?\d+\s*$/.test(gravity)) g = Number.parseInt(gravity, 10);
  if (CENTERED[scaleKey].includes(g)) return undefined;
  const axis = scaleKey === "scale_x" ? "left/right" : "top/bottom";
  const fixes = CENTERED[scaleKey].map((i) => GRAVITY_NAMES[i]).join(", ");
  const name = g >= 0 && g < 9 ? GRAVITY_NAMES[g] : String(g);
  return (
    `anchored to the ${axis} edge (gravity ${name}): libopenshot 1.0 draws a mirrored clip from its anchor outward, ` +
    `off-screen; set gravity to ${fixes} (and place it with location_${scaleKey === "scale_x" ? "x" : "y"}) before mirroring`
  );
}

/** Warnings for a clip whose scale would be negative with an edge gravity after `values` apply. */
export function mirrorWarnings(clip: Clip, values: Record<string, unknown>): string[] {
  const data = clip as Record<string, unknown>;
  const gravity = "gravity" in values ? values.gravity : "gravity" in data ? data.gravity : 4;
  const out: string[] = [];
  for (const key of ["scale_x", "scale_y"] as const) {
    const curve = key in values ? values[key] : data[key];
    if (curvePoints(curve).some((p) => Number(p.co.Y ?? 0) < 0)) {
      const reason = mirrorBlocker(key, gravity);
      if (reason) out.push(`${key} < 0 mirrors the clip but it is ${reason}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Values at a frame, curves and points
// ---------------------------------------------------------------------------

/** The property's value at a clip frame, as libopenshot evaluates it ([r, g, b, a] for a colour). */
export function valueAt(info: PropertyInfo, clip: Clip, frame: number): unknown {
  const data = clip as Record<string, unknown>;
  const current = currentValue(data, info.key);
  if (info.kind === "color") {
    const curves = isRecord(current) ? current : {};
    const fallbackCurves = isRecord(shape(info.key)) ? (shape(info.key) as Record<string, unknown>) : {};
    return COLOR_CHANNELS.map((ch) => {
      const fallback = keyframeValue(fallbackCurves[ch], 1, ch === "alpha" ? 255.0 : 0.0);
      return pyRound(keyframeValue(curves[ch], frame, fallback));
    });
  }
  if (isCurve(current)) {
    const value = keyframeValue(current, frame, Number(info.default) || 0.0);
    if (info.kind === "int" || info.choices.length > 0) return pyRound(value);
    return value;
  }
  if (current === null || current === undefined) return info.default;
  if (typeof current === "boolean") return info.choices.length > 0 ? Number(current) : current;
  return current;
}

/** More than one point on the clip's own curve (any channel for a colour). */
export function isAnimated(info: PropertyInfo, clip: Clip): boolean {
  const current = (clip as Record<string, unknown>)[info.key];
  if (info.kind === "color" && isRecord(current)) return COLOR_CHANNELS.some((ch) => curvePoints(current[ch]).length > 1);
  return curvePoints(current).length > 1;
}

/** The point a clip tool writes at a frame (`make_point`). */
export function makePoint(frame: number, value: number, interpolation: Interpolation = Interpolation.BEZIER): KeyframePoint {
  return editorPoint(frame, value, interpolation);
}

/** `_slug`: "Ease In/Out (Quad)" → "ease_in_out_quad". */
function slug(label: string): string {
  const text = label.toLowerCase().replace("(default)", "").replaceAll("/", "_").replaceAll("(", " ").replaceAll(")", " ");
  return text.split(/\s+/).filter(Boolean).join("_");
}

/** The 28 bezier presets of the Properties panel's menu: {name: (x1, y1, x2, y2)}, in menu order. */
export const EASE_PRESETS: ReadonlyMap<string, readonly [number, number, number, number]> = new Map(
  KEYFRAME_BEZIER_PRESETS.map((p) => [slug(p.name), p.handles] as const),
);

/** Name of the bezier preset shaping the segment that ends at `point` (undefined: none or not bezier). */
export function easeOf(prev: KeyframePoint | undefined, point: KeyframePoint): string | undefined {
  if (prev === undefined || Math.trunc(Number(point.interpolation ?? Interpolation.BEZIER)) !== Interpolation.BEZIER) return undefined;
  const hr: Record<string, unknown> = isRecord(prev.handle_right) ? prev.handle_right : {};
  const hl: Record<string, unknown> = isRecord(point.handle_left) ? point.handle_left : {};
  const handles = [Number(hr.X ?? 0.5), Number(hr.Y ?? 0.0), Number(hl.X ?? 0.5), Number(hl.Y ?? 1.0)];
  if (handles.some((h) => !Number.isFinite(h))) return undefined;
  const same = (preset: readonly number[]): boolean => handles.every((h, i) => Math.abs(h - preset[i]!) < 1e-6);
  if (same(DEFAULT_HANDLES)) return "default";
  for (const [name, preset] of EASE_PRESETS) if (same(preset)) return name;
  return "custom";
}

// ---------------------------------------------------------------------------
// Where keyframes land
// ---------------------------------------------------------------------------

/** Frame arithmetic for one clip: keyframe X is a 1-based clip frame that includes the trim. */
export class ClipTime {
  constructor(
    readonly fps: number,
    readonly position: number,
    readonly start: number,
    readonly end: number,
  ) {}

  static of(clip: Clip, project: Project): ClipTime {
    return new ClipTime(projectFpsFloat(project), Number(clip.position) || 0, Number(clip.start) || 0, Number(clip.end) || 0);
  }

  /** X of the first visible frame (what the menus call start_of_clip). */
  get firstFrame(): number {
    return pyRound(this.start * this.fps) + 1;
  }

  /** X of the clip's end boundary (the menus' end_of_clip). */
  get endFrame(): number {
    return Math.max(this.firstFrame, pyRound(this.end * this.fps) + 1);
  }

  get duration(): number {
    return Math.max(0, this.end - this.start);
  }

  fromClipSeconds(seconds: number): number {
    return pyRound((this.start + seconds) * this.fps) + 1;
  }

  fromTimelineSeconds(seconds: number): number {
    return pyRound((this.start + seconds - this.position) * this.fps) + 1;
  }

  fromSourceSeconds(seconds: number): number {
    return pyRound(seconds * this.fps) + 1;
  }

  clipSeconds(frame: number): number {
    return roundTo((frame - 1) / this.fps - this.start, 4);
  }

  timelineSeconds(frame: number): number {
    return roundTo(this.position + (frame - 1) / this.fps - this.start, 4);
  }

  contains(frame: number): boolean {
    return this.firstFrame <= frame && frame <= this.endFrame;
  }

  rangesText(): string {
    return (
      `frames ${this.firstFrame}-${this.endFrame}, seconds 0-${pyFixed(this.duration, 3)} from the clip's start, ` +
      `timeline_seconds ${pyFixed(this.position, 3)}-${pyFixed(this.position + this.duration, 3)}, ` +
      `source_seconds ${pyFixed(this.start, 3)}-${pyFixed(this.end, 3)}`
    );
  }
}

/** Each point of a curve with its frame, clip and timeline seconds, value, interpolation and ease. */
export function describePoints(curve: unknown, time: ClipTime): Record<string, unknown>[] {
  const points = curvePoints(curve);
  return points.map((point, i) => {
    const x = pointX(point);
    const item: Record<string, unknown> = {
      frame: Number.isInteger(x) ? x : roundTo(x, 3),
      clip_seconds: time.clipSeconds(x),
      timeline_seconds: time.timelineSeconds(x),
      value: roundTo(pointY(point), 6),
      interpolation: INTERPOLATION_NAMES[Math.trunc(Number(point.interpolation ?? Interpolation.BEZIER))] ?? "bezier",
    };
    const ease = easeOf(i > 0 ? points[i - 1] : undefined, point);
    if (ease && ease !== "default") item.ease = ease;
    if (!time.contains(x)) item.outside_clip = true;
    return item;
  });
}
