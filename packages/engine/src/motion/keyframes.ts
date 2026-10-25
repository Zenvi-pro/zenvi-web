/**
 * From designed elements to timeline layers: poses become libopenshot clip
 * keyframes (see render/plan/transform.ts for how a clip is placed).
 *
 * SVG drawings play with scale mode None and gravity top-left: a drawing is
 * shown at its own pixel size, its top-left corner at (location_x × width,
 * location_y × height), scaled from that corner, rotated about `origin`.
 * libopenshot rasterizes a None clip at its size × the largest scale_x/y
 * keyframe *point* and then multiplies by the scale again, so a drawing is
 * drawn at its largest pose (`k` = that scale) and its keyframes run up to
 * exactly 1. Media in cards plays with scale mode Best Fit, centred: its
 * scale and location keyframes size and place the fitted picture, and
 * `corner_radius` rounds it (clip property in libopenshot 1.0).
 *
 * Every pose property is an affine function of the pose, so one easing per
 * segment (the same bezier handles on every property) keeps a drawing and the
 * media under it moving as one, frame for frame.
 */

import { makeKeyframePoint } from "../keyframe/edit.js";
import { defaultEffectJson } from "../effects/registry.js";
import { Gravity, Interpolation, ScaleMode, type Effect, type Keyframe, type KeyframePoint } from "../model/types.js";
import { KEYFRAME_BEZIER_PRESETS } from "../ops/keyframes.js";
import type { Ease, Element, Key, MediaSource, MotionFrame, MotionLayer, MotionPlan, Pose, SvgSource } from "./types.js";

/** Each easing is one of the desktop keyframe menu's bezier presets (CSS cubic-bezier x1, y1, x2, y2). */
const PRESET_OF: Readonly<Record<Exclude<Ease, "linear" | "hold">, string>> = {
  smooth: "Ease In/Out (Sine)",
  out: "Ease Out (Cubic)",
  out_strong: "Ease Out (Expo)",
  out_back: "Ease Out (Back)",
  in: "Ease In (Cubic)",
  in_out: "Ease In/Out (Cubic)",
};

export function easeHandles(ease: Ease): readonly [number, number, number, number] | null {
  if (ease === "linear" || ease === "hold") return null;
  const preset = KEYFRAME_BEZIER_PRESETS.find((p) => p.name === PRESET_OF[ease]);
  if (!preset) throw new Error(`no bezier preset ${PRESET_OF[ease]}`);
  return preset.handles;
}

const DEFAULTS: Readonly<Record<string, number>> = {
  scale_x: 1,
  scale_y: 1,
  location_x: 0,
  location_y: 0,
  alpha: 1,
  rotation: 0,
  origin_x: 0.5,
  origin_y: 0.5,
};

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/**
 * A keyframe through `values` at clip `frames`: one point when the value never
 * changes. A segment's easing is its end point's interpolation and handles;
 * a flat segment is written as a bezier so its end point can carry the next
 * segment's handle (libopenshot only keeps handles on bezier points).
 */
export function keyframeThrough(frames: readonly number[], values: readonly number[], eases: readonly Ease[]): Keyframe {
  const v = values.map(round6);
  if (v.every((x) => x === v[0])) return { Points: [makeKeyframePoint(frames[0]!, v[0]!)] };
  const points: KeyframePoint[] = v.map((value, i) => {
    const flat = i > 0 && value === v[i - 1];
    const ease = i === 0 || flat ? "smooth" : eases[i]!;
    const interpolation = ease === "linear" ? Interpolation.LINEAR : ease === "hold" ? Interpolation.CONSTANT : Interpolation.BEZIER;
    const point = makeKeyframePoint(frames[i]!, value, interpolation);
    if (interpolation !== Interpolation.BEZIER) return point;
    const incoming = i > 0 ? easeHandles(ease) : null;
    if (incoming) point.handle_left = { X: incoming[2], Y: incoming[3] };
    const nextFlat = i + 1 < v.length && v[i + 1] === value;
    const outgoing = i + 1 < v.length && !nextFlat ? easeHandles(eases[i + 1]!) : null;
    if (outgoing) point.handle_right = { X: outgoing[0], Y: outgoing[1] };
    return point;
  });
  return { Points: points };
}

/** Clip keyframes from per-key values; constant defaults are left out (the clip default applies). */
function keyframeProps(frames: readonly number[], eases: readonly Ease[], values: Readonly<Record<string, readonly number[]>>): Record<string, Keyframe> {
  const out: Record<string, Keyframe> = {};
  for (const [prop, series] of Object.entries(values)) {
    const constant = series.every((x) => round6(x) === round6(series[0]!));
    if (constant && DEFAULTS[prop] !== undefined && round6(series[0]!) === DEFAULTS[prop]) continue;
    out[prop] = keyframeThrough(frames, series, eases);
  }
  return out;
}

function checkKeys(el: Element): Key[] {
  if (!(el.to > el.from)) throw new Error(`element ${el.name}: empty time range ${el.from}-${el.to}`);
  if (el.keys.length === 0) throw new Error(`element ${el.name}: no keys`);
  const keys = [...el.keys].sort((a, b) => a.frame - b.frame);
  for (let i = 0; i < keys.length; i += 1) {
    if (!Number.isInteger(keys[i]!.frame)) throw new Error(`element ${el.name}: key frame ${keys[i]!.frame} is not a whole frame`);
    if (i > 0 && keys[i]!.frame === keys[i - 1]!.frame) throw new Error(`element ${el.name}: two keys at frame ${keys[i]!.frame}`);
  }
  return keys;
}

/** The size Best Fit gives a `w` × `h` picture in the frame (libopenshot keeps the aspect). */
export function fittedSize(w: number, h: number, frame: MotionFrame): { width: number; height: number } {
  const aspect = w / h;
  return aspect > frame.width / frame.height ? { width: frame.width, height: frame.width / aspect } : { width: frame.height * aspect, height: frame.height };
}

/** Display aspect of a media source after its crop window. */
export function croppedAspect(source: MediaSource): number {
  const c = source.crop;
  const w = source.media.width * (c ? 1 - c.left - c.right : 1);
  const h = source.media.height * (c ? 1 - c.top - c.bottom : 1);
  return w / h;
}

/** Rest height of a fit media source shown `source.width` px wide. */
export function mediaHeight(source: Pick<MediaSource, "media" | "crop" | "width">): number {
  return source.width / croppedAspect(source as MediaSource);
}

/** Smallest scale written: a zero scale would make the clip's transform singular. */
const MIN_SCALE = 0.001;

const sxOf = (p: Pose): number => Math.max(MIN_SCALE, p.sx ?? 1);
const sOf = (p: Pose): number => Math.max(MIN_SCALE, p.s);

function svgLayer(el: Element, source: SvgSource, keys: Key[], frame: MotionFrame): MotionLayer {
  const top = Math.max(...keys.map((k) => sOf(k.pose)));
  const topX = Math.max(...keys.map((k) => sOf(k.pose) * sxOf(k.pose)));
  // libopenshot sizes a None clip's raster by the largest scale_x and scale_y points (keeping its aspect).
  if (Math.abs(topX - top) > 1e-9) throw new Error(`element ${el.name}: its widest pose must also be its largest (sx 1 there)`);
  const drawing = source.draw(top);
  const pw = drawing.pixelWidth;
  const ph = drawing.pixelHeight;
  const frames = keys.map((k) => k.frame - el.from + 1);
  const eases = keys.map((k) => k.ease);
  const pose = (f: (p: Pose) => number) => keys.map((k) => f(k.pose));
  const props: Record<string, unknown> = {
    scale: ScaleMode.NONE,
    gravity: Gravity.TOP_LEFT,
    ...keyframeProps(frames, eases, {
      scale_x: pose((p) => (sOf(p) * sxOf(p)) / top),
      scale_y: pose((p) => sOf(p) / top),
      location_x: pose((p) => (p.x - source.cx * sOf(p) * sxOf(p)) / frame.width),
      location_y: pose((p) => (p.y - source.cy * sOf(p)) / frame.height),
      alpha: pose((p) => p.alpha),
      rotation: pose((p) => p.rotation),
    }),
  };
  if (keys.some((k) => k.pose.rotation !== 0)) {
    props.origin_x = { Points: [makeKeyframePoint(1, round6((source.cx * top) / pw))] };
    props.origin_y = { Points: [makeKeyframePoint(1, round6((source.cy * top) / ph))] };
  }
  return {
    name: el.name,
    track: el.track,
    start: el.from,
    frames: el.to - el.from,
    source: { kind: "svg", name: source.name, svg: drawing.svg(), width: pw, height: ph },
    props,
    effects: el.effects ?? [],
    cue: el.cue ?? el.from,
    bleed: el.bleed ?? false,
  };
}

function cropEffect(crop: NonNullable<MediaSource["crop"]>): Omit<Effect, "id"> {
  const { id: _id, ...json } = defaultEffectJson("Crop", "TEMPLATE00");
  const constant = (value: number): Keyframe => ({ Points: [makeKeyframePoint(1, round6(value))] });
  return { ...json, left: constant(crop.left), top: constant(crop.top), right: constant(crop.right), bottom: constant(crop.bottom), resize: true } as Omit<Effect, "id">;
}

function mediaLayer(el: Element, source: MediaSource, keys: Key[], frame: MotionFrame): MotionLayer {
  // libopenshot evaluates a clip's keyframes at its source frame: round(start × fps) + 1 on its first frame
  // (timeline/windows.ts). The in-point goes on the frame grid so that offset is exact.
  const inFrames = Math.round(source.start * frame.fps);
  const frames = keys.map((k) => k.frame - el.from + 1 + inFrames);
  const eases = keys.map((k) => k.ease);
  const pose = (f: (p: Pose) => number) => keys.map((k) => f(k.pose));
  let props: Record<string, unknown>;
  if (source.mode === "fill") {
    if (keys.some((k) => Math.abs(k.pose.x - frame.width / 2) > 0.5 || Math.abs(k.pose.y - frame.height / 2) > 0.5 || k.pose.rotation !== 0)) {
      throw new Error(`element ${el.name}: a frame-filling picture can only scale and fade`);
    }
    props = { scale: ScaleMode.CROP, gravity: Gravity.CENTER, ...keyframeProps(frames, eases, { scale_x: pose((p) => sOf(p)), scale_y: pose((p) => sOf(p)), alpha: pose((p) => p.alpha) }) };
  } else {
    const aspect = croppedAspect(source);
    const fit = fittedSize(aspect, 1, frame);
    const rest = source.width / fit.width;
    props = {
      scale: ScaleMode.FIT,
      gravity: Gravity.CENTER,
      ...keyframeProps(frames, eases, {
        scale_x: pose((p) => rest * sOf(p) * sxOf(p)),
        scale_y: pose((p) => rest * sOf(p)),
        location_x: pose((p) => (p.x - frame.width / 2) / frame.width),
        location_y: pose((p) => (p.y - frame.height / 2) / frame.height),
        alpha: pose((p) => p.alpha),
        rotation: pose((p) => p.rotation),
      }),
    };
    if (source.radius > 0) {
      // corner_radius is a share of the drawn picture's short side (Clip.cpp:1416).
      const fraction = Math.min(0.5, source.radius / (rest * Math.min(fit.width, fit.height)));
      props.corner_radius = { Points: [makeKeyframePoint(1, round6(fraction))] };
    }
  }
  const seconds = (el.to - el.from) / frame.fps;
  const effects = [...(source.crop ? [cropEffect(source.crop)] : []), ...(el.effects ?? [])];
  return {
    name: el.name,
    track: el.track,
    start: el.from,
    frames: el.to - el.from,
    source: {
      kind: "media",
      fileId: source.media.fileId,
      start: round6(inFrames / frame.fps),
      end: round6(source.media.kind === "image" ? inFrames / frame.fps + seconds : inFrames / frame.fps + seconds * source.speed),
      speed: source.speed,
      sound: source.sound ?? false,
    },
    props,
    effects,
    cue: el.cue ?? el.from,
    bleed: el.bleed ?? false,
  };
}

/** One element as a timeline layer. */
export function elementLayer(el: Element, frame: MotionFrame): MotionLayer {
  const keys = checkKeys(el);
  return el.source.kind === "svg" ? svgLayer(el, el.source, keys, frame) : mediaLayer(el, el.source, keys, frame);
}

/** A plan from designed elements: layers in track order, the track count and the cues. */
export function planOf(template: string, frames: number, elements: readonly Element[], cues: readonly number[], frame: MotionFrame): MotionPlan {
  const names = new Set<string>();
  for (const el of elements) {
    if (names.has(el.name)) throw new Error(`${template}: two elements named ${el.name}`);
    names.add(el.name);
    if (el.from < 0 || el.to > frames) throw new Error(`${template}: ${el.name} runs outside the template (${el.from}-${el.to} of ${frames})`);
  }
  // Tracks are compacted (a template may skip optional parts) and clips on one track must not overlap.
  const used = [...new Set(elements.map((e) => e.track))].sort((a, b) => a - b);
  const remap = new Map(used.map((t, i) => [t, i]));
  const layers = elements.map((el) => elementLayer({ ...el, track: remap.get(el.track)! }, frame));
  for (const track of remap.values()) {
    const spans = layers.filter((l) => l.track === track).sort((a, b) => a.start - b.start);
    for (let i = 1; i < spans.length; i += 1) {
      const prev = spans[i - 1]!;
      if (spans[i]!.start < prev.start + prev.frames) throw new Error(`${template}: ${prev.name} and ${spans[i]!.name} overlap on track ${track}`);
    }
  }
  layers.sort((a, b) => a.track - b.track || a.start - b.start);
  const all = [...cues, ...layers.map((l) => l.cue)].filter((f) => f < frames);
  return { template, frames, tracks: used.length, layers, cues: [...new Set(all)].sort((a, b) => a - b) };
}
