/**
 * Qt 5.15 `QTransform` (affine subset), ported from qtbase
 * src/gui/painting/qtransform.cpp. Qt picks arithmetic and raster paths by a
 * lazily computed *type* with fuzzy-null tests (|v| <= 1e-12), e.g. a
 * rotation of 360° is "scale only" and is drawn by the axis-aligned path, and
 * `isIdentity()` decides whether libopenshot turns on smooth sampling
 * (Clip.cpp:1404). Mirroring the type logic keeps both decisions and the
 * floating-point results identical to the desktop.
 *
 * Mapping (row vectors, like Qt): x' = m11·x + m21·y + dx, y' = m12·x + m22·y + dy.
 */

import type { Affine } from "../types.js";

export const TxNone = 0x00;
export const TxTranslate = 0x01;
export const TxScale = 0x02;
export const TxRotate = 0x04;
export const TxShear = 0x08;
export type TxType = typeof TxNone | typeof TxTranslate | typeof TxScale | typeof TxRotate | typeof TxShear;

/** qFuzzyIsNull(double). */
export function fuzzyIsNull(d: number): boolean {
  return Math.abs(d) <= 0.000000000001;
}

/** qFuzzyCompare(double, double). */
export function fuzzyCompare(p1: number, p2: number): boolean {
  return Math.abs(p1 - p2) * 1000000000000 <= Math.min(Math.abs(p1), Math.abs(p2));
}

/** qtransform.cpp:631. */
const DEG2RAD = 0.017453292519943295; // qreal(0.017453292519943295769)

export class QTransform {
  m11 = 1;
  m12 = 0;
  m21 = 0;
  m22 = 1;
  dx = 0;
  dy = 0;
  private mType: number = TxNone;
  private mDirty: number = TxNone;

  /** `QTransform(h11, h12, h21, h22, dx, dy)`: type recomputed from values (m_dirty = TxShear). */
  static fromValues(m11: number, m12: number, m21: number, m22: number, dx: number, dy: number): QTransform {
    const t = new QTransform();
    t.m11 = m11;
    t.m12 = m12;
    t.m21 = m21;
    t.m22 = m22;
    t.dx = dx;
    t.dy = dy;
    t.mType = TxNone;
    t.mDirty = TxShear;
    return t;
  }

  /** From a Canvas2D-order affine `[a, b, c, d, e, f]`. */
  static fromAffine(a: Affine): QTransform {
    return QTransform.fromValues(a[0], a[1], a[2], a[3], a[4], a[5]);
  }

  clone(): QTransform {
    const t = new QTransform();
    t.m11 = this.m11;
    t.m12 = this.m12;
    t.m21 = this.m21;
    t.m22 = this.m22;
    t.dx = this.dx;
    t.dy = this.dy;
    t.mType = this.mType;
    t.mDirty = this.mDirty;
    return t;
  }

  toAffine(): Affine {
    return [this.m11, this.m12, this.m21, this.m22, this.dx, this.dy];
  }

  /** `QTransform::type()` (qtransform.cpp): lazily classify, fuzzy. */
  type(): number {
    if (this.mDirty === TxNone || this.mDirty < this.mType) return this.mType;
    let t: number = TxNone;
    // Fall through from the dirty level down, like the C++ switch.
    const level = this.mDirty;
    if (level >= TxRotate && (!fuzzyIsNull(this.m12) || !fuzzyIsNull(this.m21))) {
      const dot = this.m11 * this.m21 + this.m12 * this.m22;
      t = fuzzyIsNull(dot) ? TxRotate : TxShear;
    } else if (level >= TxScale && (!fuzzyIsNull(this.m11 - 1) || !fuzzyIsNull(this.m22 - 1))) {
      t = TxScale;
    } else if (level >= TxTranslate && (!fuzzyIsNull(this.dx) || !fuzzyIsNull(this.dy))) {
      t = TxTranslate;
    }
    this.mType = t;
    this.mDirty = TxNone;
    return t;
  }

  private inlineType(): number {
    return this.mDirty === TxNone ? this.mType : this.type();
  }

  isIdentity(): boolean {
    return this.inlineType() === TxNone;
  }

  translate(dx: number, dy: number): this {
    if (dx === 0 && dy === 0) return this;
    switch (this.inlineType()) {
      case TxNone:
        this.dx = dx;
        this.dy = dy;
        break;
      case TxTranslate:
        this.dx += dx;
        this.dy += dy;
        break;
      case TxScale:
        this.dx += dx * this.m11;
        this.dy += dy * this.m22;
        break;
      default:
        this.dx += dx * this.m11 + dy * this.m21;
        this.dy += dy * this.m22 + dx * this.m12;
        break;
    }
    if (this.mDirty < TxTranslate) this.mDirty = TxTranslate;
    return this;
  }

  scale(sx: number, sy: number): this {
    if (sx === 1 && sy === 1) return this;
    switch (this.inlineType()) {
      case TxNone:
      case TxTranslate:
        this.m11 = sx;
        this.m22 = sy;
        break;
      case TxRotate:
      case TxShear:
        this.m12 *= sx;
        this.m21 *= sy;
        this.m11 *= sx;
        this.m22 *= sy;
        break;
      default: // TxScale
        this.m11 *= sx;
        this.m22 *= sy;
        break;
    }
    if (this.mDirty < TxScale) this.mDirty = TxScale;
    return this;
  }

  /** Degrees; positive is clockwise on a y-down canvas. */
  rotate(a: number): this {
    if (a === 0) return this;
    let sina = 0;
    let cosa = 0;
    if (a === 90 || a === -270) sina = 1;
    else if (a === 270 || a === -90) sina = -1;
    else if (a === 180) cosa = -1;
    else {
      const b = DEG2RAD * a;
      sina = Math.sin(b);
      cosa = Math.cos(b);
    }
    switch (this.inlineType()) {
      case TxNone:
      case TxTranslate:
        this.m11 = cosa;
        this.m12 = sina;
        this.m21 = -sina;
        this.m22 = cosa;
        break;
      case TxScale: {
        const tm11 = cosa * this.m11;
        const tm12 = sina * this.m22;
        const tm21 = -sina * this.m11;
        const tm22 = cosa * this.m22;
        this.m11 = tm11;
        this.m12 = tm12;
        this.m21 = tm21;
        this.m22 = tm22;
        break;
      }
      default: {
        const tm11 = cosa * this.m11 + sina * this.m21;
        const tm12 = cosa * this.m12 + sina * this.m22;
        const tm21 = -sina * this.m11 + cosa * this.m21;
        const tm22 = -sina * this.m12 + cosa * this.m22;
        this.m11 = tm11;
        this.m12 = tm12;
        this.m21 = tm21;
        this.m22 = tm22;
        break;
      }
    }
    if (this.mDirty < TxRotate) this.mDirty = TxRotate;
    return this;
  }

  shear(sh: number, sv: number): this {
    if (sh === 0 && sv === 0) return this;
    switch (this.inlineType()) {
      case TxNone:
      case TxTranslate:
        this.m12 = sv;
        this.m21 = sh;
        break;
      case TxScale:
        this.m12 = sv * this.m22;
        this.m21 = sh * this.m11;
        break;
      default: {
        const tm11 = sv * this.m21;
        const tm22 = sh * this.m12;
        const tm12 = sv * this.m22;
        const tm21 = sh * this.m11;
        this.m11 += tm11;
        this.m12 += tm12;
        this.m21 += tm21;
        this.m22 += tm22;
        break;
      }
    }
    if (this.mDirty < TxShear) this.mDirty = TxShear;
    return this;
  }

  /** `this * m`: apply `this` first, then `m` (qtransform.cpp operator*). */
  multiply(m: QTransform): QTransform {
    const otherType = m.inlineType();
    if (otherType === TxNone) return this.clone();
    const thisType = this.inlineType();
    if (thisType === TxNone) return m.clone();
    const t = new QTransform();
    const type = Math.max(thisType, otherType);
    if (type === TxTranslate) {
      t.dx = this.dx + m.dx;
      t.dy += this.dy + m.dy;
    } else if (type === TxScale) {
      t.m11 = this.m11 * m.m11;
      t.m22 = this.m22 * m.m22;
      t.dx = this.dx * m.m11 + m.dx;
      t.dy = this.dy * m.m22 + m.dy;
    } else {
      t.m11 = this.m11 * m.m11 + this.m12 * m.m21;
      t.m12 = this.m11 * m.m12 + this.m12 * m.m22;
      t.m21 = this.m21 * m.m11 + this.m22 * m.m21;
      t.m22 = this.m21 * m.m12 + this.m22 * m.m22;
      t.dx = this.dx * m.m11 + this.dy * m.m21 + m.dx;
      t.dy = this.dx * m.m12 + this.dy * m.m22 + m.dy;
    }
    t.mDirty = type;
    t.mType = type;
    return t;
  }

  /** `QTransform::inverted()`; null when singular. */
  inverted(): QTransform | null {
    const inv = new QTransform();
    let ok = true;
    const type = this.inlineType();
    switch (type) {
      case TxNone:
        break;
      case TxTranslate:
        inv.dx = -this.dx;
        inv.dy = -this.dy;
        break;
      case TxScale:
        ok = !fuzzyIsNull(this.m11) && !fuzzyIsNull(this.m22);
        if (ok) {
          inv.m11 = 1 / this.m11;
          inv.m22 = 1 / this.m22;
          inv.dx = -this.dx * inv.m11;
          inv.dy = -this.dy * inv.m22;
        }
        break;
      default: {
        // QMatrix::inverted (qmatrix.cpp).
        const dtr = this.m11 * this.m22 - this.m12 * this.m21;
        if (dtr === 0) {
          ok = false;
          break;
        }
        const dinv = 1 / dtr;
        inv.m11 = this.m22 * dinv;
        inv.m12 = -this.m12 * dinv;
        inv.m21 = -this.m21 * dinv;
        inv.m22 = this.m11 * dinv;
        inv.dx = (this.m21 * this.dy - this.m22 * this.dx) * dinv;
        inv.dy = (this.m12 * this.dx - this.m11 * this.dy) * dinv;
        break;
      }
    }
    if (!ok) return null;
    inv.mType = this.mType;
    inv.mDirty = this.mDirty;
    return inv;
  }

  /** Map a point (the `MAP` macro for affine types). */
  map(x: number, y: number): [number, number] {
    switch (this.inlineType()) {
      case TxNone:
        return [x, y];
      case TxTranslate:
        return [x + this.dx, y + this.dy];
      case TxScale:
        return [this.m11 * x + this.dx, this.m22 * y + this.dy];
      default:
        return [this.m11 * x + this.m21 * y + this.dx, this.m12 * x + this.m22 * y + this.dy];
    }
  }

  /** `QTransform::mapRect(QRectF)`: bounding rect of the mapped rectangle. */
  mapRect(x: number, y: number, w: number, h: number): { x: number; y: number; width: number; height: number } {
    const t = this.inlineType();
    if (t <= TxTranslate) return { x: x + this.dx, y: y + this.dy, width: w, height: h };
    if (t <= TxScale) {
      let rx = this.m11 * x + this.dx;
      let ry = this.m22 * y + this.dy;
      let rw = this.m11 * w;
      let rh = this.m22 * h;
      if (rw < 0) {
        rw = -rw;
        rx -= rw;
      }
      if (rh < 0) {
        rh = -rh;
        ry -= rh;
      }
      return { x: rx, y: ry, width: rw, height: rh };
    }
    const corners: [number, number][] = [
      this.map(x, y),
      this.map(x + w, y),
      this.map(x + w, y + h),
      this.map(x, y + h),
    ];
    let xmin = corners[0]![0];
    let ymin = corners[0]![1];
    let xmax = xmin;
    let ymax = ymin;
    for (const [cx, cy] of corners) {
      xmin = Math.min(xmin, cx);
      ymin = Math.min(ymin, cy);
      xmax = Math.max(xmax, cx);
      ymax = Math.max(ymax, cy);
    }
    return { x: xmin, y: ymin, width: xmax - xmin, height: ymax - ymin };
  }
}

/**
 * `qt_scaleForTransform` (qtransform.cpp): true when the transform has no
 * shear and a uniform scale; the raster engine then draws images with
 * `rasterizeLine` instead of a general path fill.
 */
export function scaleIsUniform(t: QTransform): boolean {
  const type = t.type();
  if (type <= TxTranslate) return true;
  if (type === TxScale) return fuzzyCompare(Math.abs(t.m11), Math.abs(t.m22));
  const xScale1 = t.m11 * t.m11 + t.m21 * t.m21;
  const yScale1 = t.m12 * t.m12 + t.m22 * t.m22;
  const xScale2 = t.m11 * t.m11 + t.m12 * t.m12;
  const yScale2 = t.m21 * t.m21 + t.m22 * t.m22;
  if (Math.abs(xScale1 - yScale1) > Math.abs(xScale2 - yScale2)) {
    return type === TxRotate && fuzzyCompare(xScale1, yScale1);
  }
  return type === TxRotate && fuzzyCompare(xScale2, yScale2);
}
