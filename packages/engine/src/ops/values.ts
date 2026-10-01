/**
 * Writing user values into keyframes and color keyframes, shared by the clip,
 * effect and transition ops (desktop properties_model.py `value_updated` and
 * `color_update` semantics).
 */

import type { ColorKeyframe, Keyframe } from "../model/types.js";
import { Interpolation } from "../model/types.js";
import { constantKeyframe, openshotPoint, setKeyframeValue } from "../keyframe/edit.js";
import { parseHexColor } from "../keyframe/color.js";
import { invalid } from "./errors.js";
import { isRecord } from "./internal.js";
import type { ColorInput } from "./types.js";

/** Parse a `ColorInput` into channels 0..255 (CSS `#rrggbbaa` order, like timeline.py `_parse_effect_color`). */
export function parseColorInput(value: unknown): [number, number, number, number] {
  if (typeof value === "string") {
    const rgba = parseHexColor(value);
    if (!rgba) throw invalid(`Not a color: ${value} (use #rrggbb or #rrggbbaa).`);
    return rgba;
  }
  if (isRecord(value)) {
    const channel = (key: string, fallback: number): number => {
      const v = value[key] ?? fallback;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 255) {
        throw invalid(`Color ${key} must be 0..255 (got ${String(v)}).`);
      }
      return v;
    };
    return [channel("red", 0), channel("green", 0), channel("blue", 0), channel("alpha", 255)];
  }
  throw invalid(`Not a color: ${String(value)}.`);
}

/** `undefined`, or one of BEZIER/LINEAR/CONSTANT; anything else is refused. */
export function requireInterpolation(value: unknown): Interpolation | undefined {
  if (value === undefined) return undefined;
  if (value !== 0 && value !== 1 && value !== 2) throw invalid(`interpolation must be 0 (bezier), 1 (linear) or 2 (constant).`);
  return value;
}

/**
 * Write a keyframed number. With no frame the property becomes one constant
 * point; with a frame, the point there is updated or inserted (desktop
 * Properties panel: new points LINEAR, choice properties CONSTANT).
 */
export function writeKeyframeValue(
  kf: Keyframe | undefined,
  value: number,
  frame: number | undefined,
  interpolation: Interpolation | undefined,
  choice = false,
): Keyframe {
  if (frame === undefined) {
    const keep = kf && typeof kf === "object" ? kf : {};
    const interp = choice ? Interpolation.CONSTANT : (interpolation ?? Interpolation.BEZIER);
    return { ...keep, Points: constantKeyframe(value, interp).Points };
  }
  return setKeyframeValue(kf, frame, value, choice ? Interpolation.CONSTANT : interpolation);
}

/** Write a color keyframe channel by channel (same frame rules as `writeKeyframeValue`). */
export function writeColorKeyframe(
  color: ColorKeyframe | undefined,
  value: ColorInput,
  frame: number | undefined,
  interpolation: Interpolation | undefined,
): ColorKeyframe {
  const rgba = parseColorInput(value);
  const channels = ["red", "green", "blue", "alpha"] as const;
  const out: Record<string, unknown> = { ...(color ?? {}) };
  channels.forEach((channel, i) => {
    const current = color?.[channel] as Keyframe | undefined;
    out[channel] =
      frame === undefined
        ? { Points: [openshotPoint(1, rgba[i]!, interpolation ?? Interpolation.BEZIER)] }
        : setKeyframeValue(current, frame, rgba[i]!, interpolation);
  });
  return out as ColorKeyframe;
}

