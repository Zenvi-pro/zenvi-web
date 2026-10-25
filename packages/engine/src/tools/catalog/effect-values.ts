/**
 * Effect property values for the effects-color tools: what a model sends
 * (numbers, "4s", choice names, "#00ff00", keyframe lists in timeline
 * seconds, curve points, wheel objects, file ids, LUT names) → the effect
 * JSON libopenshot reads, validated before anything is saved.
 *
 * Ports of zenvi-core develop (1f80cb3d0) src/classes/editor_tools/
 * effects_color.py (`convert_property`, `prepare_properties`, `curve_value`,
 * `wheels_value`, `effect_value_summary`) and _base.py (`parse_color`,
 * `color_keyframe`, `keyframe_point`, `interpolation_code`, `clip_extent`,
 * `clip_frame_at`, `keyframe_value_at`). Keyframe points are written the way
 * the desktop's Python writes them: JSON doubles with handles on every point.
 */

import { pyRound } from "../../model/rounding.js";
import type { Clip, Effect, Keyframe, Project } from "../../model/types.js";
import { curveData, defaultCurveData, defaultWheelsData, wheelEntry } from "../../ops/look.js";
import { getCloseMatches } from "../difflib.js";
import { projectFps } from "../frame-time.js";
import { parsePythonFloat } from "../coerce.js";
import { LutError, resolveLut } from "../luts.js";
import { pyFloat, pyG, pyRepr, pyReprString } from "../pyfmt.js";
import {
  COMMON_PROPERTIES,
  colorHex,
  effectCatalog,
  HIDDEN_PROPERTIES,
  isColorValue,
  isKeyframe,
  normName,
  round4,
  type CatalogProperty,
} from "./effect-catalog.js";
import { r3, ToolError } from "./timeline-edit-common.js";

/** OpenShot interpolation codes (openshot.BEZIER / LINEAR / CONSTANT). */
export const BEZIER = 0;
export const LINEAR = 1;
export const CONSTANT = 2;

const INTERPOLATION_NAMES: Readonly<Record<string, number>> = {
  bezier: BEZIER, ease: BEZIER, smooth: BEZIER, linear: LINEAR, constant: CONSTANT, hold: CONSTANT, step: CONSTANT,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Python truthiness of a JSON value. */
export function pyTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

/** Python `float(x)` for a JSON value; null when Python would raise. */
export function pyFloatOf(value: unknown): number | null {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return parsePythonFloat(value);
  return null;
}

// ---------------------------------------------------------------------------
// _base.py: keyframes, time, colours
// ---------------------------------------------------------------------------

/** _base.interpolation_code. */
export function interpolationCode(name: unknown): number {
  if (typeof name === "number" && Number.isInteger(name) && [BEZIER, LINEAR, CONSTANT].includes(name)) return name;
  const key = String(name === null || name === undefined || name === "" || name === false || name === 0 ? "bezier" : name).trim().toLowerCase();
  const code = INTERPOLATION_NAMES[key];
  if (code === undefined) throw new ToolError(`interpolation must be bezier, linear or constant, got ${pyRepr(name)}`);
  return code;
}

/** _base.keyframe_point / effects_color._point: a point with handles, values as JSON doubles. */
export function keyframePoint(frame: number, value: number, interpolation: number = BEZIER): Record<string, unknown> {
  return {
    co: { X: Number(frame), Y: Number(value) },
    interpolation: Math.trunc(interpolation),
    handle_type: 0,
    handle_left: { X: 0.5, Y: 1.0 },
    handle_right: { X: 0.5, Y: 0.0 },
  };
}

/** _base.constant_keyframe. */
export function constantKeyframe(value: number): Keyframe {
  return { Points: [keyframePoint(1, value, BEZIER)] } as unknown as Keyframe;
}

/** _base.keyframe_value_at: a keyframe's value at `frame`, linear between points (for reports and starting values). */
export function keyframeValueAt(kf: unknown, frame: number, fallback = 0): number {
  if (typeof kf === "number") return kf;
  const points = isRecord(kf) && Array.isArray(kf.Points) ? (kf.Points as Record<string, unknown>[]) : [];
  if (points.length === 0) return fallback;
  const xy = (p: Record<string, unknown>): [number, number] => {
    const co = isRecord(p.co) ? p.co : {};
    return [Number(co.X), Number(co.Y)];
  };
  const sorted = [...points].sort((a, b) => xy(a)[0] - xy(b)[0]);
  if (frame <= xy(sorted[0]!)[0]) return xy(sorted[0]!)[1];
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const [ax, ay] = xy(sorted[i]!);
    const [bx, by] = xy(sorted[i + 1]!);
    if (ax <= frame && frame <= bx) {
      if (Number(sorted[i]!.interpolation ?? BEZIER) === CONSTANT || bx === ax) return ay;
      return ay + ((frame - ax) / (bx - ax)) * (by - ay);
    }
  }
  return xy(sorted[sorted.length - 1]!)[1];
}

/** _base.project_fps. */
export function fpsFloat(project: Project): number {
  const fps = projectFps(project);
  return fps.num / fps.den;
}

/** _base.clip_extent: [timeline start, timeline end, duration] in seconds. */
export function clipExtent(clip: Pick<Clip, "position" | "start" | "end">): [number, number, number] {
  const position = Number(clip.position) || 0;
  const duration = Math.max(0, (Number(clip.end) || 0) - (Number(clip.start) || 0));
  return [position, position + duration, duration];
}

/**
 * _base.clip_frame_at: the clip-local keyframe X for a timeline time (frame 1
 * is the source's first frame, so a trimmed start counts).
 */
export function clipFrameAt(project: Project, clip: Pick<Clip, "position" | "start">, seconds: number): number {
  const fps = fpsFloat(project);
  const local = Math.max(0, seconds - (Number(clip.position) || 0)) + (Number(clip.start) || 0);
  return pyRound(local * fps) + 1;
}

const COLOR_NAMES: Readonly<Record<string, string>> = {
  white: "#ffffff", black: "#000000", red: "#ff0000", green: "#00ff00", blue: "#0000ff", yellow: "#ffff00",
  cyan: "#00ffff", magenta: "#ff00ff", orange: "#ffa500", purple: "#800080", pink: "#ffc0cb", gray: "#808080",
  grey: "#808080", transparent: "#00000000",
};

/** _base.parse_color: '#RRGGBB', '#RRGGBBAA', '#RGB', 'rgb(r,g,b[,a])' or a basic colour name → [r, g, b, a]. */
export function parseColor(value: unknown): [number, number, number, number] {
  const raw = value === null || value === undefined || value === false || value === 0 ? "" : String(value);
  const s = COLOR_NAMES[raw.trim().toLowerCase()] ?? raw.trim();
  if (s.startsWith("#")) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = Array.from(h, (ch) => ch + ch).join("");
    if ((h.length === 6 || h.length === 8) && /^[0-9a-fA-F]+$/.test(h)) {
      const at = (i: number): number => Number.parseInt(h.slice(i, i + 2), 16);
      return [at(0), at(2), at(4), h.length === 8 ? at(6) : 255];
    }
  }
  if (s.toLowerCase().startsWith("rgb") && s.includes("(") && s.includes(")")) {
    const parts = s.slice(s.indexOf("(") + 1, s.lastIndexOf(")")).split(",").map((p) => p.trim());
    const nums = parts.map((p) => parsePythonFloat(p));
    if (nums.length >= 3 && nums.every((n) => n !== null)) {
      const [r, g, b] = (nums as number[]).slice(0, 3).map((n) => Math.trunc(Math.max(0, Math.min(255, pyRound(n))))) as [number, number, number];
      let a = 255;
      if (nums.length > 3) {
        const n = nums[3]!;
        a = n <= 1 ? Math.trunc(pyRound(n * 255)) : Math.trunc(n);
      }
      return [r, g, b, Math.max(0, Math.min(255, a))];
    }
  }
  throw new ToolError(`unrecognised color ${pyRepr(value ?? "")}; use #RRGGBB, #RRGGBBAA, rgb(r,g,b) or a basic color name`);
}

/** _base.color_keyframe: a constant colour. */
export function colorKeyframe(value: unknown): Record<string, Keyframe> {
  const [r, g, b, a] = parseColor(value);
  return { red: constantKeyframe(r), green: constantKeyframe(g), blue: constantKeyframe(b), alpha: constantKeyframe(a) };
}

/** `"#%02x%02x%02x"`. */
export function hex6(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// ---------------------------------------------------------------------------
// Property values
// ---------------------------------------------------------------------------

/** What converting a property needs besides the value. */
export interface ValueContext {
  project: Project;
  /**
   * The `lut_path` this call resolved and checked beforehand (LUT files are
   * read through the host, which is async). Unset: resolved here, and only
   * built-in LUTs are accepted.
   */
  lutPath?: string;
}

function choiceValue(pname: string, spec: CatalogProperty, value: unknown): unknown {
  const choices = spec.choices ?? [];
  let v: unknown = value;
  if (typeof v === "string") {
    const key = normName(v);
    for (const c of choices) if (normName(c.name) === key) return c.value;
    for (const c of choices) if (key && normName(c.name).startsWith(key)) return c.value;
    const f = parsePythonFloat(v);
    if (f === null) {
      const names = choices.map((c) => String(c.name)).join(", ");
      throw new ToolError(`${pname} must be one of: ${names}; got ${pyReprString(v)}`);
    }
    v = f;
    for (const c of choices) if (Number(c.value) === f) return c.value;
    const names = choices.map((c) => `${String(c.name)}=${String(c.value)}`).join(", ");
    throw new ToolError(`${pname} must be one of: ${names}; got ${pyFloat(f)}`);
  }
  if (typeof v === "boolean") v = v ? 1 : 0;
  for (const c of choices) if (Number(c.value) === Number(v)) return c.value;
  const names = choices.map((c) => `${String(c.name)}=${String(c.value)}`).join(", ");
  throw new ToolError(`${pname} must be one of: ${names}; got ${pyRepr(v)}`);
}

/** effects_color._number: a number in the property's range ("true"/"off", "4s" and "50%" read as numbers). */
function numberValue(pname: string, spec: CatalogProperty, value: unknown): number {
  if (spec.choices && spec.choices.length > 0) return Number(choiceValue(pname, spec, value));
  let n: number;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (["true", "yes", "on"].includes(s)) return 1;
    if (["false", "no", "off"].includes(s)) return 0;
    const f = parsePythonFloat(s.replace(/[s%]+$/, "").trim());
    if (f === null) throw new ToolError(`${pname} must be a number, got ${pyReprString(value)}`);
    n = f;
  } else if (typeof value === "number" && Number.isFinite(value)) {
    n = value;
  } else {
    throw new ToolError(`${pname} must be a number, got ${pyRepr(value)}`);
  }
  const lo = spec.min;
  const hi = spec.max;
  if (lo !== undefined && hi !== undefined && !(lo - 1e-9 <= n && n <= hi + 1e-9)) {
    throw new ToolError(`${pname} must be between ${pyG(lo)} and ${pyG(hi)}, got ${pyG(n)}`);
  }
  return n;
}

type KeyframeInput = [time: unknown, value: unknown, interpolation: unknown];

/** effects_color._keyframe_list: keyframe input → [(time, value, interpolation)], or null for a static value. */
function keyframeList(value: unknown): KeyframeInput[] | null {
  let v = value;
  if (isRecord(v) && "keyframes" in v) v = v.keyframes;
  if (!Array.isArray(v)) return null;
  const out: KeyframeInput[] = [];
  for (const item of v) {
    if (isRecord(item)) {
      if (!("time" in item) || !("value" in item)) throw new ToolError('each keyframe needs "time" (timeline seconds) and "value"');
      out.push([item.time, item.value, item.interpolation]);
    } else if (Array.isArray(item) && (item.length === 2 || item.length === 3)) {
      out.push([item[0], item[1], item.length === 3 ? item[2] : undefined]);
    } else {
      throw new ToolError('keyframes are [{"time": seconds, "value": v, "interpolation": "linear"}...]');
    }
  }
  if (out.length === 0) throw new ToolError("the keyframe list is empty");
  return out;
}

function keyframeFrame(ctx: ValueContext, clip: Clip, t: unknown): number {
  const seconds = pyFloatOf(t);
  if (seconds === null) throw new ToolError(`keyframe time must be timeline seconds, got ${pyRepr(t)}`);
  const [start, end] = clipExtent(clip);
  const slack = 1 / fpsFloat(ctx.project);
  if (seconds < start - slack || seconds > end + slack) {
    throw new ToolError(`keyframe time ${pyG(seconds)}s is outside the clip (${pyG(start)}-${pyG(end)}s on the timeline)`);
  }
  return clipFrameAt(ctx.project, clip, Math.min(Math.max(seconds, start), end));
}

function points(
  ctx: ValueContext,
  clip: Clip,
  kfs: readonly KeyframeInput[],
  defaultInterp: number,
  convert: (v: unknown) => number,
): Record<string, unknown>[] {
  const byFrame = new Map<number, [number, number, number]>();
  for (const [t, v, interp] of kfs) {
    const frame = keyframeFrame(ctx, clip, t);
    const code = interp === undefined || interp === null || interp === "" ? defaultInterp : interpolationCode(interp);
    byFrame.set(frame, [frame, convert(v), code]);
  }
  return [...byFrame.keys()].sort((a, b) => a - b).map((k) => keyframePoint(...byFrame.get(k)!));
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** effects_color._file_reader: a project file (id, file name or path) as an image/video reader. */
function fileReader(ctx: ValueContext, value: unknown): Record<string, unknown> {
  const key = value === null || value === undefined || value === false || value === 0 ? "" : String(value).trim();
  if (["", "none"].includes(key.toLowerCase())) return { type: "" };
  const files = ctx.project.files ?? [];
  let file = files.find((f) => String(f.id) === key);
  if (!file) {
    file = files.find((f) => {
      const path = String(f.path ?? "");
      return basename(path).toLowerCase() === key.toLowerCase() || path === key;
    });
  }
  if (!file) throw new ToolError(`no project file ${pyRepr(value)} for the image/video input (use a file id from list_files_tool)`);
  return structuredClone(file) as unknown as Record<string, unknown>;
}

/** effects_color.curve_value: [[x, y], ...] or [{"x", "y"}...] (0-1, input → output) → a Color Grade curve. */
export function curveValue(pname: string, value: unknown): Record<string, unknown> {
  if (isRecord(value) && "nodes" in value) return value;
  if (value === null || value === undefined || (typeof value === "string" && ["", "reset", "none", "linear"].includes(value))) {
    return defaultCurveData();
  }
  if (!Array.isArray(value) || value.length < 2) {
    throw new ToolError(`${pname} needs at least 2 points like [[0,0],[0.5,0.6],[1,1]] (x = input, y = output, 0-1)`);
  }
  const pts: { x: number; y: number }[] = [];
  for (const p of value) {
    let x: unknown;
    let y: unknown;
    if (isRecord(p)) [x, y] = [p.x, p.y];
    else if (Array.isArray(p) && p.length === 2) [x, y] = p;
    else throw new ToolError(`${pname} points are [x, y] pairs in 0-1`);
    const fx = pyFloatOf(x);
    const fy = pyFloatOf(y);
    if (fx === null || fy === null) throw new ToolError(`${pname} points are [x, y] pairs in 0-1`);
    if (!(fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1)) throw new ToolError(`${pname} point (${pyG(fx)}, ${pyG(fy)}) is outside 0-1`);
    pts.push({ x: fx, y: fy });
  }
  pts.sort((a, b) => a.x - b.x);
  if (new Set(pts.map((p) => p.x)).size !== pts.length) throw new ToolError(`${pname} has two points with the same x`);
  if (pts.length > 16) throw new ToolError(`${pname} takes at most 16 points`);
  return curveData(pts);
}

export const WHEELS = ["global", "shadows", "midtones", "highlights"] as const;

/** effects_color.wheels_value: {"shadows": {"color", "amount", "luma"}, ...} merged onto the current wheels. */
export function wheelsValue(value: unknown, current: unknown): Record<string, unknown> {
  if (value === null || value === undefined || (typeof value === "string" && ["", "reset", "none"].includes(value))) {
    return defaultWheelsData();
  }
  if (!isRecord(value)) throw new ToolError('wheels is {"shadows": {"color": "#hex", "amount": 0-1, "luma": -1..1}, ...}');
  const out: Record<string, unknown> = isRecord(current) && pyTruthy(current.global) ? structuredClone(current) : defaultWheelsData();
  for (const [name, wheel] of Object.entries(value)) {
    if (name === "enabled") {
      out.enabled_keyframes = constantKeyframe(pyTruthy(wheel) ? 1.0 : 0.0);
      continue;
    }
    if (!(WHEELS as readonly string[]).includes(name)) {
      throw new ToolError(`unknown color wheel ${pyReprString(name)}; use ${WHEELS.join(", ")}`);
    }
    if (!isRecord(wheel)) throw new ToolError(`wheel ${name} needs {color, amount, luma}`);
    const prev = isRecord(out[name]) ? (out[name] as Record<string, unknown>) : {};
    const color = "color" in wheel ? wheel.color : "color" in prev ? prev.color : "#ffffff";
    const [r, g, b] = parseColor(color);
    const amount = pyFloatOf("amount" in wheel ? wheel.amount : "amount" in prev ? prev.amount : 0.0);
    const luma = pyFloatOf("luma" in wheel ? wheel.luma : "luma" in prev ? prev.luma : 0.0);
    if (amount === null || luma === null) throw new ToolError(`wheel ${name}: amount and luma are numbers`);
    if (!(amount >= 0 && amount <= 1)) throw new ToolError(`wheel ${name}: amount must be 0-1, got ${pyG(amount)}`);
    if (!(luma >= -1 && luma <= 1)) throw new ToolError(`wheel ${name}: luma must be -1..1, got ${pyG(luma)}`);
    out[name] = wheelEntry(hex6(r, g, b), amount, luma);
  }
  return out;
}

function propertySpec(className: string, pname: string): CatalogProperty {
  const props = effectCatalog().get(className)?.properties ?? {};
  const spec = props[pname];
  if (spec) return spec;
  if (HIDDEN_PROPERTIES.has(pname)) throw new ToolError(`${pname} is not settable on an effect (effects follow their clip)`);
  const names = Object.keys(props).sort();
  const close = getCloseMatches(pname, names, 3, 0.5);
  const hint = close.length > 0 ? ` (did you mean ${close.join(", ")}?)` : "";
  throw new ToolError(`${className} has no property ${pyReprString(pname)}${hint}; it has: ${names.join(", ")}`);
}

function lutValue(ctx: ValueContext, value: unknown): string {
  if (ctx.lutPath !== undefined) return ctx.lutPath;
  try {
    const resolved = resolveLut(value);
    if (resolved.kind === "file") {
      throw new ToolError("a .cube file outside the built-in LUTs needs local file access (Zenvi desktop or the zenvi CLI); use a built-in LUT (list_luts_tool)");
    }
    return resolved.path;
  } catch (error) {
    if (error instanceof LutError) throw new ToolError(error.message);
    throw error;
  }
}

/** effects_color.convert_property: a model-supplied value → the effect JSON value for `pname` (validated; nothing mutated). */
export function convertProperty(
  ctx: ValueContext,
  className: string,
  pname: string,
  value: unknown,
  effect: Readonly<Record<string, unknown>>,
  clip: Clip,
  defaultInterp: number = BEZIER,
): unknown {
  const spec = propertySpec(className, pname);
  const ptype = spec.type;
  const current = effect[pname];
  const kfs = ptype !== "colorgrade_curve" && ptype !== "colorgrade_wheels" ? keyframeList(value) : null;

  if (ptype === "color") {
    if (kfs) {
      const parsed = kfs.map(([t, v, i]) => [t, parseColor(v), i] as const);
      const out: Record<string, unknown> = {};
      (["red", "green", "blue", "alpha"] as const).forEach((channel, idx) => {
        out[channel] = { Points: points(ctx, clip, parsed.map(([t, c, i]) => [t, c[idx], i]), defaultInterp, Number) };
      });
      return out;
    }
    return colorKeyframe(value);
  }

  if (ptype === "float" || ptype === "int" || ptype === "bool") {
    const keyframed = isKeyframe(current) || ((current === undefined || current === null) && spec.keyframable);
    if (keyframed) {
      const interp = spec.choices && spec.choices.length > 0 ? CONSTANT : defaultInterp;
      if (kfs) return { Points: points(ctx, clip, kfs, interp, (v) => numberValue(pname, spec, v)) };
      return { Points: [keyframePoint(1, numberValue(pname, spec, value), interp)] };
    }
    if (kfs) throw new ToolError(`${pname} cannot be keyframed; give one value`);
    const num = numberValue(pname, spec, value);
    if (typeof current === "boolean" || ptype === "bool") return num !== 0;
    if (ptype === "int") return Math.trunc(pyRound(num));
    return num;
  }

  if (kfs) throw new ToolError(`${pname} cannot be keyframed; give one value`);
  if (ptype === "string") {
    if (pname === "lut_path") return lutValue(ctx, value);
    return value === null || value === undefined ? "" : typeof value === "string" ? value : pyRepr(value);
  }
  if (ptype === "font" || ptype === "caption") return typeof value === "string" ? value : pyRepr(value);
  if (ptype === "reader") return fileReader(ctx, value);
  if (ptype === "colorgrade_curve") return curveValue(pname, value);
  if (ptype === "colorgrade_wheels") return wheelsValue(value, current);
  throw new ToolError(`${pname} (${ptype}) is not settable by tools; use the Properties dock`);
}

/** effects_color.prepare_properties: validate and convert every property before anything is saved. */
export function prepareProperties(
  ctx: ValueContext,
  className: string,
  properties: unknown,
  effect: Readonly<Record<string, unknown>>,
  clip: Clip,
  interpolation: unknown = "bezier",
): Record<string, unknown> {
  if (properties === null || properties === undefined) return {};
  if (!isRecord(properties)) throw new ToolError('properties is an object like {"horizontal_radius": 12, "sigma": 4}');
  const defaultInterp = interpolationCode(interpolation);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    out[key] = convertProperty(ctx, className, key, value, effect, clip, defaultInterp);
  }
  return out;
}

/** effects_color.needs_luts. */
export function needsLuts(properties: unknown): boolean {
  return isRecord(properties) && "lut_path" in properties;
}

function richSummary(ptype: string, value: unknown): unknown {
  if (!isRecord(value)) return null;
  if (ptype === "reader") return basename(String(value.path ?? "")) || null;
  if (ptype === "colorgrade_curve") {
    const nodes = Array.isArray(value.nodes) ? (value.nodes as Record<string, unknown>[]) : [];
    return nodes.map((n) => [r3(keyframeValueAt(n.x, 1)), r3(keyframeValueAt(n.y, 1))]);
  }
  const out: Record<string, unknown> = {};
  for (const w of WHEELS) {
    const wheel = value[w];
    if (isRecord(wheel)) out[w] = { color: wheel.color ?? null, amount: wheel.amount ?? null, luma: wheel.luma ?? null };
  }
  return out;
}

/** effects_color.effect_value_summary: an effect's settable values (keyframed ones as timed points). */
export function effectValueSummary(project: Project, className: string, effect: Effect, clip: Clip): Record<string, unknown> {
  const spec = effectCatalog().get(className)?.properties ?? {};
  const fps = fpsFloat(project);
  const position = Number(clip.position) || 0;
  const start = Number(clip.start) || 0;
  const out: Record<string, unknown> = {};
  for (const [pname, pspec] of Object.entries(spec)) {
    if ((COMMON_PROPERTIES as readonly string[]).includes(pname) && pname !== "mask_source_id" && pname !== "mask_invert") continue;
    const value = (effect as Record<string, unknown>)[pname];
    if (isKeyframe(value)) {
      const pts = value.Points;
      if (pts.length <= 1) out[pname] = pts.length > 0 ? round4(Number(pts[0]!.co.Y)) : (pspec.default ?? null);
      else {
        out[pname] = {
          keyframes: pts.map((p) => ({ time: r3(position + (Number(p.co.X) - 1) / fps - start), value: round4(Number(p.co.Y)) })),
        };
      }
    } else if (isColorValue(value)) {
      out[pname] = colorHex(value);
    } else if (pspec.type === "colorgrade_curve" || pspec.type === "colorgrade_wheels" || pspec.type === "reader") {
      out[pname] = richSummary(pspec.type, value);
    } else if (["boolean", "number", "string"].includes(typeof value)) {
      out[pname] = value;
    }
  }
  return out;
}
