/**
 * The clip Look menu: Reset Look, Color (Color Grade presets), Film Grain
 * presets, and the Analog Tape / Sharpen / Blur / Glow / Shadow presets.
 *
 * Ported from zenvi-core src/windows/views/timeline.py (Reset_Look_Triggered,
 * _apply_color_preset, Film_Grain_Triggered, _apply_effect_preset,
 * _set_effect_property_value, _clip_has_visual), src/classes/color_presets.py
 * (code port) and src/classes/film_grain_presets.py + LOOK_EFFECT_PRESETS
 * (generated data, look-presets.data.ts).
 */

import type { Transaction } from "../history/document.js";
import type { Clip, Effect, Keyframe } from "../model/types.js";
import { Interpolation } from "../model/types.js";
import { createEffect } from "../effects/registry.js";
import { openshotPoint } from "../keyframe/edit.js";
import { parseHexColor } from "../keyframe/color.js";
import { invalid } from "./errors.js";
import { ids, isRecord, patchClip, requireEditableClip } from "./internal.js";
import { FILM_GRAIN_PRESETS, LOOK_EFFECT_PRESETS } from "./look-presets.data.js";

/** Effects marked as managed by the Look menu carry `"ui-menu": "look"`. */
export const LOOK_UI_MENU = "look";

export const COLOR_PRESETS = ["reset", "auto_contrast", "lift_shadows", "warm_up", "boost_color"] as const;
export type ColorPreset = (typeof COLOR_PRESETS)[number];

export const FILM_GRAIN_PRESET_NAMES = ["none", "35mm_fine", "35mm_classic", "35mm_gritty", "16mm_classic", "super_8", "high_iso"] as const;
export type FilmGrainPreset = (typeof FILM_GRAIN_PRESET_NAMES)[number];

/** Look effect classes with presets, keyed by menu id. */
export const LOOK_EFFECT_CLASSES = {
  analog_tape: "AnalogTape",
  blur: "Blur",
  glow: "Glow",
  shadow: "Shadow",
  sharpen: "Sharpen",
} as const;
export type LookEffectKey = keyof typeof LOOK_EFFECT_CLASSES;

export type LookPresetId =
  | "reset"
  | `color.${ColorPreset}`
  | `film_grain.${FilmGrainPreset}`
  | `${LookEffectKey}.${string}`;

/** Every Look preset id (effect preset names from the desktop table). */
export const LOOK_PRESET_IDS: readonly LookPresetId[] = [
  "reset",
  ...COLOR_PRESETS.map((p) => `color.${p}` as const),
  ...FILM_GRAIN_PRESET_NAMES.map((p) => `film_grain.${p}` as const),
  ...(Object.entries(LOOK_EFFECT_CLASSES) as [LookEffectKey, string][]).flatMap(([key, cls]) =>
    Object.keys(LOOK_EFFECT_PRESETS[cls] ?? {}).map((name) => `${key}.${name}` as LookPresetId),
  ),
];

// ---------------------------------------------------------------------------
// color_presets.py
// ---------------------------------------------------------------------------

/** `_constant_property`: a one-point keyframe with Python float values (not narrowed). */
function constantProperty(value: number): Keyframe {
  return {
    Points: [
      {
        co: { X: 1.0, Y: value },
        handle_left: { X: 0.5, Y: 1.0 },
        handle_right: { X: 0.5, Y: 0.0 },
        handle_type: 0,
        interpolation: Interpolation.BEZIER,
      },
    ],
  };
}

function curveNode(id: number, x: number, y: number): Record<string, unknown> {
  return {
    id,
    x: constantProperty(x),
    y: constantProperty(y),
    left_handle_x: constantProperty(0.5),
    left_handle_y: constantProperty(1.0),
    right_handle_x: constantProperty(0.5),
    right_handle_y: constantProperty(0.0),
    interpolation: Interpolation.LINEAR,
    handle_type: 0,
  };
}

function curve(points: readonly [number, number][], enabled = true): Record<string, unknown> {
  return { enabled: constantProperty(enabled ? 1.0 : 0.0), nodes: points.map(([x, y], i) => curveNode(i, x, y)) };
}

function colorKeyframes(hex: string): Record<string, Keyframe> {
  const [r, g, b] = parseHexColor(hex) ?? [255, 255, 255, 255];
  return { red: constantProperty(r), green: constantProperty(g), blue: constantProperty(b), alpha: constantProperty(255) };
}

function wheelEntry(color = "#ffffff", amount = 0.0, luma = 0.0): Record<string, unknown> {
  return {
    color,
    color_keyframes: colorKeyframes(color),
    amount,
    amount_keyframes: constantProperty(amount),
    luma,
    luma_keyframes: constantProperty(luma),
  };
}

function defaultWheels(): Record<string, unknown> {
  return {
    enabled_keyframes: constantProperty(1.0),
    global: wheelEntry(),
    shadows: wheelEntry(),
    midtones: wheelEntry(),
    highlights: wheelEntry(),
  };
}

const IDENTITY_CURVE: readonly [number, number][] = [
  [0.0, 0.0],
  [1.0, 1.0],
];

/** `apply_color_grade_preset(effect_json, name)`: the keys a Color preset writes. */
export function colorGradePresetValues(preset: Exclude<ColorPreset, "reset">): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const scalars: Record<string, number> = {
    temperature: 0.0,
    tint: 0.0,
    exposure: 0.0,
    contrast: 0.0,
    highlights: 0.0,
    shadows: 0.0,
    saturation: 1.0,
    vibrance: 0.0,
    mix: 1.0,
    lut_intensity: 1.0,
  };
  let curveAll: readonly [number, number][] = IDENTITY_CURVE;
  if (preset === "auto_contrast") {
    Object.assign(scalars, { contrast: 0.18, highlights: -0.08, shadows: 0.08, vibrance: 0.06 });
    curveAll = [[0.0, 0.0], [0.25, 0.22], [0.75, 0.8], [1.0, 1.0]];
  } else if (preset === "lift_shadows") {
    Object.assign(scalars, { exposure: 0.08, contrast: -0.03, highlights: -0.05, shadows: 0.22 });
    curveAll = [[0.0, 0.06], [0.35, 0.4], [1.0, 1.0]];
  } else if (preset === "warm_up") {
    Object.assign(scalars, { temperature: 0.18, tint: 0.03, saturation: 1.05, vibrance: 0.08 });
  } else if (preset === "boost_color") {
    Object.assign(scalars, { contrast: 0.08, saturation: 1.18, vibrance: 0.22 });
    curveAll = [[0.0, 0.0], [0.2, 0.16], [0.8, 0.86], [1.0, 1.0]];
  }
  for (const [key, value] of Object.entries(scalars)) out[key] = constantProperty(value);
  out.lut_path = "";
  out.wheels = defaultWheels();
  out.curve_all = curve(curveAll);
  out.curve_red = curve(IDENTITY_CURVE);
  out.curve_green = curve(IDENTITY_CURVE);
  out.curve_blue = curve(IDENTITY_CURVE);
  return out;
}

// ---------------------------------------------------------------------------
// Applying presets
// ---------------------------------------------------------------------------

/** timeline.py `_clip_has_visual`: video, or audio drawn as a waveform. */
export function clipHasVisual(clip: Clip): boolean {
  const reader: Record<string, unknown> = isRecord(clip.reader) ? clip.reader : {};
  if (reader.has_video === undefined || reader.has_video === null || Boolean(reader.has_video)) return true;
  return Boolean(clip.waveform);
}

const isLookManaged = (e: Effect, className?: string): boolean =>
  e["ui-menu"] === LOOK_UI_MENU && (className === undefined || e.class_name === className);

/** `_set_effect_property_value`: keyframes `Point(1, float(v))`, colors per channel, others raw. */
function setEffectValue(effect: Record<string, unknown>, key: string, value: number | string): void {
  const current = effect[key];
  const rgba = typeof value === "string" ? parseHexColor(value) : null;
  if (rgba && isRecord(current)) {
    const channels = ["red", "green", "blue", "alpha"] as const;
    const next: Record<string, unknown> = { ...current };
    channels.forEach((c, i) => {
      if (isRecord(current[c]) && Array.isArray((current[c] as Keyframe).Points)) next[c] = { Points: [openshotPoint(1, rgba[i]!)] };
    });
    effect[key] = next;
  } else if (isRecord(current) && Array.isArray(current.Points)) {
    effect[key] = { Points: [openshotPoint(1, Number(value))] };
  } else if (key in effect) {
    effect[key] = value;
  }
}

/** Replace the first matching effect (keeping its id and order) and drop the rest, or append. */
function placePreset(effects: Effect[], matches: number[], preset: Effect): Effect[] {
  const next = [...effects];
  if (matches.length === 0) return [...next, preset];
  const existing = next[matches[0]!]!;
  if (existing.id) preset.id = existing.id;
  if ("order" in existing) preset.order = existing.order;
  next[matches[0]!] = preset;
  for (const i of [...matches.slice(1)].reverse()) next.splice(i, 1);
  return next;
}

export function isLookPresetId(value: string): value is LookPresetId {
  return (LOOK_PRESET_IDS as readonly string[]).includes(value);
}

/**
 * Apply one Look menu preset to a clip (one undo step). Presets that change
 * nothing (e.g. removing a look that is not there) record nothing. Clips
 * without a picture are refused.
 */
export function applyLookPreset(tx: Transaction, clipId: string, presetId: LookPresetId): Clip {
  const project = tx.project;
  const clip = requireEditableClip(project, clipId);
  if (!isLookPresetId(presetId)) throw invalid(`Unknown look preset: ${String(presetId)}.`);
  if (!clipHasVisual(clip)) throw invalid(`Clip ${clipId} has no picture to grade.`);
  const effects = [...(clip.effects ?? [])];
  const nextId = ids(project);

  if (presetId === "reset") {
    const kept = effects.filter((e) => !isRecord(e) || (!["ColorGrade", "FilmGrain"].includes(e.class_name) && !isLookManaged(e)));
    return kept.length === effects.length ? clip : patchClip(tx, clipId, { effects: kept });
  }
  const [family, name] = presetId.split(".") as [string, string];
  if (family === "color") {
    const matches = effects.flatMap((e, i) => (e.class_name === "ColorGrade" ? [i] : []));
    if (name === "reset") {
      return matches.length === 0 ? clip : patchClip(tx, clipId, { effects: effects.filter((e) => e.class_name !== "ColorGrade") });
    }
    const preset = { ...createEffect("ColorGrade", {}, { id: nextId() }), ...colorGradePresetValues(name as Exclude<ColorPreset, "reset">) } as Effect;
    return patchClip(tx, clipId, { effects: placePreset(effects, matches, preset) });
  }
  if (family === "film_grain") {
    const matches = effects.flatMap((e, i) => (e.class_name === "FilmGrain" ? [i] : []));
    if (name === "none") {
      return matches.length === 0 ? clip : patchClip(tx, clipId, { effects: effects.filter((e) => e.class_name !== "FilmGrain") });
    }
    const source = matches.length > 0 ? structuredClone(effects[matches[0]!]!) : createEffect("FilmGrain", {}, { id: nextId() });
    const preset = source as Record<string, unknown>;
    for (const [key, value] of Object.entries(FILM_GRAIN_PRESETS[name] ?? {})) preset[key] = constantProperty(value);
    if (!("seed" in preset)) preset.seed = 1;
    return patchClip(tx, clipId, { effects: placePreset(effects, matches, preset as Effect) });
  }
  const className = LOOK_EFFECT_CLASSES[family as LookEffectKey];
  const values = LOOK_EFFECT_PRESETS[className]?.[name];
  if (!values) throw invalid(`Unknown look preset: ${presetId}.`);
  const matches = effects.flatMap((e, i) => (isLookManaged(e, className) ? [i] : []));
  if (name === "none") {
    return matches.length === 0 ? clip : patchClip(tx, clipId, { effects: effects.filter((e) => !isLookManaged(e, className)) });
  }
  const preset = createEffect(className, {}, { id: nextId() }) as Record<string, unknown>;
  preset["ui-menu"] = LOOK_UI_MENU;
  for (const [key, value] of Object.entries(values)) setEffectValue(preset, key, value);
  return patchClip(tx, clipId, { effects: placePreset(effects, matches, preset as Effect) });
}
