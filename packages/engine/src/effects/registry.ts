/**
 * Every libopenshot 1.0 effect: metadata, parameter schema and exact default
 * JSON (generated from the real library by scripts/gen-libopenshot-tables.py
 * into registry.data.ts: `EffectInfo::Json()`, `CreateEffect(name).Json()`,
 * `PropertiesJSON(1)`).
 *
 * `createEffect` produces what the desktop stores when it adds an effect
 * (timeline.py `_apply_effect_to_clip`: `EffectInfo().CreateEffect(name)`,
 * a project id, `Json()`), with parameter overrides applied the way the
 * desktop's preset code writes them (`_set_effect_property_value`).
 */

import type { Effect, Keyframe } from "../model/types.js";
import { Interpolation } from "../model/types.js";
import { expandCompact } from "../model/compact.js";
import type { PropertyMeta } from "../model/properties.js";
import { openshotPoint } from "../keyframe/edit.js";
import { parseHexColor } from "../keyframe/color.js";
import { LIBOPENSHOT_EFFECTS } from "./registry.data.js";
import type { EffectDefinition, EffectParam, EffectParamType, LibopenshotEffectEntry } from "./types.js";

/** Effects that need the desktop ProcessEffect dialog (zenvi-core src/classes/effect_init.py `effect_options`). */
export const DIALOG_EFFECTS: ReadonlySet<string> = new Set(["Tracker", "Stabilizer", "ObjectDetection", "ObjectMask"]);

/** Effects implemented with OpenCV in libopenshot (not rendered by the web/Node renderers). */
export const OPENCV_EFFECTS: ReadonlySet<string> = new Set(["Outline", "Stabilizer", "Tracker", "ObjectDetection", "ObjectMask"]);

/** EffectBase keys every effect carries (libopenshot src/EffectBase.cpp JsonValue/PropertiesJSON). */
export const COMMON_EFFECT_KEYS: ReadonlySet<string> = new Set([
  "id",
  "layer",
  "position",
  "start",
  "end",
  "duration",
  "order",
  "apply_before_clip",
  "parent_effect_id",
  "mask_reader",
  "mask_invert",
  "mask_mode",
  "mask_loop_mode",
  "mask_time_mode",
  "mask_source_id",
]);

/** Informational keys written by `JsonValue()` that are not parameters. */
const INFO_KEYS = new Set(["class_name", "type", "name", "description", "has_video", "has_audio", "has_tracked_object"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCompactKeyframe(value: unknown): value is { $kf: number } {
  return isRecord(value) && typeof value.$kf === "number" && Object.keys(value).length === 1;
}

function isCompactColor(value: unknown): value is { $color: number[] } {
  return isRecord(value) && Array.isArray(value.$color) && Object.keys(value).length === 1;
}

function isKeyframeJson(value: unknown): boolean {
  return isCompactKeyframe(value) || (isRecord(value) && Array.isArray(value.Points));
}

function isColorJson(value: unknown): boolean {
  return (
    isCompactColor(value) ||
    (isRecord(value) && ["red", "green", "blue"].every((c) => isRecord(value[c]) && Array.isArray((value[c] as Keyframe).Points)))
  );
}

function paramType(meta: PropertyMeta | undefined, raw: unknown): EffectParamType {
  if (meta?.type === "reader") return "reader";
  if (meta?.type === "colorgrade_curve" || meta?.type === "colorgrade_wheels") return "object";
  if (isColorJson(raw) || meta?.type === "color") return "color";
  const choices = (meta?.choices?.length ?? 0) > 0;
  if (isKeyframeJson(raw)) return choices ? "choice" : "keyframe";
  if (typeof raw === "boolean") return "bool";
  if (typeof raw === "number") return choices ? "choice" : meta?.type === "int" ? "int" : "float";
  if (typeof raw === "string") return "string";
  return "object";
}

function paramDefault(raw: unknown): unknown {
  if (isCompactKeyframe(raw)) return raw.$kf;
  if (isCompactColor(raw)) return [...raw.$color];
  if (isRecord(raw) && Array.isArray(raw.Points)) {
    const first = (raw.Points as { co?: { Y?: number } }[])[0];
    return first?.co?.Y ?? 0;
  }
  return structuredClone(raw);
}

function buildParams(entry: LibopenshotEffectEntry): EffectParam[] {
  const params: EffectParam[] = [];
  const keys = new Set([...Object.keys(entry.properties), ...Object.keys(entry.defaults)]);
  for (const key of keys) {
    if (INFO_KEYS.has(key) || key === "id") continue;
    const meta = entry.properties[key];
    const raw = entry.defaults[key];
    const type = paramType(meta, raw);
    const param: EffectParam = {
      key,
      name: meta?.name ?? key,
      type,
      keyframable: isKeyframeJson(raw) || isColorJson(raw),
      default: paramDefault(raw),
      readonly: meta?.readonly ?? false,
      common: COMMON_EFFECT_KEYS.has(key),
      libopenshotType: meta?.type ?? null,
    };
    if (typeof meta?.min === "number") param.min = meta.min;
    if (typeof meta?.max === "number") param.max = meta.max;
    if (meta?.choices?.length) param.choices = meta.choices.map((c) => ({ ...c }));
    params.push(param);
  }
  return params.sort((a, b) => Number(a.common) - Number(b.common));
}

function buildDefinition(entry: LibopenshotEffectEntry): EffectDefinition {
  const className = entry.info.class_name;
  const opencv = OPENCV_EFFECTS.has(className);
  return {
    className,
    name: entry.info.name,
    description: entry.info.description,
    category: entry.info.has_audio && !entry.info.has_video ? "audio" : "video",
    hasVideo: entry.info.has_video,
    hasAudio: entry.info.has_audio,
    supported: { web: !opencv, node: !opencv },
    needsDialog: DIALOG_EFFECTS.has(className),
    requiresOpenCV: opencv,
    icon: `${className.toLowerCase()}.png`,
    params: buildParams(entry),
    properties: entry.properties,
  };
}

/** Every effect, in libopenshot `EffectInfo` order (video effects first). */
export const EFFECTS: readonly EffectDefinition[] = LIBOPENSHOT_EFFECTS.map(buildDefinition);

const BY_CLASS = new Map(EFFECTS.map((e) => [e.className.toLowerCase(), e]));
const ENTRY_BY_CLASS = new Map(LIBOPENSHOT_EFFECTS.map((e) => [e.info.class_name.toLowerCase(), e]));

/** Look up an effect by class name (case-insensitive). */
export function getEffect(className: string): EffectDefinition | undefined {
  return BY_CLASS.get(String(className).toLowerCase());
}

/** The parameter `key` of an effect class. */
export function getEffectParam(className: string, key: string): EffectParam | undefined {
  return getEffect(className)?.params.find((p) => p.key === key);
}

/** Effects of one category, e.g. for the Effects panel filter. */
export function effectsByCategory(category: "video" | "audio"): EffectDefinition[] {
  return EFFECTS.filter((e) => e.category === category);
}

/** The effect's default JSON exactly as libopenshot writes it, with `id` set. */
export function defaultEffectJson(className: string, id: string): Effect {
  const entry = ENTRY_BY_CLASS.get(String(className).toLowerCase());
  if (!entry) throw new Error(`Unknown effect class: ${className}`);
  const json = expandCompact<Record<string, unknown>>(entry.defaults, id);
  return { id, ...json } as Effect;
}

/** A value an effect parameter accepts when creating or editing an effect. */
export type EffectParamValue = number | string | boolean | number[] | Record<string, unknown>;

export class EffectParamError extends Error {
  override readonly name = "EffectParamError";
}

/**
 * The JSON value to store for `param` given a user value, the way the
 * desktop writes preset values (timeline.py `_set_effect_property_value`):
 * keyframes become one BEZIER point `Point(1, float(value))`, colors one
 * point per channel (hex `#rrggbb[aa]` or `[r, g, b, a]`). Keyframe/color
 * objects pass through. Throws `EffectParamError` for invalid values.
 */
export function effectParamJson(param: EffectParam, value: unknown): unknown {
  const rangeCheck = (n: number): number => {
    if (!Number.isFinite(n)) throw new EffectParamError(`${param.key} must be a finite number.`);
    return n;
  };
  switch (param.type) {
    case "keyframe":
    case "choice": {
      if (isRecord(value) && Array.isArray(value.Points)) return structuredClone(value);
      const n = typeof value === "boolean" ? (value ? 1 : 0) : Number(value);
      if (typeof value !== "number" && typeof value !== "boolean") {
        throw new EffectParamError(`${param.key} must be a number.`);
      }
      rangeCheck(n);
      if (param.choices && !param.choices.some((c) => Number(c.value) === n)) {
        throw new EffectParamError(`${param.key} must be one of ${param.choices.map((c) => c.value).join(", ")}.`);
      }
      if (param.keyframable) return { Points: [openshotPoint(1, n, Interpolation.BEZIER)] };
      return n;
    }
    case "color": {
      if (isColorJson(value)) return isCompactColor(value) ? expandCompact(value) : structuredClone(value);
      let rgba: number[] | null = null;
      if (typeof value === "string") rgba = parseHexColor(value);
      else if (Array.isArray(value) && value.length >= 3 && value.every((v) => typeof v === "number")) {
        rgba = [value[0]!, value[1]!, value[2]!, value[3] ?? 255];
      } else if (isRecord(value) && typeof value.red === "number") {
        rgba = [Number(value.red), Number(value.green ?? 0), Number(value.blue ?? 0), Number(value.alpha ?? 255)];
      }
      if (!rgba || rgba.some((v) => !Number.isFinite(v) || v < 0 || v > 255)) {
        throw new EffectParamError(`${param.key} must be a color (#rrggbb, #rrggbbaa or [r, g, b, a]).`);
      }
      const [r, g, b, a] = rgba as [number, number, number, number];
      return {
        red: { Points: [openshotPoint(1, r)] },
        green: { Points: [openshotPoint(1, g)] },
        blue: { Points: [openshotPoint(1, b)] },
        alpha: { Points: [openshotPoint(1, a)] },
      };
    }
    case "int":
    case "float": {
      if (typeof value !== "number") throw new EffectParamError(`${param.key} must be a number.`);
      rangeCheck(value);
      if (param.type === "int" && !Number.isInteger(value)) throw new EffectParamError(`${param.key} must be an integer.`);
      return value;
    }
    case "bool": {
      if (typeof value === "boolean") return value;
      if (value === 0 || value === 1) return value === 1;
      throw new EffectParamError(`${param.key} must be true or false.`);
    }
    case "string": {
      if (typeof value !== "string") throw new EffectParamError(`${param.key} must be a string.`);
      return value;
    }
    case "reader":
    case "object": {
      if (!isRecord(value) && !Array.isArray(value) && value !== null) {
        throw new EffectParamError(`${param.key} must be an object.`);
      }
      return structuredClone(value);
    }
  }
}

export interface CreateEffectOptions {
  id: string;
}

/**
 * A new effect: libopenshot's exact default JSON for `className` plus the
 * given parameter overrides. Throws for unknown classes or parameters.
 */
export function createEffect(
  className: string,
  overrides: Readonly<Record<string, unknown>>,
  opts: CreateEffectOptions,
): Effect {
  const def = getEffect(className);
  if (!def) throw new EffectParamError(`Unknown effect: ${className}.`);
  const effect = defaultEffectJson(def.className, opts.id) as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides)) {
    const param = def.params.find((p) => p.key === key);
    if (!param) throw new EffectParamError(`Effect ${def.className} has no parameter ${key}.`);
    if (param.readonly) throw new EffectParamError(`${key} is read-only.`);
    effect[key] = effectParamJson(param, value);
  }
  return effect as Effect;
}
