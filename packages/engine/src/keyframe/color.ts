/**
 * Color keyframes (libopenshot `Color`: one keyframe per channel, 0..255).
 *
 * Ported from libopenshot src/Color.cpp:47-66 (GetColorHex / GetColorRGBA:
 * `GetInt` per channel) and :117-128 (SetJsonValue: a missing channel keeps
 * the owner's default curve). Hex parsing follows Qt `QColor(QString)` for
 * `#rgb` / `#rrggbb`; for 8 digits Qt reads `#aarrggbb`, which `parseHexColor`
 * supports via `order: "argb"` (CSS `#rrggbbaa` is the default).
 */

import type { ColorKeyframe, Keyframe } from "../model/types.js";
import type { RGBA } from "../render/types.js";
import { getInt } from "./evaluate.js";
import { openshotKeyframe } from "./edit.js";

export type ColorChannel = "red" | "green" | "blue" | "alpha";
export const COLOR_CHANNELS: readonly ColorChannel[] = ["red", "green", "blue", "alpha"];

/**
 * Sample a color keyframe at `frame`: `[r, g, b, a]`, integers 0..255.
 * Channels absent from `color` use `fallback` (the owner's default).
 */
export function evaluateColor(
  color: Partial<ColorKeyframe> | null | undefined,
  frame: number,
  fallback: RGBA = [0, 0, 0, 255],
): RGBA {
  return COLOR_CHANNELS.map((channel, i) => {
    const kf = color?.[channel] as Keyframe | undefined;
    return kf === undefined || kf === null ? fallback[i]! : getInt(kf, frame);
  }) as RGBA;
}

/** `#rrggbb` of a sampled color (Qt `QColor::name()` drops alpha, Color.cpp:54). */
export function colorHexAt(color: Partial<ColorKeyframe> | null | undefined, frame: number, fallback?: RGBA): string {
  const [r, g, b] = evaluateColor(color, frame, fallback);
  return `#${[r, g, b].map((v) => clampByte(v).toString(16).padStart(2, "0")).join("")}`;
}

function clampByte(v: number): number {
  return Math.min(255, Math.max(0, Math.trunc(v)));
}

/**
 * Parse `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` (CSS order; pass
 * `order: "argb"` for Qt's `#aarrggbb`). Returns null when malformed.
 */
export function parseHexColor(hex: string, order: "rgba" | "argb" = "rgba"): RGBA | null {
  const m = /^#?([0-9a-f]+)$/i.exec(hex.trim());
  if (!m) return null;
  let digits = m[1]!;
  if (digits.length === 3 || digits.length === 4) {
    digits = [...digits].map((d) => d + d).join("");
  }
  if (digits.length !== 6 && digits.length !== 8) return null;
  const bytes = digits.match(/../g)!.map((pair) => Number.parseInt(pair, 16));
  if (bytes.length === 3) return [bytes[0]!, bytes[1]!, bytes[2]!, 255];
  if (order === "argb") return [bytes[1]!, bytes[2]!, bytes[3]!, bytes[0]!];
  return [bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!];
}

/** `#rrggbb` (or `#rrggbbaa` when `withAlpha`) for channel values 0..255. */
export function toHexColor(rgba: RGBA, withAlpha = false): string {
  const channels = withAlpha ? rgba : rgba.slice(0, 3);
  return `#${channels.map((v) => clampByte(v).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A constant color keyframe, as libopenshot `Color(r, g, b, a).JsonValue()`
 * writes it (each channel a one-point BEZIER keyframe).
 */
export function constantColor(rgba: RGBA): ColorKeyframe {
  const [r, g, b, a] = rgba.map(clampByte) as RGBA;
  return {
    red: openshotKeyframe(r),
    green: openshotKeyframe(g),
    blue: openshotKeyframe(b),
    alpha: openshotKeyframe(a),
  };
}
