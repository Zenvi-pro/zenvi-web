/**
 * Clip presets from the desktop clip context menu: Fade, Rotate, Layout,
 * Volume, Speed (Time), Motion (Animate: in/out, emphasis, camera, credits)
 * and Layout ▸ Show All.
 *
 * Ported from zenvi-core src/windows/views/timeline.py (Fade_Triggered,
 * Rotate_Triggered, Layout_Triggered, show_all_clips, Volume_Triggered,
 * Time_Triggered, Animate_Triggered), src/windows/views/retime.py,
 * src/windows/views/repeat.py (`reset_repeat`), src/animation_presets.py and
 * src/classes/camera_motion.py. Menu enums:
 * src/windows/views/timeline_backend/enums.py. Points built through
 * `openshot.Point` on the desktop are narrowed to float here too.
 */

import type { Transaction } from "../history/document.js";
import type { Clip, Effect, Keyframe, KeyframePoint } from "../model/types.js";
import { Gravity, Interpolation, ScaleMode } from "../model/types.js";
import { DEFAULT_IMAGE_LENGTH } from "../model/defaults.js";
import { isSingleImageMedia } from "../model/media.js";
import { pyRound } from "../model/rounding.js";
import { evaluate, getLong } from "../keyframe/evaluate.js";
import { openshotPoint, removeKeyframePointsInRange, setKeyframePoint } from "../keyframe/edit.js";
import { createEffect } from "../effects/registry.js";
import { invalid, requireFinite } from "./errors.js";
import { fadeTargets, replaceClip } from "./clips.js";
import { fpsOf, ids, isRecord, rateOf, requireEditableClip, withClampedTiming } from "./internal.js";
import { retimeClip } from "./retime.js";
import { maskReader } from "./transition-masks.js";
import { ANIMATION_PRESET_DATA, KEYFRAME_EASING } from "./animation-presets.data.js";
import { cameraPanKeyframes, kenBurnsKeyframes, pushPullKeyframes, sourceDimensions, type CameraKeyframes, type PanDirection } from "./camera-motion.js";

/** Desktop MenuFade. */
export const FADE_PRESETS = ["none", "in_fast", "in_slow", "out_fast", "out_slow", "in_out_fast", "in_out_slow"] as const;
export type FadePreset = (typeof FADE_PRESETS)[number];

/** Desktop MenuRotate. */
export const ROTATE_PRESETS = ["none", "right_90", "left_90", "flip_180"] as const;
export type RotatePreset = (typeof ROTATE_PRESETS)[number];

/**
 * Desktop MenuLayout for one clip. (`ALL_WITH_ASPECT` / `ALL_WITHOUT_ASPECT`
 * arrange several clips; see `layoutShowAll`.)
 */
export const LAYOUT_PRESETS = ["none", "center", "top_left", "top_right", "bottom_left", "bottom_right"] as const;
export type LayoutPreset = (typeof LAYOUT_PRESETS)[number];

/** Desktop MenuVolume (`level` uses `ClipPresetOptions.level`). */
export const VOLUME_PRESETS = [
  "none",
  "fade_in_fast",
  "fade_in_slow",
  "fade_out_fast",
  "fade_out_slow",
  "fade_in_out_fast",
  "fade_in_out_slow",
  "level",
] as const;
export type VolumePreset = (typeof VOLUME_PRESETS)[number];

/**
 * Desktop MenuTime. `forward`/`backward` use `ClipPresetOptions.speed`
 * (e.g. 2 or 0.5); `freeze`/`freeze_zoom` use `seconds` and `playhead`.
 */
export const TIME_PRESETS = ["none", "forward", "backward", "reverse", "freeze", "freeze_zoom"] as const;
export type TimePreset = (typeof TIME_PRESETS)[number];

/** Desktop MenuAnimate, lower-cased (`SLIDE_IN_LEFT` → `slide_in_left`). */
export const ANIMATE_PRESETS = [
  "none",
  // In
  "slide_in_left", "slide_in_right", "slide_in_top", "slide_in_bottom",
  "blur_in",
  "wipe_in_circle_expand", "wipe_in_circle_shrink", "wipe_in_fade",
  "wipe_in_left", "wipe_in_right", "wipe_in_top", "wipe_in_bottom",
  "blur_wipe_in_circle_expand", "blur_wipe_in_circle_shrink",
  "blur_wipe_in_left", "blur_wipe_in_right", "blur_wipe_in_top", "blur_wipe_in_bottom",
  "pop_in", "spiral_in",
  "back_in_down", "back_in_left", "back_in_right", "back_in_up",
  "bounce_in", "bounce_in_down", "bounce_in_left", "bounce_in_right", "bounce_in_up",
  // Out
  "slide_out_left", "slide_out_right", "slide_out_top", "slide_out_bottom",
  "blur_out",
  "wipe_out_circle_expand", "wipe_out_circle_shrink", "wipe_out_fade",
  "wipe_out_left", "wipe_out_right", "wipe_out_top", "wipe_out_bottom",
  "blur_wipe_out_circle_expand", "blur_wipe_out_circle_shrink",
  "blur_wipe_out_left", "blur_wipe_out_right", "blur_wipe_out_top", "blur_wipe_out_bottom",
  "pop_out", "spiral_out",
  "back_out_down", "back_out_left", "back_out_right", "back_out_up",
  "bounce_out", "bounce_out_down", "bounce_out_left", "bounce_out_right", "bounce_out_up",
  // Emphasis
  "bounce", "flash", "pulse", "rubber_band", "shake_x", "shake_y", "swing", "tada", "wobble", "jello", "heart_beat",
  // Camera
  "cam_push_in", "cam_pull_out",
  "cam_pan_auto", "cam_pan_left", "cam_pan_right", "cam_pan_up", "cam_pan_down",
  "ken_burns_in", "ken_burns_out",
  "ken_burns_in_left_to_right", "ken_burns_in_right_to_left", "ken_burns_in_top_to_bottom", "ken_burns_in_bottom_to_top",
  "ken_burns_out_left_to_right", "ken_burns_out_right_to_left", "ken_burns_out_top_to_bottom", "ken_burns_out_bottom_to_top",
  // Credits
  "credits_up", "credits_down",
] as const;
export type AnimatePreset = (typeof ANIMATE_PRESETS)[number];

export type ClipPresetId =
  | `fade.${FadePreset}`
  | `rotate.${RotatePreset}`
  | `layout.${LayoutPreset}`
  | `volume.${VolumePreset}`
  | `time.${TimePreset}`
  | `animate.${AnimatePreset}`;

/** Every preset id, for tool schemas and menus. */
export const CLIP_PRESET_IDS: readonly ClipPresetId[] = [
  ...FADE_PRESETS.map((p) => `fade.${p}` as const),
  ...ROTATE_PRESETS.map((p) => `rotate.${p}` as const),
  ...LAYOUT_PRESETS.map((p) => `layout.${p}` as const),
  ...VOLUME_PRESETS.map((p) => `volume.${p}` as const),
  ...TIME_PRESETS.map((p) => `time.${p}` as const),
  ...ANIMATE_PRESETS.map((p) => `animate.${p}` as const),
];

export function isClipPresetId(value: string): value is ClipPresetId {
  return (CLIP_PRESET_IDS as readonly string[]).includes(value);
}

/** Desktop menus' "Entire Clip" / "Start of Clip" / "End of Clip". */
export type PresetRange = "entire" | "start" | "end";

export interface ClipPresetOptions {
  /**
   * Which part of the clip a fade / volume fade covers. Defaults follow the
   * desktop menus: fade-in → start, fade-out → end, in-and-out → entire.
   */
  range?: PresetRange;
  /** `volume.level`: linear gain 0..1.3 (the desktop menu offers 0–130 %). */
  level?: number;
  /** `time.forward` / `time.backward`: speed factor 1/16..16 (2 = 2x faster). */
  speed?: number;
  /** `time.freeze*`: freeze length, seconds (desktop menu 2–30). */
  seconds?: number;
  /**
   * Timeline seconds of the playhead: the frame `time.freeze*` holds and
   * where emphasis animations start (desktop: the preview's current frame).
   * Default the clip start.
   */
  playhead?: number;
}

const point = (frame: number, value: number, interpolation: Interpolation = Interpolation.BEZIER): KeyframePoint =>
  openshotPoint(Math.trunc(frame), value, interpolation);
const single = (value: number): Keyframe => ({ Points: [openshotPoint(1, value, Interpolation.BEZIER)] });

/** Shared frame math of the clip menus. */
function spans(clip: Clip, rate: number) {
  const s = pyRound(Number(clip.start) * rate) + 1;
  const e = pyRound(Number(clip.end) * rate) + 1;
  return { s, e };
}

// ---------------------------------------------------------------------------
// Fade / Volume
// ---------------------------------------------------------------------------

type FadeAction = "none" | "in_fast" | "in_slow" | "out_fast" | "out_slow";

/** Fade_Triggered / Volume_Triggered for one keyframe and one action. */
function fadeKeyframe(kf: Keyframe | undefined, action: FadeAction, range: PresetRange, s: number, e: number, rate: number): Keyframe {
  if (action === "none") return single(1.0);
  const length = action.endsWith("_fast") ? 1.0 : 3.0;
  let startAnimation = s;
  let endAnimation = e;
  if (range === "start") endAnimation = Math.min(s + length * rate, e);
  else if (range === "end") startAnimation = Math.max(1.0, e - length * rate);
  if (action.startsWith("in")) {
    const zoneEnd = Math.min(s + 3.0 * rate, e);
    const target = evaluate(kf, Math.trunc(pyRound(zoneEnd)), 1.0);
    const cleared = removeKeyframePointsInRange(kf, s, zoneEnd);
    return setKeyframePoint(setKeyframePoint(cleared, openshotPoint(startAnimation, 0.0)), openshotPoint(endAnimation, target));
  }
  const zoneStart = Math.max(1.0, e - 3.0 * rate);
  const source = evaluate(kf, Math.trunc(pyRound(zoneStart)), 1.0);
  const cleared = removeKeyframePointsInRange(kf, zoneStart, e);
  return setKeyframePoint(setKeyframePoint(cleared, openshotPoint(startAnimation, source)), openshotPoint(endAnimation, 0.0));
}

/** Expand a fade preset into the desktop's (action, range) steps (in-and-out runs in then out). */
function fadeSteps(preset: string, range: PresetRange | undefined): [FadeAction, PresetRange][] {
  if (preset === "none") return [["none", range ?? "entire"]];
  if (preset === "in_out_fast" || preset === "in_out_slow") {
    const speed = preset.endsWith("fast") ? "fast" : "slow";
    if ((range ?? "entire") === "entire") return [[`in_${speed}`, "start"], [`out_${speed}`, "end"]];
    return [];
  }
  const action = preset as FadeAction;
  return [[action, range ?? (action.startsWith("in") ? "start" : "end")]];
}

function applyFade(clip: Clip, preset: FadePreset, opts: ClipPresetOptions, rate: number, volumeOnly: boolean): Partial<Clip> {
  const { s, e } = spans(clip, rate);
  const steps = fadeSteps(preset, opts.range);
  const targets = volumeOnly ? { alpha: false, volume: true } : fadeTargets(clip);
  let alpha = clip.alpha;
  let volume = clip.volume;
  for (const [action, range] of steps) {
    if (targets.alpha) alpha = fadeKeyframe(alpha, action, range, s, e, rate);
    if (targets.volume) volume = fadeKeyframe(volume, action, range, s, e, rate);
  }
  const patch: Partial<Clip> = {};
  if (targets.alpha) patch.alpha = alpha;
  if (targets.volume) patch.volume = volume;
  return patch;
}

// ---------------------------------------------------------------------------
// Rotate / Layout
// ---------------------------------------------------------------------------

const ROTATIONS: Record<RotatePreset, number> = { none: 0, right_90: 90, left_90: -90, flip_180: 180 };

const LAYOUT_GRAVITY: Record<Exclude<LayoutPreset, "none">, Gravity> = {
  center: Gravity.CENTER,
  top_left: Gravity.TOP_LEFT,
  top_right: Gravity.TOP_RIGHT,
  bottom_left: Gravity.BOTTOM_LEFT,
  bottom_right: Gravity.BOTTOM_RIGHT,
};

function applyLayout(preset: LayoutPreset): Partial<Clip> {
  if (preset === "none") {
    return {
      scale: ScaleMode.FIT,
      gravity: Gravity.CENTER,
      scale_x: single(1.0),
      scale_y: single(1.0),
      location_x: single(0.0),
      location_y: single(0.0),
    };
  }
  return {
    scale: ScaleMode.FIT,
    gravity: LAYOUT_GRAVITY[preset],
    scale_x: single(0.5),
    scale_y: single(0.5),
    location_x: single(0.0),
    location_y: single(0.0),
  };
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** repeat.py `reset_repeat`: restore what a Repeat preset cached on the clip. */
function resetRepeat(clip: Clip): Clip {
  const cache = clip.repeat_cache;
  if (!isRecord(cache)) return clip;
  const next: Record<string, unknown> = { ...clip };
  delete next.repeat_cache;
  next.start = cache.start ?? clip.start;
  next.end = cache.end ?? clip.end;
  next.duration = cache.duration ?? clip.duration;
  const props = isRecord(cache.properties) ? cache.properties : {};
  for (const [key, value] of Object.entries(props)) next[key] = value;
  if (!("time" in props)) next.time = { Points: [{ co: { X: 1, Y: 1 }, interpolation: Interpolation.LINEAR }] };
  return next as Clip;
}

function applyTime(tx: Transaction, clip: Clip, preset: TimePreset, opts: ClipPresetOptions): Clip {
  const project = tx.project;
  const fps = fpsOf(project);
  const rate = rateOf(project);
  if (preset === "freeze" || preset === "freeze_zoom") return freeze(clip, preset === "freeze_zoom", opts, rate);
  if (preset === "none") {
    const base = resetRepeat(clip);
    const reader: Record<string, unknown> = isRecord(base.reader) ? base.reader : {};
    let duration = Number(reader.duration ?? 0) || 0;
    if (duration <= 0) duration = Number(base.duration ?? 0) || 0;
    if (isSingleImageMedia(reader)) duration = DEFAULT_IMAGE_LENGTH;
    if (duration <= 0) duration = 1 / rate;
    const frames = Math.max(1, Math.trunc(pyRound(duration * rate)));
    const retimed = retimeClip(base, Number(base.start) + frames / rate, fps, 1, base.position) ?? base;
    return { ...retimed, time: { Points: [{ co: { X: 1, Y: 1 }, interpolation: Interpolation.LINEAR }] } };
  }
  if (preset === "reverse") {
    let end = Number(clip.end);
    if (end <= Number(clip.start)) end = Number(clip.start) + (Number(clip.duration) > 0 ? Number(clip.duration) : 1 / rate);
    const retimed = retimeClip(clip, end, fps, -1, clip.position);
    if (!retimed) throw invalid("The clip is too short to reverse.");
    return retimed;
  }
  const speed = requireFinite(opts.speed, "speed");
  if (!(speed >= 1 / 16 && speed <= 16)) throw invalid(`speed must be between 1/16 and 16 (got ${speed}).`);
  const newEnd = Number(clip.start) + (Number(clip.end) - Number(clip.start)) / speed;
  const retimed = retimeClip(clip, newEnd, fps, preset === "backward" ? -1 : 1, clip.position);
  if (!retimed) throw invalid("That speed leaves the clip empty.");
  return retimed;
}

/** Time_Triggered FREEZE / FREEZE_ZOOM. */
function freeze(clip: Clip, zoom: boolean, opts: ClipPresetOptions, rate: number): Clip {
  const seconds = requireFinite(opts.seconds, "seconds");
  if (!(seconds > 0)) throw invalid("seconds must be > 0.");
  const playhead = opts.playhead === undefined ? Number(clip.position) : requireFinite(opts.playhead, "playhead");
  const originalEnd = Number(clip.end);
  const next: Clip = structuredClone(clip);
  next.end = originalEnd + seconds;
  next.duration = Number(clip.duration ?? originalEnd - Number(clip.start)) + seconds;
  const startSeconds = Number(clip.start) + (playhead - Number(clip.position));
  const startFrames = pyRound(startSeconds * rate) + 1;
  let startValue = startFrames;
  const endFrames = pyRound((startSeconds + seconds) * rate) + 1;
  const endOfClipFrames = pyRound(next.end * rate) + 1;
  const endOfClipValue = pyRound(originalEnd * rate) + 1;
  let startVolume = 1.0;
  if ((clip.time?.Points?.length ?? 0) > 1) {
    next.time = { ...next.time, Points: next.time.Points.slice(0, -1) };
    startValue = getLong(clip.time, startFrames);
  }
  if ((clip.volume?.Points?.length ?? 0) > 1) startVolume = evaluate(clip.volume, startFrames, 1.0);
  next.time = setKeyframePoint(next.time, point(startFrames, startValue, Interpolation.LINEAR));
  next.time = setKeyframePoint(next.time, point(endFrames, startValue, Interpolation.LINEAR));
  next.time = setKeyframePoint(next.time, point(endOfClipFrames, endOfClipValue, Interpolation.LINEAR));
  let volume = next.volume;
  volume = setKeyframePoint(volume, point(startFrames - 1, startVolume, Interpolation.LINEAR));
  volume = setKeyframePoint(volume, point(startFrames, 0.0, Interpolation.LINEAR));
  volume = setKeyframePoint(volume, point(endFrames - 1, 0.0, Interpolation.LINEAR));
  volume = setKeyframePoint(volume, point(endFrames, startVolume, Interpolation.LINEAR));
  next.volume = volume;
  if (zoom) {
    const half = (endFrames - startFrames) / 2.0;
    for (const prop of ["scale_x", "scale_y"] as const) {
      let kf = next[prop];
      kf = setKeyframePoint(kf, openshotPoint(startFrames, 1.0, Interpolation.BEZIER));
      kf = setKeyframePoint(kf, openshotPoint(startFrames + half, 1.05, Interpolation.BEZIER));
      kf = setKeyframePoint(kf, openshotPoint(endFrames, 1.0, Interpolation.BEZIER));
      next[prop] = kf;
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// Animate
// ---------------------------------------------------------------------------

/** animation_presets.py names for the JSON-driven presets (timeline.py `_JSON_ANIM`). */
const JSON_ANIM: Partial<Record<AnimatePreset, string>> = {
  back_in_down: "backInDown", back_in_left: "backInLeft", back_in_right: "backInRight", back_in_up: "backInUp",
  bounce_in: "bounceIn", bounce_in_down: "bounceInDown", bounce_in_left: "bounceInLeft", bounce_in_right: "bounceInRight", bounce_in_up: "bounceInUp",
  back_out_down: "backOutDown", back_out_left: "backOutLeft", back_out_right: "backOutRight", back_out_up: "backOutUp",
  bounce_out: "bounceOut", bounce_out_down: "bounceOutDown", bounce_out_left: "bounceOutLeft", bounce_out_right: "bounceOutRight", bounce_out_up: "bounceOutUp",
  bounce: "bounce", flash: "flash", pulse: "pulse", rubber_band: "rubberBand", shake_x: "shakeX", shake_y: "shakeY",
  swing: "swing", tada: "tada", wobble: "wobble", jello: "jello", heart_beat: "heartBeat",
};

const EMPHASIS = new Set<AnimatePreset>(["bounce", "flash", "pulse", "rubber_band", "shake_x", "shake_y", "swing", "tada", "wobble", "jello", "heart_beat"]);
const IN_JSON = new Set<AnimatePreset>(["back_in_down", "back_in_left", "back_in_right", "back_in_up", "bounce_in", "bounce_in_down", "bounce_in_left", "bounce_in_right", "bounce_in_up"]);

/** Wipe presets → common mask file (timeline.py `_WIPE_SVG`). */
const WIPE_SVG: Partial<Record<string, string>> = {
  circle_expand: "circle_in_to_out.svg",
  circle_shrink: "circle_out_to_in.svg",
  fade: "fade.svg",
  left: "wipe_left_to_right.svg",
  right: "wipe_right_to_left.svg",
  top: "wipe_top_to_bottom.svg",
  bottom: "wipe_bottom_to_top.svg",
};

const PROP_IDENTITY: Record<string, number> = {
  scale_x: 1, scale_y: 1, location_x: 0, location_y: 0, alpha: 1, rotation: 0, shear_x: 0, shear_y: 0,
};

const MULTIPLICATIVE = new Set(["scale_x", "scale_y", "alpha"]);

function applyAnimate(tx: Transaction, original: Clip, preset: AnimatePreset, opts: ClipPresetOptions): Clip {
  const project = tx.project;
  const rate = rateOf(project);
  const { s, e } = spans(original, rate);
  const zone = Math.max(1, pyRound(rate));
  const inEnd = Math.min(s + zone, e);
  const outStart = Math.max(s, e - zone);
  let emphStart = s;
  if (opts.playhead !== undefined) {
    const playhead = requireFinite(opts.playhead, "playhead");
    const clipPlayhead = pyRound((Number(original.start) + Math.max(0, playhead) - Number(original.position)) * rate) + 1;
    if (s <= clipPlayhead && clipPlayhead <= e) emphStart = clipPlayhead;
  }
  const emphEnd = Math.min(emphStart + zone, e);
  const nextId = ids(project);

  const clip = structuredClone(original) as Clip & Record<string, unknown>;
  const base = (prop: string, frame: number): number => {
    const kf = original[prop] as Keyframe | undefined;
    return kf ? evaluate(kf, Math.trunc(pyRound(frame))) : (PROP_IDENTITY[prop] ?? 0);
  };
  const kfOf = (prop: string): Keyframe => (isRecord(clip[prop]) ? (clip[prop] as Keyframe) : { Points: [] });
  const clear = (prop: string, from: number, to: number): void => {
    clip[prop] = removeKeyframePointsInRange(kfOf(prop), from, to);
  };
  const add = (prop: string, ...points: KeyframePoint[]): void => {
    let kf = kfOf(prop);
    for (const p of points) kf = setKeyframePoint(kf, p);
    clip[prop] = kf;
  };

  clip.gravity = Gravity.CENTER;

  if (preset === "none") {
    clip.scale = ScaleMode.FIT;
    for (const [prop, value] of [
      ["scale_x", 1], ["scale_y", 1], ["location_x", 0], ["location_y", 0], ["rotation", 0],
      ["shear_x", 0], ["shear_y", 0], ["alpha", 1], ["origin_x", 0.5], ["origin_y", 0.5],
    ] as const) {
      clip[prop] = { Points: [point(s, value)] };
    }
    clip.effects = (clip.effects ?? []).filter(
      (fx) => !isRecord(fx) || !["Blur", "Mask"].includes(String(fx.class_name)) || fx["ui-menu"] === "look",
    );
    return clip;
  }
  if (!Array.isArray(clip.effects)) clip.effects = [];

  const blurFx = (tStart: number, rStart: number, tEnd: number, rEnd: number): void => {
    const fx = createEffect("Blur", {}, { id: nextId() }) as Effect & Record<string, unknown>;
    const radius = { Points: [point(tStart, rStart, Interpolation.LINEAR), point(tEnd, rEnd, Interpolation.LINEAR)] };
    fx.horizontal_radius = radius;
    fx.vertical_radius = structuredClone(radius);
    clip.effects.push(fx);
  };
  const wipeFx = (file: string, tStart: number, tEnd: number, bStart: number, bEnd: number, contrast = 20.0): void => {
    const fx = createEffect("Mask", {}, { id: nextId() }) as Effect & Record<string, unknown>;
    const reader = maskReader(`@transitions/common/${file}`);
    fx.mask_reader = structuredClone(reader);
    fx.reader = structuredClone(reader);
    fx.brightness = { Points: [point(tStart, bStart, Interpolation.LINEAR), point(tEnd, bEnd, Interpolation.LINEAR)] };
    fx.contrast = { Points: [point(tStart, contrast)] };
    clip.effects.push(fx);
  };
  const jsonPreset = (name: string, tStart: number, tEnd: number, resting: number): void => {
    const data = ANIMATION_PRESET_DATA[name];
    if (!data) return;
    const targetDuration = Math.max(1, tEnd - tStart);
    for (const [prop, points] of Object.entries(data)) {
      if (!(prop in clip)) continue;
      const b = base(prop, resting);
      clear(prop, tStart, tEnd);
      add(prop, point(tStart, b), point(tEnd, b));
      const scaled = points.map(([frame, value, easing]) => ({
        frame: tStart + pyRound(((frame - 1) / 30.0) * targetDuration),
        value: MULTIPLICATIVE.has(prop) ? value * b : value + b,
        easing,
      }));
      scaled.forEach((p, i) => {
        const kp = point(p.frame, p.value);
        const ease = p.easing ? KEYFRAME_EASING[p.easing] : undefined;
        if (ease) kp.handle_right = { X: ease[0], Y: ease[1] };
        const prevEase = i > 0 && scaled[i - 1]!.easing ? KEYFRAME_EASING[scaled[i - 1]!.easing!] : undefined;
        if (prevEase) kp.handle_left = { X: prevEase[2], Y: prevEase[3] };
        add(prop, kp);
      });
    }
  };
  const camera = (values: CameraKeyframes): void => {
    clip.scale = ScaleMode.CROP;
    for (const prop of ["scale_x", "scale_y", "location_x", "location_y"]) clear(prop, s, e);
    add("scale_x", point(s, values.scaleX[0]), point(e, values.scaleX[1]));
    add("scale_y", point(s, values.scaleY[0]), point(e, values.scaleY[1]));
    add("location_x", point(s, values.locationX[0]), point(e, values.locationX[1]));
    add("location_y", point(s, values.locationY[0]), point(e, values.locationY[1]));
  };
  const cameraContext = (): [number, number, number | null, number | null] => {
    const [sw, sh] = sourceDimensions(original.reader);
    return [project.width, project.height, sw, sh];
  };

  const slide = /^slide_(in|out)_(left|right|top|bottom)$/.exec(preset);
  const wipe = /^(blur_)?wipe_(in|out)_(.+)$/.exec(preset);
  if (slide) {
    const [, dir, side] = slide;
    const prop = side === "left" || side === "right" ? "location_x" : "location_y";
    const offset = side === "left" || side === "top" ? -1.0 : 1.0;
    if (dir === "in") {
      const b = base(prop, inEnd);
      clear(prop, s, inEnd);
      add(prop, point(s, b + offset), point(inEnd, b));
    } else {
      const b = base(prop, outStart);
      clear(prop, outStart, e);
      add(prop, point(outStart, b), point(e, b + offset));
    }
  } else if (preset === "blur_in") {
    blurFx(s, 50.0, inEnd, 0.0);
    const ba = base("alpha", inEnd);
    clear("alpha", s, inEnd);
    add("alpha", point(s, 0.0), point(inEnd, ba));
  } else if (preset === "blur_out") {
    blurFx(outStart, 0.0, e, 50.0);
    const ba = base("alpha", outStart);
    clear("alpha", outStart, e);
    add("alpha", point(outStart, ba), point(e, 0.0));
  } else if (wipe) {
    const [, blur, dir, shape] = wipe;
    const file = WIPE_SVG[shape!];
    if (file) {
      if (dir === "in") {
        if (blur) blurFx(s, 50.0, inEnd, 0.0);
        wipeFx(file, s, inEnd, 1.0, -1.0, blur ? 10.0 : 20.0);
      } else {
        if (blur) blurFx(outStart, 0.0, e, 50.0);
        wipeFx(file, outStart, e, -1.0, 1.0, blur ? 10.0 : 20.0);
      }
    }
  } else if (preset === "pop_in") {
    const peak = inEnd - Math.max(1, pyRound(0.2 * (inEnd - s)));
    const [bsx, bsy, ba] = [base("scale_x", inEnd), base("scale_y", inEnd), base("alpha", inEnd)];
    for (const prop of ["scale_x", "scale_y", "alpha"]) clear(prop, s, inEnd);
    add("scale_x", point(s, 0.0), point(peak, 1.1 * bsx), point(inEnd, bsx));
    add("scale_y", point(s, 0.0), point(peak, 1.1 * bsy), point(inEnd, bsy));
    add("alpha", point(s, 0.0), point(inEnd, ba));
  } else if (preset === "pop_out") {
    const peak = outStart + Math.max(1, pyRound(0.2 * (e - outStart)));
    const [bsx, bsy, ba] = [base("scale_x", outStart), base("scale_y", outStart), base("alpha", outStart)];
    for (const prop of ["scale_x", "scale_y", "alpha"]) clear(prop, outStart, e);
    add("scale_x", point(outStart, bsx), point(peak, 1.1 * bsx), point(e, 0.0));
    add("scale_y", point(outStart, bsy), point(peak, 1.1 * bsy), point(e, 0.0));
    add("alpha", point(outStart, ba), point(e, 0.0));
  } else if (preset === "spiral_in") {
    const [br, bsx, bsy, ba] = [base("rotation", inEnd), base("scale_x", inEnd), base("scale_y", inEnd), base("alpha", inEnd)];
    for (const prop of ["rotation", "scale_x", "scale_y", "alpha"]) clear(prop, s, inEnd);
    add("rotation", point(s, -360.0 + br), point(inEnd, br));
    add("scale_x", point(s, 0.0), point(inEnd, bsx));
    add("scale_y", point(s, 0.0), point(inEnd, bsy));
    add("alpha", point(s, 0.0), point(inEnd, ba));
  } else if (preset === "spiral_out") {
    const [br, bsx, bsy, ba] = [base("rotation", outStart), base("scale_x", outStart), base("scale_y", outStart), base("alpha", outStart)];
    for (const prop of ["rotation", "scale_x", "scale_y", "alpha"]) clear(prop, outStart, e);
    add("rotation", point(outStart, br), point(e, 360.0 + br));
    add("scale_x", point(outStart, bsx), point(e, 0.0));
    add("scale_y", point(outStart, bsy), point(e, 0.0));
    add("alpha", point(outStart, ba), point(e, 0.0));
  } else if (JSON_ANIM[preset]) {
    const name = JSON_ANIM[preset]!;
    if (EMPHASIS.has(preset)) jsonPreset(name, emphStart, emphEnd, emphStart);
    else if (IN_JSON.has(preset)) jsonPreset(name, s, inEnd, inEnd);
    else jsonPreset(name, outStart, e, outStart);
  } else if (preset === "cam_push_in" || preset === "cam_pull_out") {
    camera(pushPullKeyframes(preset === "cam_push_in"));
  } else if (preset.startsWith("cam_pan_")) {
    const direction = ({ auto: "auto", left: "pan_left", right: "pan_right", up: "pan_up", down: "pan_down" } as const)[
      preset.slice("cam_pan_".length) as "auto" | "left" | "right" | "up" | "down"
    ] as PanDirection;
    camera(cameraPanKeyframes(direction, ...cameraContext()));
  } else if (preset.startsWith("ken_burns_")) {
    const zoomIn = preset.startsWith("ken_burns_in");
    const suffix = preset.replace(/^ken_burns_(in|out)_?/, "");
    const direction = (suffix || "auto") as PanDirection;
    camera(kenBurnsKeyframes(zoomIn, direction, ...cameraContext()));
  } else if (preset === "credits_up" || preset === "credits_down") {
    clip.scale = ScaleMode.CROP;
    const [from, to] = preset === "credits_up" ? [1.0, -1.0] : [-1.0, 1.0];
    add("location_y", point(s, from, Interpolation.LINEAR), point(e, to, Interpolation.LINEAR));
  }
  return clip;
}

/**
 * Apply one clip context-menu preset (one undo step). Returns the updated
 * clip. Presets that produce no change record nothing. Unknown ids are
 * refused with `invalid_argument`.
 */
export function applyClipPreset(
  tx: Transaction,
  clipId: string,
  presetId: ClipPresetId,
  opts: ClipPresetOptions = {},
): Clip {
  const project = tx.project;
  const clip = requireEditableClip(project, clipId);
  if (typeof presetId !== "string" || !isClipPresetId(presetId)) throw invalid(`Unknown clip preset: ${String(presetId)}.`);
  if (opts.range !== undefined && !["entire", "start", "end"].includes(opts.range)) throw invalid("range must be entire, start or end.");
  const [family, name] = presetId.split(".") as [string, string];
  const rate = rateOf(project);
  let next: Clip;
  switch (family) {
    case "fade":
      next = { ...clip, ...applyFade(clip, name as FadePreset, opts, rate, false) };
      break;
    case "volume":
      if (name === "level") {
        const level = requireFinite(opts.level, "level");
        if (level < 0 || level > 1.3) throw invalid(`level must be between 0 and 1.3 (got ${level}).`);
        next = { ...clip, volume: single(level) };
      } else if (name === "none") {
        next = { ...clip, volume: single(1.0) };
      } else {
        next = { ...clip, ...applyFade(clip, name.replace(/^fade_/, "") as FadePreset, opts, rate, true) };
      }
      break;
    case "rotate":
      next = { ...clip, rotation: single(ROTATIONS[name as RotatePreset]) };
      break;
    case "layout":
      next = { ...clip, ...applyLayout(name as LayoutPreset) };
      break;
    case "time":
      next = withClampedTiming(applyTime(tx, clip, name as TimePreset, opts) as unknown as Record<string, unknown>, project, clip) as unknown as Clip;
      break;
    default:
      next = applyAnimate(tx, clip, name as AnimatePreset, opts);
  }
  return replaceClip(tx, clip, next);
}

/**
 * Arrange several clips in a grid so all are visible at once (desktop Layout
 * ▸ Show All, `show_all_clips` with the selection): rows = floor(√n), columns
 * to fit; `stretch` fills each cell (Distort) instead of keeping the aspect
 * ratio. Returns the clips in grid order.
 */
export function layoutShowAll(tx: Transaction, clipIds: readonly string[], opts: { stretch?: boolean } = {}): Clip[] {
  const project = tx.project;
  if (!Array.isArray(clipIds) || clipIds.length === 0) throw invalid("Give the clips to arrange.");
  const wanted = new Set(clipIds);
  for (const id of wanted) requireEditableClip(project, id);
  // The desktop walks the project's clips in order, keeping the selected ones.
  const clips = project.clips.filter((c) => wanted.has(c.id));
  const count = clips.length;
  const rows = Math.trunc(Math.sqrt(count));
  let columns = count / rows;
  columns = columns > Math.trunc(columns) ? Math.trunc(columns + 1) : Math.trunc(columns);
  const height = 1.0 / rows;
  const width = 1.0 / columns;
  const out: Clip[] = [];
  let index = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      if (index >= count) continue;
      const clip = clips[index]!;
      const [sx, sy] = opts.stretch ? [width, height] : [Math.min(width, height), Math.min(width, height)];
      const next: Clip = {
        ...clip,
        gravity: Gravity.TOP_LEFT,
        scale: opts.stretch ? ScaleMode.STRETCH : ScaleMode.FIT,
        scale_x: single(sx),
        scale_y: single(sy),
        location_x: single(col * width),
        location_y: single(row * height),
      };
      out.push(replaceClip(tx, clip, next));
      index += 1;
    }
  }
  return out;
}
