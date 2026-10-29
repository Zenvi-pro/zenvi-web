/**
 * Effects-color editor tools, part 2: apply_look_preset_tool,
 * color_grade_clip_tool, list_luts_tool, apply_audio_effect_tool and
 * chroma_key_clip_tool.
 *
 * Port of zenvi-core develop (1f80cb3d0) src/classes/editor_tools/
 * effects_color_looks.py. Look presets follow the Clip > Look menu's rules
 * (ops/look.ts, a port of look_presets.py); grades keep ONE Color Grade per
 * clip; LUTs are the 50 built-ins every renderer bundles (effects/luts.ts),
 * plus `.cube` files on hosts with local files. Chroma key samples the screen
 * colour and measures what it keyed out on frames the host renders; without
 * frame rendering it keys a given or stock colour and leaves keyed_pct null.
 */

import type { Clip, Effect, Project } from "../../model/types.js";
import { listLuts } from "../../effects/luts.js";
import { setClipEffects } from "../../ops/effects.js";
import { moveClip } from "../../ops/clips.js";
import { addTrack } from "../../ops/tracks.js";
import { sameJson } from "../../ops/internal.js";
import {
  applyColorGradePreset,
  colorLookPresetEffects,
  filmGrainLookPresetEffects,
  lookEffectPresetEffects,
  neutralColorGrade,
  resetLookEffects,
  type ColorGradePreset,
  type FilmGrainPreset,
} from "../../ops/look.js";
import { wheelBias } from "../../render/kernels/color-grade.js";
import { editedWhileRendering } from "../color-frames.js";
import { roundTo } from "../color-stats.js";
import { contractTool, type CatalogTool } from "../define.js";
import { pyG, pyReprString } from "../pyfmt.js";
import { effectCatalog } from "./effect-catalog.js";
import {
  constantKeyframe,
  curveValue,
  hex6,
  keyframeValueAt,
  parseColor,
  prepareProperties,
  wheelsValue,
  type ValueContext,
} from "./effect-values.js";
import { keyedShare, sampleScreenColor } from "./effects-color-analysis.js";
import { lutArgument, newEffectFactory } from "./effects-color.js";
import {
  clipEffects,
  compatibilityProblem,
  isLocked,
  resolveOneClip,
  splitCompatible,
  targetClips,
} from "./effects-color-common.js";
import { editorRun, nothingChanged, ok, ToolError, uiTrack } from "./timeline-edit-common.js";

const EDIT = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Look presets (Clip > Look)
// ---------------------------------------------------------------------------

type LookFamily = "color" | "film_grain" | "reset" | "AnalogTape" | "Sharpen" | "Blur" | "Glow" | "Shadow";

const FILM_GRAIN = ["35mm_fine", "35mm_classic", "35mm_gritty", "16mm_classic", "super_8", "high_iso"] as const;

/** effects_color_looks.LOOK_PRESETS: look → (family, preset). */
export const LOOK_PRESETS: Readonly<Record<string, [LookFamily, string | null]>> = {
  ...Object.fromEntries(["auto_contrast", "lift_shadows", "warm_up", "boost_color"].map((p) => [`color_${p}`, ["color", p]])),
  remove_color: ["color", "reset"],
  ...Object.fromEntries(FILM_GRAIN.map((p) => [`film_grain_${p}`, ["film_grain", p]])),
  remove_film_grain: ["film_grain", "none"],
  ...Object.fromEntries(["subtle", "vhs", "heavy"].map((p) => [`analog_tape_${p}`, ["AnalogTape", p]])),
  remove_analog_tape: ["AnalogTape", "none"],
  ...Object.fromEntries(["subtle", "medium", "strong"].map((p) => [`sharpen_${p}`, ["Sharpen", p]])),
  remove_sharpen: ["Sharpen", "none"],
  ...Object.fromEntries(["soft_focus", "medium", "heavy"].map((p) => [`blur_${p}`, ["Blur", p]])),
  remove_blur: ["Blur", "none"],
  ...Object.fromEntries(["soft_white", "warm", "neon", "inner"].map((p) => [`glow_${p}`, ["Glow", p]])),
  remove_glow: ["Glow", "none"],
  ...Object.fromEntries(["subtle", "soft", "strong", "long"].map((p) => [`shadow_${p}`, ["Shadow", p]])),
  remove_shadow: ["Shadow", "none"],
  reset_look: ["reset", null],
};

const FAMILY_CLASS: Readonly<Record<string, string>> = { color: "ColorGrade", film_grain: "FilmGrain", reset: "ColorGrade" };

/** effects_color_looks.look_effects: the clip's effects after a Look preset (null = unchanged). */
function lookEffects(effects: readonly Effect[], family: LookFamily, preset: string | null, create: (cn: string) => Effect): Effect[] | null {
  if (family === "color") return colorLookPresetEffects(effects, preset as "reset" | ColorGradePreset, create);
  if (family === "film_grain") return filmGrainLookPresetEffects(effects, preset as FilmGrainPreset, create);
  if (family === "reset") return resetLookEffects(effects);
  return lookEffectPresetEffects(effects, family, preset!, create);
}

// ---------------------------------------------------------------------------
// Color grade
// ---------------------------------------------------------------------------

const GRADE_PARAMS = ["exposure", "contrast", "highlights", "shadows", "saturation", "vibrance", "temperature", "tint", "mix"] as const;

interface NamedLook {
  base: ColorGradePreset | null;
  lut?: string;
  lut_intensity?: number;
  params?: Readonly<Record<string, number>>;
  about: string;
}

/** Named grades: a Color preset (or neutral), then a built-in LUT, then parameter changes. */
export const NAMED_LOOKS: Readonly<Record<string, NamedLook>> = {
  neutral: { base: null, about: "every control neutral, no LUT (undo a grade)" },
  natural: { base: "auto_contrast", about: "gentle contrast S-curve, a little vibrance" },
  auto_contrast: { base: "auto_contrast", about: "Look > Color > Auto Contrast" },
  lift_shadows: { base: "lift_shadows", about: "Look > Color > Lift Shadows (open up dark footage)" },
  warm_up: { base: "warm_up", about: "Look > Color > Warm Up" },
  boost_color: { base: "boost_color", about: "Look > Color > Boost Color" },
  cinematic: {
    base: "auto_contrast",
    lut: "cinematic_&_blockbuster/teal_&_orange_cinema",
    lut_intensity: 0.5,
    params: { saturation: 0.95, highlights: -0.1, shadows: 0.0 },
    about: "blockbuster teal/orange LUT at 50%, contrast curve, slightly muted",
  },
  teal_orange: {
    base: "auto_contrast",
    lut: "teal_&_orange_vibes/signature_teal_&_orange",
    lut_intensity: 0.8,
    params: { vibrance: 0.1 },
    about: "strong teal shadows / orange skin tones",
  },
  warm: { base: "warm_up", params: { temperature: 0.25 }, about: "warmer white balance" },
  golden_hour: {
    base: "warm_up",
    lut: "teal_&_orange_vibes/sunset_orange",
    lut_intensity: 0.6,
    params: { temperature: 0.15 },
    about: "sunset orange glow",
  },
  cool: { base: null, params: { temperature: -0.22, tint: -0.03 }, about: "cooler, bluer" },
  vintage: {
    base: "lift_shadows",
    lut: "film_stock_&_vintage/faded_memories",
    lut_intensity: 0.7,
    params: { saturation: 0.85, contrast: -0.05 },
    about: "faded film, lifted blacks",
  },
  black_and_white: { base: null, params: { saturation: 0.0, vibrance: 0.0, contrast: 0.15 }, about: "monochrome with a little contrast" },
  film_noir: {
    base: null,
    params: { saturation: 0.0, contrast: 0.35, shadows: -0.12, highlights: 0.05 },
    about: "hard-contrast black and white",
  },
  moody: {
    base: null,
    lut: "dark_&_moody/cold_shadows",
    lut_intensity: 0.6,
    params: { exposure: -0.15, contrast: 0.2, saturation: 0.8, shadows: -0.15 },
    about: "darker, desaturated, cold shadows",
  },
  vibrant: { base: "boost_color", lut: "vibrant_&_colorful/color_pop", lut_intensity: 0.5, about: "punchy saturated color" },
  bright_airy: {
    base: "lift_shadows",
    params: { exposure: 0.2, contrast: -0.08, saturation: 0.92, highlights: -0.1 },
    about: "light, soft, lifted",
  },
};

/** `_grade_values`: a grade's controls and its LUT (`category/name`) as a receipt row. */
/** Below this channel shift (0..1, at full tonal weight) a wheel's tint is not visible (sk2-product-brand: amounts of 0.05-0.1 on greyish colours). */
const FAINT_WHEEL = 0.02;

/** The largest channel shift one wheel of a `wheels` property applies, 0..1 (the kernel's own bias). */
function wheelShift(wheels: unknown, name: string): number {
  const entry = isRecord(wheels) ? wheels[name] : undefined;
  if (!isRecord(entry)) return 0;
  const bias = wheelBias({ color: entry.color, amount: entry.amount, luma: entry.luma } as Parameters<typeof wheelBias>[0]);
  return Math.max(...bias.map(Math.abs));
}

function gradeValues(effect: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of GRADE_PARAMS) out[p] = roundTo(keyframeValueAt(effect[p], 1, 0.0), 4);
  const lutPath = String(effect.lut_path || "");
  out.lut = lutPath ? lutPath.replaceAll("\\", "/").split("/").slice(-2).join("/").slice(0, -5) : "";
  out.lut_intensity = roundTo(keyframeValueAt(effect.lut_intensity, 1, 1.0), 4);
  return out;
}

// ---------------------------------------------------------------------------
// Audio effect presets
// ---------------------------------------------------------------------------

/** effects_color_looks.AUDIO_PRESETS: preset → (effect, settings, what it does). */
export const AUDIO_PRESETS: Readonly<Record<string, [string, Readonly<Record<string, number>>, string]>> = {
  voice_compressor: ["Compressor", { threshold: -18.0, ratio: 3.0, attack: 5.0, release: 120.0, makeup_gain: 3.0 }, "even out a voice (gentle 3:1)"],
  strong_compressor: ["Compressor", { threshold: -28.0, ratio: 8.0, attack: 2.0, release: 80.0, makeup_gain: 6.0 }, "podcast/broadcast squash"],
  noise_gate: ["Expander", { threshold: -45.0, ratio: 4.0, attack: 1.0, release: 100.0, makeup_gain: 0.0 }, "quiet the room noise between phrases"],
  echo: ["Echo", { echo_time: 0.25, feedback: 0.35, mix: 0.35 }, "clear echo"],
  slapback: ["Echo", { echo_time: 0.09, feedback: 0.15, mix: 0.3 }, "short room slap"],
  canyon_echo: ["Echo", { echo_time: 0.6, feedback: 0.55, mix: 0.45 }, "long repeating echo"],
  low_cut: ["ParametricEQ", { filter_type: 1, frequency: 90, q_factor: 0.707, gain: 0 }, "remove rumble / wind below 90 Hz"],
  high_cut: ["ParametricEQ", { filter_type: 0, frequency: 8000, q_factor: 0.707, gain: 0 }, "tame hiss above 8 kHz"],
  bass_boost: ["ParametricEQ", { filter_type: 2, frequency: 120, q_factor: 0.707, gain: 6 }, "+6 dB low shelf at 120 Hz"],
  treble_boost: ["ParametricEQ", { filter_type: 3, frequency: 6000, q_factor: 0.707, gain: 5 }, "+5 dB high shelf at 6 kHz"],
  voice_presence: ["ParametricEQ", { filter_type: 6, frequency: 3000, q_factor: 1.0, gain: 4 }, "+4 dB at 3 kHz for clarity"],
  telephone: ["ParametricEQ", { filter_type: 4, frequency: 1500, q_factor: 1.2, gain: 0 }, "band-pass phone/radio voice"],
  robot: ["Robotization", { fft_size: 5, hop_size: 1, window_type: 2 }, "robotic voice"],
  whisper: ["Whisperization", { fft_size: 4, hop_size: 2, window_type: 2 }, "whispering voice"],
  distortion: ["Distortion", { distortion_type: 1, input_gain: 12, output_gain: -8, tone: 4 }, "soft-clipped grit"],
  add_noise: ["Noise", { level: 15 }, "white noise bed (15%)"],
  sync_delay: ["Delay", { delay_time: 0.1 }, "delay the sound (fix A/V sync; set delay_time seconds)"],
};

// ---------------------------------------------------------------------------
// Chroma key
// ---------------------------------------------------------------------------

const KEY_METHODS: Readonly<Record<string, number>> = {
  basic_soft: 11, basic: 0, hsv_hue: 1, hsv_saturation: 2, hsl_saturation: 3, hsv_value: 4, hsl_luminance: 5,
  lch_luminosity: 6, lch_chroma: 7, lch_hue: 8, cie_distance: 9, cbcr_vector: 10,
};
const KEY_COLORS: Readonly<Record<string, string>> = { green: "#00b140", blue: "#0047bb" };
/** Below this share of transparent pixels a "removed screen" almost certainly was not removed. */
const MIN_KEYED_PCT = 10.0;

function span(clip: Clip): [number, number] {
  const start = Number(clip.position) || 0;
  return [start, start + Math.max(0, (Number(clip.end) || 0) - (Number(clip.start) || 0))];
}

/** `_free_on_layer`: nothing but `excludeId` overlaps [start, end) on the layer. */
function freeOnLayer(project: Project, layer: number, start: number, end: number, excludeId: string): boolean {
  return !project.clips.some((c) => {
    if (c.id === excludeId || Number(c.layer) !== layer) return false;
    const [s, e] = span(c);
    return s < end - 1e-6 && e > start + 1e-6;
  });
}

/** `_placement`: [layer, position, new track number | null] putting the keyed clip above the background, overlapping it. */
function placement(project: Project, keyed: Clip, background: Clip, align: string): [number, number, number | null] {
  const kDur = Math.max(0, (Number(keyed.end) || 0) - (Number(keyed.start) || 0));
  let kPos = Number(keyed.position) || 0;
  const [bPos, bEnd] = span(background);
  const overlaps = kPos < bEnd && kPos + kDur > bPos;
  if (align === "start" || (align === "auto" && !overlaps)) kPos = bPos;
  const bLayer = Number(background.layer) || 0;
  const kLayer = Number(keyed.layer) || 0;
  if (kLayer > bLayer && freeOnLayer(project, kLayer, kPos, kPos + kDur, keyed.id)) return [kLayer, kPos, null];
  const numbers = project.layers.map((l) => Math.trunc(Number(l.number) || 0));
  for (const n of numbers.filter((n) => n > bLayer).sort((a, b) => a - b)) {
    if (!isLocked(project, n) && freeOnLayer(project, n, kPos, kPos + kDur, keyed.id)) return [n, kPos, null];
  }
  const top = Math.max(...numbers, bLayer);
  return [top + 1_000_000, kPos, top + 1_000_000];
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const effectsColorLookTools: CatalogTool[] = [
  contractTool("apply_look_preset_tool", {
    annotations: EDIT,
    run: (call, input) =>
      editorRun(async () => {
        const look = input.look;
        const entry = LOOK_PRESETS[look];
        if (!entry) throw new ToolError(`unknown look ${pyReprString(look)}; choose one of ${Object.keys(LOOK_PRESETS).sort().join(", ")}`);
        const [family, preset] = entry;
        const checkClass = FAMILY_CLASS[family] ?? family;
        const { clips: targets, explicit } = await targetClips(call, input);
        const { ok: clips, skipped } = splitCompatible(call.doc.project, targets, explicit, checkClass);
        const create = newEffectFactory(call);
        const changes: [string, Effect[]][] = [];
        const rows: Record<string, unknown>[] = [];
        for (const clip of clips) {
          const before = clipEffects(clip);
          const after = lookEffects(before, family, preset, create);
          if (after === null || sameJson(before, after)) {
            rows.push({ timeline_clip_id: clip.id, changed: false });
            continue;
          }
          changes.push([clip.id, after]);
          rows.push({ timeline_clip_id: clip.id, changed: true, effects: after.filter(isRecord).map((e) => e.class_name ?? null) });
        }
        const removing = look.startsWith("remove_") || look === "reset_look";
        if (changes.length === 0) {
          const state = removing ? "has no such look to remove" : "already has this look";
          return nothingChanged(call, `Every target clip ${state}; nothing changed.`, { look, clips: rows, skipped });
        }
        call.commit((tx) => {
          for (const [cid, effects] of changes) setClipEffects(tx, cid, effects);
        });
        return ok(call, `${removing ? "Removed" : "Applied"} look ${look} on ${changes.length} clip(s).`, { look, changed: true, clips: rows, skipped });
      }),
  }),

  contractTool("color_grade_clip_tool", {
    annotations: EDIT,
    run: (call, input) =>
      editorRun(async () => {
        const project = call.doc.project;
        const explicitParams: Record<string, number> = {};
        for (const key of GRADE_PARAMS) {
          const value = input[key];
          if (value !== null && value !== undefined) explicitParams[key] = value;
        }
        const look = input.look ?? "";
        if (look && !NAMED_LOOKS[look]) throw new ToolError(`unknown look ${pyReprString(look)}; choose one of ${Object.keys(NAMED_LOOKS).sort().join(", ")}`);
        const lut = input.lut ?? "";
        const lutIntensity = input.lut_intensity ?? null;
        const wheels = input.wheels;
        const curves = input.curves;
        const hasWheels = isRecord(wheels) && Object.keys(wheels).length > 0;
        const hasCurves = isRecord(curves) && Object.keys(curves).length > 0;
        if (!(look || Object.keys(explicitParams).length > 0 || lut || lutIntensity !== null || hasWheels || hasCurves || input.reset)) {
          throw new ToolError("say what to change: a look, a LUT, or one of exposure/contrast/.../curves");
        }
        const { clips: targets, explicit } = await targetClips(call, input);
        const { ok: clips, skipped } = splitCompatible(project, targets, explicit, "ColorGrade");
        const spec: Partial<NamedLook> = NAMED_LOOKS[look] ?? {};
        const lookLut = spec.lut ? await lutArgument(call, spec.lut) : "";
        const lutPath = lut ? await lutArgument(call, lut) : null;
        if (curves !== undefined && curves !== null && !isRecord(curves)) throw new ToolError('curves is {"all": [[0,0],[1,1]], "red": [...]}');
        for (const key of Object.keys(curves ?? {})) {
          if (!["all", "red", "green", "blue"].includes(key)) throw new ToolError(`unknown curve ${pyReprString(key)}; use all, red, green or blue`);
        }
        const ctx: ValueContext = { project };
        const create = newEffectFactory(call);
        const changes: [string, Effect[]][] = [];
        const rows: Record<string, unknown>[] = [];
        const faintWheels = new Set<string>();
        for (const clip of clips) {
          const effects = clipEffects(clip).map((e) => structuredClone(e));
          const idxs = effects.flatMap((e, i) => (e.class_name === "ColorGrade" ? [i] : []));
          const existing = idxs.length > 0 ? (effects[idxs[0]!] as Record<string, unknown>) : null;
          let payload: Record<string, unknown>;
          let values: Record<string, unknown>;
          if (look || input.reset || existing === null) {
            const fresh = create("ColorGrade") as Record<string, unknown>;
            payload = spec.base ? applyColorGradePreset(fresh, spec.base) : neutralColorGrade(fresh);
            if (existing !== null) {
              payload.id = "id" in existing ? existing.id : payload.id;
              if ("order" in existing) payload.order = existing.order;
              if (existing.ui) payload.ui = existing.ui;
            }
            if (lookLut) {
              payload.lut_path = lookLut;
              payload.lut_intensity = constantKeyframe(spec.lut_intensity ?? 1.0);
            }
            values = { ...(spec.params ?? {}) };
          } else {
            payload = structuredClone(existing);
            values = {};
          }
          Object.assign(values, explicitParams);
          if (lutIntensity !== null) values.lut_intensity = lutIntensity;
          Object.assign(payload, prepareProperties(ctx, "ColorGrade", values, payload, clip));
          if (lutPath !== null) payload.lut_path = lutPath;
          if (hasWheels) {
            payload.wheels = wheelsValue(wheels, payload.wheels);
            for (const name of Object.keys(wheels)) {
              if (name !== "enabled" && wheelShift(payload.wheels, name) < FAINT_WHEEL) faintWheels.add(name);
            }
          }
          for (const [key, pts] of Object.entries(curves ?? {})) payload[`curve_${key}`] = curveValue(`curves.${key}`, pts);
          if (existing !== null && sameJson(payload, existing)) {
            rows.push({ timeline_clip_id: clip.id, effect_id: existing.id ?? null, changed: false, grade: gradeValues(payload) });
            continue;
          }
          if (idxs.length > 0) {
            effects[idxs[0]!] = payload as Effect;
            for (const i of idxs.slice(1).reverse()) effects.splice(i, 1);
          } else {
            effects.push(payload as Effect);
          }
          changes.push([clip.id, effects]);
          rows.push({ timeline_clip_id: clip.id, effect_id: payload.id ?? null, changed: true, grade: gradeValues(payload) });
        }
        if (changes.length === 0) return nothingChanged(call, "The grade already has these values; nothing changed.", { clips: rows, skipped });
        call.commit((tx) => {
          for (const [cid, effects] of changes) setClipEffects(tx, cid, effects);
        });
        const wheelNames = hasWheels ? Object.keys(wheels).filter((n) => n !== "enabled") : [];
        const changed = [...Object.keys(explicitParams).sort(), ...(lut ? ["lut"] : []), ...(wheelNames.length > 0 ? [`wheels (${wheelNames.join(", ")})`] : []), ...(hasCurves ? ["curves"] : [])];
        const what = look ? `look ${look}` : changed.join(", ") || "grade";
        const receipt = ok(call, `Graded ${changes.length} clip(s): ${what}.`, { look, changed: true, clips: rows, skipped });
        if (faintWheels.size > 0) {
          const names = [...faintWheels].join(", ");
          receipt.warnings.push(
            `The ${names} wheel${faintWheels.size === 1 ? " moves" : "s move"} colour by under ${Math.round(FAINT_WHEEL * 255)}/255: too faint to see. ` +
              "A wheel tints by how far its colour is from grey times amount: pick a saturated colour (#2a6cff, #ffb36b) or raise amount (0.2-0.5).",
          );
        }
        return receipt;
      }),
  }),

  contractTool("list_luts_tool", {
    annotations: READ,
    run: (call, input) =>
      editorRun(() => {
        const query = input.query ?? "";
        const words = query.toLowerCase().replaceAll("&", " ").split(/\s+/).filter(Boolean);
        const rows = listLuts()
          .filter((lut) => {
            const hay = `${lut.id} ${lut.name} ${lut.category}`.toLowerCase().replaceAll("_", " ");
            return words.length === 0 || words.every((w) => hay.includes(w));
          })
          .map((lut) => ({ id: lut.id, name: lut.name, category: lut.category || "User-Defined", builtin: lut.builtin }));
        if (rows.length === 0) throw new ToolError(query ? `no LUT matches ${pyReprString(query)}` : "no LUT files were found");
        return ok(call, `${rows.length} LUT(s)${query ? ` matching ${pyReprString(query)}` : ""}`, { luts: rows });
      }),
  }),

  contractTool("apply_audio_effect_tool", {
    annotations: EDIT,
    run: (call, input) =>
      editorRun(async () => {
        const preset = input.preset;
        const entry = AUDIO_PRESETS[preset];
        if (!entry) throw new ToolError(`unknown preset ${pyReprString(preset)}; choose one of ${Object.keys(AUDIO_PRESETS).sort().join(", ")}`);
        const [className, settings] = entry;
        if (!effectCatalog().has(className)) throw new ToolError(`this libopenshot build has no ${className} effect`);
        const merged: Record<string, unknown> = { ...settings };
        if (input.properties && Object.keys(input.properties).length > 0) {
          if (!isRecord(input.properties)) throw new ToolError('properties is an object like {"ratio": 4}');
          Object.assign(merged, input.properties);
        }
        const project = call.doc.project;
        const { clips: targets, explicit } = await targetClips(call, input);
        const { ok: clips, skipped } = splitCompatible(project, targets, explicit, className);
        const ctx: ValueContext = { project };
        const create = newEffectFactory(call);
        const changes: [string, Effect[]][] = [];
        const rows: Record<string, unknown>[] = [];
        for (const clip of clips) {
          const effects = clipEffects(clip).map((e) => structuredClone(e));
          const idxs = effects.flatMap((e, i) => (e.class_name === className ? [i] : []));
          const target = (idxs.length > 0 ? effects[idxs[0]!] : create(className)) as Record<string, unknown>;
          const props = prepareProperties(ctx, className, merged, target, clip);
          const changed = Object.entries(props).filter(([k, v]) => !sameJson(target[k], v));
          if (idxs.length > 0 && changed.length === 0) {
            rows.push({ timeline_clip_id: clip.id, effect_id: target.id ?? null, action: "unchanged" });
            continue;
          }
          Object.assign(target, props);
          if (idxs.length === 0) effects.push(target as Effect);
          changes.push([clip.id, effects]);
          rows.push({ timeline_clip_id: clip.id, effect_id: target.id ?? null, action: idxs.length > 0 ? "updated" : "added" });
        }
        if (changes.length === 0) {
          return nothingChanged(call, `${preset} is already applied with these settings; nothing changed.`, { clips: rows, skipped });
        }
        call.commit((tx) => {
          for (const [cid, effects] of changes) setClipEffects(tx, cid, effects);
        });
        return ok(call, `Applied ${preset} (${className}) to ${changes.length} clip(s).`, {
          effect: className,
          preset,
          settings: merged,
          changed: true,
          clips: rows,
          skipped,
        });
      }),
  }),

  contractTool("chroma_key_clip_tool", {
    annotations: EDIT,
    run: (call, input) =>
      editorRun(async () => {
        const project = call.doc.project;
        const clip = await resolveOneClip(call, input);
        const problem = compatibilityProblem(project, clip, "ChromaKey");
        if (problem) throw new ToolError(problem);
        let background: Clip | null = null;
        if (input.background_clip_id || input.background_query) {
          background = await resolveOneClip(call, { timeline_clip_id: input.background_clip_id ?? "", clip_query: input.background_query ?? "", track: "" });
          if (background.id === clip.id) throw new ToolError("the background must be a different clip than the keyed one");
        }
        const method = input.method ?? "basic_soft";
        if (!(method in KEY_METHODS)) throw new ToolError(`method must be one of ${Object.keys(KEY_METHODS).sort().join(", ")}`);
        const halo = input.halo ?? 10.0;
        let fuzz: number | null = input.fuzz ?? null;
        const sampleTime = input.sample_time ?? null;
        const canRender = Boolean(call.host.frames);
        let colorSource = "given";
        let hexColor: string;
        const key = String(input.key_color || "auto").trim().toLowerCase();
        if (key === "auto") {
          if (!canRender) {
            throw new ToolError(
              "key_color='auto' samples the screen from a rendered frame, which this host cannot render; pass key_color ('green', 'blue' or #RRGGBB)",
            );
          }
          const [color, detail, suggested] = await sampleScreenColor(call, clip, sampleTime);
          hexColor = color;
          colorSource = `sampled (${detail})`;
          if (fuzz === null) fuzz = suggested;
        } else if (key in KEY_COLORS) {
          // "green" means this footage's green: the stock shade misses a lighter or darker backdrop.
          try {
            if (!canRender) throw new Error("this host does not render frames");
            const [color, detail, suggested] = await sampleScreenColor(call, clip, sampleTime, key as "green" | "blue");
            hexColor = color;
            colorSource = `sampled (${detail})`;
            if (fuzz === null) fuzz = suggested;
          } catch (error) {
            hexColor = KEY_COLORS[key]!;
            colorSource = `stock ${key}; the screen could not be sampled (${error instanceof Error ? error.message : String(error)})`;
          }
        } else {
          const [r, g, b] = parseColor(input.key_color);
          hexColor = hex6(r, g, b);
        }
        if (fuzz === null) fuzz = 20.0;
        const effects = clipEffects(clip).map((e) => structuredClone(e));
        const idxs = effects.flatMap((e, i) => (e.class_name === "ChromaKey" ? [i] : []));
        const target = (idxs.length > 0 ? effects[idxs[0]!] : newEffectFactory(call)("ChromaKey")) as Record<string, unknown>;
        const props = prepareProperties({ project }, "ChromaKey", { color: hexColor, keymethod: KEY_METHODS[method], fuzz, halo }, target, clip);
        Object.assign(target, props);
        if (idxs.length === 0) effects.push(target as Effect);

        // How much the key removes, measured on the clip alone, so a key that missed the screen (a few
        // percent) reads differently from one that worked.
        let keyedPct: number | null = null;
        if (canRender) {
          try {
            keyedPct = await keyedShare(call, { ...clip, effects }, sampleTime);
          } catch (error) {
            call.host.log?.(`chroma key: could not measure the keyed share: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        // Frames take a while: write nothing over an edit that landed meanwhile, and place against the timeline as it is now.
        const stale =
          editedWhileRendering(call, clip, ["effects", "layer", "position", "start", "end"]) ??
          (background ? editedWhileRendering(call, background, ["layer", "position", "start", "end"]) : null);
        if (stale) throw new ToolError(stale);
        let place: { layer: number; position: number; newTrack: boolean } | null = null;
        if (background) {
          const [layer, position, newTrack] = placement(call.doc.project, clip, background, input.align ?? "auto");
          place = { layer, position: roundTo(position, 4), newTrack: newTrack !== null };
        }
        call.commit((tx) => {
          if (place?.newTrack) {
            const track = addTrack(tx);
            if (track.number !== place.layer) throw new Error(`chroma key: new track ${track.number}, expected ${place.layer}`);
          }
          setClipEffects(tx, clip.id, effects);
          if (place) {
            const move: { layer?: number; position?: number } = {};
            if ((Number(clip.layer) || 0) !== place.layer) move.layer = place.layer;
            if (Math.abs((Number(clip.position) || 0) - place.position) > 1e-6) move.position = place.position;
            if (Object.keys(move).length > 0) moveClip(tx, clip.id, move);
          }
        });
        let summary = `Keyed out ${hexColor} (${colorSource}, ${method}, fuzz ${pyG(fuzz)}, halo ${pyG(halo)}) on clip ${clip.id}.`;
        const receipt: Record<string, unknown> = {
          timeline_clip_id: clip.id,
          effect_id: target.id ?? null,
          key_color: hexColor,
          key_color_source: colorSource,
          method,
          fuzz,
          halo,
          keyed_pct: keyedPct,
        };
        if (keyedPct !== null) {
          summary += ` ${pyG(keyedPct)}% of the frame is now transparent.`;
          if (keyedPct < MIN_KEYED_PCT) {
            summary +=
              " That is too little for a green/blue screen: the key colour probably misses this screen. Call again with key_color='auto' or a #RRGGBB sampled from the screen, or raise fuzz.";
          }
        }
        if (place && background) {
          const trackNo = uiTrack(call.doc.project, place.layer);
          summary += ` It now sits on track ${String(trackNo)} above background ${background.id}${place.newTrack ? " (new track)" : ""}, starting at ${pyG(place.position)}s.`;
          Object.assign(receipt, { background_clip_id: background.id, track: trackNo, layer: place.layer, position: place.position, new_track: place.newTrack });
        }
        return ok(call, summary, receipt);
      }),
  }),
];
