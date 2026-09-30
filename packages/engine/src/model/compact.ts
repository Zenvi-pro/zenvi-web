/**
 * Expansion of the compact encoding the generated libopenshot tables use
 * (scripts/gen-libopenshot-tables.py):
 *
 *   {"$kf": y}               → `Keyframe(y).JsonValue()` (one BEZIER point at X=1)
 *   {"$color": [r, g, b, a]} → `Color(r, g, b, a).JsonValue()`
 *   "{{id}}" in keys/strings → the new object's id (tracked-object keys)
 *
 * Values in the tables are already float-exact, so expansion reproduces the
 * library's JSON bit for bit.
 */

import type { ColorKeyframe, Keyframe } from "./types.js";
import { HandleType, Interpolation } from "./types.js";

const ID_PLACEHOLDER = "{{id}}";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `Keyframe(y).JsonValue()`. */
export function libopenshotKeyframe(y: number): Keyframe {
  return {
    Points: [
      {
        co: { X: 1.0, Y: y },
        handle_left: { X: 0.5, Y: 1.0 },
        handle_right: { X: 0.5, Y: 0.0 },
        handle_type: HandleType.AUTO,
        interpolation: Interpolation.BEZIER,
      },
    ],
  };
}

function libopenshotColor(channels: readonly number[]): ColorKeyframe {
  const [r = 0, g = 0, b = 0, a = 255] = channels;
  return {
    red: libopenshotKeyframe(r),
    green: libopenshotKeyframe(g),
    blue: libopenshotKeyframe(b),
    alpha: libopenshotKeyframe(a),
  };
}

/** Expand a compact table value into fresh libopenshot JSON (never shares objects with the table). */
export function expandCompact<T = unknown>(value: unknown, id?: string): T {
  return expand(value, id) as T;
}

function expand(value: unknown, id: string | undefined): unknown {
  if (Array.isArray(value)) return value.map((v) => expand(v, id));
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === "$kf" && typeof value.$kf === "number") {
      return libopenshotKeyframe(value.$kf);
    }
    if (keys.length === 1 && keys[0] === "$color" && Array.isArray(value.$color)) {
      return libopenshotColor(value.$color as number[]);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[substitute(k, id)] = expand(v, id);
    return out;
  }
  if (typeof value === "string") return substitute(value, id);
  return value;
}

function substitute(text: string, id: string | undefined): string {
  return id !== undefined && text.includes(ID_PLACEHOLDER) ? text.split(ID_PLACEHOLDER).join(id) : text;
}
