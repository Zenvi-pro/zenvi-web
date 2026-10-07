/**
 * Effect JSON → evaluated kernel parameters at one effect-local frame.
 *
 * libopenshot effects read their properties at the frame they process:
 * keyframes via `Keyframe::GetValue`, colors per channel, AnimatedCurves via
 * `BuildCurve` + `GetValue` (src/AnimatedCurve.cpp:103-134). The planner does
 * that evaluation once so kernels only see plain values:
 *
 * - `{ "Points": [...] }` → the keyframe's `GetValue(frame)` (a double)
 * - `{ "red", "green", "blue"[, "alpha"] }` of keyframes → `[r, g, b, a]` doubles
 * - `{ "enabled", "nodes": [...] }` → `{ enabled, table }` (see below)
 * - anything else: strings/numbers/booleans unchanged, objects and arrays recursively
 */

import { evaluate } from "../../keyframe/evaluate.js";
import { addResolvedPoint, type ResolvedPoint } from "../../keyframe/points.js";
import { valueAtResolved } from "../../keyframe/evaluate.js";
import type { EvaluatedParam } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKeyframe(value: unknown): value is { Points: unknown[] } {
  return isRecord(value) && Array.isArray(value.Points);
}

function isColor(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && isKeyframe(value.red) && isKeyframe(value.green) && isKeyframe(value.blue);
}

function isAnimatedCurve(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Array.isArray(value.nodes);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * An AnimatedCurve evaluated at a frame: `enabled` is the enable keyframe's
 * value and `table[i] = clamp01(BuildCurve(frame, 255).GetValue(i))` for
 * i = 0..255. `AnimatedCurve::Sample(v)` is then `enabled < 0.5 ? clamp01(v)
 * : table[lround(clamp01(v) * 255)]`.
 */
export interface EvaluatedCurve {
  enabled: number;
  table: number[];
}

interface CurveNode {
  id: number;
  x: unknown;
  y: unknown;
  lhx: unknown;
  lhy: unknown;
  rhx: unknown;
  rhy: unknown;
  interpolation: number;
  handleType: number;
}

/** AnimatedCurveNode defaults (AnimatedCurve.cpp:29-43) with JSON applied (:84-102). */
function readNode(raw: unknown): CurveNode {
  const n = isRecord(raw) ? raw : {};
  const int = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : fallback);
  return {
    id: int(n.id, 0),
    x: n.x ?? 0,
    y: n.y ?? 0,
    lhx: n.left_handle_x ?? 0.5,
    lhy: n.left_handle_y ?? 1,
    rhx: n.right_handle_x ?? 0.5,
    rhy: n.right_handle_y ?? 0,
    interpolation: int(n.interpolation, 1),
    handleType: int(n.handle_type, 0),
  };
}

/** Keyframe-or-number property value at a frame (a bare number is a constant). */
function valueOf(v: unknown, frame: number): number {
  if (typeof v === "number") return v;
  return evaluate(v as { Points?: unknown }, frame);
}

/**
 * Default curve: identity nodes (0,0) and (1,1), both LINEAR
 * (AnimatedCurve.cpp:103-107). `defaultNodes` lets an effect supply its own
 * (DenoiseImage's response curve).
 */
export function evaluateAnimatedCurve(json: unknown, frame: number, defaultNodes?: unknown[]): EvaluatedCurve {
  const root = isRecord(json) ? json : {};
  const enabled = root.enabled === undefined ? 1 : valueOf(root.enabled, frame);
  let rawNodes: unknown[] = Array.isArray(root.nodes) && root.nodes.length > 0 ? root.nodes : [];
  if (rawNodes.length === 0) {
    rawNodes = defaultNodes ?? [
      { id: 0, x: 0, y: 0, interpolation: 1 },
      { id: 1, x: 1, y: 1, interpolation: 1 },
    ];
  }
  const nodes = rawNodes.map(readNode);
  const xs = new Map(nodes.map((n) => [n, valueOf(n.x, frame)]));
  // std::sort by x at the frame, ties by id (not stable, but ids decide ties).
  nodes.sort((a, b) => {
    const ax = xs.get(a)!;
    const bx = xs.get(b)!;
    if (ax === bx) return a.id - b.id;
    return ax - bx;
  });
  const points: ResolvedPoint[] = [];
  for (const n of nodes) {
    addResolvedPoint(points, {
      x: Math.fround(clamp01(valueOf(n.x, frame)) * 255),
      y: Math.fround(clamp01(valueOf(n.y, frame))),
      interpolation: n.interpolation,
      handleType: n.handleType,
      leftX: clamp01(valueOf(n.lhx, frame)),
      leftY: clamp01(valueOf(n.lhy, frame)),
      rightX: clamp01(valueOf(n.rhx, frame)),
      rightY: clamp01(valueOf(n.rhy, frame)),
    });
  }
  const table: number[] = [];
  for (let i = 0; i < 256; i += 1) table.push(clamp01(valueAtResolved(points, i)));
  return { enabled, table };
}

/** `AnimatedCurve::Sample` on an evaluated curve. */
export function sampleCurve(curve: EvaluatedCurve, input: number): number {
  const v = clamp01(input);
  if (curve.enabled < 0.5) return Math.fround(v);
  const i = Math.round(v * 255); // lround of a non-negative value
  return Math.fround(curve.table[i] ?? v);
}

/** Evaluate one JSON value (see the module comment). */
export function evaluateValue(value: unknown, frame: number): EvaluatedParam | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  if (isKeyframe(value)) return evaluate(value, frame);
  if (isColor(value)) {
    const alpha = isKeyframe(value.alpha) ? evaluate(value.alpha, frame) : 255;
    return [evaluate(value.red as { Points: unknown[] }, frame), evaluate(value.green as { Points: unknown[] }, frame), evaluate(value.blue as { Points: unknown[] }, frame), alpha];
  }
  if (isAnimatedCurve(value)) {
    const c = evaluateAnimatedCurve(value, frame);
    return { enabled: c.enabled, table: c.table };
  }
  if (Array.isArray(value)) {
    const out: EvaluatedParam[] = [];
    for (const item of value) {
      const v = evaluateValue(item, frame);
      if (v !== undefined) out.push(v);
    }
    return out;
  }
  if (isRecord(value)) {
    const out: { [key: string]: EvaluatedParam } = {};
    for (const [k, v] of Object.entries(value)) {
      const e = evaluateValue(v, frame);
      if (e !== undefined) out[k] = e;
    }
    return out;
  }
  return undefined;
}

/** DenoiseImage's response curve: (0,1), (.5,.55), (1,.2), LINEAR (DenoiseImage.cpp:310-313). */
export const DENOISE_RESPONSE_NODES: readonly unknown[] = Object.freeze([
  { id: 0, x: 0, y: 1, interpolation: 1 },
  { id: 1, x: 0.5, y: 0.55, interpolation: 1 },
  { id: 2, x: 1, y: 0.2, interpolation: 1 },
]);

/**
 * AnimatedCurve properties whose constructor nodes are not the identity.
 * An empty `nodes` array keeps the constructor's nodes
 * (AnimatedCurve::SetJsonValue, AnimatedCurve.cpp:169-178).
 */
const CURVE_DEFAULTS: Readonly<Record<string, Readonly<Record<string, readonly unknown[]>>>> = {
  DenoiseImage: { response_curve: DENOISE_RESPONSE_NODES },
};

/** Every property of an effect's JSON, evaluated at `frame`. */
export function evaluateEffectParams(effect: Readonly<Record<string, unknown>>, frame: number): Record<string, EvaluatedParam> {
  const out: Record<string, EvaluatedParam> = {};
  const curveDefaults = CURVE_DEFAULTS[String(effect.type ?? effect.class_name ?? "")];
  for (const [k, v] of Object.entries(effect)) {
    const nodes = curveDefaults?.[k];
    if (nodes && isAnimatedCurve(v)) {
      const c = evaluateAnimatedCurve(v, frame, [...nodes]);
      out[k] = { enabled: c.enabled, table: c.table };
      continue;
    }
    const e = evaluateValue(v, frame);
    if (e !== undefined) out[k] = e;
  }
  return out;
}

