/**
 * Qt's thin-line renderer, ported from qtbase 5.15
 * src/gui/painting/qcosmeticstroker.cpp (`drawLine` :729-905 with dropout
 * control, `drawLineAA` :908-1050, `drawPath` :500-640, cubic subdivision
 * :643-700, `clipLine` :325-375). QRasterPaintEngine uses it for every solid
 * pen of width <= 1 ("fast pen"); coverage is scaled by
 * `int(256 * width)`. Integer 26.6 / 16.16 arithmetic is reproduced
 * literally; solid pens only (no dashes, no legacy rounding).
 */

import { CURVE_TO, LINE_TO, MOVE_TO, pointsEqual, type Path } from "./audio-visualization-stroke.js";

/** Receives one pixel at a time, in Qt's emission order. */
export type PixelSink = (x: number, y: number, coverage: number) => void;

const CAP_BEGIN = 1;
const CAP_END = 2;

const NO_DIRECTION = 0;
const TOP_TO_BOTTOM = 1;
const BOTTOM_TO_TOP = 2;
const LEFT_TO_RIGHT = 4;
const RIGHT_TO_LEFT = 8;
const VERTICAL_MASK = 3;
const HORIZONTAL_MASK = 12;

const INT_MIN = -2147483648;

function toF26Dot6(x: number): number {
  return Math.trunc(x * 64);
}

function fixedDiv(x: number, y: number): number {
  return Math.trunc((x * 65536) / y);
}

/** `qRound(double)`. */
function qRound(d: number): number {
  if (d >= 0) return Math.trunc(d + 0.5);
  const i = Math.trunc(d - 1);
  return Math.trunc(d - i + 0.5) + i;
}

function swapCaps(caps: number): number {
  return ((caps & CAP_BEGIN) << 1) | ((caps & CAP_END) >> 1);
}

export class CosmeticStroker {
  private readonly xmin: number;
  private readonly xmax: number;
  private readonly ymin: number;
  private readonly ymax: number;
  private readonly opacity: number;
  private lastDir = NO_DIRECTION;
  private lastAxisAligned = false;
  private lastX = INT_MIN;
  private lastY = INT_MIN;

  /**
   * `width`/`height`: the device. `penWidth` <= 1. `drawCaps` is
   * `capStyle != FlatCap`.
   */
  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly antialiased: boolean,
    penWidth: number,
    private readonly drawCaps: boolean,
    private readonly sink: PixelSink,
  ) {
    this.xmin = -1;
    this.xmax = width - 1 + 2;
    this.ymin = -1;
    this.ymax = height - 1 + 2;
    const opacity = penWidth === 0 ? 256 : Math.trunc(256 * penWidth);
    this.opacity = Math.max(0, Math.min(256, opacity));
  }

  private pixel(x: number, y: number, coverage: number): void {
    if (x < 0 || x > this.width - 1 || y < 0 || y > this.height - 1) return;
    this.sink(x, y, (coverage * this.opacity) >> 8);
  }

  /** Returns null when the line is clipped away, else the clipped coordinates. */
  private clipLine(x1In: number, y1In: number, x2In: number, y2In: number): [number, number, number, number] | null {
    let x1 = x1In;
    let y1 = y1In;
    let x2 = x2In;
    let y2 = y2In;
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) return null;
    const clipped = (): null => {
      this.lastX = INT_MIN;
      return null;
    };
    if (x1 < this.xmin) {
      if (x2 <= this.xmin) return clipped();
      y1 += ((y2 - y1) / (x2 - x1)) * (this.xmin - x1);
      x1 = this.xmin;
    } else if (x1 > this.xmax) {
      if (x2 >= this.xmax) return clipped();
      y1 += ((y2 - y1) / (x2 - x1)) * (this.xmax - x1);
      x1 = this.xmax;
    }
    if (x2 < this.xmin) {
      this.lastX = INT_MIN;
      y2 += ((y2 - y1) / (x2 - x1)) * (this.xmin - x2);
      x2 = this.xmin;
    } else if (x2 > this.xmax) {
      this.lastX = INT_MIN;
      y2 += ((y2 - y1) / (x2 - x1)) * (this.xmax - x2);
      x2 = this.xmax;
    }
    if (y1 < this.ymin) {
      if (y2 <= this.ymin) return clipped();
      x1 += ((x2 - x1) / (y2 - y1)) * (this.ymin - y1);
      y1 = this.ymin;
    } else if (y1 > this.ymax) {
      if (y2 >= this.ymax) return clipped();
      x1 += ((x2 - x1) / (y2 - y1)) * (this.ymax - y1);
      y1 = this.ymax;
    }
    if (y2 < this.ymin) {
      this.lastX = INT_MIN;
      x2 += ((x2 - x1) / (y2 - y1)) * (this.ymin - y2);
      y2 = this.ymin;
    } else if (y2 > this.ymax) {
      this.lastX = INT_MIN;
      x2 += ((x2 - x1) / (y2 - y1)) * (this.ymax - y2);
      y2 = this.ymax;
    }
    return [x1, y1, x2, y2];
  }

  private stroke(rx1: number, ry1: number, rx2: number, ry2: number, caps: number): boolean {
    return this.antialiased ? this.drawLineAA(rx1, ry1, rx2, ry2, caps) : this.drawLineAliased(rx1, ry1, rx2, ry2, caps);
  }

  private drawLineAliased(rx1In: number, ry1In: number, rx2In: number, ry2In: number, capsIn: number): boolean {
    let didDraw = Math.abs(rx2In - rx1In) + Math.abs(ry2In - ry1In) >= 1;
    const c = this.clipLine(rx1In, ry1In, rx2In, ry2In);
    if (!c) return true;
    let caps = capsIn;
    let x1 = toF26Dot6(c[0]);
    let y1 = toF26Dot6(c[1]);
    let x2 = toF26Dot6(c[2]);
    let y2 = toF26Dot6(c[3]);
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    let lastX = this.lastX;
    let lastY = this.lastY;
    if (dx < dy) {
      let dir = TOP_TO_BOTTOM;
      let swapped = false;
      if (y1 > y2) {
        swapped = true;
        [y1, y2] = [y2, y1];
        [x1, x2] = [x2, x1];
        caps = swapCaps(caps);
        dir = BOTTOM_TO_TOP;
      }
      const xinc = fixedDiv(x2 - x1, y2 - y1);
      let x = x1 * 1024;
      if ((this.lastDir ^ VERTICAL_MASK) === dir) caps |= swapped ? CAP_END : CAP_BEGIN;
      // capAdjust(caps, y1, y2, x, xinc)
      if (caps & CAP_BEGIN) {
        y1 -= 32;
        x -= xinc >> 1;
      }
      if (caps & CAP_END) y2 += 32;
      let y = (y1 + 32) >> 6;
      let ys = (y2 + 32) >> 6;
      const round = xinc > 0 ? 32 : 0;
      if (caps & CAP_BEGIN && this.lastY === y + 1) y += 1;
      if (y !== ys) {
        x += ((y * 64 + round - y1) * xinc) >> 6;
        let firstX = x >> 16;
        let firstY = y;
        lastX = (x + (ys - y - 1) * xinc) >> 16;
        lastY = ys - 1;
        if (swapped) {
          [firstX, lastX] = [lastX, firstX];
          [firstY, lastY] = [lastY, firstY];
        }
        const axisAligned = Math.abs(xinc) < 1 << 14;
        if (this.lastX > INT_MIN) {
          if (firstX === this.lastX && firstY === this.lastY) {
            if (swapped) ys -= 1;
            else {
              y += 1;
              x += xinc;
            }
          } else if (
            this.lastDir !== dir &&
            ((axisAligned && this.lastAxisAligned && this.lastX !== firstX && this.lastY !== firstY) ||
              Math.abs(this.lastX - firstX) > 1 ||
              Math.abs(this.lastY - firstY) > 1)
          ) {
            if (swapped) ys += 1;
            else {
              y -= 1;
              x -= xinc;
            }
          } else if (this.lastDir === dir && Math.abs(this.lastX - firstX) <= 1 && Math.abs(this.lastY - firstY) > 1) {
            x += xinc >> 1;
            if (swapped) lastX = x >> 16;
            else lastX = (x + (ys - y - 1) * xinc) >> 16;
          }
        }
        this.lastDir = dir;
        this.lastAxisAligned = axisAligned;
        do {
          this.pixel(x >> 16, y, 255);
          x += xinc;
        } while (++y < ys);
        didDraw = true;
      }
    } else {
      if (!dx) return true;
      let dir = LEFT_TO_RIGHT;
      let swapped = false;
      if (x1 > x2) {
        swapped = true;
        [x1, x2] = [x2, x1];
        [y1, y2] = [y2, y1];
        caps = swapCaps(caps);
        dir = RIGHT_TO_LEFT;
      }
      const yinc = fixedDiv(y2 - y1, x2 - x1);
      let y = y1 * 1024;
      if ((this.lastDir ^ HORIZONTAL_MASK) === dir) caps |= swapped ? CAP_END : CAP_BEGIN;
      if (caps & CAP_BEGIN) {
        x1 -= 32;
        y -= yinc >> 1;
      }
      if (caps & CAP_END) x2 += 32;
      let x = (x1 + 32) >> 6;
      let xs = (x2 + 32) >> 6;
      const round = yinc > 0 ? 32 : 0;
      if (caps & CAP_BEGIN && this.lastX === x + 1) x += 1;
      if (x !== xs) {
        y += ((x * 64 + round - x1) * yinc) >> 6;
        let firstX = x;
        let firstY = y >> 16;
        lastX = xs - 1;
        lastY = (y + (xs - x - 1) * yinc) >> 16;
        if (swapped) {
          [firstX, lastX] = [lastX, firstX];
          [firstY, lastY] = [lastY, firstY];
        }
        const axisAligned = Math.abs(yinc) < 1 << 14;
        if (this.lastX > INT_MIN) {
          if (firstX === this.lastX && firstY === this.lastY) {
            if (swapped) xs -= 1;
            else {
              x += 1;
              y += yinc;
            }
          } else if (
            this.lastDir !== dir &&
            ((axisAligned && this.lastAxisAligned && this.lastX !== firstX && this.lastY !== firstY) ||
              Math.abs(this.lastX - firstX) > 1 ||
              Math.abs(this.lastY - firstY) > 1)
          ) {
            if (swapped) xs += 1;
            else {
              x -= 1;
              y -= yinc;
            }
          } else if (this.lastDir === dir && Math.abs(this.lastX - firstX) <= 1 && Math.abs(this.lastY - firstY) > 1) {
            y += yinc >> 1;
            if (swapped) lastY = y >> 16;
            else lastY = (y + (xs - x - 1) * yinc) >> 16;
          }
        }
        this.lastDir = dir;
        this.lastAxisAligned = axisAligned;
        do {
          this.pixel(x, y >> 16, 255);
          y += yinc;
        } while (++x < xs);
        didDraw = true;
      }
    }
    this.lastX = lastX;
    this.lastY = lastY;
    return didDraw;
  }

  private drawLineAA(rx1In: number, ry1In: number, rx2In: number, ry2In: number, capsIn: number): boolean {
    const c = this.clipLine(rx1In, ry1In, rx2In, ry2In);
    if (!c) return true;
    let caps = capsIn;
    let x1 = toF26Dot6(c[0]);
    let y1 = toF26Dot6(c[1]);
    let x2 = toF26Dot6(c[2]);
    let y2 = toF26Dot6(c[3]);
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (Math.abs(dx) < Math.abs(dy)) {
      const xinc = fixedDiv(dx, dy);
      if (y1 > y2) {
        [y1, y2] = [y2, y1];
        [x1, x2] = [x2, x1];
        caps = swapCaps(caps);
      }
      let x = (x1 - 32) * 1024;
      x -= (((y1 & 63) - 32) * xinc) >> 6;
      if (caps & CAP_BEGIN) {
        y1 -= 32;
        x -= xinc >> 1;
      }
      if (caps & CAP_END) y2 += 32;
      let y = y1 >> 6;
      const ys = y2 >> 6;
      let alphaStart: number;
      let alphaEnd: number;
      if (y === ys) {
        alphaStart = y2 - y1;
        alphaEnd = 0;
      } else {
        alphaStart = 64 - (y1 & 63);
        alphaEnd = y2 & 63;
      }
      let alpha = (x >> 8) & 0xff;
      this.pixel(x >> 16, y, ((255 - alpha) * alphaStart) >> 6);
      this.pixel((x >> 16) + 1, y, (alpha * alphaStart) >> 6);
      x += xinc;
      y += 1;
      if (y < ys) {
        do {
          alpha = (x >> 8) & 0xff;
          this.pixel(x >> 16, y, 255 - alpha);
          this.pixel((x >> 16) + 1, y, alpha);
          x += xinc;
        } while (++y < ys);
      }
      if (alphaEnd) {
        alpha = (x >> 8) & 0xff;
        this.pixel(x >> 16, y, ((255 - alpha) * alphaEnd) >> 6);
        this.pixel((x >> 16) + 1, y, (alpha * alphaEnd) >> 6);
      }
    } else {
      if (!dx) return true;
      const yinc = fixedDiv(dy, dx);
      if (x1 > x2) {
        [x1, x2] = [x2, x1];
        [y1, y2] = [y2, y1];
        caps = swapCaps(caps);
      }
      let y = (y1 - 32) * 1024;
      y -= (((x1 & 63) - 32) * yinc) >> 6;
      if (caps & CAP_BEGIN) {
        x1 -= 32;
        y -= yinc >> 1;
      }
      if (caps & CAP_END) x2 += 32;
      let x = x1 >> 6;
      const xs = x2 >> 6;
      let alphaStart: number;
      let alphaEnd: number;
      if (x === xs) {
        alphaStart = x2 - x1;
        alphaEnd = 0;
      } else {
        alphaStart = 64 - (x1 & 63);
        alphaEnd = x2 & 63;
      }
      let alpha = (y >> 8) & 0xff;
      this.pixel(x, y >> 16, ((255 - alpha) * alphaStart) >> 6);
      this.pixel(x, (y >> 16) + 1, (alpha * alphaStart) >> 6);
      y += yinc;
      x += 1;
      if (x < xs) {
        do {
          alpha = (y >> 8) & 0xff;
          this.pixel(x, y >> 16, 255 - alpha);
          this.pixel(x, (y >> 16) + 1, alpha);
          y += yinc;
        } while (++x < xs);
      }
      if (alphaEnd) {
        alpha = (y >> 8) & 0xff;
        this.pixel(x, y >> 16, ((255 - alpha) * alphaEnd) >> 6);
        this.pixel(x, (y >> 16) + 1, (alpha * alphaEnd) >> 6);
      }
    }
    return true;
  }

  /** `calculateLastPoint` (:412-490): direction and last pixel of the closing segment. */
  private calculateLastPoint(rx1In: number, ry1In: number, rx2In: number, ry2In: number): void {
    this.lastX = INT_MIN;
    this.lastY = INT_MIN;
    const c = this.clipLine(rx1In, ry1In, rx2In, ry2In);
    if (!c) return;
    let x1 = toF26Dot6(c[0]);
    let y1 = toF26Dot6(c[1]);
    let x2 = toF26Dot6(c[2]);
    let y2 = toF26Dot6(c[3]);
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    if (dx < dy) {
      let swapped = false;
      if (y1 > y2) {
        swapped = true;
        [y1, y2] = [y2, y1];
        [x1, x2] = [x2, x1];
      }
      const xinc = fixedDiv(x2 - x1, y2 - y1);
      let x = x1 * 1024;
      const y = (y1 + 32) >> 6;
      const ys = (y2 + 32) >> 6;
      const round = xinc > 0 ? 32 : 0;
      if (y !== ys) {
        x += ((y * 64 + round - y1) * xinc) >> 6;
        if (swapped) {
          this.lastX = x >> 16;
          this.lastY = y;
          this.lastDir = BOTTOM_TO_TOP;
        } else {
          this.lastX = (x + (ys - y - 1) * xinc) >> 16;
          this.lastY = ys - 1;
          this.lastDir = TOP_TO_BOTTOM;
        }
        this.lastAxisAligned = Math.abs(xinc) < 1 << 14;
      }
    } else {
      if (!dx) return;
      let swapped = false;
      if (x1 > x2) {
        swapped = true;
        [x1, x2] = [x2, x1];
        [y1, y2] = [y2, y1];
      }
      const yinc = fixedDiv(y2 - y1, x2 - x1);
      let y = y1 * 1024;
      const x = (x1 + 32) >> 6;
      const xs = (x2 + 32) >> 6;
      const round = yinc > 0 ? 32 : 0;
      if (x !== xs) {
        y += ((x * 64 + round - x1) * yinc) >> 6;
        if (swapped) {
          this.lastX = x;
          this.lastY = y >> 16;
          this.lastDir = RIGHT_TO_LEFT;
        } else {
          this.lastX = xs - 1;
          this.lastY = (y + (xs - x - 1) * yinc) >> 16;
          this.lastDir = LEFT_TO_RIGHT;
        }
        this.lastAxisAligned = Math.abs(yinc) < 1 << 14;
      }
    }
  }

  /** `drawPoints`: one full-coverage pixel at the rounded position. */
  private point(x: number, y: number): void {
    this.pixel(qRound(x), qRound(y), 255);
  }

  /** `QCosmeticStroker::drawLine`. */
  drawLine(x1: number, y1: number, x2: number, y2: number): void {
    if (pointsEqual(x1, y1, x2, y2)) {
      this.point(x1, y1);
      return;
    }
    this.lastX = INT_MIN;
    this.lastY = INT_MIN;
    this.stroke(x1, y1, x2, y2, this.drawCaps ? CAP_BEGIN | CAP_END : 0);
  }

  /** `drawPath` for a polygon without element types (drawPolyline / implicitly closed polygons). */
  drawPolygon(points: readonly number[], implicitClose: boolean): void {
    const n = points.length >> 1;
    if (n === 0) return;
    let px = points[0]!;
    let py = points[1]!;
    const movedX = px;
    const movedY = py;
    this.lastX = INT_MIN;
    this.lastY = INT_MIN;
    const endX = points[(n - 1) * 2]!;
    const endY = points[(n - 1) * 2 + 1]!;
    const closed = implicitClose || (points[0] === endX && points[1] === endY);
    let caps = !closed && this.drawCaps ? CAP_BEGIN : 0;
    if (closed) {
      let p2x: number;
      let p2y: number;
      if (points[0] === endX && points[1] === endY && n > 2) {
        p2x = points[(n - 2) * 2]!;
        p2y = points[(n - 2) * 2 + 1]!;
      } else {
        p2x = endX;
        p2y = endY;
      }
      this.calculateLastPoint(p2x, p2y, px, py);
    }
    const fastPenAliased = !this.antialiased;
    for (let i = 1; i < n; i += 1) {
      const qx = points[i * 2]!;
      const qy = points[i * 2 + 1]!;
      if (!closed && this.drawCaps && i === n - 1) caps |= CAP_END;
      const moveNextStart = this.stroke(px, py, qx, qy, caps);
      if (!fastPenAliased || moveNextStart || i === 1 || i === n - 1) {
        px = qx;
        py = qy;
      }
      caps = 0;
    }
    if (implicitClose) this.stroke(px, py, movedX, movedY, 0);
  }

  /** `drawPath` for a path with element types (QPainterPath: lines and cubics). */
  drawPath(path: Path): void {
    const types = path.types;
    const pts = path.pts;
    const end = types.length;
    let t = 0;
    while (t < end) {
      let px = pts[t * 2]!;
      let py = pts[t * 2 + 1]!;
      this.lastX = INT_MIN;
      this.lastY = INT_MIN;
      // subPath(): find the next MoveTo; closed when the first and last points are equal (exactly).
      let e = t + 1;
      while (e < end && types[e] !== MOVE_TO) e += 1;
      const lastIndex = e - 1;
      const closed = pts[t * 2] === pts[lastIndex * 2] && pts[t * 2 + 1] === pts[lastIndex * 2 + 1];
      if (closed) {
        this.calculateLastPoint(pts[(e - 2) * 2]!, pts[(e - 2) * 2 + 1]!, pts[(e - 1) * 2]!, pts[(e - 1) * 2 + 1]!);
      }
      let caps = !closed && this.drawCaps ? CAP_BEGIN : 0;
      let i = t + 1;
      while (i < e) {
        const type = types[i]!;
        const qx = pts[i * 2]!;
        const qy = pts[i * 2 + 1]!;
        if (type === LINE_TO) {
          if (!closed && this.drawCaps && i === e - 1) caps |= CAP_END;
          this.stroke(px, py, qx, qy, caps);
          px = qx;
          py = qy;
          i += 1;
        } else if (type === CURVE_TO) {
          if (!closed && this.drawCaps && i === e - 3) caps |= CAP_END;
          const p3x = pts[(i + 1) * 2]!;
          const p3y = pts[(i + 1) * 2 + 1]!;
          const p4x = pts[(i + 2) * 2]!;
          const p4y = pts[(i + 2) * 2 + 1]!;
          this.renderCubic(px, py, qx, qy, p3x, p3y, p4x, p4y, caps);
          px = p4x;
          py = p4y;
          i += 3;
        } else i += 1;
        caps = 0;
      }
      t = e;
    }
  }

  private renderCubic(p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number, p4x: number, p4y: number, caps: number): void {
    // points[3] = p1, [2] = p2, [1] = p3, [0] = p4 (reversed), as in the C++.
    const pts: number[] = new Array<number>(2 * (3 * 6 + 4)).fill(0);
    pts[6] = p1x;
    pts[7] = p1y;
    pts[4] = p2x;
    pts[5] = p2y;
    pts[2] = p3x;
    pts[3] = p3y;
    pts[0] = p4x;
    pts[1] = p4y;
    this.renderCubicSubdivision(pts, 0, 6, caps);
  }

  private renderCubicSubdivision(pts: number[], base: number, level: number, caps: number): void {
    const X = (i: number): number => pts[(base + i) * 2]!;
    const Y = (i: number): number => pts[(base + i) * 2 + 1]!;
    if (level) {
      const dx = X(3) - X(0);
      const dy = Y(3) - Y(0);
      const len = 0.25 * (Math.abs(dx) + Math.abs(dy));
      if (Math.abs(dx * (Y(0) - Y(2)) - dy * (X(0) - X(2))) >= len || Math.abs(dx * (Y(0) - Y(1)) - dy * (X(0) - X(1))) >= len) {
        splitCubic(pts, base);
        this.renderCubicSubdivision(pts, base + 3, level - 1, caps & CAP_BEGIN);
        this.renderCubicSubdivision(pts, base, level - 1, caps & CAP_END);
        return;
      }
    }
    this.stroke(X(3), Y(3), X(0), Y(0), caps);
  }
}

/** `splitCubic` (:666-693) on points [base .. base+6]. */
function splitCubic(pts: number[], base: number): void {
  for (let k = 0; k < 2; k += 1) {
    const at = (i: number): number => (base + i) * 2 + k;
    pts[at(6)] = pts[at(3)]!;
    let c = pts[at(1)]!;
    const d = pts[at(2)]!;
    let a = (pts[at(0)]! + c) * 0.5;
    pts[at(1)] = a;
    let b = (pts[at(3)]! + d) * 0.5;
    pts[at(5)] = b;
    c = (c + d) * 0.5;
    a = (a + c) * 0.5;
    pts[at(2)] = a;
    b = (b + c) * 0.5;
    pts[at(4)] = b;
    pts[at(3)] = (a + b) * 0.5;
  }
}
