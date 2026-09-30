/**
 * Reading evaluated effect parameters. The planner evaluates every keyframe
 * with `Keyframe::GetValue` (a double) and every color channel likewise;
 * kernels then apply the conversion libopenshot applies at the call site
 * (`GetInt` rounding, `int(...)` truncation, float narrowing).
 */

import type { EvaluatedParam, RGBA } from "../types.js";
import type { Params } from "./types.js";

function isRecord(v: EvaluatedParam | undefined): v is { [key: string]: EvaluatedParam } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A numeric parameter (`GetValue`), or `fallback` when missing or not a number. */
export function num(params: Params, key: string, fallback: number): number {
  const v = params[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return fallback;
}

/** A plain int property (`asInt()` of a JSON number: truncation). */
export function int(params: Params, key: string, fallback: number): number {
  return Math.trunc(num(params, key, fallback));
}

/** `bool` property (`asBool()`): numbers are true when non-zero. */
export function bool(params: Params, key: string, fallback: boolean): boolean {
  const v = params[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v === "true" || v === "1";
  return fallback;
}

export function str(params: Params, key: string, fallback: string): string {
  const v = params[key];
  return typeof v === "string" ? v : fallback;
}

/**
 * A color parameter as evaluated channel values `[r, g, b, a]` (each the
 * channel keyframe's `GetValue`). Missing channels use `fallback`.
 */
export function color(params: Params, key: string, fallback: RGBA): RGBA {
  const v = params[key];
  if (Array.isArray(v) && v.length >= 3) {
    const ch = (i: number): number => {
      const x = v[i];
      return typeof x === "number" && Number.isFinite(x) ? x : fallback[i]!;
    };
    return [ch(0), ch(1), ch(2), v.length >= 4 ? ch(3) : fallback[3]];
  }
  if (isRecord(v)) {
    const ch = (name: string, i: number): number => {
      const x = v[name];
      return typeof x === "number" && Number.isFinite(x) ? x : fallback[i]!;
    };
    return [ch("red", 0), ch("green", 1), ch("blue", 2), ch("alpha", 3)];
  }
  return fallback;
}

/** A nested object parameter (e.g. ColorGrade `wheels`). */
export function record(params: Params, key: string): Params | undefined {
  const v = params[key];
  return isRecord(v) ? v : undefined;
}

/** A numeric array parameter (curve lookup tables). */
export function numbers(params: Params, key: string): number[] | undefined {
  const v = params[key];
  if (!Array.isArray(v)) return undefined;
  return v.every((x) => typeof x === "number") ? (v as number[]) : undefined;
}

/** libopenshot `Keyframe::GetInt`: round half away from zero, then truncate. */
export function getInt(value: number): number {
  const a = Math.abs(value);
  const f = Math.floor(a);
  const r = a - f >= 0.5 ? f + 1 : f;
  const out = value < 0 ? -r : r;
  return out === 0 ? 0 : out;
}

/** `QColor(QString(Color::GetColorHex(n)))`: channels rounded, alpha dropped (opaque). */
export function hexColorRgb(c: RGBA): [number, number, number] {
  const clamp = (v: number): number => Math.min(255, Math.max(0, getInt(v)));
  return [clamp(c[0]), clamp(c[1]), clamp(c[2])];
}

/** The `path` of a reader-JSON parameter (`mask_reader`, `map_reader`), if it names one. */
export function readerPath(params: Params, key: string): string | undefined {
  const v = params[key];
  if (!isRecord(v)) return undefined;
  const path = v.path;
  return typeof path === "string" && path.length > 0 ? path : undefined;
}
