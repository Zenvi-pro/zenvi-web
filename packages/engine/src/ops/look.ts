/**
 * The clip Look menu: Reset Look, Color (Color Grade presets), Film Grain
 * presets, and the Analog Tape / Sharpen / Blur / Glow / Shadow presets.
 *
 * Ported from zenvi-core develop (1f80cb3d0) src/classes/look_presets.py (the
 * rules the timeline's Look menu and the agent's look tools share: which
 * effects a preset replaces, which ids and order it keeps, what Reset Look
 * removes), src/classes/color_presets.py (code port) and
 * src/classes/film_grain_presets.py + LOOK_EFFECT_PRESETS (generated data,
 * look-presets.data.ts), and timeline.py `_clip_has_visual`.
 *
 * The `*Effects` functions are pure: they take a clip's effect list and
 * return the new list, or null when the preset would change nothing (so
 * callers record no undo step).
 */

import type { Transaction } from "../history/document.js";
import type { Clip, Effect, Keyframe } from "../model/types.js";
import { Interpolation } from "../model/types.js";
import { createEffect } from "../effects/registry.js";
import { parseHexColor } from "../keyframe/color.js";
import { invalid } from "./errors.js";
import { ids, isRecord, patchClip, requireEditableClip } from "./internal.js";
import { FILM_GRAIN_PRESETS, LOOK_EFFECT_PRESETS } from "./look-presets.data.js";

/** Effects marked as managed by the Look menu carry `"ui-menu": "look"`. */
export const LOOK_UI_MENU = "look";

/** Look ▸ Color menu entries. */
export const COLOR_PRESETS = ["reset", "auto_contrast", "lift_shadows", "warm_up", "boost_color"] as const;
export type ColorPreset = (typeof COLOR_PRESETS)[number];

/** Every Color Grade preset color_presets.py knows (the Look menu's, plus the Assistant's sunny and gloomy). */
export const COLOR_GRADE_PRESETS = ["auto_contrast", "lift_shadows", "warm_up", "sunny", "gloomy", "boost_color"] as const;
export type ColorGradePreset = (typeof COLOR_GRADE_PRESETS)[number];

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
export function constantProperty(value: number): Keyframe {
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

/** `curve_data`: a Color Grade curve through `points` (0-1), linear between nodes. */
export function curveData(points: readonly { x: number; y: number }[], enabled = true): Record<string, unknown> {
  return { enabled: constantProperty(enabled ? 1.0 : 0.0), nodes: points.map((p, i) => curveNode(i, p.x, p.y)) };
}

/** `default_curve_data`: the identity curve. */
export function defaultCurveData(): Record<string, unknown> {
  return curveData([
    { x: 0.0, y: 0.0 },
    { x: 1.0, y: 1.0 },
  ]);
}

function colorKeyframes(hex: string): Record<string, Keyframe> {
  const [r, g, b] = parseHexColor(hex) ?? [255, 255, 255, 255];
  return { red: constantProperty(r), green: constantProperty(g), blue: constantProperty(b), alpha: constantProperty(255) };
}

/** `wheel_entry`: one Color Grade wheel (tint color, amount 0-1, luma -1..1). */
export function wheelEntry(color = "#ffffff", amount = 0.0, luma = 0.0): Record<string, unknown> {
  return {
    color,
    color_keyframes: colorKeyframes(color),
    amount,
    amount_keyframes: constantProperty(amount),
    luma,
    luma_keyframes: constantProperty(luma),
  };
}

/** `default_wheels_data`: every wheel neutral. */
export function defaultWheelsData(): Record<string, unknown> {
  return {
    enabled_keyframes: constantProperty(1.0),
    global: wheelEntry(),
    shadows: wheelEntry(),
    midtones: wheelEntry(),
    highlights: wheelEntry(),
  };
}

/** The scalar Color Grade controls and their neutral values (color_presets.py `neutral_color_grade`). */
export const NEUTRAL_GRADE_SCALARS: Readonly<Record<string, number>> = {
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

const PRESET_SCALARS: Readonly<Record<ColorGradePreset, Readonly<Record<string, number>>>> = {
  auto_contrast: { contrast: 0.18, highlights: -0.08, shadows: 0.08, vibrance: 0.06 },
  lift_shadows: { exposure: 0.08, contrast: -0.03, highlights: -0.05, shadows: 0.22 },
  warm_up: { temperature: 0.18, tint: 0.03, vibrance: 0.1, saturation: 1.08 },
  sunny: { temperature: 0.12, tint: 0.02, exposure: 0.05, contrast: 0.04, saturation: 1.08, vibrance: 0.08 },
  gloomy: { temperature: -0.1, exposure: -0.08, contrast: 0.06, highlights: -0.08, saturation: 0.88, vibrance: -0.04 },
  boost_color: { contrast: 0.08, saturation: 1.18, vibrance: 0.22 },
};

const PRESET_CURVES: Partial<Record<ColorGradePreset, readonly { x: number; y: number }[]>> = {
  auto_contrast: [
    { x: 0.0, y: 0.0 },
    { x: 0.25, y: 0.22 },
    { x: 0.75, y: 0.8 },
    { x: 1.0, y: 1.0 },
  ],
  lift_shadows: [
    { x: 0.0, y: 0.06 },
    { x: 0.35, y: 0.4 },
    { x: 1.0, y: 1.0 },
  ],
  boost_color: [
    { x: 0.0, y: 0.0 },
    { x: 0.2, y: 0.16 },
    { x: 0.8, y: 0.86 },
    { x: 1.0, y: 1.0 },
  ],
};

/** `neutral_color_grade(effect)`: a copy with every Color Grade control neutral (no LUT, flat curves). */
export function neutralColorGrade<T extends Record<string, unknown>>(effect: T): T {
  const payload: Record<string, unknown> = structuredClone(effect ?? {});
  for (const [key, value] of Object.entries(NEUTRAL_GRADE_SCALARS)) payload[key] = constantProperty(value);
  payload.lut_path = "";
  payload.wheels = defaultWheelsData();
  payload.curve_all = defaultCurveData();
  payload.curve_red = defaultCurveData();
  payload.curve_green = defaultCurveData();
  payload.curve_blue = defaultCurveData();
  return payload as T;
}

export function isColorGradePreset(value: string): value is ColorGradePreset {
  return (COLOR_GRADE_PRESETS as readonly string[]).includes(value);
}

/** `apply_color_grade_preset(effect, name)`: neutral, then the preset's controls and curve. */
export function applyColorGradePreset<T extends Record<string, unknown>>(effect: T, preset: ColorGradePreset): T {
  if (!isColorGradePreset(preset)) throw invalid(`Unknown color preset: ${String(preset)}`);
  const payload: Record<string, unknown> = neutralColorGrade(effect);
  for (const [key, value] of Object.entries(PRESET_SCALARS[preset])) payload[key] = constantProperty(value);
  const curve = PRESET_CURVES[preset];
  if (curve) payload.curve_all = curveData(curve);
  return payload as T;
}

/** The keys a Color preset writes (`apply_color_grade_preset({}, name)`; "neutral" = `neutral_color_grade({})`). */
export function colorGradePresetValues(preset: ColorGradePreset | "neutral"): Record<string, unknown> {
  return preset === "neutral" ? neutralColorGrade({}) : applyColorGradePreset({}, preset);
}

// ---------------------------------------------------------------------------
// film_grain_presets.py
// ---------------------------------------------------------------------------

/** `apply_film_grain_preset(effect, name)`: a copy with the stock's grain controls (and seed 1 when it has none). */
export function applyFilmGrainPreset<T extends Record<string, unknown>>(effect: T, preset: Exclude<FilmGrainPreset, "none">): T {
  const values = FILM_GRAIN_PRESETS[preset];
  if (!values) throw invalid(`Unknown film grain preset: ${String(preset)}`);
  const payload: Record<string, unknown> = structuredClone(effect ?? {});
  for (const [key, value] of Object.entries(values)) payload[key] = constantProperty(value);
  if (!("seed" in payload)) payload.seed = 1;
  return payload as T;
}

// ---------------------------------------------------------------------------
// look_presets.py
// ---------------------------------------------------------------------------

/** A fresh effect of `className` with a new id (the desktop's `create_effect_json`). */
export type CreateEffectJson = (className: string) => Effect;

/** timeline.py `_clip_has_visual`: video, or audio drawn as a waveform. */
export function clipHasVisual(clip: Clip): boolean {
  const reader: Record<string, unknown> = isRecord(clip.reader) ? clip.reader : {};
  if (reader.has_video === undefined || reader.has_video === null || Boolean(reader.has_video)) return true;
  return Boolean(clip.waveform);
}

/** `is_look_managed_effect`: an effect the Look menu created. */
export function isLookManaged(effect: unknown, className?: string): boolean {
  return isRecord(effect) && effect["ui-menu"] === LOOK_UI_MENU && (className === undefined || effect.class_name === className);
}

/** `parse_effect_color`: '#RRGGBB' / '#RRGGBBAA' → channels, else null. */
function parseEffectColor(value: unknown): Record<"red" | "green" | "blue" | "alpha", number> | null {
  if (typeof value !== "string") return null;
  let color = value.trim();
  if (color.startsWith("#")) color = color.slice(1);
  if (color.length !== 6 && color.length !== 8) return null;
  if (!/^[0-9a-fA-F]+$/.test(color)) return null;
  const at = (i: number): number => Number.parseInt(color.slice(i, i + 2), 16);
  return { red: at(0), green: at(2), blue: at(4), alpha: color.length === 8 ? at(6) : 255 };
}

/** `set_effect_property_value`: constant keyframe, colour channels, or a plain key. */
function setEffectPropertyValue(effect: Record<string, unknown>, key: string, value: number | string): void {
  const current = effect[key];
  const channels = parseEffectColor(value);
  if (channels && isRecord(current)) {
    const next: Record<string, unknown> = { ...current };
    for (const [channel, channelValue] of Object.entries(channels)) {
      const data = current[channel];
      if (isRecord(data) && Array.isArray(data.Points)) next[channel] = { ...data, Points: constantProperty(channelValue).Points };
    }
    effect[key] = next;
  } else if (isRecord(current) && Array.isArray(current.Points)) {
    effect[key] = { ...current, Points: constantProperty(Number(value)).Points };
  } else if (key in effect) {
    effect[key] = value;
  }
}

/** `_replace_matches`: the preset where the first match was (keeping its id and order); other matches dropped. */
function replaceMatches(effects: Effect[], matches: readonly number[], preset: Effect): Effect[] {
  const next = [...effects];
  if (matches.length === 0) return [...next, preset];
  const existing = next[matches[0]!]!;
  if (existing.id) preset.id = existing.id;
  if ("order" in existing) preset.order = existing.order;
  next[matches[0]!] = preset;
  for (const i of [...matches.slice(1)].reverse()) next.splice(i, 1);
  return next;
}

const indexesOf = (effects: readonly Effect[], test: (e: Effect) => boolean): number[] =>
  effects.flatMap((e, i) => (isRecord(e) && test(e) ? [i] : []));

/** `apply_look_effect_preset`: Analog Tape / Sharpen / Blur / Shadow / Glow (`none` removes the Look effect). */
export function lookEffectPresetEffects(
  effects: readonly Effect[],
  className: string,
  presetName: string,
  create: CreateEffectJson,
): Effect[] | null {
  const presets = LOOK_EFFECT_PRESETS[className] ?? {};
  const values = presets[presetName];
  if (!values) throw invalid(`Unknown ${className} look preset: ${presetName}`);
  const list = [...effects];
  const matches = indexesOf(list, (e) => isLookManaged(e, className));
  if (presetName === "none") return matches.length === 0 ? null : list.filter((e) => !isLookManaged(e, className));
  const preset = create(className) as Record<string, unknown>;
  preset["ui-menu"] = LOOK_UI_MENU;
  for (const [key, value] of Object.entries(values)) setEffectPropertyValue(preset, key, value);
  return replaceMatches(list, matches, preset as Effect);
}

/** `apply_color_look_preset`: a fresh Color Grade with the preset in place of the clip's (`reset` removes it). */
export function colorLookPresetEffects(
  effects: readonly Effect[],
  presetName: "reset" | ColorGradePreset,
  create: CreateEffectJson,
): Effect[] | null {
  const list = [...effects];
  const matches = indexesOf(list, (e) => e.class_name === "ColorGrade");
  if (presetName === "reset") return matches.length === 0 ? null : list.filter((e) => !(isRecord(e) && e.class_name === "ColorGrade"));
  const preset = applyColorGradePreset(create("ColorGrade") as Record<string, unknown>, presetName) as Effect;
  return replaceMatches(list, matches, preset);
}

/** `apply_film_grain_look_preset` (`none` removes Film Grain effects). */
export function filmGrainLookPresetEffects(
  effects: readonly Effect[],
  presetName: FilmGrainPreset,
  create: CreateEffectJson,
): Effect[] | null {
  const list = [...effects];
  const matches = indexesOf(list, (e) => e.class_name === "FilmGrain");
  if (presetName === "none") return matches.length === 0 ? null : list.filter((e) => !(isRecord(e) && e.class_name === "FilmGrain"));
  const source = matches.length > 0 ? list[matches[0]!]! : create("FilmGrain");
  const preset = applyFilmGrainPreset(structuredClone(source) as Record<string, unknown>, presetName) as Effect;
  return replaceMatches(list, matches, preset);
}

/** `reset_look`: drop Color Grade, Film Grain and every Look-tagged effect. */
export function resetLookEffects(effects: readonly Effect[]): Effect[] | null {
  const kept = effects.filter(
    (e) => !isRecord(e) || (!["ColorGrade", "FilmGrain"].includes(String(e.class_name)) && !isLookManaged(e)),
  );
  return kept.length === effects.length ? null : kept;
}

export function isLookPresetId(value: string): value is LookPresetId {
  return (LOOK_PRESET_IDS as readonly string[]).includes(value);
}

/** The clip's effect list after a Look menu preset, or null when it changes nothing. */
export function lookPresetEffects(effects: readonly Effect[], presetId: LookPresetId, create: CreateEffectJson): Effect[] | null {
  if (!isLookPresetId(presetId)) throw invalid(`Unknown look preset: ${String(presetId)}.`);
  if (presetId === "reset") return resetLookEffects(effects);
  const [family, name] = presetId.split(".") as [string, string];
  if (family === "color") return colorLookPresetEffects(effects, name as "reset" | ColorGradePreset, create);
  if (family === "film_grain") return filmGrainLookPresetEffects(effects, name as FilmGrainPreset, create);
  return lookEffectPresetEffects(effects, LOOK_EFFECT_CLASSES[family as LookEffectKey], name, create);
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
  const nextId = ids(project);
  const next = lookPresetEffects(clip.effects ?? [], presetId, (className) => createEffect(className, {}, { id: nextId() }));
  return next === null ? clip : patchClip(tx, clipId, { effects: next });
}
