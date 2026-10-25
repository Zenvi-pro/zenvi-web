/**
 * The effect catalog the desktop's effects-color tools describe and validate
 * against: zenvi-core develop src/classes/editor_tools/effects_color.py
 * (`_build_catalog`, `resolve_effect_name`, HIDDEN/COMMON_PROPERTIES,
 * PROCESSING_EFFECTS, AUDIO_REACTIVE_EFFECTS). The desktop builds it from
 * libopenshot at run time (`EffectInfo.Json()`, `CreateEffect(name).Json()`,
 * `PropertiesJSON(1)`); here the same three come from the engine's tables
 * generated from libopenshot 1.0 (effects/registry.data.ts).
 */

import { pyRound } from "../../model/rounding.js";
import { defaultEffectJson, EFFECTS } from "../../effects/registry.js";
import { getCloseMatches } from "../difflib.js";
import { pyFixed, pyReprString } from "../pyfmt.js";
import { ToolError } from "./timeline-edit-common.js";

/** Effect keys a tool never sets: identity, placement (effects follow their clip), data only processing writes. */
export const HIDDEN_PROPERTIES: ReadonlySet<string> = new Set([
  "id", "position", "layer", "start", "end", "duration", "order", "class_name", "type", "name",
  "description", "has_audio", "has_video", "has_tracked_object", "objects", "protobuf_data_path",
  "BaseFPS", "TimeScale", "ui", "ui-menu", "parent_effect_id",
]);

/** Settable on every effect; listed once by list_effects_tool instead of per effect. */
export const COMMON_PROPERTIES = ["apply_before_clip", "mask_invert", "mask_loop_mode", "mask_time_mode", "mask_reader", "mask_source_id"] as const;

export const PROCESSING_EFFECTS = ["Stabilizer", "Tracker", "ObjectDetection", "ObjectMask"] as const;

/** Video effects that make pictures out of sound, so they belong on audio clips too. */
export const AUDIO_REACTIVE_EFFECTS: ReadonlySet<string> = new Set(["AudioVisualization", "BeatSync"]);

const ALIASES: Readonly<Record<string, string>> = {
  greenscreen: "ChromaKey", bluescreen: "ChromaKey", chroma: "ChromaKey", keyer: "ChromaKey",
  grade: "ColorGrade", colorgrading: "ColorGrade", colorcorrection: "ColorGrade",
  lut: "ColorMap", lookup: "ColorMap", brightnesscontrast: "Brightness", contrast: "Brightness",
  grain: "FilmGrain", vhs: "AnalogTape", tape: "AnalogTape", eq: "ParametricEQ",
  equalizer: "ParametricEQ", equaliser: "ParametricEQ", denoise: "DenoiseImage",
  stabilize: "Stabilizer", stabilise: "Stabilizer", stabilization: "Stabilizer",
  track: "Tracker", objecttracker: "Tracker", objectdetector: "ObjectDetection",
  detection: "ObjectDetection", segmentation: "ObjectMask", invert: "Negate",
  negative: "Negate", letterbox: "Bars", robot: "Robotization", whisper: "Whisperization",
  noisegate: "Expander", gate: "Expander", "360": "SphericalProjection",
  fisheye: "SphericalProjection", flare: "LensFlare", dropshadow: "Shadow",
  visualizer: "AudioVisualization", waveform: "AudioVisualization",
};

export interface CatalogChoice {
  name: unknown;
  value: unknown;
}

/** One settable property, as list_effects_tool describes it. */
export interface CatalogProperty {
  type: string;
  keyframable: boolean;
  min?: number;
  max?: number;
  choices?: CatalogChoice[];
  default?: unknown;
}

export interface CatalogEffect {
  effect: string;
  name: string;
  description: string;
  kind: "video" | "audio";
  needs_processing: boolean;
  tracks_objects: boolean;
  properties: Record<string, CatalogProperty>;
}

/** Colour properties whose PropertiesJSON(1) `keyframe` flag libopenshot 1.0 leaves false. */
const COLORS_NOT_FLAGGED_KEYFRAME: ReadonlySet<string> = new Set(["ChromaKey.color", "ObjectMask.mask_color", "ObjectMask.stroke_color"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isKeyframe(value: unknown): value is { Points: { co: { X: number; Y: number } }[] } {
  return isRecord(value) && Array.isArray(value.Points);
}

export function isColorValue(value: unknown): value is Record<"red" | "green" | "blue" | "alpha", unknown> {
  return isRecord(value) && ["red", "green", "blue"].every((c) => isKeyframe(value[c]));
}

/** `round(x, 4)`. */
export function round4(x: number): number {
  return Number(pyFixed(x, 4));
}

/** effects_color._color_hex: `#rrggbbaa` of a colour's first points (alpha 255 when it has none). */
export function colorHex(value: unknown): string | null {
  if (!isColorValue(value)) return null;
  const channels: number[] = [];
  for (const c of ["red", "green", "blue", "alpha"] as const) {
    const points = isKeyframe(value[c]) ? (value[c] as { Points: { co: { Y: number } }[] }).Points : [];
    if (points.length === 0) {
      if (c === "alpha") {
        channels.push(255);
        continue;
      }
      return null;
    }
    channels.push(pyRound(Number(points[0]!.co.Y)));
  }
  return `#${channels.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
}

/** effects_color._default_of. */
function defaultOf(value: unknown): unknown {
  if (isKeyframe(value)) {
    const points = value.Points;
    return points.length > 0 ? Number(points[0]!.co.Y) : null;
  }
  if (isColorValue(value)) return colorHex(value);
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  return null;
}

function buildCatalog(): Map<string, CatalogEffect> {
  const out = new Map<string, CatalogEffect>();
  for (const def of EFFECTS) {
    const defaults = defaultEffectJson(def.className, "") as Record<string, unknown>;
    const meta = def.properties as unknown as Record<string, Record<string, unknown> | undefined>;
    const names = [...Object.keys(meta).filter((k) => isRecord(meta[k])), ...Object.keys(defaults).filter((k) => !(k in meta))];
    const props: Record<string, CatalogProperty> = {};
    for (const pname of names) {
      if (HIDDEN_PROPERTIES.has(pname)) continue;
      const p = isRecord(meta[pname]) ? meta[pname]! : {};
      if (p.readonly) continue;
      const current = defaults[pname];
      let ptype = typeof p.type === "string" && p.type ? p.type : "";
      if (!ptype) {
        if (isColorValue(current)) ptype = "color";
        else if (isKeyframe(current) || (typeof current === "number" && !Number.isInteger(current))) ptype = "float";
        else if (typeof current === "boolean") ptype = "bool";
        else if (typeof current === "number") ptype = "int";
        else if (typeof current === "string") ptype = "string";
        else continue;
      }
      // `bool(p["keyframe"]) or _is_keyframe(current)`. The engine's table records "stored as a keyframe"
      // rather than PropertiesJSON(1)'s own flag, which libopenshot sets for every colour but these.
      const keyframable =
        isKeyframe(current) || (isColorValue(current) && !COLORS_NOT_FLAGGED_KEYFRAME.has(`${def.className}.${pname}`));
      const spec: CatalogProperty = { type: ptype, keyframable };
      const lo = p.min;
      const hi = p.max;
      if ((ptype === "float" || ptype === "int") && typeof lo === "number" && typeof hi === "number" && lo < hi) {
        spec.min = lo;
        spec.max = hi;
      }
      if (Array.isArray(p.choices) && p.choices.length > 0) {
        spec.choices = (p.choices as Record<string, unknown>[]).map((c) => ({ name: c.name, value: c.value }));
      }
      const fallback = defaultOf(current);
      if (fallback !== null && fallback !== undefined) {
        // round(default, 4) for floats; integers are unchanged by it.
        spec.default = typeof fallback === "number" ? round4(fallback) : fallback;
      }
      props[pname] = spec;
    }
    out.set(def.className, {
      effect: def.className,
      name: def.name || def.className,
      description: def.description || "",
      kind: def.hasAudio && !def.hasVideo ? "audio" : "video",
      needs_processing: (PROCESSING_EFFECTS as readonly string[]).includes(def.className),
      // `info.get("has_tracked_object")`: EffectInfo's entries carry no such key, so the desktop always says false.
      tracks_objects: false,
      properties: props,
    });
  }
  return out;
}

let cached: Map<string, CatalogEffect> | undefined;

/** The effect catalog by class name, in libopenshot's EffectInfo order. */
export function effectCatalog(): ReadonlyMap<string, CatalogEffect> {
  cached ??= buildCatalog();
  return cached;
}

/** effects_color._norm: lower case, letters and digits only. */
export function normName(text: unknown): string {
  return Array.from(String(text ?? "").toLowerCase())
    .filter((ch) => /[\p{L}\p{N}]/u.test(ch))
    .join("");
}

/** effects_color.resolve_effect_name: class name, display name ('Chroma Key (Greenscreen)') or alias → class name. */
export function resolveEffectName(name: unknown): string {
  const cat = effectCatalog();
  const key = normName(name);
  if (!key) throw new ToolError("name the effect (see list_effects_tool)");
  for (const [cn, spec] of cat) {
    if (key === normName(cn) || key === normName(spec.name)) return cn;
  }
  const alias = ALIASES[key];
  if (alias && cat.has(alias)) return alias;
  for (const [cn, spec] of cat) {
    // "Chroma Key" matches "Chroma Key (Greenscreen)".
    if (normName(spec.name).startsWith(key) && key.length >= 4) return cn;
  }
  const close = getCloseMatches(String(name), [...cat.keys()], 4, 0.5);
  const hint = close.length > 0 ? `; did you mean ${close.join(", ")}?` : "";
  throw new ToolError(`unknown effect ${pyReprString(String(name))}${hint} list_effects_tool lists all ${cat.size} effects`);
}

/** effects_color.effect_kind. */
export function effectKind(className: string): "video" | "audio" {
  return effectCatalog().get(className)?.kind ?? "video";
}
