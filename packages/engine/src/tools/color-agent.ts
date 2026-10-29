/**
 * The Zenvi Assistant's older colour tools' rules (apply_color_tool,
 * apply_look_tool, inspect_color_tool, list_looks_tool,
 * match_color_to_reference_tool): Color Grade merges and summaries, the
 * looks catalog, scope summaries, LookProfiles and the grade solver.
 *
 * A port of zenvi-core develop (1f80cb3d0) src/classes/color_agent.py (pure
 * JSON transforms). Errors are `ColorValueError` with the desktop's
 * ValueError text; handlers answer them as "Error: <message>".
 */

import { STYLIZED_LOOKS, stylizedLook, type StylizedLook } from "../looks/stylized.js";
import type { Effect } from "../model/types.js";
import { BUILTIN_LUTS } from "../effects/luts.js";
import { applyColorGradePreset, isColorGradePreset } from "../ops/look.js";
import { pyRound } from "../model/rounding.js";
import { parsePythonFloat } from "./coerce.js";
import { roundTo } from "./color-stats.js";
import { pyRepr } from "./pyfmt.js";

/** The desktop's ValueError: answered as "Error: <message>". */
export class ColorValueError extends Error {
  override readonly name = "ColorValueError";
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const COLOR_GRADE_CLASS_NAME = "ColorGrade";

/** Scalar ColorGrade knobs and their neutral values. */
export const SCALAR_DEFAULTS: Readonly<Record<string, number>> = {
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
export const SCALAR_KEYS: readonly string[] = Object.keys(SCALAR_DEFAULTS);

/** Clamp ranges after resolving *_delta (neutral-zero knobs use [-1, 1]). */
const SCALAR_BOUNDS: Readonly<Record<string, [number, number]>> = {
  saturation: [0.0, 2.0],
  mix: [0.0, 1.0],
  lut_intensity: [0.0, 1.0],
};

/** Agent-facing aliases → ColorGrade keys. */
export const SCALAR_ALIASES: Readonly<Record<string, string>> = {
  temp: "temperature",
  sat: "saturation",
  lut_strength: "lut_intensity",
  lutIntensity: "lut_intensity",
};

export const CURVE_KEYS = ["curve_all", "curve_red", "curve_green", "curve_blue"] as const;
export const CURVE_ALIASES: Readonly<Record<string, string>> = {
  masterCurve: "curve_all",
  master_curve: "curve_all",
  redCurve: "curve_red",
  red_curve: "curve_red",
  greenCurve: "curve_green",
  green_curve: "curve_green",
  blueCurve: "curve_blue",
  blue_curve: "curve_blue",
};
export const WHEEL_NAMES = ["global", "shadows", "midtones", "highlights"] as const;

/** Soft ColorGrade presets (color_presets.py); reset removes the effect. */
export const LOOK_PRESET_IDS = ["reset", "auto_contrast", "lift_shadows", "warm_up", "sunny", "gloomy", "boost_color"] as const;

export const FILM_GRAIN_LOOK_IDS = ["none", "35mm_fine", "35mm_classic", "35mm_gritty", "16mm_classic", "super_8", "high_iso"] as const;

/** Relative nudges resolved against the current grade before a merge. */
export const DELTA_KEYS: Readonly<Record<string, string>> = {
  temperature_delta: "temperature",
  tint_delta: "tint",
  exposure_delta: "exposure",
  vibrance_delta: "vibrance",
  contrast_delta: "contrast",
  highlights_delta: "highlights",
  shadows_delta: "shadows",
  saturation_delta: "saturation",
};

export function lutRelativePath(category: string, lookId: string): string {
  return `${category}/${lookId}.cube`;
}

export function isColorGradeEffect(effect: unknown): boolean {
  return isRecord(effect) && effect.class_name === COLOR_GRADE_CLASS_NAME;
}

export function findColorGrade(effects: unknown): Effect | null {
  if (!Array.isArray(effects)) return null;
  return (effects.find((e) => isColorGradeEffect(e)) as Effect | undefined) ?? null;
}

export function isFilmGrainEffect(effect: unknown): boolean {
  return isRecord(effect) && effect.class_name === "FilmGrain";
}

export function findFilmGrain(effects: unknown): Effect | null {
  if (!Array.isArray(effects)) return null;
  return (effects.find((e) => isFilmGrainEffect(e)) as Effect | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Scalars, curves, wheels
// ---------------------------------------------------------------------------

function constantProperty(value: number): Json {
  return {
    Points: [{ co: { X: 1.0, Y: Number(value) }, handle_left: { X: 0.5, Y: 1.0 }, handle_right: { X: 0.5, Y: 0.0 }, handle_type: 0, interpolation: 0 }],
  };
}

/** `scalar_y`: the first point's value, else `fallback`, else the neutral value. */
export function scalarY(effect: Json | null | undefined, key: string, fallback?: number): number | null {
  const raw = effect?.[key];
  if (isRecord(raw) && Array.isArray(raw.Points) && raw.Points.length > 0) {
    const co = isRecord(raw.Points[0]) ? (raw.Points[0] as Json).co : null;
    if (isRecord(co) && "Y" in co) {
      const y = typeof co.Y === "string" ? parsePythonFloat(co.Y) : typeof co.Y === "number" ? co.Y : null;
      if (y !== null) return y;
    }
  }
  if (fallback !== undefined) return fallback;
  return key in SCALAR_DEFAULTS ? SCALAR_DEFAULTS[key]! : null;
}

export function setScalar(effect: Json, key: string, value: number): void {
  effect[key] = constantProperty(value);
}

/** Curve nodes are LINEAR, as libopenshot's default curve and the Look menu write them. */
function curveNode(id: number, x: number, y: number): Json {
  return {
    id: Math.trunc(id),
    x: constantProperty(x),
    y: constantProperty(y),
    left_handle_x: constantProperty(0.5),
    left_handle_y: constantProperty(1.0),
    right_handle_x: constantProperty(0.5),
    right_handle_y: constantProperty(0.0),
    interpolation: 1,
    handle_type: 0,
  };
}

/** `points_to_curve`: [[x, y], ...] or [{x, y}] → a Color Grade curve. */
export function pointsToCurve(points: readonly unknown[], enabled = true): Json {
  const nodes = points.map((point, index) => {
    let x: number;
    let y: number;
    if (Array.isArray(point) && point.length >= 2) {
      [x, y] = [toFloat(point[0], "curve point"), toFloat(point[1], "curve point")];
    } else if (isRecord(point)) {
      x = toFloat(point.x ?? point.X ?? 0.0, "curve point");
      y = toFloat(point.y ?? point.Y ?? 0.0, "curve point");
    } else {
      throw new ColorValueError(`Invalid curve point: ${pyRepr(point)}`);
    }
    return curveNode(index, x, y);
  });
  if (nodes.length < 2) throw new ColorValueError("Curves need at least two points");
  return { enabled: constantProperty(enabled ? 1.0 : 0.0), nodes };
}

function colorKeyframes(hex: string): Json {
  const rgb = hex.replace(/^#+/, "");
  if (rgb.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(rgb)) throw new ColorValueError(`Wheel color must be #RRGGBB, got ${pyRepr(hex)}`);
  const at = (i: number): number => Number.parseInt(rgb.slice(i, i + 2), 16);
  return { red: constantProperty(at(0)), green: constantProperty(at(2)), blue: constantProperty(at(4)), alpha: constantProperty(255) };
}

function wheelEntry(color = "#ffffff", amount = 0.0, luma = 0.0): Json {
  return {
    color,
    color_keyframes: colorKeyframes(color),
    amount,
    amount_keyframes: constantProperty(amount),
    luma,
    luma_keyframes: constantProperty(luma),
  };
}

export function defaultWheelsData(): Json {
  return {
    enabled_keyframes: constantProperty(1.0),
    global: wheelEntry(),
    shadows: wheelEntry(),
    midtones: wheelEntry(),
    highlights: wheelEntry(),
  };
}

export function defaultCurveData(): Json {
  return { enabled: constantProperty(1.0), nodes: [curveNode(0, 0.0, 0.0), curveNode(1, 1.0, 1.0)] };
}

/** `blank_color_grade`: a neutral ColorGrade without libopenshot (only the keys the agent writes). */
export function blankColorGrade(effectId = ""): Json {
  const payload: Json = {
    class_name: COLOR_GRADE_CLASS_NAME,
    name: "Color Grade",
    lut_path: "",
    wheels: defaultWheelsData(),
    curve_all: defaultCurveData(),
    curve_red: defaultCurveData(),
    curve_green: defaultCurveData(),
    curve_blue: defaultCurveData(),
  };
  for (const [key, value] of Object.entries(SCALAR_DEFAULTS)) setScalar(payload, key, value);
  if (effectId) payload.id = effectId;
  return payload;
}

/** `parse_clip_ids`: JSON lists, comma lists and single ids from every argument, de-duplicated in order. */
export function parseClipIds(...values: unknown[]): string[] {
  const collected: string[] = [];
  const extend = (raw: unknown): void => {
    if (raw === null || raw === undefined || raw === "") return;
    if (Array.isArray(raw)) {
      for (const item of raw) extend(item);
      return;
    }
    const text = String(raw).trim();
    if (!text) return;
    if (text.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (Array.isArray(parsed)) {
          for (const item of parsed) extend(item);
          return;
        }
      } catch {
        // Not JSON: read it as a comma list.
      }
    }
    for (const part of text.split(",")) {
      const piece = part.trim().replace(/^["']+|["']+$/g, "");
      if (piece) collected.push(piece);
    }
  };
  for (const value of values) extend(value);
  return [...new Set(collected)];
}

/** `_coerce_float`: a finite float or ColorValueError("<name> must be a finite number"). */
export function toFloat(value: unknown, name: string): number {
  let out: number | null = null;
  if (typeof value === "number") out = value;
  else if (typeof value === "boolean") out = value ? 1 : 0;
  else if (typeof value === "string") out = parsePythonFloat(value);
  if (out === null || !Number.isFinite(out)) throw new ColorValueError(`${name} must be a finite number`);
  return out;
}

function mergeWheel(existing: unknown, patch: Json): Json {
  const base = isRecord(existing) ? structuredClone(existing) : wheelEntry();
  const color = patch.color || patch.hex;
  if (color !== undefined && color !== null && color !== "") {
    let text = String(color).trim();
    if (!text.startsWith("#")) text = `#${text}`;
    base.color = text;
    base.color_keyframes = colorKeyframes(text);
  }
  if (patch.amount !== undefined && patch.amount !== null) {
    const amount = toFloat(patch.amount, "wheel.amount");
    base.amount = amount;
    base.amount_keyframes = constantProperty(amount);
  }
  if (patch.luma !== undefined && patch.luma !== null) {
    const luma = toFloat(patch.luma, "wheel.luma");
    base.luma = luma;
    base.luma_keyframes = constantProperty(luma);
  }
  return base;
}

/** `resolve_relative_deltas`: temperature_delta & co. → absolute values from the current grade (clamped). */
export function resolveRelativeDeltas(effect: Json | null, patch: Json): Json {
  const out: Json = { ...patch };
  for (const [dkey, target] of Object.entries(DELTA_KEYS)) {
    if (!(dkey in out) || out[dkey] === null || out[dkey] === undefined || out[dkey] === "") continue;
    const delta = toFloat(out[dkey], dkey);
    delete out[dkey];
    if (target in out && out[target] !== null && out[target] !== undefined && out[target] !== "") {
      throw new ColorValueError(`pass ${target} or ${dkey}, not both`);
    }
    const cur = scalarY(effect ?? {}, target) ?? SCALAR_DEFAULTS[target] ?? 0;
    const [lo, hi] = SCALAR_BOUNDS[target] ?? [-1.0, 1.0];
    out[target] = Math.max(lo, Math.min(hi, cur + delta));
  }
  return out;
}

const SATURATION_REFUSAL =
  "saturation neutral is 1.0 (not 0). Values below 0.5 look grey. " +
  "For more color use ~1.1–1.3, or apply_look_tool lookId='sunny' / " +
  "'boost_color'. For less color use ~0.7–0.9, never 0.2.";

/** `validate_color_patch`: refuse a bad patch before anything is written. */
export function validateColorPatch(patch: unknown): void {
  if (!isRecord(patch)) throw new ColorValueError("color patch must be an object");
  if (patch.color !== undefined && patch.color !== null && !isRecord(patch.color)) throw new ColorValueError("'color' paste object must be a dict");
  for (const [key, raw] of Object.entries(patch)) {
    if (key in DELTA_KEYS && raw !== null && raw !== undefined && typeof raw !== "boolean") {
      toFloat(raw, key);
      continue;
    }
    const canon = SCALAR_ALIASES[key] ?? key;
    if (SCALAR_KEYS.includes(canon) && raw !== null && raw !== undefined && typeof raw !== "boolean") {
      const value = toFloat(raw, canon);
      // Neutral saturation is 1.0: 0.2 meaning "a bit more color" greys the shot out.
      if (canon === "saturation" && value < 0.5) throw new ColorValueError(SATURATION_REFUSAL);
    }
  }
  const lut = patch.lut;
  if (lut !== undefined && lut !== null) {
    if (!isRecord(lut)) throw new ColorValueError("lut must be an object with path and optional strength");
    if (lut.strength !== undefined && lut.strength !== null) toFloat(lut.strength, "lut.strength");
    if (lut.intensity !== undefined && lut.intensity !== null) toFloat(lut.intensity, "lut.intensity");
  }
  const wheels = patch.wheels;
  if (wheels !== undefined && wheels !== null) {
    if (!isRecord(wheels)) throw new ColorValueError("wheels must be an object");
    for (const [name, wheel] of Object.entries(wheels)) {
      if (name === "enabled") continue;
      if (!(WHEEL_NAMES as readonly string[]).includes(name)) throw new ColorValueError(`Unknown wheel '${name}'`);
      if (wheel !== null && wheel !== undefined && !isRecord(wheel)) throw new ColorValueError(`wheels.${name} must be an object`);
      if (isRecord(wheel)) {
        if (wheel.amount !== undefined && wheel.amount !== null) toFloat(wheel.amount, `wheels.${name}.amount`);
        if (wheel.luma !== undefined && wheel.luma !== null) toFloat(wheel.luma, `wheels.${name}.luma`);
        const color = wheel.color || wheel.hex;
        if (color !== undefined && color !== null && color !== "") {
          const rgb = String(color).replace(/^#+/, "");
          if (rgb.length !== 6) throw new ColorValueError(`wheels.${name}.color must be #RRGGBB`);
          if (!/^[0-9a-fA-F]{6}$/.test(rgb)) throw new ColorValueError(`invalid literal for int() with base 16: ${pyRepr(rgb)}`);
        }
      }
    }
  }
  for (const [alias, canon] of [...Object.entries(CURVE_ALIASES), ...CURVE_KEYS.map((k) => [k, k] as const)]) {
    if (!(alias in patch) && !(canon in patch)) continue;
    const points = alias in patch ? patch[alias] : patch[canon];
    if (points === null || points === undefined) continue;
    if (isRecord(points) && "nodes" in points) continue;
    if (!Array.isArray(points) || points.length < 2) throw new ColorValueError(`${canon} needs a list of at least two [x,y] points`);
    pointsToCurve(points);
  }
}

/** `merge_color_grade`: merge an agent patch into a ColorGrade (fields it does not set are kept). */
export function mergeColorGrade(effect: Json | null, rawPatch: Json): Json {
  validateColorPatch(rawPatch);
  let payload: Json = structuredClone(effect ?? {});
  if (!isColorGradeEffect(payload)) payload.class_name = COLOR_GRADE_CLASS_NAME;
  const patch = resolveRelativeDeltas(payload, rawPatch);
  // Deltas resolve after the first validation: check the absolute saturation again.
  const sat = patch.saturation;
  if (sat !== undefined && sat !== null && sat !== "") {
    if (toFloat(sat, "saturation") < 0.5) throw new ColorValueError(SATURATION_REFUSAL);
  }
  // A paste lays its fields over the grade and keeps id and order. zenvi-core's merge_color_grade
  // (src/classes/color_agent.py) replaces the payload instead: the same result for a full paste,
  // but a partial one there drops the fields (and the `type`) it leaves out.
  const colorObj = patch.color;
  if (isRecord(colorObj)) {
    const keepId = payload.id;
    const keepOrder = payload.order;
    payload = { ...payload, ...structuredClone(colorObj) };
    payload.class_name = COLOR_GRADE_CLASS_NAME;
    if (keepId) payload.id = keepId;
    if (keepOrder !== undefined && keepOrder !== null) payload.order = keepOrder;
    // A hand-written paste ({"exposure": 1}) gives plain numbers; libopenshot (and the engine's
    // kernel) read only keyframes, so a plain number would silently grade nothing.
    for (const key of SCALAR_KEYS) {
      const value = payload[key];
      if (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) setScalar(payload, key, toFloat(value, key));
    }
  }
  for (const [key, raw] of Object.entries(patch)) {
    if (["color", "lut", "wheels", "reset"].includes(key) || (CURVE_KEYS as readonly string[]).includes(key) || key in CURVE_ALIASES) continue;
    const canon = SCALAR_ALIASES[key] ?? key;
    if (SCALAR_KEYS.includes(canon) && raw !== null && raw !== undefined) setScalar(payload, canon, toFloat(raw, canon));
  }
  if ("lut_path" in patch && patch.lut_path !== null && patch.lut_path !== undefined) payload.lut_path = String(patch.lut_path);
  const lut = patch.lut;
  if (isRecord(lut)) {
    if (lut.path !== undefined && lut.path !== null) payload.lut_path = String(lut.path);
    const strength = lut.strength ?? lut.intensity;
    if (strength !== undefined && strength !== null) setScalar(payload, "lut_intensity", toFloat(strength, "lut.strength"));
  }
  const wheelsPatch = patch.wheels;
  if (isRecord(wheelsPatch)) {
    const wheels: Json = isRecord(payload.wheels) ? structuredClone(payload.wheels) : defaultWheelsData();
    for (const name of WHEEL_NAMES) {
      if (name in wheelsPatch && wheelsPatch[name] !== null && wheelsPatch[name] !== undefined) {
        wheels[name] = mergeWheel(wheels[name], wheelsPatch[name] as Json);
      }
    }
    payload.wheels = wheels;
  }
  for (const [alias, canon] of [...Object.entries(CURVE_ALIASES), ...CURVE_KEYS.map((k) => [k, k] as const)]) {
    if (!(alias in patch)) continue;
    const points = patch[alias];
    if (points === null || points === undefined) continue;
    payload[canon] = isRecord(points) && "nodes" in points ? structuredClone(points) : pointsToCurve(points as unknown[]);
  }
  return payload;
}

/** `summarize_color_grade`. */
export function summarizeColorGrade(effect: unknown): Json {
  if (!isColorGradeEffect(effect)) return { present: false };
  const e = effect as Json;
  const summary: Json = {
    present: true,
    id: e.id ?? null,
    lut_path: e.lut_path || "",
    wheels: e.wheels || {},
    curve_all: e.curve_all || {},
    curve_red: e.curve_red || {},
    curve_green: e.curve_green || {},
    curve_blue: e.curve_blue || {},
  };
  for (const key of SCALAR_KEYS) summary[key] = scalarY(e, key);
  return summary;
}

const GRAIN_SCALAR_KEYS = [
  "amount", "size", "softness", "clump", "shadows", "midtones", "highlights", "color_amount", "color_variation", "evolution", "coherence",
] as const;

/** `summarize_film_grain`. */
export function summarizeFilmGrain(effect: unknown): Json {
  if (!isFilmGrainEffect(effect)) return { present: false };
  const summary: Json = { present: true, id: (effect as Json).id ?? null };
  for (const key of GRAIN_SCALAR_KEYS) summary[key] = scalarY(effect as Json, key);
  return summary;
}

function num(value: unknown, fallback: number): number {
  return value === null || value === undefined ? fallback : Number(value);
}

/** `grain_meaningfully_differs`. */
export function grainMeaningfullyDiffers(subject: unknown, reference: unknown, eps = 0.03): boolean {
  const sub = isRecord(subject) ? subject : {};
  const ref = isRecord(reference) ? reference : {};
  if (Boolean(sub.present) !== Boolean(ref.present)) return true;
  if (!sub.present) return false;
  return GRAIN_SCALAR_KEYS.some((key) => Math.abs(num(sub[key], 0) - num(ref[key], 0)) >= eps);
}

function withoutIdentity(effect: Effect): Json {
  const paste = structuredClone(effect) as Json;
  delete paste.id;
  delete paste.order;
  return paste;
}

/** `match_grain_action`: noop, reset, or paste the reference's FilmGrain. */
export function matchGrainAction(subjectEffect: Effect | null, referenceEffect: Effect | null): Json {
  const sub = summarizeFilmGrain(subjectEffect);
  const ref = summarizeFilmGrain(referenceEffect);
  if (!grainMeaningfullyDiffers(sub, ref)) return { mode: "noop" };
  if (!ref.present) return { mode: "reset" };
  return { mode: "paste", grain: withoutIdentity(referenceEffect!) };
}

/** Stable JSON (sorted keys) of the wheels and curves, so paste decisions see non-scalar differences. */
function structureFingerprint(payload: Json): string {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sorted(value[k])]));
    return value;
  };
  return JSON.stringify(
    sorted({
      wheels: payload.wheels || {},
      curve_all: payload.curve_all || {},
      curve_red: payload.curve_red || {},
      curve_green: payload.curve_green || {},
      curve_blue: payload.curve_blue || {},
    }),
  );
}

/** `grades_meaningfully_differ`: knobs, LUT, wheels or curves differ enough to copy or reset. */
export function gradesMeaningfullyDiffer(subject: unknown, reference: unknown, eps = 0.02): boolean {
  const sub = isRecord(subject) ? subject : {};
  const ref = isRecord(reference) ? reference : {};
  if (Boolean(sub.present) !== Boolean(ref.present)) return true;
  if (!sub.present) return false;
  if (String(sub.lut_path || "") !== String(ref.lut_path || "")) return true;
  for (const key of SCALAR_KEYS) {
    if (Math.abs(num(sub[key], SCALAR_DEFAULTS[key]!) - num(ref[key], SCALAR_DEFAULTS[key]!)) >= eps) return true;
  }
  return structureFingerprint(sub) !== structureFingerprint(ref);
}

/** `match_grade_action`: noop, reset, or paste the reference's ColorGrade. */
export function matchGradeAction(subjectEffect: Effect | null, referenceEffect: Effect | null): Json {
  const sub = summarizeColorGrade(subjectEffect);
  const ref = summarizeColorGrade(referenceEffect);
  if (!gradesMeaningfullyDiffer(sub, ref)) return { mode: "noop" };
  if (!ref.present) return { mode: "reset" };
  return { mode: "paste", color: withoutIdentity(referenceEffect!) };
}

// ---------------------------------------------------------------------------
// Scope summaries
// ---------------------------------------------------------------------------

function histMean(bins: readonly number[]): number | null {
  if (bins.length === 0) return null;
  let total = 0;
  let weighted = 0;
  const n = bins.length;
  bins.forEach((count, i) => {
    total += count;
    weighted += count * (i / Math.max(n - 1, 1));
  });
  return total > 0 ? weighted / total : null;
}

function histPercentile(bins: readonly number[], p: number): number | null {
  if (bins.length === 0) return null;
  const q = Math.max(0, Math.min(1, p));
  const total = bins.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const target = total * q;
  let running = 0;
  for (let i = 0; i < bins.length; i += 1) {
    running += bins[i]!;
    if (running >= target) return i / Math.max(bins.length - 1, 1);
  }
  return 1.0;
}

/** FrameScope's output as `_framescope_from_frame` passes it on. */
export interface RawScopeVideo {
  present: boolean;
  histogram?: { luma: number[]; red: number[]; green: number[]; blue: number[] };
  summary?: { avg_luma: number; clipped_shadows: number; clipped_highlights: number };
}

/** `summarize_scope_video`: compact FrameScope data for inspect JSON. */
export function summarizeScopeVideo(video: RawScopeVideo | null | undefined): Json {
  if (!video || !video.present) return { present: false };
  const summary: Json = { present: true };
  const s = video.summary;
  summary.avg_luma = s?.avg_luma ?? null;
  summary.clipped_shadows = s?.clipped_shadows ?? null;
  summary.clipped_highlights = s?.clipped_highlights ?? null;
  const hist = video.histogram;
  const means: Record<string, number> = {};
  for (const channel of ["luma", "red", "green", "blue"] as const) {
    const mean = histMean(hist?.[channel] ?? []);
    if (mean !== null) means[channel] = roundTo(mean, 4);
  }
  if (Object.keys(means).length > 0) {
    summary.channel_means = means;
    const { red: r, green: g, blue: b } = means;
    if (r !== undefined && b !== undefined) summary.warm_cool = roundTo(r - b, 4);
    if (g !== undefined && r !== undefined && b !== undefined) summary.green_magenta = roundTo(g - (r + b) / 2.0, 4);
  }
  return summary;
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** `scope_look_distance`: how different two isolated scope summaries look (0 ≈ same). */
export function scopeLookDistance(subject: unknown, reference: unknown): number | null {
  if (!isRecord(subject) || !isRecord(reference) || !subject.present || !reference.present) return null;
  const parts: number[] = [];
  for (const [key, weight] of [
    ["avg_luma", 1.0],
    ["warm_cool", 1.2],
    ["green_magenta", 1.0],
  ] as const) {
    const a = finite(subject[key]);
    const b = finite(reference[key]);
    if (a !== null && b !== null) parts.push(Math.abs(a - b) * weight);
  }
  const subCm = isRecord(subject.channel_means) ? subject.channel_means : {};
  const refCm = isRecord(reference.channel_means) ? reference.channel_means : {};
  for (const ch of ["red", "green", "blue"]) {
    const a = finite(subCm[ch]);
    const b = finite(refCm[ch]);
    if (a !== null && b !== null) parts.push(Math.abs(a - b) * 0.8);
  }
  if (parts.length === 0) return null;
  return roundTo(parts.reduce((x, y) => x + y, 0), 4);
}

/** `reference_gap_hints`: scope differences → apply_color knob hints. */
export function referenceGapHints(subject: Json, reference: Json): { gap: Json; hints: Json[] } {
  const gap: Json = {};
  const hints: Json[] = [];
  if (!subject.present || !reference.present) return { gap, hints };
  const pair = (key: string): [number, number] | null => {
    const a = finite(subject[key]);
    const b = finite(reference[key]);
    return a !== null && b !== null ? [a, b] : null;
  };
  const luma = pair("avg_luma");
  if (luma) {
    const delta = luma[1] - luma[0];
    gap.avg_luma = roundTo(delta, 4);
    if (Math.abs(delta) >= 0.015) hints.push({ exposure: roundTo(Math.max(-0.5, Math.min(0.5, delta * 0.8)), 3), reason: "match average luma" });
  }
  const warm = pair("warm_cool");
  if (warm) {
    const delta = warm[1] - warm[0];
    gap.warm_cool = roundTo(delta, 4);
    if (Math.abs(delta) >= 0.012) hints.push({ temperature: roundTo(Math.max(-0.4, Math.min(0.4, delta * 0.6)), 3), reason: "match warm/cool balance" });
  }
  const gm = pair("green_magenta");
  if (gm) {
    const delta = gm[1] - gm[0];
    gap.green_magenta = roundTo(delta, 4);
    if (Math.abs(delta) >= 0.01) hints.push({ tint: roundTo(Math.max(-0.3, Math.min(0.3, delta * 0.5)), 3), reason: "match green/magenta balance" });
  }
  const distance = scopeLookDistance(subject, reference);
  if (distance !== null) gap.look_distance = distance;
  return { gap, hints };
}

// ---------------------------------------------------------------------------
// LookProfile: dense sample aggregation + inverse grade
// ---------------------------------------------------------------------------

export const LOOK_DISTANCE_MATCHED = 0.045;
export const LOOK_DISTANCE_CLOSE = 0.08;
const MAX_STEP: Readonly<Record<string, number>> = {
  exposure: 0.35,
  contrast: 0.25,
  highlights: 0.3,
  shadows: 0.3,
  temperature: 0.35,
  tint: 0.25,
  saturation: 0.25,
  vibrance: 0.25,
};

/** `sample_count_for_duration`: full-frame samples across a media duration (1 for stills, 16-96 otherwise). */
export function sampleCountForDuration(duration: number): number {
  const d = Number.isFinite(duration) ? duration : 0;
  if (d <= 0.05) return 1;
  // ~1 sample / 25 s on long form, denser on short; floor 16, ceil 96.
  return Math.max(16, Math.min(96, pyRound(d / 25.0) + 8));
}

function satProxy(means: Json): number | null {
  const r = finite(means.red);
  const g = finite(means.green);
  const b = finite(means.blue);
  if (r === null || g === null || b === null) return null;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx <= 1e-9) return 0.0;
  return (mx - mn) / mx;
}

function enrichScopeForProfile(scope: Json): Json {
  const out: Json = isRecord(scope) ? { ...scope } : { present: false };
  if (!out.present) return out;
  const sat = satProxy(isRecord(out.channel_means) ? out.channel_means : {});
  if (sat !== null) out.sat_proxy = roundTo(sat, 4);
  return out;
}

/** `scope_from_raw_video`: summarize_scope_video + contrast span from the luma percentiles. */
export function scopeFromRawVideo(video: RawScopeVideo | null | undefined): Json {
  const summary = summarizeScopeVideo(video);
  if (!summary.present || !video) return summary;
  const luma = video.histogram?.luma ?? [];
  const p10 = histPercentile(luma, 0.1);
  const p90 = histPercentile(luma, 0.9);
  if (p10 !== null && p90 !== null) {
    summary.contrast_span = roundTo(p90 - p10, 4);
    summary.luma_p10 = roundTo(p10, 4);
    summary.luma_p90 = roundTo(p90, 4);
  }
  return enrichScopeForProfile(summary);
}

function median(values: readonly (number | null)[]): number | null {
  const clean = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid]! : (clean[mid - 1]! + clean[mid]!) / 2.0;
}

function percentileList(values: readonly number[], p: number): number | null {
  const clean = [...values].sort((a, b) => a - b);
  if (clean.length === 0) return null;
  if (clean.length === 1) return clean[0]!;
  const idx = Math.max(0, Math.min(clean.length - 1, pyRound((clean.length - 1) * p)));
  return clean[idx]!;
}

/** `build_look_profile`: one or many scope summaries → a LookProfile (medians, so one flash frame cannot own the look). */
export function buildLookProfile(scopes: Json | readonly Json[] | null | undefined): Json {
  let items: Json[];
  if (Array.isArray(scopes)) items = scopes.filter(isRecord);
  else if (isRecord(scopes)) items = [scopes];
  else return { present: false, samples: 0 };
  const present = items.filter((s) => s.present).map(enrichScopeForProfile);
  if (present.length === 0) return { present: false, samples: 0 };
  const collect = (key: string): number[] => present.map((s) => finite(s[key])).filter((v): v is number => v !== null);
  const collectCh = (ch: string): number[] =>
    present.map((s) => finite(isRecord(s.channel_means) ? s.channel_means[ch] : null)).filter((v): v is number => v !== null);
  const profile: Json = {
    present: true,
    samples: present.length,
    avg_luma: median(collect("avg_luma")),
    warm_cool: median(collect("warm_cool")),
    green_magenta: median(collect("green_magenta")),
    sat_proxy: median(collect("sat_proxy")),
    contrast_span: median(collect("contrast_span")),
    clipped_shadows: median(collect("clipped_shadows")),
    clipped_highlights: median(collect("clipped_highlights")),
    channel_means: {},
  };
  for (const ch of ["red", "green", "blue", "luma"]) {
    const m = median(collectCh(ch));
    if (m !== null) (profile.channel_means as Json)[ch] = roundTo(m, 4);
  }
  const lumaVals = collect("avg_luma");
  const warmVals = collect("warm_cool");
  if (lumaVals.length >= 3) {
    profile.luma_p10 = percentileList(lumaVals, 0.1);
    profile.luma_p90 = percentileList(lumaVals, 0.9);
  }
  if (warmVals.length >= 3) {
    profile.warm_p10 = percentileList(warmVals, 0.1);
    profile.warm_p90 = percentileList(warmVals, 0.9);
  }
  for (const key of [
    "avg_luma", "warm_cool", "green_magenta", "sat_proxy", "contrast_span", "clipped_shadows", "clipped_highlights",
    "luma_p10", "luma_p90", "warm_p10", "warm_p90",
  ]) {
    const v = finite(profile[key]);
    if (v !== null) profile[key] = roundTo(v, 4);
  }
  return profile;
}

/** `look_profile_distance`: weighted LookProfile distance (0 ≈ same look). */
export function lookProfileDistance(subject: unknown, reference: unknown): number | null {
  if (!isRecord(subject) || !isRecord(reference) || !subject.present || !reference.present) return null;
  const parts: number[] = [];
  for (const [key, weight] of [
    ["avg_luma", 1.2],
    ["warm_cool", 1.4],
    ["green_magenta", 1.0],
    ["sat_proxy", 1.1],
    ["contrast_span", 1.0],
    ["clipped_highlights", 0.9],
    ["clipped_shadows", 0.6],
  ] as const) {
    const a = finite(subject[key]);
    const b = finite(reference[key]);
    if (a !== null && b !== null) parts.push(Math.abs(a - b) * weight);
  }
  const subCm = isRecord(subject.channel_means) ? subject.channel_means : {};
  const refCm = isRecord(reference.channel_means) ? reference.channel_means : {};
  for (const ch of ["red", "green", "blue"]) {
    const a = finite(subCm[ch]);
    const b = finite(refCm[ch]);
    if (a !== null && b !== null) parts.push(Math.abs(a - b) * 0.7);
  }
  if (parts.length === 0) return scopeLookDistance(subject, reference);
  return roundTo(parts.reduce((x, y) => x + y, 0), 4);
}

/** `cap_color_patch`: clamp each step's knob changes so one iteration cannot nuke the picture. */
export function capColorPatch(patch: Json, scale = 1.0): Json {
  const out: Json = {};
  const s = Math.max(0.05, Math.min(1.0, Number.isFinite(scale) ? scale : 1.0));
  for (const [key, value] of Object.entries(patch)) {
    if (!SCALAR_KEYS.includes(key) && !(key in SCALAR_ALIASES)) {
      if (["lut_path", "lut", "color", "reset", "wheels"].includes(key) || key.startsWith("curve")) out[key] = value;
      continue;
    }
    const canon = SCALAR_ALIASES[key] ?? key;
    const v = finite(value);
    if (v === null) continue;
    const limit = MAX_STEP[canon] ?? 0.35;
    out[canon] = roundTo(Math.max(-limit, Math.min(limit, v * s)), 4);
  }
  return out;
}

/** `solve_grade_from_profiles`: LookProfile gap → ColorGrade nudges toward the reference. */
export function solveGradeFromProfiles(subject: Json, reference: Json, scale = 1.0): Json {
  if (!subject.present || !reference.present) return {};
  const patch: Json = {};
  const delta = (key: string): number | null => {
    const a = finite(subject[key]);
    const b = finite(reference[key]);
    return a !== null && b !== null ? b - a : null;
  };
  const clampTo = (lo: number, hi: number, x: number): number => Math.max(lo, Math.min(hi, x));
  const luma = delta("avg_luma");
  if (luma !== null && Math.abs(luma) >= 0.012) patch.exposure = clampTo(-0.5, 0.5, luma * 0.85);
  const warm = delta("warm_cool");
  if (warm !== null && Math.abs(warm) >= 0.01) patch.temperature = clampTo(-0.45, 0.45, warm * 0.65);
  const gm = delta("green_magenta");
  if (gm !== null && Math.abs(gm) >= 0.008) patch.tint = clampTo(-0.35, 0.35, gm * 0.55);
  const sat = delta("sat_proxy");
  if (sat !== null && Math.abs(sat) >= 0.02) {
    patch.saturation = clampTo(-0.35, 0.35, sat * 0.9);
    patch.vibrance = clampTo(-0.3, 0.3, sat * 0.55);
  }
  const contrast = delta("contrast_span");
  if (contrast !== null && Math.abs(contrast) >= 0.015) patch.contrast = clampTo(-0.35, 0.35, contrast * 0.7);
  const hi = delta("clipped_highlights");
  if (hi !== null && Math.abs(hi) >= 0.01) patch.highlights = clampTo(-0.4, 0.4, -hi * 1.2);
  const sh = delta("clipped_shadows");
  if (sh !== null && Math.abs(sh) >= 0.01) patch.shadows = clampTo(-0.4, 0.4, sh * 0.9);
  return capColorPatch(patch, scale);
}

/** `assess_grade_outcome`: did AFTER move toward GOAL without nuking the image? */
export function assessGradeOutcome(before: Json, after: Json, goal: Json, outdoorBright = false): Json {
  const beforeD = lookProfileDistance(before, goal);
  const afterD = lookProfileDistance(after, goal);
  let nukeRisk = false;
  const reasons: string[] = [];
  const f = (d: Json, key: string): number => finite(d[key]) ?? 0.0;
  const afterHi = f(after, "clipped_highlights");
  const beforeHi = f(before, "clipped_highlights");
  if (afterHi - beforeHi >= 0.04 || afterHi >= 0.12) {
    nukeRisk = true;
    reasons.push("clipped_highlights_spike");
  }
  if (outdoorBright && afterHi >= 0.08) {
    nukeRisk = true;
    reasons.push("outdoor_highlight_blow");
  }
  if (f(after, "clipped_shadows") - f(before, "clipped_shadows") >= 0.06) {
    nukeRisk = true;
    reasons.push("clipped_shadows_spike");
  }
  if (beforeD !== null && afterD !== null && afterD > beforeD + 0.02) {
    nukeRisk = true;
    reasons.push("look_distance_worse");
  }
  let recovery: Json = {};
  if (nukeRisk) {
    recovery = capColorPatch({ exposure: afterHi > beforeHi ? -0.12 : -0.06, highlights: -0.15, contrast: -0.08, vibrance: -0.05 });
    if (afterHi > beforeHi) {
      recovery.exposure = -Math.min(0.25, 0.08 + (afterHi - beforeHi));
      recovery.highlights = -Math.min(0.3, 0.1 + (afterHi - beforeHi));
    }
  }
  const ok = !nukeRisk && afterD !== null && afterD <= LOOK_DISTANCE_MATCHED;
  const closer = beforeD !== null && afterD !== null && afterD < beforeD - 0.005;
  const status = ok ? "matched" : nukeRisk ? "recovered_needed" : closer ? "closer_not_exact" : "still_far";
  return {
    ok,
    nuke_risk: nukeRisk,
    look_distance_before: beforeD,
    look_distance_after: afterD,
    status,
    reasons,
    suggested_recovery_patch: recovery,
    outdoor_bright: outdoorBright,
  };
}

/** `is_outdoor_bright_profile`: a bright outdoor plate that must not get a heavy sunny look. */
export function isOutdoorBrightProfile(profile: unknown): boolean {
  if (!isRecord(profile) || !profile.present) return false;
  const luma = finite(profile.avg_luma) ?? 0.0;
  const hi = finite(profile.clipped_highlights) ?? 0.0;
  return luma >= 0.55 || hi >= 0.05;
}

const PRESET_GOALS: Readonly<Record<string, Json>> = {
  sunny: {
    present: true, samples: 0, avg_luma: 0.58, warm_cool: 0.08, green_magenta: 0.0, sat_proxy: 0.22, contrast_span: 0.45,
    clipped_shadows: 0.01, clipped_highlights: 0.03, channel_means: { red: 0.55, green: 0.52, blue: 0.47, luma: 0.58 },
  },
  gloomy: {
    present: true, samples: 0, avg_luma: 0.38, warm_cool: -0.06, green_magenta: 0.0, sat_proxy: 0.1, contrast_span: 0.4,
    clipped_shadows: 0.04, clipped_highlights: 0.01, channel_means: { red: 0.34, green: 0.36, blue: 0.4, luma: 0.38 },
  },
  warm_up: {
    present: true, samples: 0, avg_luma: 0.5, warm_cool: 0.1, green_magenta: 0.02, sat_proxy: 0.2, contrast_span: 0.42,
    clipped_shadows: 0.02, clipped_highlights: 0.02, channel_means: { red: 0.52, green: 0.48, blue: 0.42, luma: 0.5 },
  },
  boost_color: {
    present: true, samples: 0, avg_luma: 0.5, warm_cool: 0.02, green_magenta: 0.0, sat_proxy: 0.32, contrast_span: 0.48,
    clipped_shadows: 0.02, clipped_highlights: 0.03, channel_means: { red: 0.52, green: 0.48, blue: 0.46, luma: 0.5 },
  },
};

/** `target_profile_for_look`: synthetic LookProfile goals for named vibes / soft presets. */
export function targetProfileForLook(lookId: string): Json | null {
  const lid = String(lookId ?? "").trim().toLowerCase();
  if (["horror", "teal_horror", "noir", "noir_era"].includes(lid)) {
    return {
      present: true, samples: 0, avg_luma: 0.32, warm_cool: -0.08, green_magenta: 0.04, sat_proxy: 0.14, contrast_span: 0.52,
      clipped_shadows: 0.08, clipped_highlights: 0.02, channel_means: { red: 0.26, green: 0.34, blue: 0.38, luma: 0.32 },
    };
  }
  if (["teal_orange", "teal_&_orange_cinema", "signature_teal_&_orange"].includes(lid)) {
    return {
      present: true, samples: 0, avg_luma: 0.48, warm_cool: 0.04, green_magenta: -0.02, sat_proxy: 0.28, contrast_span: 0.5,
      clipped_shadows: 0.03, clipped_highlights: 0.03, channel_means: { red: 0.5, green: 0.44, blue: 0.46, luma: 0.48 },
    };
  }
  return PRESET_GOALS[lid] ? structuredClone(PRESET_GOALS[lid]) : null;
}

// ---------------------------------------------------------------------------
// Looks catalog
// ---------------------------------------------------------------------------

const LOOK_PRESET_META: Readonly<Record<string, { label: string; description: string; vibe_tags: string[] }>> = {
  reset: { label: "Reset Color", description: "Remove ColorGrade from the clip", vibe_tags: ["neutral", "reset"] },
  auto_contrast: { label: "Auto Contrast", description: "Mild S-curve contrast with lifted shadows", vibe_tags: ["contrast", "punchy", "documentary"] },
  lift_shadows: { label: "Lift Shadows", description: "Open shadows, soft contrast", vibe_tags: ["soft", "interview", "low_contrast"] },
  warm_up: { label: "Warm Up", description: "Warmer temperature and slight vibrance", vibe_tags: ["warm", "tungsten", "cozy", "golden", "sunny"] },
  sunny: {
    label: "Sunny",
    description: "Bright daylight: warm, lifted exposure, healthy color",
    vibe_tags: ["sunny", "sun", "bright", "daylight", "golden", "summer", "outdoors"],
  },
  gloomy: {
    label: "Gloomy",
    description: "Overcast / muted: cooler, slightly darker, less punch",
    vibe_tags: ["gloomy", "overcast", "grey", "gray", "muted", "cloudy", "dreary"],
  },
  boost_color: {
    label: "Boost Color",
    description: "Higher saturation and vibrance with mild S-curve",
    vibe_tags: ["vibrant", "saturated", "pop", "instagram", "candy"],
  },
};

/** Query synonyms so "sunny" finds the sunlit LUTs and the sunny preset. */
const LOOK_QUERY_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  sunny: ["sunny", "sunlit", "sun", "warm", "golden", "daylight", "bright"],
  sun: ["sunny", "sunlit", "warm", "golden"],
  bright: ["sunny", "bright", "sunlit", "boost"],
  gloomy: ["gloomy", "overcast", "muted", "grey", "gray", "cloudy", "dark"],
  grey: ["gloomy", "muted", "grey", "gray"],
  gray: ["gloomy", "muted", "grey", "gray"],
  candy: ["candy", "boost", "vibrant", "pop", "saturated"],
  horror: ["horror", "teal_horror", "noir", "dark", "moody", "cold"],
  noir: ["noir", "noir_era", "dark", "moody", "black"],
  vhs: ["vhs", "vintage", "super8", "retro", "analog", "film_stock"],
  teal: ["teal", "teal_orange", "teal_horror", "cinematic"],
  orange: ["teal_orange", "sunset", "warm", "orange"],
  overcast: ["gloomy", "overcast", "muted", "cloudy"],
  vintage: ["vintage", "film_stock", "analog", "retro", "vhs", "super8"],
};

const CATEGORY_VIBE_TAGS: Readonly<Record<string, readonly string[]>> = {
  "cinematic_&_blockbuster": ["cinematic", "blockbuster", "film"],
  "dark_&_moody": ["dark", "moody", "night", "noir", "horror"],
  "film_stock_&_vintage": ["vintage", "film_stock", "analog", "retro", "vhs"],
  "teal_&_orange_vibes": ["teal_orange", "cinematic", "hollywood", "teal", "orange"],
  "utility_&_correction": ["utility", "correction", "neutral"],
  "vibrant_&_colorful": ["vibrant", "colorful", "pop", "candy"],
};

const GRAIN_META: Readonly<Record<string, { label: string; vibe_tags: string[] }>> = {
  none: { label: "No Film Grain", vibe_tags: ["clean"] },
  "35mm_fine": { label: "35mm Fine", vibe_tags: ["film", "subtle", "35mm"] },
  "35mm_classic": { label: "35mm Classic", vibe_tags: ["film", "35mm", "cinematic"] },
  "35mm_gritty": { label: "35mm Gritty", vibe_tags: ["film", "gritty", "35mm"] },
  "16mm_classic": { label: "16mm Classic", vibe_tags: ["film", "16mm", "documentary"] },
  super_8: { label: "Super 8", vibe_tags: ["vintage", "super8", "home_movie"] },
  high_iso: { label: "High ISO", vibe_tags: ["grainy", "night", "high_iso"] },
};

function lookMatches(entry: Json, query: string): boolean {
  if (!query) return true;
  const hay = [entry.id, entry.label, entry.description, entry.category, entry.lut_path, ((entry.vibe_tags as string[]) ?? []).join(" ")]
    .map((v) => String(v ?? ""))
    .join(" ")
    .toLowerCase();
  const tokens = query.replaceAll(",", " ").split(/\s+/).filter(Boolean);
  return tokens.every((token) => hay.includes(token) || (LOOK_QUERY_SYNONYMS[token] ?? []).some((syn) => hay.includes(syn)));
}

const KIND_RANK: Readonly<Record<string, number>> = { color_preset: 0, lut: 1, generated: 1, film_grain: 2 };

/** Python string order (by code point), for sorting ids. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `list_looks_catalog`: the Look / LUT / Film Grain catalog, optionally filtered. */
export function listLooksCatalog(query = ""): Json {
  const q = String(query ?? "").trim().toLowerCase();
  const looks: Json[] = [];
  for (const [lookId, meta] of Object.entries(LOOK_PRESET_META)) {
    const entry: Json = { id: lookId, kind: "color_preset", label: meta.label, description: meta.description, vibe_tags: [...meta.vibe_tags] };
    if (lookMatches(entry, q)) looks.push(entry);
  }
  for (const [category, lookIds] of BUILTIN_LUTS) {
    const catTags = [...(CATEGORY_VIBE_TAGS[category] ?? [])];
    for (const lookId of lookIds) {
      const entry: Json = {
        id: lookId,
        kind: "lut",
        label: lookId.replaceAll("_", " "),
        description: `LUT pack ${category}`,
        category,
        lut_path: lutRelativePath(category, lookId),
        vibe_tags: [...catTags, lookId.replaceAll("_", " "), category.replaceAll("_", " ")],
      };
      if (lookMatches(entry, q)) looks.push(entry);
    }
  }
  for (const look of STYLIZED_LOOKS) {
    const entry: Json = { id: look.id, kind: "generated", label: look.label, description: look.description, vibe_tags: [...look.vibe_tags] };
    if (lookMatches(entry, q)) looks.push(entry);
  }
  for (const [grainId, meta] of Object.entries(GRAIN_META)) {
    const entry: Json = {
      id: `grain:${grainId}`,
      kind: "film_grain",
      grain_id: grainId,
      label: meta.label,
      description: "Film Grain look",
      vibe_tags: [...meta.vibe_tags],
    };
    if (lookMatches(entry, q)) looks.push(entry);
  }
  // Colour presets first for vibe words, then LUTs, then grain.
  looks.sort((a, b) => (KIND_RANK[String(a.kind)] ?? 9) - (KIND_RANK[String(b.kind)] ?? 9) || cmp(String(a.id ?? ""), String(b.id ?? "")));
  return { ok: true, count: looks.length, looks, query: query || "" };
}

/** What a lookId names. */
export type ResolvedLook =
  | { kind: "film_grain"; grain_id: string; id: string }
  | { kind: "color_preset"; preset_name: string; id: string }
  | { kind: "lut"; lut_path: string; id: string; category?: string }
  /** A stylised look whose LUT is generated (looks/stylized.ts). */
  | { kind: "generated"; id: string; look: StylizedLook };

/** `resolve_look_id`: a lookId or lutPath → what apply_look_tool does with it. */
export function resolveLookId(lookId: string): ResolvedLook {
  const raw = String(lookId ?? "").trim();
  if (!raw) throw new ColorValueError("lookId is required");
  const lowered = raw.toLowerCase();
  if (lowered.startsWith("grain:")) {
    const grainId = raw.split(":").slice(1).join(":").trim();
    if (!(FILM_GRAIN_LOOK_IDS as readonly string[]).includes(grainId)) throw new ColorValueError(`Unknown film grain look '${grainId}'`);
    return { kind: "film_grain", grain_id: grainId, id: `grain:${grainId}` };
  }
  if ((LOOK_PRESET_IDS as readonly string[]).includes(lowered)) return { kind: "color_preset", preset_name: lowered, id: lowered };
  const stylized = stylizedLook(raw);
  if (stylized) return { kind: "generated", id: stylized.id, look: stylized };
  if (lowered.endsWith(".cube") || raw.includes("/") || raw.includes("\\") || raw.startsWith("@colors")) return { kind: "lut", lut_path: raw, id: raw };
  const matches: [string, string][] = [];
  for (const [category, ids] of BUILTIN_LUTS) {
    for (const lid of ids) if (lid === raw || lid.toLowerCase() === lowered) matches.push([category, lid]);
  }
  if (matches.length === 1) {
    const [category, lid] = matches[0]!;
    return { kind: "lut", id: lid, lut_path: lutRelativePath(category, lid), category };
  }
  if (matches.length > 1) {
    throw new ColorValueError(`Ambiguous LUT id '${raw}'; use one of: ${matches.map(([c, i]) => lutRelativePath(c, i)).join(", ")}`);
  }
  if ((FILM_GRAIN_LOOK_IDS as readonly string[]).includes(lowered)) return { kind: "film_grain", grain_id: lowered, id: `grain:${lowered}` };
  throw new ColorValueError(`Unknown lookId '${raw}'. Call list_looks_tool to see preset, LUT, and grain ids.`);
}

/** `hints_to_color_patch`: reference_gap_hints → one apply_color merge patch. */
export function hintsToColorPatch(hints: readonly Json[]): Json {
  const patch: Record<string, number> = {};
  for (const hint of hints ?? []) {
    if (!isRecord(hint)) continue;
    for (const [key, value] of Object.entries(hint)) {
      if (key === "reason" || value === null || value === undefined) continue;
      if (SCALAR_KEYS.includes(key) || key in SCALAR_ALIASES) {
        const canon = SCALAR_ALIASES[key] ?? key;
        const v = finite(value);
        if (v !== null) patch[canon] = v + (patch[canon] ?? 0.0);
      }
    }
  }
  return patch;
}

/** `apply_soft_color_preset`: a soft ColorGrade Look preset (color_presets.py, the single source of truth). */
export function applySoftColorPreset(effect: Json, presetName: string): Json {
  const name = String(presetName ?? "").trim().toLowerCase();
  if (name === "reset") throw new ColorValueError("reset removes ColorGrade; do not call apply_soft_color_preset");
  if (!(LOOK_PRESET_IDS as readonly string[]).includes(name) || !isColorGradePreset(name)) throw new ColorValueError(`Unknown color preset: ${presetName}`);
  const payload = applyColorGradePreset(effect, name);
  if (!payload.class_name) payload.class_name = COLOR_GRADE_CLASS_NAME;
  return payload;
}
