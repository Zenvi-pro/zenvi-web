/**
 * Generated matrix: every editable parameter of every effect the renderers
 * draw (the engine's effect registry, libopenshot 1.0 `PropertiesJSON`),
 * through `add_effect_tool`'s `properties`, default against a value well
 * inside the range on the far side of the default. Plus one case per effect
 * ("adding it with its defaults changes the frame") and the EffectBase
 * parameters every effect shares, on Negate.
 *
 * A parameter that needs another one to show (a crop offset needs a crop)
 * gets that context in CONTEXT. One that shows nothing on these fixtures in
 * either renderer is pinned in EFFECT_INERT with the reason; one the matrix
 * cannot exercise at all is in EFFECT_EXEMPT.
 */

import { EFFECTS, type EffectDefinition, type EffectParam } from "@zenvi/engine";
import { fixturePath, type FixtureName } from "../fixtures.js";
import { clipId, fullMode, type Args, type Probe, type TruthCase, type TruthClip } from "../harness.js";

const LUT = "@colors/cinematic_&_blockbuster/teal_&_orange_cinema.cube";
const SHORT_CAPTION = "00:00:00:000 --> 00:00:00:700\nTool truth";
const COMPRESSING = { ratio: 8, threshold: -45 };
const EXPANDING = { ratio: 8, threshold: -20 };
/** A still image in Project Files (case `files`), named by path: mask and displacement maps. */
const DISC_READER = fixturePath("disc.png");
/** The fixture's own green (green.mp4): ChromaKey's default key colour is black. */
const SCREEN = "#1eae24";

/** Extra properties both runs set so the parameter under test has something to act on (`Class.*` for every parameter). */
const CONTEXT: Readonly<Record<string, Args>> = {
  // Its defaults (brightness 0, contrast 3) move the bars by about half a level: on the edge of "changed".
  "Brightness.*": { brightness: 0.3 },
  "Caption.background": { background_alpha: 1 },
  "Caption.background_corner": { background_alpha: 1 },
  "Caption.background_padding": { background_alpha: 1 },
  "Caption.fade_out": { caption_text: SHORT_CAPTION },
  "ChromaKey.*": { color: SCREEN },
  // A tight tolerance: at the default every method keys the whole evenly lit screen alike.
  "ChromaKey.keymethod": { color: SCREEN, fuzz: 5 },
  "ColorGrade.lut_intensity": { lut_path: LUT },
  "ColorGrade.mix": { exposure: 1 },
  "ColorMap.*": { lut_path: LUT },
  "Crop.resize": { left: 0.3 },
  "Crop.x": { left: 0.3, right: 0.3 },
  "Crop.y": { top: 0.3, bottom: 0.3 },
  "Displace.*": { map_reader: DISC_READER },
  "Mask.*": { mask_reader: DISC_READER },
  "SphericalProjection.in_fov": { input_model: "Fisheye: Equidistant" },
  "Timer.clamp": { start_time: -5 },
  "Timer.end_time": { mode: "Count Down" },
  "Timer.mode": { end_time: 30 },
  "Distortion.distortion_type": { input_gain: 24 },
  "Compressor.attack": COMPRESSING,
  "Compressor.release": { ratio: 20, threshold: -55 },
  "Compressor.threshold": { ratio: 8 },
  "Compressor.ratio": { threshold: -45 },
  "Expander.attack": EXPANDING,
  "Expander.release": EXPANDING,
  "Expander.threshold": { ratio: 8 },
  "Expander.ratio": { threshold: -20 },
  "ParametricEQ.frequency": { q_factor: 1 },
  "ParametricEQ.gain": { filter_type: "Peaking Notch", q_factor: 1 },
  "ParametricEQ.q_factor": { filter_type: "Peaking Notch", gain: 12 },
  "ParametricEQ.filter_type": { q_factor: 1, gain: 12 },
};

/** Variant values where "far side of the default" is not a clear change. */
const VALUES: Readonly<Record<string, unknown>> = {
  // The default 1 s delay pushes the whole 1 s fixture out of the mix.
  "Delay.delay_time": 0.25,
  // A long release is what holds the gain down between the noise's peaks.
  "Compressor.release": 1000,
};

/** Source in-points (seconds) for parameters that read the clip's trim. */
const START: Readonly<Record<string, number>> = {
  // Source time and clip time differ only when the clip does not start at the source's first frame.
  "Timer.time_source": 0.3,
};

/** Effects that need something other than the bars to act on. */
const FIXTURE: Readonly<Record<string, FixtureName>> = {
  ChromaKey: "green.mp4",
  Shadow: "disc.png",
  Glow: "disc.png",
  ColorShift: "disc.png",
  AudioVisualization: "beat.mp4",
  BeatSync: "beat.mp4",
};

/** Parameters that need another fixture than their effect's. */
const KEY_FIXTURE: Readonly<Record<string, FixtureName>> = {};

/** Effects drawn around the clip's alpha: over a second shot, so a black shadow shows. */
const OVER_RINGS: ReadonlySet<string> = new Set(["Shadow", "ColorShift"]);

/**
 * Parameters neither renderer shows on these fixtures. Each is pinned as
 * "no change" (full mode: in libopenshot too), so parity holds and the day
 * one starts drawing it the case fails.
 */
export const EFFECT_INERT: ReadonlyMap<string, string> = new Map([
  ["Blur.sigma", "libopenshot's Blur draws box blurs from the radii and iterations only (Blur.cpp GetFrame never reads sigma); the engine's blur.ts ports that"],
  ["DenoiseImage.motion_safety", "guards the temporal pass, which needs earlier frames; a single-frame render has none"],
  ["DenoiseImage.temporal", "blends with earlier frames; a single-frame render has none"],
  ["BeatSync.decay_ms", "the click fixture's envelope is already back to rest at the probed frame in both renderers"],
  ["BeatSync.frequency_high", "the click fixture has no energy above the default band in either renderer"],
  ["BeatSync.intensity", "the probed frame is between beats: both renderers show the resting colour"],
  ["AudioVisualization.frequency_high", "the click fixture's spectrum above the default top is empty in both renderers"],
  ["AudioVisualization.frequency_low", "the click fixture's spectrum below the new bottom is empty in both renderers"],
  ["Timer.time_source", "both renderers count clip time and source time alike for a trimmed clip"],
  ["Mask.fade_audio_hint", "a hint for the desktop's audio fade, not drawn"],
  ["Expander.attack", "steady noise keeps the expander's detector open: attack has nothing to shape in either renderer"],
  ["Negate.apply_before_clip", "Negate commutes with the clip's transform: before or after it, the same pixels"],
  // Choices only full mode tries:
  ["AudioVisualization.channel_layout=Split", "the fixture's two channels are identical, so Split draws the same picture"],
  ["SphericalProjection.interpolation=Bicubic", "Auto picks bicubic at this scale in both renderers"],
  ["Timer.mode=Clock", "at 0.5 s a clock from midnight shows the same digits as the count-up in MM:SS"],
  // Basic keying (the choice CI tries) keys the fixture differently from the default; the others key it
  // exactly like the default Cb,Cr vector in both renderers, even at fuzz 5.
  ...["HSV/HSL hue", "HSV saturation", "HSL saturation", "HSV value", "HSL luminance", "LCH luminosity", "LCH chroma", "LCH hue", "CIE Distance", "Cb,Cr vector"].map(
    (name): [string, string] => [`ChromaKey.keymethod=${name}`, "keys the evenly lit fixture exactly like the default method in both renderers"],
  ),
]);

/** Effect parameters the matrix does not exercise, with why. */
export const EFFECT_EXEMPT: ReadonlyMap<string, string> = new Map([
  ["Displace.map_reader", "the reader itself is the context every Displace case sets (DISC_READER)"],
  ["Caption.caption_text", "text: changing it changes the picture by construction; the caption tools' cases cover it"],
  ["Caption.caption_font", "font family: needs an installed font list; add_title_tool font covers fonts"],
  ["Timer.font_name", "font family: needs an installed font list; add_timer_tool font covers fonts"],
  ["Timer.prefix", "text: add_timer_tool prefix covers it"],
  ["Timer.suffix", "text: add_timer_tool suffix covers it"],
  ["ColorGrade.lut_path", "a file path: color_grade_clip_tool lut covers LUTs"],
  ["ColorMap.lut_path", "the LUT itself is the context every ColorMap case sets"],
  ["ColorGrade.curve_all", "nested curve object: color_grade_clip_tool curves covers it"],
  ["ColorGrade.curve_red", "nested curve object: color_grade_clip_tool curves covers it"],
  ["ColorGrade.curve_green", "nested curve object: apply_color_tool curve_green covers it"],
  ["ColorGrade.curve_blue", "nested curve object: apply_color_tool curve_blue covers it"],
  ["ColorGrade.wheels", "nested wheels object: color_grade_clip_tool wheels covers it"],
  ["BeatSync.response_curve", "nested curve object edited by the desktop's curve widget"],
  ["DenoiseImage.response_curve", "nested curve object edited by the desktop's curve widget"],
  ["FilmGrain.seed", "an int seed: FilmGrain.evolution and the other grain controls cover the pattern"],
  ["AnalogTape.seed_offset", "an int seed: the other tape controls cover the pattern"],
]);

const toHex = (rgb: readonly number[]): string => `#${rgb.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** A clearly different value for `param`, or undefined when the type has no generic one. */
export function changedValue(param: EffectParam): unknown {
  const def = param.default;
  switch (param.type) {
    case "bool":
      return !def;
    case "choice": {
      const other = param.choices?.find((c) => c.value !== def);
      return other?.name;
    }
    case "color": {
      const rgb = Array.isArray(def) ? (def as number[]) : [0, 0, 0];
      return toHex(rgb.map((v) => 255 - v));
    }
    case "keyframe":
    case "float":
    case "int": {
      if (typeof def !== "number" || param.min === undefined || param.max === undefined) return undefined;
      const toMax = param.max - def >= def - param.min;
      const value = def + (toMax ? 1 : -1) * 0.4 * (param.max - param.min);
      const clamped = Math.min(param.max, Math.max(param.min, value));
      return param.type === "int" ? Math.round(clamped) : Number(clamped.toFixed(4));
    }
    default:
      return undefined;
  }
}

/** Every other choice too (full mode): each must render differently from the default. */
function choiceValues(param: EffectParam): unknown[] {
  return (param.choices ?? []).filter((c) => c.value !== param.default).map((c) => c.name);
}

export function rendersEffect(effect: EffectDefinition): boolean {
  return effect.supported.node && !effect.needsDialog;
}

/** Parameters the matrix covers for one effect (editable, effect-specific). */
export function matrixParams(effect: EffectDefinition): EffectParam[] {
  return effect.params.filter((p) => !p.common && !p.readonly);
}

/** Effects whose defaults are the identity, so adding one alone changes nothing. */
export const IDENTITY_DEFAULTS: ReadonlyMap<string, string> = new Map([
  ["Saturation", "saturation 1 on every channel"],
  ["Hue", "hue 0"],
  ["Shift", "x and y 0"],
  ["ColorShift", "every shift 0"],
  ["Crop", "every edge 0"],
  ["ColorGrade", "every control neutral, no LUT"],
  ["ColorMap", "no LUT"],
  ["Displace", "no displacement map"],
  ["Mask", "no mask image"],
]);

function effectClips(effect: EffectDefinition, key?: string): TruthClip[] {
  const name = (key ? KEY_FIXTURE[key] : undefined) ?? FIXTURE[effect.className] ?? (effect.category === "video" ? "bars.mp4" : "noise.wav");
  const start = key ? START[key] : undefined;
  const clip: TruthClip = { fixture: name, id: "A", start, track: OVER_RINGS.has(effect.className) ? 2 : 1 };
  return OVER_RINGS.has(effect.className) ? [{ fixture: "rings.mp4", id: "B", track: 1 }, clip] : [clip];
}

export function effectCases(category: "video" | "audio"): TruthCase[] {
  const cases: TruthCase[] = [];
  const target = (className: string): Args => ({ timeline_clip_id: clipId("A"), effect: className });
  for (const effect of EFFECTS) {
    if (effect.category !== category || !rendersEffect(effect)) continue;
    const probe: Probe = category === "video" ? { kind: "picture", at: 0.5 } : { kind: "sound" };
    const classContext = CONTEXT[`${effect.className}.*`] ?? {};
    cases.push({
      id: `add_effect_tool effect=${effect.className}`,
      tool: "add_effect_tool",
      param: "effect",
      clips: effectClips(effect),
      files: ["disc.png"],
      base: null,
      variant: { ...target(effect.className), properties: classContext },
      probe,
      inert: IDENTITY_DEFAULTS.has(effect.className) && Object.keys(classContext).length === 0 ? `its defaults are the identity: ${IDENTITY_DEFAULTS.get(effect.className)}` : undefined,
    });
    for (const param of matrixParams(effect)) {
      const key = `${effect.className}.${param.key}`;
      if (EFFECT_EXEMPT.has(key)) continue;
      const context = CONTEXT[key] ?? classContext;
      const values = key in VALUES ? [VALUES[key]] : param.type === "choice" && fullMode() ? choiceValues(param) : [changedValue(param)];
      for (const value of values) {
        if (value === undefined) continue;
        cases.push({
          id: `add_effect_tool ${key}${values.length > 1 ? `=${JSON.stringify(value)}` : ""}`,
          tool: "add_effect_tool",
          param: `properties.${key}`,
          clips: effectClips(effect, key),
          files: ["disc.png"],
          base: { ...target(effect.className), properties: { ...context } },
          variant: { ...target(effect.className), properties: { ...context, [param.key]: value } },
          probe,
          inert: EFFECT_INERT.get(`${key}=${String(value)}`) ?? EFFECT_INERT.get(key),
        });
      }
    }
  }
  return cases;
}

/** EffectBase parameters (every effect has them), proven once on Negate. */
export const COMMON_PARAM_CASES: Readonly<Record<string, { value: unknown; context?: Args; inert?: string }>> = {
  mask_reader: { value: DISC_READER },
  mask_invert: { value: true, context: { mask_reader: DISC_READER } },
  apply_before_clip: { value: false, inert: EFFECT_INERT.get("Negate.apply_before_clip") },
};

/** EffectBase parameters the matrix does not exercise, with why. */
export const COMMON_EXEMPT: ReadonlyMap<string, string> = new Map([
  ["layer", "the effect's track mirror: the clip's track decides where it draws"],
  ["start", "add_effect_tool refuses it: effects follow their clip"],
  ["end", "add_effect_tool refuses it: effects follow their clip"],
  ["position", "add_effect_tool refuses it: effects follow their clip"],
  ["order", "stacking order of several effects on one clip: copy_effects_tool and the engine's planner tests cover order"],
  ["parent_effect_id", "an id linking a tracked-object effect to its parent: OpenCV effects only"],
  ["mask_source_id", "an id: the effect that supplies a mask (ObjectMask, OpenCV only)"],
  ["mask_loop_mode", "how a video mask loops: needs a mask clip longer or shorter than the clip (the matrix masks with a still)"],
  ["mask_time_mode", "how a video mask's frames map to time: a still mask has one frame"],
  ["mask_mode", "not proven yet: the mask blend of the effects that have one (Blur, Sharpen …); Negate has none"],
]);

export function commonParamCases(): TruthCase[] {
  return Object.entries(COMMON_PARAM_CASES).map(([key, c]) => ({
    id: `add_effect_tool Negate.${key} (EffectBase)`,
    tool: "add_effect_tool",
    param: `properties.@common.${key}`,
    clips: [{ fixture: "bars.mp4", id: "A" }],
    files: ["disc.png"],
    setup: key === "apply_before_clip" ? [{ tool: "set_clip_properties_tool", args: { timeline_clip_ids: [clipId("A")], properties: { scale_x: 0.5, scale_y: 0.5 } } }] : [],
    base: { timeline_clip_id: clipId("A"), effect: "Negate", properties: { ...c.context } },
    variant: { timeline_clip_id: clipId("A"), effect: "Negate", properties: { ...c.context, [key]: c.value } },
    probe: { kind: "picture", at: 0.5 },
    inert: c.inert,
  }));
}
