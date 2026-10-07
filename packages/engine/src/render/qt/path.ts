/**
 * The parts of Qt 5.15's `QPainterPath` (qpainterpath.cpp, qstroker.cpp
 * `qt_curves_for_arc`) and `QOutlineMapper` (qoutlinemapper.cpp,
 * qoutlinemapper_p.h) the raster engine uses for libopenshot's rounded-corner
 * clip and antialiased image edges: the exact path elements, curve
 * flattening in user space (`QBezier::addToPolygon`, qbezier.cpp:139-173)
 * and the mapping to device space.
 */

import { fma } from "./fma.js";
import { fuzzyCompare, TxScale, TxTranslate, type QTransform } from "./transform.js";

export const MoveTo = 0;
export const LineTo = 1;
export const CurveTo = 2;
export const CurveToData = 3;

export interface PathElement {
  type: number;
  x: number;
  y: number;
}

/** QT_PATH_KAPPA (qstroker_p.h). */
const KAPPA = 0.5522847498;

interface RectF {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * `qt_find_ellipse_coords` for an angle that is a multiple of 90°
 * (qpainterpath.cpp:113-160; `qt_t_for_arc_angle` is exact there).
 */
function ellipsePoint(r: RectF, angle: number): [number, number] {
  const w2 = r.w / 2;
  const h2 = r.h / 2;
  const theta = angle - 360 * Math.floor(angle / 360);
  const quadrant = Math.trunc(theta / 90);
  if (theta / 90 - quadrant !== 0) throw new RangeError("ellipsePoint: angle must be a multiple of 90");
  const t = quadrant & 1 ? 1 : 0;
  // QBezier::coefficients(t) at t = 0 or 1, then p = (a + b + c·K, d + c + b·K).
  let px = t === 0 ? 1 : 0;
  let py = t === 0 ? 0 : 1;
  if (quadrant === 1 || quadrant === 2) px = -px;
  if (quadrant === 0 || quadrant === 1) py = -py;
  // r.center() + QPointF(w2 * p.x, h2 * p.y).
  return [r.x + r.w / 2 + w2 * px, r.y + r.h / 2 + h2 * py];
}

export class PainterPath {
  /** A new QPainterPathData starts with MoveTo(0, 0). */
  readonly elements: PathElement[] = [{ type: MoveTo, x: 0, y: 0 }];
  private cStart = 0;
  private requireMoveTo = false;

  private last(): PathElement {
    return this.elements[this.elements.length - 1]!;
  }

  private maybeMoveTo(): void {
    if (this.requireMoveTo) {
      const e = this.last();
      this.elements.push({ type: MoveTo, x: e.x, y: e.y });
      this.requireMoveTo = false;
    }
  }

  isEmpty(): boolean {
    return this.elements.length === 1 && this.elements[0]!.type === MoveTo;
  }

  moveTo(x: number, y: number): void {
    this.requireMoveTo = false;
    const last = this.last();
    if (last.type === MoveTo) {
      last.x = x;
      last.y = y;
    } else this.elements.push({ type: MoveTo, x, y });
    this.cStart = this.elements.length - 1;
  }

  lineTo(x: number, y: number): void {
    this.maybeMoveTo();
    const last = this.last();
    if (last.x === x && last.y === y) return;
    this.elements.push({ type: LineTo, x, y });
  }

  cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, ex: number, ey: number): void {
    const last = this.last();
    if (last.x === c1x && last.y === c1y && c1x === c2x && c1y === c2y && c2x === ex && c2y === ey) return;
    this.maybeMoveTo();
    this.elements.push({ type: CurveTo, x: c1x, y: c1y }, { type: CurveToData, x: c2x, y: c2y }, { type: CurveToData, x: ex, y: ey });
  }

  closeSubpath(): void {
    if (this.isEmpty()) return;
    this.requireMoveTo = true;
    const first = this.elements[this.cStart]!;
    const last = this.last();
    if (first.x !== last.x || first.y !== last.y) {
      if (fuzzyCompare(first.x, last.x) && fuzzyCompare(first.y, last.y)) {
        last.x = first.x;
        last.y = first.y;
      } else this.elements.push({ type: LineTo, x: first.x, y: first.y });
    }
  }

  /** `addRect(QRectF)`. */
  addRect(x: number, y: number, w: number, h: number): void {
    if (w === 0 && h === 0) return;
    this.moveTo(x, y);
    this.elements.push({ type: LineTo, x: x + w, y }, { type: LineTo, x: x + w, y: y + h }, { type: LineTo, x, y: y + h }, { type: LineTo, x, y });
    this.requireMoveTo = true;
  }

  /** `arcTo(rect, start, -90)` for a start angle that is a multiple of 90° (qt_curves_for_arc). */
  private quarterArc(r: RectF, start: number): void {
    const { x, y, w } = r;
    const w2 = r.w / 2;
    const w2k = w2 * KAPPA;
    const h = r.h;
    const h2 = r.h / 2;
    const h2k = h2 * KAPPA;
    const points: [number, number][] = [
      [x + w, y + h2],
      [x + w, y + h2 + h2k],
      [x + w2 + w2k, y + h],
      [x + w2, y + h],
      [x + w2 - w2k, y + h],
      [x, y + h2 + h2k],
      [x, y + h2],
      [x, y + h2 - h2k],
      [x + w2 - w2k, y],
      [x + w2, y],
      [x + w2 + w2k, y],
      [x + w, y + h2 - h2k],
      [x + w, y + h2],
    ];
    // Sweep -90 from a multiple of 90: one whole segment, no splitting.
    const segment = Math.floor(start / 90) - 1;
    const quadrant = 3 - (((segment % 4) + 4) % 4);
    const j = 3 * quadrant;
    const [sx, sy] = ellipsePoint(r, start);
    const [ex, ey] = ellipsePoint(r, start - 90);
    this.lineTo(sx, sy);
    this.cubicTo(points[j + 1]![0], points[j + 1]![1], points[j + 2]![0], points[j + 2]![1], ex, ey);
  }

  /** `addRoundedRect(QRectF(x, y, w, h), xr, yr, Qt::AbsoluteSize)` (qpainterpath.cpp:3214-3270). */
  addRoundedRect(x0: number, y0: number, w0: number, h0: number, xRadius: number, yRadius: number): void {
    const x = w0 < 0 ? x0 + w0 : x0;
    const y = h0 < 0 ? y0 + h0 : y0;
    const w = Math.abs(w0);
    const h = Math.abs(h0);
    if (w === 0 && h === 0) return;
    const hw = w / 2;
    const hh = h / 2;
    const xr = hw === 0 ? 0 : (100 * Math.min(xRadius, hw)) / hw;
    const yr = hh === 0 ? 0 : (100 * Math.min(yRadius, hh)) / hh;
    if (xr <= 0 || yr <= 0) {
      this.addRect(x, y, w, h);
      return;
    }
    const rxx2 = (w * xr) / 100;
    const ryy2 = (h * yr) / 100;
    const [mx, my] = ellipsePoint({ x, y, w: rxx2, h: ryy2 }, 180);
    if (!(rxx2 === 0 && ryy2 === 0)) this.moveTo(mx, my);
    this.quarterArc({ x, y, w: rxx2, h: ryy2 }, 180);
    this.quarterArc({ x: x + w - rxx2, y, w: rxx2, h: ryy2 }, 90);
    this.quarterArc({ x: x + w - rxx2, y: y + h - ryy2, w: rxx2, h: ryy2 }, 0);
    this.quarterArc({ x, y: y + h - ryy2, w: rxx2, h: ryy2 }, 270);
    this.closeSubpath();
    this.requireMoveTo = true;
  }
}

/** The scale `qt_scaleForTransform` reports (qtransform.cpp:2373-2412). */
export function transformScale(t: QTransform): number {
  const type = t.type();
  if (type <= TxTranslate) return 1;
  if (type === TxScale) return Math.max(Math.abs(t.m11), Math.abs(t.m22));
  const xScale1 = fma(t.m11, t.m11, t.m21 * t.m21);
  const yScale1 = fma(t.m12, t.m12, t.m22 * t.m22);
  const xScale2 = fma(t.m11, t.m11, t.m12 * t.m12);
  const yScale2 = fma(t.m21, t.m21, t.m22 * t.m22);
  if (Math.abs(xScale1 - yScale1) > Math.abs(xScale2 - yScale2)) return Math.sqrt(Math.max(xScale1, yScale1));
  return Math.sqrt(Math.max(xScale2, yScale2));
}

/** `QBezier::addToPolygon`: append the flattened curve's points after its start. */
function flatten(out: number[], b0: readonly number[], threshold: number): void {
  const stack: number[][] = [b0.slice()];
  const levels = [9];
  let top = 0;
  while (top >= 0) {
    const b = stack[top]!;
    const [x1, y1, x2, y2, x3, y3, x4, y4] = b as [number, number, number, number, number, number, number, number];
    const y4y1 = y4 - y1;
    const x4x1 = x4 - x1;
    let l = Math.abs(x4x1) + Math.abs(y4y1);
    let d: number;
    if (l > 1) {
      // clang fuses the left product of each difference.
      d = Math.abs(fma(x4x1, y1 - y2, -(y4y1 * (x1 - x2)))) + Math.abs(fma(x4x1, y1 - y3, -(y4y1 * (x1 - x3))));
    } else {
      d = Math.abs(x1 - x2) + Math.abs(y1 - y2) + Math.abs(x1 - x3) + Math.abs(y1 - y3);
      l = 1;
    }
    if (d < threshold * l || levels[top] === 0) {
      out.push(x4, y4);
      top -= 1;
    } else {
      // QBezier::split: first half on top of the stack, second half below.
      const m12x = (x1 + x2) * 0.5;
      const m12y = (y1 + y2) * 0.5;
      const m23x = (x2 + x3) * 0.5;
      const m23y = (y2 + y3) * 0.5;
      const m34x = (x3 + x4) * 0.5;
      const m34y = (y3 + y4) * 0.5;
      const m1223x = (m12x + m23x) * 0.5;
      const m1223y = (m12y + m23y) * 0.5;
      const m2334x = (m23x + m34x) * 0.5;
      const m2334y = (m23y + m34y) * 0.5;
      const mx = (m1223x + m2334x) * 0.5;
      const my = (m1223y + m2334y) * 0.5;
      stack[top] = [mx, my, m2334x, m2334y, m34x, m34y, x4, y4];
      stack[top + 1] = [x1, y1, m12x, m12y, m1223x, m1223y, mx, my];
      levels[top] = levels[top]! - 1;
      levels[top + 1] = levels[top]!;
      top += 1;
    }
  }
}

/**
 * `QOutlineMapper::convertPath` + `endOutline` for an affine transform:
 * curves flattened with threshold 0.25 / scale, subpaths implicitly
 * closed, points mapped to device space. One flat [x0, y0, x1, y1, …] array
 * per subpath, for the gray raster.
 */
export function outlineContours(path: PainterPath, transform: QTransform): number[][] {
  const scale = transformScale(transform);
  const threshold = scale === 0 ? 0.25 : 0.25 / scale;
  const contours: number[][] = [];
  let current: number[] | null = null;
  const close = (): void => {
    if (!current || current.length < 2) return;
    const n = current.length;
    if (current[n - 2] !== current[0] || current[n - 1] !== current[1]) current.push(current[0]!, current[1]!);
  };
  const els = path.elements;
  for (let i = 0; i < els.length; i += 1) {
    const e = els[i]!;
    if (e.type === MoveTo) {
      if (i === els.length - 1) continue;
      close();
      current = [e.x, e.y];
      contours.push(current);
    } else if (e.type === LineTo) {
      current!.push(e.x, e.y);
    } else if (e.type === CurveTo) {
      const c2 = els[i + 1]!;
      const end = els[i + 2]!;
      const n = current!.length;
      flatten(current!, [current![n - 2]!, current![n - 1]!, e.x, e.y, c2.x, c2.y, end.x, end.y], threshold);
      i += 2;
    }
  }
  close();
  const identity = transform.isIdentity();
  return contours.map((c) => {
    if (identity) return c;
    const out = new Array<number>(c.length);
    for (let k = 0; k < c.length; k += 2) {
      const [mx, my] = transform.map(c[k]!, c[k + 1]!);
      out[k] = mx;
      out[k + 1] = my;
    }
    return out;
  });
}

