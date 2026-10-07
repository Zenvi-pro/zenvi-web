/**
 * Path stroking and flattening as Qt's raster engine does it, ported from
 * qtbase 5.15 src/gui/painting: `QStroker` (qstroker.cpp:400-786: sides,
 * joins, caps, `qt_curves_for_arc`), `QBezier` (qbezier.cpp: `split`,
 * `addToPolygon`, `shifted`, `bezierOnInterval`), `qt_find_ellipse_coords`
 * (qpainterpath.cpp) and the `QLineF` helpers they use (qline.cpp).
 *
 * The geometry is the same algorithm in double precision. The Qt build fuses
 * some of these double expressions (FMA); that is not reproduced, so an
 * outline vertex can differ from Qt's in the last bit, which only matters if
 * it lands within that of a 1/64 px rounding boundary (randomized comparisons
 * against Qt 5.15.19 found no differing pixel).
 */

export const MOVE_TO = 0;
export const LINE_TO = 1;
export const CURVE_TO = 2;
export const CURVE_DATA = 3;

/** A path as parallel element types and points (QPainterPath / QVectorPath). */
export interface Path {
  types: number[];
  pts: number[];
}

export function newPath(): Path {
  return { types: [], pts: [] };
}

function fuzzyCompare(p1: number, p2: number): boolean {
  return Math.abs(p1 - p2) * 1e12 <= Math.min(Math.abs(p1), Math.abs(p2));
}

function fuzzyIsNull(d: number): boolean {
  return Math.abs(d) <= 1e-12;
}

/** `QPointF == QPointF`. */
export function pointsEqual(x1: number, y1: number, x2: number, y2: number): boolean {
  const ex = x1 === 0 || x2 === 0 ? fuzzyIsNull(x1 - x2) : fuzzyCompare(x1, x2);
  const ey = y1 === 0 || y2 === 0 ? fuzzyIsNull(y1 - y2) : fuzzyCompare(y1, y2);
  return ex && ey;
}

/** `QPainterPath::moveTo` (an empty trailing moveTo is replaced). */
export function moveTo(path: Path, x: number, y: number): void {
  const n = path.types.length;
  if (n > 0 && path.types[n - 1] === MOVE_TO) {
    path.pts[(n - 1) * 2] = x;
    path.pts[(n - 1) * 2 + 1] = y;
    return;
  }
  path.types.push(MOVE_TO);
  path.pts.push(x, y);
}

/** `QPainterPath::lineTo`: skips a point equal to the last one. */
export function lineTo(path: Path, x: number, y: number): void {
  const n = path.types.length;
  if (n > 0 && pointsEqual(x, y, path.pts[(n - 1) * 2]!, path.pts[(n - 1) * 2 + 1]!)) return;
  path.types.push(LINE_TO);
  path.pts.push(x, y);
}

/** `QPainterPath::cubicTo`: an empty curve (all points equal) is dropped. */
export function cubicTo(path: Path, c1x: number, c1y: number, c2x: number, c2y: number, ex: number, ey: number): void {
  const n = path.types.length;
  const lx = path.pts[(n - 1) * 2]!;
  const ly = path.pts[(n - 1) * 2 + 1]!;
  if (pointsEqual(lx, ly, c1x, c1y) && pointsEqual(c1x, c1y, c2x, c2y) && pointsEqual(c2x, c2y, ex, ey)) return;
  path.types.push(CURVE_TO, CURVE_DATA, CURVE_DATA);
  path.pts.push(c1x, c1y, c2x, c2y, ex, ey);
}

// ---------------------------------------------------------------------------
// QLineF
// ---------------------------------------------------------------------------

interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function line(x1: number, y1: number, x2: number, y2: number): Line {
  return { x1, y1, x2, y2 };
}

function lineLength(l: Line): number {
  return Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
}

function lineIsNull(l: Line): boolean {
  return fuzzyCompare(l.x1, l.x2) && fuzzyCompare(l.y1, l.y2);
}

function lineAngle(l: Line): number {
  const dx = l.x2 - l.x1;
  const dy = l.y2 - l.y1;
  const theta = (Math.atan2(-dy, dx) * 360) / (2 * Math.PI);
  const normalized = theta < 0 ? theta + 360 : theta;
  return fuzzyCompare(normalized, 360) ? 0 : normalized;
}

/** `QLineF::angleTo`. */
function angleTo(a: Line, b: Line): number {
  if (lineIsNull(a) || lineIsNull(b)) return 0;
  const delta = lineAngle(b) - lineAngle(a);
  const normalized = delta < 0 ? delta + 360 : delta;
  return fuzzyCompare(delta, 360) ? 0 : normalized;
}

function setLength(l: Line, len: number): Line {
  const old = lineLength(l);
  if (!(old > 0)) return l;
  return { x1: l.x1, y1: l.y1, x2: l.x1 + len * ((l.x2 - l.x1) / old), y2: l.y1 + len * ((l.y2 - l.y1) / old) };
}

function translated(l: Line, dx: number, dy: number): Line {
  return { x1: l.x1 + dx, y1: l.y1 + dy, x2: l.x2 + dx, y2: l.y2 + dy };
}

function normalVector(l: Line): Line {
  return { x1: l.x1, y1: l.y1, x2: l.x1 + (l.y2 - l.y1), y2: l.y1 - (l.x2 - l.x1) };
}

function unitVector(l: Line): Line {
  const x = l.x2 - l.x1;
  const y = l.y2 - l.y1;
  const len = Math.hypot(x, y);
  return { x1: l.x1, y1: l.y1, x2: l.x1 + x / len, y2: l.y1 + y / len };
}

const NO_INTERSECTION = 0;
const BOUNDED = 1;
const UNBOUNDED = 2;

/** `QLineF::intersects` (Graphics Gems III). */
function intersects(a: Line, b: Line): { type: number; x: number; y: number } {
  const ax = a.x2 - a.x1;
  const ay = a.y2 - a.y1;
  const bx = b.x1 - b.x2;
  const by = b.y1 - b.y2;
  const cx = a.x1 - b.x1;
  const cy = a.y1 - b.y1;
  const denominator = ay * bx - ax * by;
  if (denominator === 0 || !Number.isFinite(denominator)) return { type: NO_INTERSECTION, x: 0, y: 0 };
  const reciprocal = 1 / denominator;
  const na = (by * cx - bx * cy) * reciprocal;
  const x = a.x1 + ax * na;
  const y = a.y1 + ay * na;
  if (na < 0 || na > 1) return { type: UNBOUNDED, x, y };
  const nb = (ax * cy - ay * cx) * reciprocal;
  if (nb < 0 || nb > 1) return { type: UNBOUNDED, x, y };
  return { type: BOUNDED, x, y };
}

// ---------------------------------------------------------------------------
// QBezier
// ---------------------------------------------------------------------------

/** Cubic Bézier control points [x1, y1, x2, y2, x3, y3, x4, y4]. */
type Bezier = [number, number, number, number, number, number, number, number];

function splitBezier(b: Bezier): [Bezier, Bezier] {
  const m12x = (b[0] + b[2]) * 0.5;
  const m12y = (b[1] + b[3]) * 0.5;
  const m23x = (b[2] + b[4]) * 0.5;
  const m23y = (b[3] + b[5]) * 0.5;
  const m34x = (b[4] + b[6]) * 0.5;
  const m34y = (b[5] + b[7]) * 0.5;
  const m123x = (m12x + m23x) * 0.5;
  const m123y = (m12y + m23y) * 0.5;
  const m234x = (m23x + m34x) * 0.5;
  const m234y = (m23y + m34y) * 0.5;
  const mx = (m123x + m234x) * 0.5;
  const my = (m123y + m234y) * 0.5;
  return [
    [b[0], b[1], m12x, m12y, m123x, m123y, mx, my],
    [mx, my, m234x, m234y, m34x, m34y, b[6], b[7]],
  ];
}

/** `QBezier::addToPolygon` (qbezier.cpp:101-136): appends flattened end points (not the start). */
export function flattenBezier(start: Bezier, threshold: number, out: number[]): void {
  const stack: Bezier[] = [start];
  const levels: number[] = [9];
  while (stack.length > 0) {
    const top = stack.length - 1;
    const b = stack[top]!;
    const y4y1 = b[7] - b[1];
    const x4x1 = b[6] - b[0];
    let l = Math.abs(x4x1) + Math.abs(y4y1);
    let d: number;
    if (l > 1) {
      d = Math.abs(x4x1 * (b[1] - b[3]) - y4y1 * (b[0] - b[2])) + Math.abs(x4x1 * (b[1] - b[5]) - y4y1 * (b[0] - b[4]));
    } else {
      d = Math.abs(b[0] - b[2]) + Math.abs(b[1] - b[3]) + Math.abs(b[0] - b[4]) + Math.abs(b[1] - b[5]);
      l = 1;
    }
    if (d < threshold * l || levels[top] === 0) {
      out.push(b[6], b[7]);
      stack.pop();
      levels.pop();
    } else {
      const [first, second] = splitBezier(b);
      const level = levels[top]! - 1;
      stack[top] = second;
      levels[top] = level;
      stack.push(first);
      levels.push(level);
    }
  }
}

function pointAt(b: Bezier, t: number): [number, number] {
  const mt = 1 - t;
  let a = b[0] * mt + b[2] * t;
  let bb = b[2] * mt + b[4] * t;
  const c = b[4] * mt + b[6] * t;
  a = a * mt + bb * t;
  bb = bb * mt + c * t;
  const x = a * mt + bb * t;
  let ay = b[1] * mt + b[3] * t;
  let by = b[3] * mt + b[5] * t;
  const cy = b[5] * mt + b[7] * t;
  ay = ay * mt + by * t;
  by = by * mt + cy * t;
  return [x, ay * mt + by * t];
}

function bezierNormal(b: Bezier, t: number): [number, number] {
  const mt = 1 - t;
  const a = mt * mt;
  const bb = t * mt;
  const c = t * t;
  return [(b[3] - b[1]) * a + (b[5] - b[3]) * bb + (b[7] - b[5]) * c, -(b[2] - b[0]) * a - (b[4] - b[2]) * bb - (b[6] - b[4]) * c];
}

/** `QBezier::parameterSplitLeft`: returns [left, right]. */
function parameterSplitLeft(src: Bezier, t: number): [Bezier, Bezier] {
  const b = [...src] as Bezier;
  const left = [0, 0, 0, 0, 0, 0, 0, 0] as Bezier;
  left[0] = b[0];
  left[1] = b[1];
  left[2] = b[0] + t * (b[2] - b[0]);
  left[3] = b[1] + t * (b[3] - b[1]);
  left[4] = b[2] + t * (b[4] - b[2]);
  left[5] = b[3] + t * (b[5] - b[3]);
  b[4] = b[4] + t * (b[6] - b[4]);
  b[5] = b[5] + t * (b[7] - b[5]);
  b[2] = left[4] + t * (b[4] - left[4]);
  b[3] = left[5] + t * (b[5] - left[5]);
  left[4] = left[2] + t * (left[4] - left[2]);
  left[5] = left[3] + t * (left[5] - left[3]);
  left[6] = b[0] = left[4] + t * (b[2] - left[4]);
  left[7] = b[1] = left[5] + t * (b[3] - left[5]);
  return [left, b];
}

function bezierOnInterval(b: Bezier, t0: number, t1: number): Bezier {
  if (t0 === 0 && t1 === 1) return b;
  const [, right] = parameterSplitLeft(b, t0);
  const trueT = (t1 - t0) / (1 - t0);
  return parameterSplitLeft(right, trueT)[0];
}

function bounds(b: Bezier): { x: number; y: number; w: number; h: number } {
  let xmin = b[0];
  let xmax = b[0];
  let ymin = b[1];
  let ymax = b[1];
  for (let i = 2; i < 8; i += 2) {
    if (b[i]! < xmin) xmin = b[i]!;
    else if (b[i]! > xmax) xmax = b[i]!;
    if (b[i + 1]! < ymin) ymin = b[i + 1]!;
    else if (b[i + 1]! > ymax) ymax = b[i + 1]!;
  }
  return { x: xmin, y: ymin, w: xmax - xmin, h: ymax - ymin };
}

const SHIFT_OK = 0;
const SHIFT_DISCARD = 1;
const SHIFT_SPLIT = 2;
const SHIFT_CIRCLE = 3;

function goodOffset(b1: Bezier, b2: Bezier, offset: number, threshold: number): number {
  const o2 = offset * offset;
  const maxDistLine = threshold * offset * offset;
  const maxDistNormal = threshold * offset;
  for (let i = 0.25; i < 0.99; i += 0.25) {
    const [p1x, p1y] = pointAt(b1, i);
    const [p2x, p2y] = pointAt(b2, i);
    let d = (p1x - p2x) * (p1x - p2x) + (p1y - p2y) * (p1y - p2y);
    if (Math.abs(d - o2) > maxDistLine) return SHIFT_SPLIT;
    const [nx, ny] = bezierNormal(b1, i);
    const l = Math.abs(nx) + Math.abs(ny);
    if (l !== 0) {
      d = Math.abs(nx * (p1y - p2y) - ny * (p1x - p2x)) / l;
      if (d > maxDistNormal) return SHIFT_SPLIT;
    }
  }
  return SHIFT_OK;
}

function shiftBezier(orig: Bezier, offset: number, threshold: number): { result: number; curve: Bezier } {
  const map = [0, 0, 0, 0];
  const p12 = fuzzyCompare(orig[0], orig[2]) && fuzzyCompare(orig[1], orig[3]);
  const p23 = fuzzyCompare(orig[2], orig[4]) && fuzzyCompare(orig[3], orig[5]);
  const p34 = fuzzyCompare(orig[4], orig[6]) && fuzzyCompare(orig[5], orig[7]);
  const px: number[] = [orig[0]];
  const py: number[] = [orig[1]];
  map[0] = 0;
  if (!p12) {
    px.push(orig[2]);
    py.push(orig[3]);
  }
  map[1] = px.length - 1;
  if (!p23) {
    px.push(orig[4]);
    py.push(orig[5]);
  }
  map[2] = px.length - 1;
  if (!p34) {
    px.push(orig[6]);
    py.push(orig[7]);
  }
  map[3] = px.length - 1;
  const np = px.length;
  const empty = [0, 0, 0, 0, 0, 0, 0, 0] as Bezier;
  if (np === 1) return { result: SHIFT_DISCARD, curve: empty };
  const bb = bounds(orig);
  if (np === 4 && bb.w < 0.1 * offset && bb.h < 0.1 * offset) {
    const l =
      (orig[0] - orig[2]) * (orig[0] - orig[2]) +
      (orig[1] - orig[3]) * (orig[1] - orig[3]) * (orig[4] - orig[6]) * (orig[4] - orig[6]) +
      (orig[5] - orig[7]) * (orig[5] - orig[7]);
    const dot = (orig[0] - orig[2]) * (orig[4] - orig[6]) + (orig[1] - orig[3]) * (orig[5] - orig[7]);
    if (dot < 0 && dot * dot < 0.8 * l) return { result: SHIFT_CIRCLE, curve: empty };
  }
  const sx: number[] = new Array<number>(np).fill(0);
  const sy: number[] = new Array<number>(np).fill(0);
  let prev = line(0, 0, px[1]! - px[0]!, py[1]! - py[0]!);
  if (!lineLength(prev)) return { result: SHIFT_DISCARD, curve: empty };
  let prevNormal = unitVector(normalVector(prev));
  let pnx = prevNormal.x2;
  let pny = prevNormal.y2;
  sx[0] = px[0]! + offset * pnx;
  sy[0] = py[0]! + offset * pny;
  for (let i = 1; i < np - 1; i += 1) {
    const next = line(0, 0, px[i + 1]! - px[i]!, py[i + 1]! - py[i]!);
    const nextNormal = unitVector(normalVector(next));
    const nnx = nextNormal.x2;
    const nny = nextNormal.y2;
    const r = 1 + pnx * nnx + pny * nny;
    if (fuzzyIsNull(r)) {
      sx[i] = px[i]! + offset * pnx;
      sy[i] = py[i]! + offset * pny;
    } else {
      const k = offset / r;
      sx[i] = px[i]! + k * (pnx + nnx);
      sy[i] = py[i]! + k * (pny + nny);
    }
    pnx = nnx;
    pny = nny;
    prev = next;
    prevNormal = nextNormal;
  }
  sx[np - 1] = px[np - 1]! + offset * pnx;
  sy[np - 1] = py[np - 1]! + offset * pny;
  const curve: Bezier = [sx[map[0]!]!, sy[map[0]!]!, sx[map[1]!]!, sy[map[1]!]!, sx[map[2]!]!, sy[map[2]!]!, sx[map[3]!]!, sy[map[3]!]!];
  if (np > 2) return { result: goodOffset(orig, curve, offset, threshold), curve };
  return { result: SHIFT_OK, curve };
}

const KAPPA = 0.5522847498;

function addCircle(b: Bezier, offset: number): Bezier[] | null {
  const normals: [number, number][] = [
    [b[3] - b[1], b[0] - b[2]],
    [0, 0],
    [b[7] - b[5], b[4] - b[6]],
  ];
  let dist = Math.sqrt(normals[0]![0] * normals[0]![0] + normals[0]![1] * normals[0]![1]);
  if (fuzzyIsNull(dist)) return null;
  normals[0] = [normals[0]![0] / dist, normals[0]![1] / dist];
  dist = Math.sqrt(normals[2]![0] * normals[2]![0] + normals[2]![1] * normals[2]![1]);
  if (fuzzyIsNull(dist)) return null;
  normals[2] = [normals[2]![0] / dist, normals[2]![1] / dist];
  const n1x = b[0] - b[2] - b[4] + b[6];
  const n1y = b[1] - b[3] - b[5] + b[7];
  const n1len = -1 * Math.sqrt(n1x * n1x + n1y * n1y);
  normals[1] = [n1x / n1len, n1y / n1len];
  const angles = [0, 0];
  let sign = 1;
  for (let i = 0; i < 2; i += 1) {
    let cosA = normals[i]![0] * normals[i + 1]![0] + normals[i]![1] * normals[i + 1]![1];
    if (cosA > 1) cosA = 1;
    if (cosA < -1) cosA = -1;
    angles[i] = Math.acos(cosA) / Math.PI;
  }
  if (angles[0]! + angles[1]! > 1) {
    normals[1] = [-normals[1]![0], -normals[1]![1]];
    angles[0] = 1 - angles[0]!;
    angles[1] = 1 - angles[1]!;
    sign = -1;
  }
  const circle: [number, number][] = [
    [b[0] + normals[0]![0] * offset, b[1] + normals[0]![1] * offset],
    [0.5 * (b[0] + b[6]) + normals[1]![0] * offset, 0.5 * (b[1] + b[7]) + normals[1]![1] * offset],
    [b[6] + normals[2]![0] * offset, b[7] + normals[2]![1] * offset],
  ];
  const out: Bezier[] = [];
  for (let i = 0; i < 2; i += 1) {
    const kappa = 2 * KAPPA * sign * offset * angles[i]!;
    out.push([
      circle[i]![0],
      circle[i]![1],
      circle[i]![0] - normals[i]![1] * kappa,
      circle[i]![1] + normals[i]![0] * kappa,
      circle[i + 1]![0] + normals[i + 1]![1] * kappa,
      circle[i + 1]![1] - normals[i + 1]![0] * kappa,
      circle[i + 1]![0],
      circle[i + 1]![1],
    ]);
  }
  return out;
}

/** `QBezier::shifted` (qbezier.cpp:446-512): the curve offset by `offset`, as up to `maxSegments` curves. */
function shiftedBeziers(b: Bezier, maxSegments: number, offset: number, thresholdIn: number): Bezier[] {
  if (fuzzyCompare(b[0], b[2]) && fuzzyCompare(b[0], b[4]) && fuzzyCompare(b[0], b[6]) && fuzzyCompare(b[1], b[3]) && fuzzyCompare(b[1], b[5]) && fuzzyCompare(b[1], b[7])) {
    return [];
  }
  const max = maxSegments - 1;
  let threshold = Math.fround(thresholdIn);
  for (;;) {
    const stack: Bezier[] = [b];
    const out: Bezier[] = [];
    let redo = false;
    let giveUp = false;
    while (stack.length > 0) {
      const stackSegments = stack.length;
      if (stackSegments === 10 || out.length === max - stackSegments) {
        threshold = Math.fround(threshold * 1.5);
        if (threshold > 2) giveUp = true;
        else redo = true;
        break;
      }
      const top = stack[stack.length - 1]!;
      const res = shiftBezier(top, offset, threshold);
      if (res.result === SHIFT_DISCARD) stack.pop();
      else if (res.result === SHIFT_OK) {
        out.push(res.curve);
        stack.pop();
      } else if (res.result === SHIFT_CIRCLE && max - out.length >= 2) {
        const circle = addCircle(top, offset);
        if (circle) out.push(...circle);
        stack.pop();
      } else {
        const [first, second] = splitBezier(top);
        stack[stack.length - 1] = second;
        stack.push(first);
      }
    }
    if (redo) continue;
    if (giveUp) {
      while (stack.length > 0) {
        const res = shiftBezier(stack[stack.length - 1]!, offset, threshold);
        if (res.result === SHIFT_OK || res.result === SHIFT_SPLIT) out.push(res.curve);
        stack.pop();
      }
    }
    return out;
  }
}

function startTangent(b: Bezier): Line {
  let t = line(b[0], b[1], b[2], b[3]);
  if (lineIsNull(t)) t = line(b[0], b[1], b[4], b[5]);
  if (lineIsNull(t)) t = line(b[0], b[1], b[6], b[7]);
  return t;
}

// ---------------------------------------------------------------------------
// Arcs (qstroker.cpp:822-990, qpainterpath.cpp qt_find_ellipse_coords)
// ---------------------------------------------------------------------------

/** `qt_t_for_arc_angle`: the cubic arc parameter for an angle in [0, 90] (two Newton steps each way). */
function tForArc(angle: number): number {
  if (fuzzyIsNull(angle)) return 0;
  if (fuzzyCompare(angle, 90)) return 1;
  const radians = angle * (Math.PI / 180);
  const cosAngle = Math.cos(radians);
  const sinAngle = Math.sin(radians);
  const K = KAPPA;
  let tc = angle / 90;
  tc -= ((((2 - 3 * K) * tc + 3 * (K - 1)) * tc) * tc + 1 - cosAngle) / (((6 - 9 * K) * tc + 6 * (K - 1)) * tc);
  tc -= ((((2 - 3 * K) * tc + 3 * (K - 1)) * tc) * tc + 1 - cosAngle) / (((6 - 9 * K) * tc + 6 * (K - 1)) * tc);
  let ts = tc;
  ts -= ((((3 * K - 2) * ts - 6 * K + 3) * ts + 3 * K) * ts - sinAngle) / (((9 * K - 6) * ts + 12 * K - 6) * ts + 3 * K);
  ts -= ((((3 * K - 2) * ts - 6 * K + 3) * ts + 3 * K) * ts - sinAngle) / (((9 * K - 6) * ts + 12 * K - 6) * ts + 3 * K);
  return 0.5 * (tc + ts);
}

function ellipseCoords(rx: number, ry: number, rw: number, rh: number, angle: number, length: number): [number, number, number, number] {
  if (rw === 0 && rh === 0) return [0, 0, 0, 0];
  const w2 = rw / 2;
  const h2 = rh / 2;
  const out: number[] = [];
  for (const a of [angle, angle + length]) {
    const theta = a - 360 * Math.floor(a / 360);
    let t = theta / 90;
    const quadrant = Math.trunc(t);
    t -= quadrant;
    t = tForArc(90 * t);
    if (quadrant & 1) t = 1 - t;
    const mt = 1 - t;
    let bb = mt * mt;
    let c = t * t;
    const d = c * t;
    const aa = bb * mt;
    bb *= 3 * t;
    c *= 3 * mt;
    let px = aa + bb + c * KAPPA;
    let py = d + c + bb * KAPPA;
    if (quadrant === 1 || quadrant === 2) px = -px;
    if (quadrant === 0 || quadrant === 1) py = -py;
    out.push(rx + rw / 2 + w2 * px, ry + rh / 2 + h2 * py);
  }
  return [out[0]!, out[1]!, out[2]!, out[3]!];
}

/**
 * `qt_curves_for_arc(rect, startAngle, sweepLength)`: the start point and
 * the cubic control points (3 per segment) approximating the arc.
 */
export function curvesForArc(x: number, y: number, w: number, h: number, startAngle: number, sweepIn: number): { sx: number; sy: number; curves: number[] } {
  if (w === 0 && h === 0) return { sx: 0, sy: 0, curves: [] };
  const w2 = w / 2;
  const w2k = w2 * KAPPA;
  const h2 = h / 2;
  const h2k = h2 * KAPPA;
  const P = [
    x + w, y + h2,
    x + w, y + h2 + h2k, x + w2 + w2k, y + h, x + w2, y + h,
    x + w2 - w2k, y + h, x, y + h2 + h2k, x, y + h2,
    x, y + h2 - h2k, x + w2 - w2k, y, x + w2, y,
    x + w2 + w2k, y, x + w, y + h2 - h2k, x + w, y + h2,
  ];
  const px = (i: number): number => P[i * 2]!;
  const py = (i: number): number => P[i * 2 + 1]!;
  let sweep = sweepIn;
  if (sweep > 360) sweep = 360;
  else if (sweep < -360) sweep = -360;
  const curves: number[] = [];
  if (startAngle === 0) {
    if (sweep === 360) {
      for (let i = 11; i >= 0; i -= 1) curves.push(px(i), py(i));
      return { sx: px(12), sy: py(12), curves };
    }
    if (sweep === -360) {
      for (let i = 1; i <= 12; i += 1) curves.push(px(i), py(i));
      return { sx: px(0), sy: py(0), curves };
    }
  }
  let startSegment = Math.floor(startAngle / 90);
  let endSegment = Math.floor((startAngle + sweep) / 90);
  let startT = (startAngle - startSegment * 90) / 90;
  let endT = (startAngle + sweep - endSegment * 90) / 90;
  const delta = sweep > 0 ? 1 : -1;
  if (delta < 0) {
    startT = 1 - startT;
    endT = 1 - endT;
  }
  if (fuzzyIsNull(startT - 1)) {
    startT = 0;
    startSegment += delta;
  }
  if (fuzzyIsNull(endT)) {
    endT = 1;
    endSegment -= delta;
  }
  startT = tForArc(startT * 90);
  endT = tForArc(endT * 90);
  const splitAtStart = !fuzzyIsNull(startT);
  const splitAtEnd = !fuzzyIsNull(endT - 1);
  const end = endSegment + delta;
  if (startSegment === end) {
    const quadrant = 3 - (((startSegment % 4) + 4) % 4);
    const j = 3 * quadrant;
    return delta > 0 ? { sx: px(j + 3), sy: py(j + 3), curves } : { sx: px(j), sy: py(j), curves };
  }
  const [spx, spy, epx, epy] = ellipseCoords(x, y, w, h, startAngle, sweep);
  for (let i = startSegment; i !== end; i += delta) {
    const quadrant = 3 - (((i % 4) + 4) % 4);
    const j = 3 * quadrant;
    let b: Bezier =
      delta > 0
        ? [px(j + 3), py(j + 3), px(j + 2), py(j + 2), px(j + 1), py(j + 1), px(j), py(j)]
        : [px(j), py(j), px(j + 1), py(j + 1), px(j + 2), py(j + 2), px(j + 3), py(j + 3)];
    if (startSegment === endSegment && fuzzyCompare(startT, endT)) return { sx: spx, sy: spy, curves };
    if (i === startSegment) {
      if (i === endSegment && splitAtEnd) b = bezierOnInterval(b, startT, endT);
      else if (splitAtStart) b = bezierOnInterval(b, startT, 1);
    } else if (i === endSegment && splitAtEnd) b = bezierOnInterval(b, 0, endT);
    curves.push(b[2], b[3], b[4], b[5], b[6], b[7]);
  }
  curves[curves.length - 2] = epx;
  curves[curves.length - 1] = epy;
  return { sx: spx, sy: spy, curves };
}

// ---------------------------------------------------------------------------
// QStroker
// ---------------------------------------------------------------------------

export type Cap = "flat" | "square" | "round";
export type Join = "bevel" | "round";

const FLAT_JOIN = 0;
const SQUARE_JOIN = 1;
const ROUND_JOIN = 3;
const ROUND_CAP = 4;

interface El {
  type: number;
  x: number;
  y: number;
}

class Stroker {
  readonly out = newPath();
  private back1x = 0;
  private back1y = 0;
  private back2x = 0;
  private back2y = 0;
  readonly width: number;
  readonly capMode: number;
  readonly joinMode: number;
  readonly curveThreshold: number;

  constructor(
    width: number,
    cap: Cap,
    join: Join,
    readonly forceOpen: boolean,
  ) {
    this.width = width === 0 ? 1 : width;
    this.capMode = cap === "flat" ? FLAT_JOIN : cap === "square" ? SQUARE_JOIN : ROUND_CAP;
    this.joinMode = join === "bevel" ? FLAT_JOIN : ROUND_JOIN;
    this.curveThreshold = Math.min(0.25, Math.max(0.00025, 1 / this.width));
  }

  emitMoveTo(x: number, y: number): void {
    this.back2x = this.back1x;
    this.back2y = this.back1y;
    this.back1x = x;
    this.back1y = y;
    this.out.types.push(MOVE_TO);
    this.out.pts.push(x, y);
  }

  emitLineTo(x: number, y: number): void {
    this.back2x = this.back1x;
    this.back2y = this.back1y;
    this.back1x = x;
    this.back1y = y;
    this.out.types.push(LINE_TO);
    this.out.pts.push(x, y);
  }

  emitCubicTo(c1x: number, c1y: number, c2x: number, c2y: number, ex: number, ey: number): void {
    if (c2x === ex && c2y === ey) {
      if (c1x === ex && c1y === ey) {
        this.back2x = this.back1x;
        this.back2y = this.back1y;
      } else {
        this.back2x = c1x;
        this.back2y = c1y;
      }
    } else {
      this.back2x = c2x;
      this.back2y = c2y;
    }
    this.back1x = ex;
    this.back1y = ey;
    this.out.types.push(CURVE_TO, CURVE_DATA, CURVE_DATA);
    this.out.pts.push(c1x, c1y, c2x, c2y, ex, ey);
  }

  joinPoints(fx: number, fy: number, next: Line, join: number): void {
    if (fuzzyCompare(this.back1x, next.x1) && fuzzyCompare(this.back1y, next.y1)) return;
    const prev = line(this.back2x, this.back2y, this.back1x, this.back1y);
    const isect = intersects(prev, next);
    const offset = this.width / 2;
    if (join === FLAT_JOIN) {
      const angle = angleTo(line(prev.x2, prev.y2, next.x1, next.y1), prev);
      if (isect.type === BOUNDED || (angle > 90 && !fuzzyCompare(angle, 90))) {
        this.emitLineTo(fx, fy);
        this.emitLineTo(next.x1, next.y1);
        return;
      }
      this.emitLineTo(next.x1, next.y1);
    } else if (join === SQUARE_JOIN) {
      let l1 = prev;
      const dp = (prev.x2 - prev.x1) * (next.x2 - next.x1) + (prev.y2 - prev.y1) * (next.y2 - next.y1);
      if (dp > 0) l1 = line(prev.x2, prev.y2, prev.x1, prev.y1);
      else l1 = translated(l1, l1.x2 - l1.x1, l1.y2 - l1.y1);
      l1 = setLength(l1, offset);
      let l2 = line(next.x2, next.y2, next.x1, next.y1);
      l2 = translated(l2, l2.x2 - l2.x1, l2.y2 - l2.y1);
      l2 = setLength(l2, offset);
      this.emitLineTo(l1.x2, l1.y2);
      this.emitLineTo(l2.x2, l2.y2);
      this.emitLineTo(l2.x1, l2.y1);
    } else if (join === ROUND_JOIN) {
      const angle = angleTo(line(prev.x2, prev.y2, next.x1, next.y1), prev);
      if ((isect.type === BOUNDED || angle > 90.01) && lineLength(next) > offset) {
        this.emitLineTo(fx, fy);
        this.emitLineTo(next.x1, next.y1);
        return;
      }
      const axis = line(0, 0, 1, 0);
      const l1OnX = angleTo(axis, prev);
      const l2OnX = angleTo(axis, next);
      const sweep = Math.abs(l2OnX - l1OnX);
      const arc = curvesForArc(fx - offset, fy - offset, offset * 2, offset * 2, l1OnX + 90, -sweep);
      for (let i = 0; i < arc.curves.length; i += 6) {
        const c = arc.curves;
        this.emitCubicTo(c[i]!, c[i + 1]!, c[i + 2]!, c[i + 3]!, c[i + 4]!, c[i + 5]!);
      }
      this.emitLineTo(next.x1, next.y1);
    } else {
      // RoundCap: two quarter arcs (qstroker.cpp:696-740).
      let l1 = prev;
      const dp = (prev.x2 - prev.x1) * (next.x2 - next.x1) + (prev.y2 - prev.y1) * (next.y2 - next.y1);
      if (dp > 0) l1 = line(prev.x2, prev.y2, prev.x1, prev.y1);
      else l1 = translated(l1, l1.x2 - l1.x1, l1.y2 - l1.y1);
      l1 = setLength(l1, KAPPA * offset);
      let l2 = line(fx, fy, prev.x2, prev.y2);
      l2 = translated(l2, -(l2.y2 - l2.y1), l2.x2 - l2.x1);
      l2 = setLength(l2, KAPPA * offset);
      this.emitCubicTo(l1.x2, l1.y2, l2.x2, l2.y2, l2.x1, l2.y1);
      l2 = line(l2.x1, l2.y1, l2.x1 - (l2.x2 - l2.x1), l2.y1 - (l2.y2 - l2.y1));
      l1 = translated(l1, next.x1 - l1.x1, next.y1 - l1.y1);
      this.emitCubicTo(l2.x2, l2.y2, l1.x2, l1.y2, l1.x1, l1.y1);
    }
  }

  /** `qt_stroke_side` (qstroker.cpp:752-871). Returns whether the side closed, and its start tangent. */
  strokeSide(els: readonly El[], capFirst: boolean): { closed: boolean; tangent: Line | null } {
    const first = els[0]!;
    const startX = first.x;
    const startY = first.y;
    let prevX = startX;
    let prevY = startY;
    let isFirst = true;
    let tangent: Line | null = null;
    const offset = this.width / 2;
    for (let i = 1; i < els.length; i += 1) {
      const e = els[i]!;
      if (e.type === LINE_TO) {
        let l = line(prevX, prevY, e.x, e.y);
        if (!pointsEqual(l.x1, l.y1, l.x2, l.y2)) {
          const normal = setLength(normalVector(l), offset);
          l = translated(l, normal.x2 - normal.x1, normal.y2 - normal.y1);
          if (isFirst) {
            if (capFirst) this.joinPoints(prevX, prevY, l, this.capMode);
            else this.emitMoveTo(l.x1, l.y1);
            tangent = l;
            isFirst = false;
          } else this.joinPoints(prevX, prevY, l, this.joinMode);
          this.emitLineTo(l.x2, l.y2);
          prevX = e.x;
          prevY = e.y;
        }
      } else if (e.type === CURVE_TO) {
        const cp2 = els[i + 1]!;
        const ep = els[i + 2]!;
        i += 2;
        const bezier: Bezier = [prevX, prevY, e.x, e.y, cp2.x, cp2.y, ep.x, ep.y];
        const offsets = shiftedBeziers(bezier, 16, offset, this.curveThreshold);
        if (offsets.length > 0) {
          const st = startTangent(bezier);
          const o0 = offsets[0]!;
          const t = translated(st, o0[0] - bezier[0], o0[1] - bezier[1]);
          if (isFirst) {
            if (capFirst) this.joinPoints(prevX, prevY, t, this.capMode);
            else this.emitMoveTo(o0[0], o0[1]);
            tangent = t;
            isFirst = false;
          } else this.joinPoints(prevX, prevY, t, this.joinMode);
          for (const c of offsets) this.emitCubicTo(c[2], c[3], c[4], c[5], c[6], c[7]);
        }
        prevX = ep.x;
        prevY = ep.y;
      }
    }
    const closedPath = fuzzyCompare(startX, prevX) && fuzzyCompare(startY, prevY);
    if (closedPath && !this.forceOpen) {
      if (!isFirst && tangent) this.joinPoints(prevX, prevY, tangent, this.joinMode);
      return { closed: true, tangent };
    }
    return { closed: false, tangent };
  }

  processSubpath(els: El[]): void {
    const forward = this.strokeSide(els, false);
    // QSubpathBackwardIterator: the elements reversed, the last one as MoveTo.
    const backward: El[] = [];
    for (let pos = els.length - 1; pos >= 0; pos -= 1) {
      const ce = els[pos]!;
      if (pos === els.length - 1) {
        backward.push({ type: MOVE_TO, x: ce.x, y: ce.y });
        continue;
      }
      const pe = els[pos + 1]!;
      let type = ce.type;
      if (pe.type === LINE_TO) type = LINE_TO;
      else if (pe.type === CURVE_DATA) type = ce.type === CURVE_TO ? CURVE_DATA : CURVE_TO;
      else if (pe.type === CURVE_TO) type = CURVE_DATA;
      backward.push({ type, x: ce.x, y: ce.y });
    }
    const back = this.strokeSide(backward, !forward.closed);
    if (!back.closed && forward.tangent && !lineIsNull(forward.tangent)) this.joinPoints(els[0]!.x, els[0]!.y, forward.tangent, this.capMode);
  }
}

/** Stroke parameters (QPen without dashes). */
export interface StrokeStyle {
  width: number;
  cap: Cap;
  join: Join;
}

/**
 * `QPaintEngineEx::stroke` for a non-cosmetic solid pen: the outline path
 * QStroker builds (fill it with the winding rule). `forceOpen` is
 * `QVectorPath::hasExplicitOpen` (polylines).
 */
export function strokePath(path: Path, style: StrokeStyle, forceOpen: boolean): Path {
  const stroker = new Stroker(style.width, style.cap, style.join, forceOpen);
  let els: El[] = [];
  const flush = (): void => {
    if (els.length > 1) stroker.processSubpath(els);
    els = [];
  };
  for (let i = 0; i < path.types.length; i += 1) {
    const type = path.types[i]!;
    const x = path.pts[i * 2]!;
    const y = path.pts[i * 2 + 1]!;
    if (type === MOVE_TO) {
      flush();
      els.push({ type: MOVE_TO, x, y });
    } else els.push({ type, x, y });
  }
  flush();
  return stroker.out;
}

// ---------------------------------------------------------------------------
// QOutlineMapper: path → flattened, implicitly closed contours
// ---------------------------------------------------------------------------

/** Device clip used by `QOutlineMapper::curveTo` (the paint device rect). */
export interface DeviceRect {
  width: number;
  height: number;
}

/**
 * `QOutlineMapper::convertPath` with an identity transform: curves are
 * flattened (`addToPolygon`, threshold 0.25) unless they lie entirely
 * outside the device (then a line to the end point), each subpath is closed
 * back to its start, a trailing MoveTo is dropped. Returns float contours.
 */
export function flattenPath(path: Path, device: DeviceRect): number[][] {
  const contours: number[][] = [];
  let current: number[] | null = null;
  const close = (): void => {
    if (current && current.length >= 2) {
      const n = current.length;
      if (!pointsEqual(current[n - 2]!, current[n - 1]!, current[0]!, current[1]!)) current.push(current[0]!, current[1]!);
      contours.push(current);
    }
    current = null;
  };
  const inside = (x: number, y: number): boolean => x >= 0 && x <= device.width && y >= 0 && y <= device.height;
  const count = path.types.length;
  for (let i = 0; i < count; i += 1) {
    const type = path.types[i]!;
    const x = path.pts[i * 2]!;
    const y = path.pts[i * 2 + 1]!;
    if (type === MOVE_TO) {
      if (i === count - 1) continue;
      close();
      current = [x, y];
    } else if (type === LINE_TO) {
      current ??= [x, y];
      current.push(x, y);
    } else if (type === CURVE_TO) {
      current ??= [0, 0];
      const n = current.length;
      const b: Bezier = [current[n - 2]!, current[n - 1]!, x, y, path.pts[(i + 1) * 2]!, path.pts[(i + 1) * 2 + 1]!, path.pts[(i + 2) * 2]!, path.pts[(i + 2) * 2 + 1]!];
      i += 2;
      let outside = false;
      if (!inside(b[6], b[7])) {
        // QRectF(bounds).intersects(deviceRect): null rects never intersect.
        const r = bounds(b);
        const r1 = r.x + r.w;
        const b1 = r.y + r.h;
        outside = r.x === r1 || r.y === b1 || r.x >= device.width || 0 >= r1 || r.y >= device.height || 0 >= b1;
      }
      if (outside) current.push(b[6], b[7]);
      else flattenBezier(b, 0.25, current);
    }
  }
  close();
  return contours;
}
