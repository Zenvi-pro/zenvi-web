/**
 * Camera motion values for the Motion ▸ Camera presets, ported from
 * zenvi-core src/classes/camera_motion.py: SCALE_CROP framing that keeps the
 * frame covered while panning or zooming.
 */

export type PanDirection =
  | "auto"
  | "left_to_right"
  | "right_to_left"
  | "top_to_bottom"
  | "bottom_to_top"
  | "pan_left"
  | "pan_right"
  | "pan_up"
  | "pan_down";

export interface CameraKeyframes {
  scaleX: [number, number];
  scaleY: [number, number];
  locationX: [number, number];
  locationY: [number, number];
}

function positive(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** `_crop_base_size`: source size after SCALE_CROP at scale 1. */
function cropBaseSize(pw: number, ph: number, sw: unknown, sh: unknown): [number, number] {
  const w = positive(sw, pw);
  const h = positive(sh, ph);
  const projectAspect = pw / ph;
  const sourceAspect = w / h;
  return sourceAspect >= projectAspect ? [ph * sourceAspect, ph] : [pw, pw / sourceAspect];
}

/** `_safe_location`: largest normalized location that keeps the edges covered. */
function safeLocation(canvas: number, base: number, scale: number): number {
  const scaled = Math.max(0.0001, base * Math.max(0.001, scale));
  const c = Math.max(0.0001, canvas);
  if (scaled <= c) return 0;
  return (scaled - c) / (scaled + c);
}

/** `_scale_for_safe_location`. */
function scaleForSafeLocation(canvas: number, base: number, target: number): number {
  const t = Math.max(0, Math.min(target, 0.9));
  return (Math.max(0.0001, canvas) * (1 + t)) / (Math.max(0.0001, base) * (1 - t));
}

function axisFor(direction: PanDirection): "x" | "y" | "auto" {
  if (["pan_left", "pan_right", "left_to_right", "right_to_left"].includes(direction)) return "x";
  if (["pan_up", "pan_down", "top_to_bottom", "bottom_to_top"].includes(direction)) return "y";
  return "auto";
}

function autoDirection(pw: number, ph: number, sw: unknown, sh: unknown): PanDirection {
  const [bw, bh] = cropBaseSize(pw, ph, sw, sh);
  const x = safeLocation(pw, bw, 1);
  const y = safeLocation(ph, bh, 1);
  if (x > y + 0.03) return "left_to_right";
  if (y > x + 0.03) return "bottom_to_top";
  return "left_to_right";
}

/** Python `round(x, 6)` for the non-negative magnitudes used here. */
function round6(x: number): number {
  return Number(Math.max(0, x).toFixed(6));
}

function panEndpoints(direction: PanDirection, magnitude: number): [number, number] {
  const m = round6(magnitude);
  if (direction === "pan_left" || direction === "right_to_left") return [-m, m];
  if (direction === "pan_right" || direction === "left_to_right") return [m, -m];
  if (direction === "pan_up" || direction === "bottom_to_top") return [-m, m];
  if (direction === "pan_down" || direction === "top_to_bottom") return [m, -m];
  return [0, 0];
}

function result(axis: "x" | "y" | "auto", scale: [number, number], start: number, end: number): CameraKeyframes {
  return axis === "x"
    ? { scaleX: scale, scaleY: [...scale], locationX: [start, end], locationY: [0, 0] }
    : { scaleX: scale, scaleY: [...scale], locationX: [0, 0], locationY: [start, end] };
}

/** `camera_pan_keyframes`. */
export function cameraPanKeyframes(
  requested: PanDirection,
  projectWidth: unknown,
  projectHeight: unknown,
  sourceWidth: unknown,
  sourceHeight: unknown,
  targetPan = 0.18,
  edgeMargin = 0.995,
): CameraKeyframes {
  const pw = positive(projectWidth, 1920);
  const ph = positive(projectHeight, 1080);
  const direction = requested === "auto" ? autoDirection(pw, ph, sourceWidth, sourceHeight) : requested;
  const [bw, bh] = cropBaseSize(pw, ph, sourceWidth, sourceHeight);
  const axis = axisFor(direction);
  const canvas = axis === "x" ? pw : ph;
  const base = axis === "x" ? bw : bh;
  const natural = safeLocation(canvas, base, 1);
  let scale: number;
  let magnitude: number;
  if (natural >= targetPan) {
    scale = 1;
    magnitude = natural * edgeMargin;
  } else {
    scale = Math.max(1, scaleForSafeLocation(canvas, base, targetPan));
    magnitude = safeLocation(canvas, base, scale) * edgeMargin;
  }
  const [start, end] = panEndpoints(direction, magnitude);
  return result(axis, [scale, scale], start, end);
}

/** `push_pull_keyframes`: centered zoom. */
export function pushPullKeyframes(zoomIn: boolean, zoom = 1.2): CameraKeyframes {
  const scale: [number, number] = zoomIn ? [1, zoom] : [zoom, 1];
  return { scaleX: scale, scaleY: [...scale], locationX: [0, 0], locationY: [0, 0] };
}

/** `ken_burns_keyframes`: zoom plus a drift along the roomiest axis. */
export function kenBurnsKeyframes(
  zoomIn: boolean,
  requested: PanDirection,
  projectWidth: unknown,
  projectHeight: unknown,
  sourceWidth: unknown,
  sourceHeight: unknown,
  zoomFactor = 1.22,
  targetPan = 0.1,
  maxPan = 0.24,
): CameraKeyframes {
  const pw = positive(projectWidth, 1920);
  const ph = positive(projectHeight, 1080);
  const [bw, bh] = cropBaseSize(pw, ph, sourceWidth, sourceHeight);
  const direction = requested === "auto" ? autoDirection(pw, ph, sourceWidth, sourceHeight) : requested;
  const axis = axisFor(direction);
  const canvas = axis === "x" ? pw : ph;
  const base = axis === "x" ? bw : bh;
  const zoom = Math.max(zoomFactor, scaleForSafeLocation(canvas, base, targetPan));
  const [startScale, endScale] = zoomIn ? [1, zoom] : [zoom, 1];
  const startSafe = Math.min(safeLocation(canvas, base, startScale) * 0.82, maxPan);
  const endSafe = Math.min(safeLocation(canvas, base, endScale) * 0.82, maxPan);
  const startMagnitude = Math.max(startSafe, startSafe ? targetPan : 0);
  const endMagnitude = Math.max(endSafe, endSafe ? targetPan : 0);
  const start = panEndpoints(direction, Math.min(startMagnitude, maxPan))[0];
  const end = panEndpoints(direction, Math.min(endMagnitude, maxPan))[1];
  return result(axis, [startScale, endScale], start, end);
}

/** `source_dimensions_from_reader`. */
export function sourceDimensions(reader: unknown): [number | null, number | null] {
  if (typeof reader !== "object" || reader === null) return [null, null];
  const r = reader as Record<string, unknown>;
  const w = Number(r.width || r.display_width);
  const h = Number(r.height || r.display_height);
  return Number.isFinite(w) && Number.isFinite(h) ? [w, h] : [null, null];
}
