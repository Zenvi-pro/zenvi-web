/**
 * Coverage spans for the shapes Qt's raster engine fills when it draws an
 * image: ported from qtbase 5.15 src/gui/painting/qrasterizer.cpp
 * (`QRasterizer::rasterizeLine` :758-1172 and the aliased `QScanConverter`
 * :126-676) and qpaintengine_raster.cpp (`fillRect_normalized`). Which pixels
 * an image covers decides the edges of every rotated or scaled clip, so these
 * follow the C++ integer and 16.16 fixed-point steps literally.
 *
 * The antialiased general-path case (qgrayraster.c) is replaced by an exact
 * area-coverage rasterizer: qgrayraster also integrates exact cell areas
 * (24.8 fixed point) and rounds coverage as floor(area·256) clamped to 255,
 * so results agree to about one level.
 */

/** Coverage for pixels [x, x + len) on row y, 1..255. */
export type SpanSink = (x: number, y: number, len: number, coverage: number) => void;

/** Inclusive device clip (QRect: right = left + width - 1). */
export interface ClipBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function clipBoxFor(width: number, height: number): ClipBox {
  return { left: 0, top: 0, right: width - 1, bottom: height - 1 };
}

function emit(sink: SpanSink, x: number, len: number, y: number, coverage: number): void {
  if (coverage <= 0 || len <= 0) return;
  sink(x, y, len, coverage > 255 ? 255 : coverage);
}

/** `fillRect_normalized` for an unclipped device: rows [y, y+h), columns [x, x+w). */
export function fillRectSpans(x: number, y: number, w: number, h: number, clip: ClipBox, sink: SpanSink): void {
  const x1 = Math.max(x, clip.left);
  const x2 = Math.min(x + w, clip.right + 1);
  const y1 = Math.max(y, clip.top);
  const y2 = Math.min(y + h, clip.bottom + 1);
  if (x2 <= x1 || y2 <= y1) return;
  for (let row = y1; row < y2; row += 1) sink(x1, row, x2 - x1, 255);
}

// ---------------------------------------------------------------------------
// 16.16 helpers (qrasterizer.cpp:55-65, :737-756)
// ---------------------------------------------------------------------------

const Q16 = 65536;

/** qSafeFloatToQ16Dot16. */
function safeQ16(x: number): number {
  const tmp = x * 65536;
  if (tmp > 2147483647) return 2147483647;
  if (tmp < -2147483648) return -2147483647;
  return Math.trunc(tmp);
}

/** Q16Dot16Multiply: (qlonglong(x) * y) >> 16. */
function q16Mul(x: number, y: number): number {
  return Math.floor((x * y) / 65536) | 0;
}

/** Q16Dot16FastMultiply: 32-bit (x * y) >> 16. */
function q16FastMul(x: number, y: number): number {
  return Math.imul(x, y) >> 16;
}

function q16ToInt(v: number): number {
  return v >> 16;
}

function qSafeDivide(x: number, y: number): number {
  if (y === 0) return x > 0 ? 1e20 : -1e20;
  return x / y;
}

/** q26Dot6Compare: equal to 1/64 px after truncation. */
function q26Dot6Equal(p1: number, p2: number): boolean {
  return Math.trunc((p2 - p1) * 64) === 0;
}

function snap26Dot6(v: number): number {
  return Math.floor(v * 64) * (1 / 64);
}

/** intersectPixelFP (qrasterizer.cpp:677-716). */
function intersectPixelFP(
  x: number,
  top: number,
  bottom: number,
  leftIntersectX: number,
  rightIntersectX: number,
  slope: number,
  invSlope: number,
): number {
  const leftX = x * Q16;
  const rightX = x * Q16 + Q16;
  let leftIntersectY: number;
  let rightIntersectY: number;
  if (slope > 0) {
    leftIntersectY = top + q16Mul(leftX - leftIntersectX, invSlope);
    rightIntersectY = leftIntersectY + invSlope;
  } else {
    leftIntersectY = top + q16Mul(leftX - rightIntersectX, invSlope);
    rightIntersectY = leftIntersectY + invSlope;
  }
  if (leftIntersectX >= leftX && rightIntersectX <= rightX) {
    return q16Mul(bottom - top, leftIntersectX - leftX + ((rightIntersectX - leftIntersectX) >> 1));
  } else if (leftIntersectX >= rightX) {
    return bottom - top;
  } else if (leftIntersectX >= leftX) {
    if (slope > 0) return bottom - top - q16FastMul((rightX - leftIntersectX) >> 1, rightIntersectY - top);
    return bottom - top - q16FastMul((rightX - leftIntersectX) >> 1, bottom - rightIntersectY);
  } else if (rightIntersectX <= leftX) {
    return 0;
  } else if (rightIntersectX <= rightX) {
    if (slope > 0) return q16FastMul((rightIntersectX - leftX) >> 1, bottom - leftIntersectY);
    return q16FastMul((rightIntersectX - leftX) >> 1, leftIntersectY - top);
  }
  if (slope > 0) return bottom - rightIntersectY + ((rightIntersectY - leftIntersectY) >> 1);
  return rightIntersectY - top + ((leftIntersectY - rightIntersectY) >> 1);
}

/**
 * `QRasterizer::rasterizeLine(a, b, width)` without square caps or legacy
 * rounding: fills the rectangle whose centre line runs from a to b and whose
 * thickness is `width · |b − a|`. The raster engine draws transformed images
 * this way when the transform has no shear (qpaintengine_raster.cpp:2463).
 */
export function rasterizeLine(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  antialiased: boolean,
  clip: ClipBox,
  sink: SpanSink,
): void {
  if ((ax === bx && ay === by) || !(width > 0) || clip.right < clip.left || clip.bottom < clip.top) return;
  let pax = ax;
  let pay = ay;
  let pbx = bx;
  let pby = by;

  const offsX = Math.abs(by - ay) * width * 0.5;
  const offsY = Math.abs(bx - ax) * width * 0.5;
  const cLeft = clip.left - offsX;
  const cTop = clip.top - offsY;
  const cRight = clip.right + 1 + offsX;
  const cBottom = clip.bottom + 1 + offsY;
  const contains = (x: number, y: number): boolean =>
    cLeft !== cRight && cTop !== cBottom && x >= cLeft && x <= cRight && y >= cTop && y <= cBottom;

  if (!contains(pax, pay) || !contains(pbx, pby)) {
    let t1 = 0;
    let t2 = 1;
    const o = [pax, pay];
    const d = [pbx - pax, pby - pay];
    const low = [cLeft, cTop];
    const high = [cRight, cBottom];
    for (let i = 0; i < 2; i += 1) {
      if (d[i] === 0) {
        if (o[i]! <= low[i]! || o[i]! >= high[i]!) return;
        continue;
      }
      const dInv = 1 / d[i]!;
      let tLow = (low[i]! - o[i]!) * dInv;
      let tHigh = (high[i]! - o[i]!) * dInv;
      if (tLow > tHigh) [tLow, tHigh] = [tHigh, tLow];
      if (t1 < tLow) t1 = tLow;
      if (t2 > tHigh) t2 = tHigh;
      if (t1 >= t2) return;
    }
    const npax = pax + (pbx - pax) * t1;
    const npay = pay + (pby - pay) * t1;
    const npbx = pax + (pbx - pax) * t2;
    const npby = pay + (pby - pay) * t2;
    pax = npax;
    pay = npay;
    pbx = npbx;
    pby = npby;
  }

  {
    const d0x = ax - bx;
    const d0y = ay - by;
    const w0 = d0x * d0x + d0y * d0y;
    const dx = pax - pbx;
    const dy = pay - pby;
    const w = dx * dx + dy * dy;
    if (w === 0) return;
    width *= Math.sqrt(w0 / w);
  }

  if (q26Dot6Equal(pay, pby)) {
    const x = (pax + pbx) * 0.5;
    const dx = Math.abs(pbx - pax) * 0.5;
    const y = pay;
    const dy = width * dx;
    pax = x;
    pay = y - dy;
    pbx = x;
    pby = y + dy;
    width = 1 / width;
  }

  if (q26Dot6Equal(pax, pbx)) {
    if (pay > pby) {
      [pax, pbx] = [pbx, pax];
      [pay, pby] = [pby, pay];
    }
    const dy = pby - pay;
    const halfWidth = 0.5 * width * dy;
    let left = pax - halfWidth;
    let right = pax + halfWidth;
    left = Math.min(Math.max(left, clip.left), clip.right + 1);
    right = Math.min(Math.max(right, clip.left), clip.right + 1);
    pay = Math.min(Math.max(pay, clip.top), clip.bottom + 1);
    pby = Math.min(Math.max(pby, clip.top), clip.bottom + 1);
    if (q26Dot6Equal(left, right) || q26Dot6Equal(pay, pby)) return;

    if (antialiased) {
      const iLeft = Math.trunc(left);
      const iRight = Math.trunc(right);
      const leftWidth = (iLeft + 1) * Q16 - safeQ16(left);
      const rightWidth = safeQ16(right) - iRight * Q16;
      const coverage: number[] = [];
      const xs: number[] = [];
      const lens: number[] = [];
      let n = 1;
      if (iLeft === iRight) {
        coverage[0] = (leftWidth + rightWidth) * 255;
        xs[0] = iLeft;
        lens[0] = 1;
      } else {
        coverage[0] = leftWidth * 255;
        xs[0] = iLeft;
        lens[0] = 1;
        if (leftWidth === Q16) {
          lens[0] = iRight - iLeft;
        } else if (iRight - iLeft > 1) {
          coverage[1] = 255 * Q16;
          xs[1] = iLeft + 1;
          lens[1] = iRight - iLeft - 1;
          n += 1;
        }
        if (rightWidth) {
          coverage[n] = rightWidth * 255;
          xs[n] = iRight;
          lens[n] = 1;
          n += 1;
        }
      }
      const iTopFP = Math.trunc(pay) * Q16;
      const iBottomFP = Math.trunc(pby) * Q16;
      const yPa = safeQ16(pay);
      const yPb = safeQ16(pby);
      for (let yFP = iTopFP; yFP <= iBottomFP; yFP += Q16) {
        const rowHeight = Math.min(yFP + Q16, yPb) - Math.max(yFP, yPa);
        const y = q16ToInt(yFP);
        if (y > clip.bottom) break;
        for (let i = 0; i < n; i += 1) {
          emit(sink, xs[i]!, lens[i]!, y, q16ToInt(q16Mul(rowHeight, coverage[i]!)));
        }
      }
    } else {
      const iTop = Math.trunc(pay + 0.5);
      const iBottom = pby < 0.5 ? -1 : Math.trunc(pby - 0.5);
      const iLeft = Math.trunc(left + 0.5);
      const iRight = right < 0.5 ? -1 : Math.trunc(right - 0.5);
      const iWidth = iRight - iLeft + 1;
      for (let y = iTop; y <= iBottom; y += 1) emit(sink, iLeft, iWidth, y, 255);
    }
    return;
  }

  // General (rotated) rectangle.
  if (pay > pby) {
    [pax, pbx] = [pbx, pax];
    [pay, pby] = [pby, pay];
  }
  const deltaX = (pbx - pax) * 0.5 * width;
  const deltaY = (pby - pay) * 0.5 * width;
  const perpX = deltaY;
  const perpY = -deltaX;
  let topX: number, topY: number, leftX: number, leftY: number, rightX: number, rightY: number, bottomX: number, bottomY: number;
  if (pax < pbx) {
    topX = pax + perpX;
    topY = pay + perpY;
    leftX = pax - perpX;
    leftY = pay - perpY;
    rightX = pbx + perpX;
    rightY = pby + perpY;
    bottomX = pbx - perpX;
    bottomY = pby - perpY;
  } else {
    topX = pax - perpX;
    topY = pay - perpY;
    leftX = pbx - perpX;
    leftY = pby - perpY;
    rightX = pax + perpX;
    rightY = pay + perpY;
    bottomX = pbx + perpX;
    bottomY = pby + perpY;
  }
  topX = snap26Dot6(topX);
  topY = snap26Dot6(topY);
  bottomX = snap26Dot6(bottomX);
  bottomY = snap26Dot6(bottomY);
  leftX = snap26Dot6(leftX);
  leftY = snap26Dot6(leftY);
  rightX = snap26Dot6(rightX);
  rightY = snap26Dot6(rightY);

  const topBound = Math.min(Math.max(topY, clip.top), clip.bottom);
  const bottomBound = Math.min(Math.max(bottomY, clip.top), clip.bottom);

  const topLeftSlope = qSafeDivide(leftX - topX, leftY - topY);
  const bottomLeftSlope = qSafeDivide(bottomX - leftX, bottomY - leftY);
  const topRightSlope = qSafeDivide(rightX - topX, rightY - topY);
  const bottomRightSlope = qSafeDivide(bottomX - rightX, bottomY - rightY);

  const topLeftSlopeFP = safeQ16(topLeftSlope);
  const topRightSlopeFP = safeQ16(topRightSlope);
  const bottomLeftSlopeFP = safeQ16(bottomLeftSlope);
  const bottomRightSlopeFP = safeQ16(bottomRightSlope);

  if (!antialiased) {
    const iTop = Math.trunc(topY + 0.5);
    const iLeft = leftY < 0.5 ? -1 : Math.trunc(leftY - 0.5);
    const iRight = rightY < 0.5 ? -1 : Math.trunc(rightY - 0.5);
    const iBottom = bottomY < 0.5 ? -1 : Math.trunc(bottomY - 0.5);
    const iMiddle = Math.min(iLeft, iRight);

    let leftIntersectAf = safeQ16(topX + 0.5 + (iTop + 0.5 - topY) * topLeftSlope);
    let leftIntersectBf = safeQ16(leftX + 0.5 + (iLeft + 1.5 - leftY) * bottomLeftSlope);
    let rightIntersectAf = safeQ16(topX - 0.5 + (iTop + 0.5 - topY) * topRightSlope);
    let rightIntersectBf = safeQ16(rightX - 0.5 + (iRight + 1.5 - rightY) * bottomRightSlope);

    let y = iTop;
    // DO_SEGMENT (qrasterizer.cpp:1160-1177).
    const segment = (next: number, useLeftB: boolean, useRightB: boolean): void => {
      const ls = useLeftB ? bottomLeftSlopeFP : topLeftSlopeFP;
      const rs = useRightB ? bottomRightSlopeFP : topRightSlopeFP;
      let li = useLeftB ? leftIntersectBf : leftIntersectAf;
      let ri = useRightB ? rightIntersectBf : rightIntersectAf;
      const ny = Math.min(next + 1, clip.top);
      if (y < ny) {
        li = (li + Math.imul(ls, ny - y)) | 0;
        ri = (ri + Math.imul(rs, ny - y)) | 0;
        y = ny;
      }
      if (next > clip.bottom) next = clip.bottom;
      for (; y <= next; y += 1) {
        const x1 = Math.max(q16ToInt(li), clip.left);
        const x2 = Math.min(q16ToInt(ri), clip.right);
        if (x2 >= x1) emit(sink, x1, x2 - x1 + 1, y, 255);
        li = (li + ls) | 0;
        ri = (ri + rs) | 0;
      }
      if (useLeftB) leftIntersectBf = li;
      else leftIntersectAf = li;
      if (useRightB) rightIntersectBf = ri;
      else rightIntersectAf = ri;
    };
    segment(iMiddle, false, false);
    segment(iRight, true, false);
    segment(iLeft, false, true);
    segment(iBottom, true, true);
    return;
  }

  // Antialiased general case (qrasterizer.cpp:942-1150).
  const invTopLeftSlopeFP = safeQ16(qSafeDivide(1, topLeftSlope));
  const invTopRightSlopeFP = safeQ16(qSafeDivide(1, topRightSlope));
  const invBottomLeftSlopeFP = safeQ16(qSafeDivide(1, bottomLeftSlope));
  const invBottomRightSlopeFP = safeQ16(qSafeDivide(1, bottomRightSlope));

  const iTopFP = Math.trunc(topBound) * Q16;
  const iLeftFP = Math.trunc(leftY) * Q16;
  const iRightFP = Math.trunc(rightY) * Q16;
  const iBottomFP = Math.trunc(bottomBound) * Q16;

  let leftIntersectAf = safeQ16(topX + (Math.trunc(topBound) - topY) * topLeftSlope);
  let rightIntersectAf = safeQ16(topX + (Math.trunc(topBound) - topY) * topRightSlope);
  let leftIntersectBf = 0;
  let rightIntersectBf = 0;
  if (iLeftFP < iTopFP) leftIntersectBf = safeQ16(leftX + (Math.trunc(topBound) - leftY) * bottomLeftSlope);
  if (iRightFP < iTopFP) rightIntersectBf = safeQ16(rightX + (Math.trunc(topBound) - rightY) * bottomRightSlope);

  const yTopFP = safeQ16(topY);
  const yLeftFP = safeQ16(leftY);
  const yRightFP = safeQ16(rightY);
  const yBottomFP = safeQ16(bottomY);

  let rowTop = Math.max(iTopFP, yTopFP);
  let topLeftIntersectAf = leftIntersectAf + q16Mul(topLeftSlopeFP, rowTop - iTopFP);
  let topRightIntersectAf = rightIntersectAf + q16Mul(topRightSlopeFP, rowTop - iTopFP);

  let yFP = iTopFP;
  while (yFP <= iBottomFP) {
    const rowBottomLeft = Math.min(yFP + Q16, yLeftFP);
    const rowBottomRight = Math.min(yFP + Q16, yRightFP);
    const rowTopLeft = Math.max(yFP, yLeftFP);
    const rowTopRight = Math.max(yFP, yRightFP);
    const rowBottom = Math.min(yFP + Q16, yBottomFP);

    let topLeftIntersectBf: number;
    let bottomLeftIntersectAf: number;
    let topRightIntersectBf: number;
    let bottomRightIntersectAf: number;
    let bottomLeftIntersectBf: number;
    let bottomRightIntersectBf: number;

    if (yFP === iLeftFP) {
      const y = q16ToInt(yFP);
      leftIntersectBf = safeQ16(leftX + (y - leftY) * bottomLeftSlope);
      topLeftIntersectBf = leftIntersectBf + q16Mul(bottomLeftSlopeFP, rowTopLeft - yFP);
      bottomLeftIntersectAf = leftIntersectAf + q16Mul(topLeftSlopeFP, rowBottomLeft - yFP);
    } else {
      topLeftIntersectBf = leftIntersectBf;
      bottomLeftIntersectAf = leftIntersectAf + topLeftSlopeFP;
    }
    if (yFP === iRightFP) {
      const y = q16ToInt(yFP);
      rightIntersectBf = safeQ16(rightX + (y - rightY) * bottomRightSlope);
      topRightIntersectBf = rightIntersectBf + q16Mul(bottomRightSlopeFP, rowTopRight - yFP);
      bottomRightIntersectAf = rightIntersectAf + q16Mul(topRightSlopeFP, rowBottomRight - yFP);
    } else {
      topRightIntersectBf = rightIntersectBf;
      bottomRightIntersectAf = rightIntersectAf + topRightSlopeFP;
    }
    if (yFP === iBottomFP) {
      bottomLeftIntersectBf = leftIntersectBf + q16Mul(bottomLeftSlopeFP, rowBottom - yFP);
      bottomRightIntersectBf = rightIntersectBf + q16Mul(bottomRightSlopeFP, rowBottom - yFP);
    } else {
      bottomLeftIntersectBf = leftIntersectBf + bottomLeftSlopeFP;
      bottomRightIntersectBf = rightIntersectBf + bottomRightSlopeFP;
    }

    let leftMin: number, leftMax: number, rightMin: number, rightMax: number;
    if (yFP < iLeftFP) {
      leftMin = q16ToInt(bottomLeftIntersectAf);
      leftMax = q16ToInt(topLeftIntersectAf);
    } else if (yFP === iLeftFP) {
      leftMin = q16ToInt(Math.max(bottomLeftIntersectAf, topLeftIntersectBf));
      leftMax = q16ToInt(Math.max(topLeftIntersectAf, bottomLeftIntersectBf));
    } else {
      leftMin = q16ToInt(topLeftIntersectBf);
      leftMax = q16ToInt(bottomLeftIntersectBf);
    }
    leftMin = Math.min(Math.max(leftMin, clip.left), clip.right);
    leftMax = Math.min(Math.max(leftMax, clip.left), clip.right);

    if (yFP < iRightFP) {
      rightMin = q16ToInt(topRightIntersectAf);
      rightMax = q16ToInt(bottomRightIntersectAf);
    } else if (yFP === iRightFP) {
      rightMin = q16ToInt(Math.min(topRightIntersectAf, bottomRightIntersectBf));
      rightMax = q16ToInt(Math.min(bottomRightIntersectAf, topRightIntersectBf));
    } else {
      rightMin = q16ToInt(bottomRightIntersectBf);
      rightMax = q16ToInt(topRightIntersectBf);
    }
    rightMin = Math.min(Math.max(rightMin, clip.left), clip.right);
    rightMax = Math.min(Math.max(rightMax, clip.left), clip.right);

    if (leftMax > rightMax) leftMax = rightMax;
    if (rightMin < leftMin) rightMin = leftMin;

    const rowHeight = rowBottom - rowTop;
    const row = q16ToInt(yFP);
    let x = leftMin;
    while (x <= leftMax) {
      let excluded = 0;
      if (yFP <= iLeftFP) {
        excluded += intersectPixelFP(x, rowTop, rowBottomLeft, bottomLeftIntersectAf, topLeftIntersectAf, topLeftSlopeFP, invTopLeftSlopeFP);
      }
      if (yFP >= iLeftFP) {
        excluded += intersectPixelFP(x, rowTopLeft, rowBottom, topLeftIntersectBf, bottomLeftIntersectBf, bottomLeftSlopeFP, invBottomLeftSlopeFP);
      }
      if (x >= rightMin) {
        if (yFP <= iRightFP) {
          excluded +=
            rowBottomRight - rowTop - intersectPixelFP(x, rowTop, rowBottomRight, topRightIntersectAf, bottomRightIntersectAf, topRightSlopeFP, invTopRightSlopeFP);
        }
        if (yFP >= iRightFP) {
          excluded +=
            rowBottom - rowTopRight - intersectPixelFP(x, rowTopRight, rowBottom, bottomRightIntersectBf, topRightIntersectBf, bottomRightSlopeFP, invBottomRightSlopeFP);
        }
      }
      emit(sink, x, 1, row, q16ToInt(255 * (rowHeight - excluded)));
      x += 1;
    }
    if (x < rightMin) {
      emit(sink, x, rightMin - x, row, q16ToInt(255 * rowHeight));
      x = rightMin;
    }
    while (x <= rightMax) {
      let excluded = 0;
      if (yFP <= iRightFP) {
        excluded +=
          rowBottomRight - rowTop - intersectPixelFP(x, rowTop, rowBottomRight, topRightIntersectAf, bottomRightIntersectAf, topRightSlopeFP, invTopRightSlopeFP);
      }
      if (yFP >= iRightFP) {
        excluded +=
          rowBottom - rowTopRight - intersectPixelFP(x, rowTopRight, rowBottom, bottomRightIntersectBf, topRightIntersectBf, bottomRightSlopeFP, invBottomRightSlopeFP);
      }
      emit(sink, x, 1, row, q16ToInt(255 * (rowHeight - excluded)));
      x += 1;
    }

    leftIntersectAf += topLeftSlopeFP;
    leftIntersectBf += bottomLeftSlopeFP;
    rightIntersectAf += topRightSlopeFP;
    rightIntersectBf += bottomRightSlopeFP;
    topLeftIntersectAf = leftIntersectAf;
    topRightIntersectAf = rightIntersectAf;

    yFP += Q16;
    rowTop = yFP;
  }
}

// ---------------------------------------------------------------------------
// Aliased polygon fill: QRasterizer::rasterize(QPainterPath) + QScanConverter
// ---------------------------------------------------------------------------

interface ScanLine {
  x: number;
  delta: number;
  top: number;
  bottom: number;
  winding: number;
}

/**
 * Fill closed polygons (flat `[x0, y0, x1, y1, …]` device coordinates, one
 * array per subpath) without antialiasing, like `QRasterizer::rasterize`
 * does for `fillPath` of a sheared image rectangle. `oddEven` selects
 * Qt::OddEvenFill (QPainterPath's default) over WindingFill.
 */
export function rasterizePolygonsAliased(subpaths: readonly (readonly number[])[], oddEven: boolean, clip: ClipBox, sink: SpanSink): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const pts of subpaths) {
    for (let i = 1; i < pts.length; i += 2) {
      minY = Math.min(minY, pts[i]!);
      maxY = Math.max(maxY, pts[i]!);
    }
  }
  if (!Number.isFinite(minY)) return;
  const top = Math.max(clip.top, Math.trunc(minY + 0.5));
  const bottom = Math.min(clip.bottom, Math.trunc(maxY - 0.5));
  if (top > bottom) return;

  const leftFP = clip.left * Q16;
  const rightFP = (clip.right + 1) * Q16;
  const lines: ScanLine[] = [];

  // QScanConverter::clip (qrasterizer.cpp:530-593). Returns true when done.
  const clipEdge = (st: { xFP: number; iTop: number; iBottom: number }, slopeFP: number, edgeFP: number, winding: number): boolean => {
    const right = edgeFP === rightFP;
    if (st.xFP === edgeFP) {
      if (slopeFP > 0 !== right) return false;
      lines.push({ x: edgeFP, delta: 0, top: st.iTop, bottom: st.iBottom, winding });
      return true;
    }
    const lastFP = st.xFP + slopeFP * (st.iBottom - st.iTop);
    if (lastFP === edgeFP) {
      if (slopeFP < 0 !== right) return false;
      lines.push({ x: edgeFP, delta: 0, top: st.iTop, bottom: st.iBottom, winding });
      return true;
    }
    if (lastFP < edgeFP !== st.xFP < edgeFP) {
      const deltaY = Math.trunc((edgeFP - st.xFP) / (slopeFP / 65536));
      if (st.xFP < edgeFP !== right) {
        const iHeight = q16ToInt(deltaY + 1);
        const iMiddle = st.iTop + iHeight;
        lines.push({ x: edgeFP, delta: 0, top: st.iTop, bottom: iMiddle, winding });
        if (iMiddle !== st.iBottom) {
          st.xFP += slopeFP * (iHeight + 1);
          st.iTop = iMiddle + 1;
        } else return true;
      } else {
        const iHeight = q16ToInt(deltaY);
        const iMiddle = st.iTop + iHeight;
        if (iMiddle !== st.iBottom) {
          lines.push({ x: edgeFP, delta: 0, top: iMiddle + 1, bottom: st.iBottom, winding });
          st.iBottom = iMiddle;
        }
      }
      return false;
    } else if (st.xFP < edgeFP !== right) {
      lines.push({ x: edgeFP, delta: 0, top: st.iTop, bottom: st.iBottom, winding });
      return true;
    }
    return false;
  };

  // QScanConverter::mergeLine (qrasterizer.cpp:595-676), 26.6 inputs.
  const mergeLine = (ax: number, ay: number, bx: number, by: number): void => {
    let winding = 1;
    if (ay > by) {
      [ax, bx] = [bx, ax];
      [ay, by] = [by, ay];
      winding = -1;
    }
    const iTop = Math.max(top, (ay + 32) >> 6);
    const iBottom = Math.min(bottom, (by - 32) >> 6);
    if (iTop > iBottom) return;
    const aFP = Q16 / 2 + ax * 1024;
    if (bx === ax) {
      lines.push({ x: Math.min(Math.max(aFP, leftFP), rightFP), delta: 0, top: iTop, bottom: iBottom, winding });
      return;
    }
    const slope = (bx - ax) / (by - ay);
    const slopeFP = Math.trunc(slope * 65536);
    const st = { xFP: aFP + q16Mul(slopeFP, iTop * Q16 + Q16 / 2 - ay * 1024), iTop, iBottom };
    if (clipEdge(st, slopeFP, leftFP, winding)) return;
    if (clipEdge(st, slopeFP, rightFP, winding)) return;
    lines.push({ x: st.xFP, delta: slopeFP, top: st.iTop, bottom: st.iBottom, winding });
  };

  for (const pts of subpaths) {
    const n = pts.length >> 1;
    if (n < 2) continue;
    // PointToVector: QT_FT_Pos(x * 64) truncates toward zero.
    const vx = (i: number): number => Math.trunc(pts[i * 2]! * 64);
    const vy = (i: number): number => Math.trunc(pts[i * 2 + 1]! * 64);
    for (let i = 0; i < n - 1; i += 1) mergeLine(vx(i), vy(i), vx(i + 1), vy(i + 1));
    if (vx(0) !== vx(n - 1) || vy(0) !== vy(n - 1)) mergeLine(vx(n - 1), vy(n - 1), vx(0), vy(0));
  }

  // qScanConvert (qrasterizer.cpp:327-386).
  if (lines.length === 0) return;
  lines.sort((a, b) => a.top - b.top);
  const mask = oddEven ? 1 : ~0;
  const active: ScanLine[] = [];
  let next = 0;
  for (let y = lines[0]!.top; y <= bottom; y += 1) {
    for (; next < lines.length && lines[next]!.top === y; next += 1) active.push(lines[next]!);
    for (let i = 1; i < active.length; i += 1) {
      const l = active[i]!;
      let j = i - 1;
      for (; j >= 0 && l.x < active[j]!.x; j -= 1) active[j + 1] = active[j]!;
      active[j + 1] = l;
    }
    let x = 0;
    let winding = 0;
    for (let i = 0; i < active.length; i += 1) {
      const node = active[i]!;
      const current = q16ToInt(node.x);
      if (winding & mask) emit(sink, x, current - x, y, 255);
      x = current;
      winding += node.winding;
      if (node.bottom === y) {
        active.splice(i, 1);
        i -= 1;
      } else node.x += node.delta;
    }
  }
}

// ---------------------------------------------------------------------------
// Antialiased polygon coverage (stand-in for qgrayraster.c)
// ---------------------------------------------------------------------------

/** Coverage of a device region: values 0..255 over the rectangle (x, y, width, height). */
export interface CoverageMask {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Exact-area coverage of closed polygons (nonzero rule; the shapes libopenshot
 * fills are simple, where nonzero and odd-even agree). Coordinates are first
 * truncated to 1/64 px like Qt's outline mapper; coverage is
 * min(255, floor(area·256)) like qgrayraster's `gray_hline`.
 */
export function rasterizePolygonsAA(subpaths: readonly (readonly number[])[], clip: ClipBox): CoverageMask | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pts of subpaths) {
    for (let i = 0; i + 1 < pts.length; i += 2) {
      minX = Math.min(minX, pts[i]!);
      maxX = Math.max(maxX, pts[i]!);
      minY = Math.min(minY, pts[i + 1]!);
      maxY = Math.max(maxY, pts[i + 1]!);
    }
  }
  if (!Number.isFinite(minX)) return null;
  const x0 = Math.max(clip.left, Math.floor(minX));
  const y0 = Math.max(clip.top, Math.floor(minY));
  const x1 = Math.min(clip.right + 1, Math.ceil(maxX) + 1);
  const y1 = Math.min(clip.bottom + 1, Math.ceil(maxY) + 1);
  if (x1 <= x0 || y1 <= y0) return null;
  const w = x1 - x0;
  const h = y1 - y0;
  // Signed-area accumulation (font-rs style): acc holds per-cell area deltas.
  const acc = new Float64Array(w * h + 1);
  const addLine = (px0: number, py0: number, px1: number, py1: number): void => {
    if (py0 === py1) return;
    let dir = 1;
    if (py0 > py1) {
      [px0, px1] = [px1, px0];
      [py0, py1] = [py1, py0];
      dir = -1;
    }
    const dxdy = (px1 - px0) / (py1 - py0);
    let x = px0;
    const yStart = Math.max(Math.floor(py0), y0);
    const yEnd = Math.min(Math.ceil(py1), y1);
    if (py0 < y0) x += (y0 - py0) * dxdy;
    for (let yi = yStart; yi < yEnd; yi += 1) {
      const rowTop = Math.max(yi, py0);
      const rowBottom = Math.min(yi + 1, py1);
      const dy = rowBottom - rowTop;
      if (dy <= 0) continue;
      const xNext = x + dxdy * dy;
      const d = dy * dir;
      const rowBase = (yi - y0) * w;
      const xa = Math.min(x, xNext) - x0;
      const xb = Math.max(x, xNext) - x0;
      if (xb <= 0) {
        acc[rowBase] = acc[rowBase]! + d;
      } else if (xa >= w) {
        // Entirely right of the mask: contributes nothing inside.
      } else {
        const ixa = Math.floor(xa);
        const ixb = Math.floor(xb);
        if (ixa === ixb || xb - xa < 1e-12) {
          const xm = (xa + xb) * 0.5 - ixa;
          const cell = Math.max(0, ixa);
          if (ixa < 0) acc[rowBase] = acc[rowBase]! + d;
          else {
            acc[rowBase + cell] = acc[rowBase + cell]! + d * (1 - xm);
            if (cell + 1 < w) acc[rowBase + cell + 1] = acc[rowBase + cell + 1]! + d * xm;
          }
        } else {
          // Split the crossing across cells by x; the part left of the mask
          // lands in column 0 in one piece.
          const inv = 1 / (xb - xa);
          let xl = xa;
          let firstCell = ixa;
          if (xa < 0) {
            acc[rowBase] = acc[rowBase]! + d * (Math.min(xb, 0) - xa) * inv;
            xl = 0;
            firstCell = 0;
          }
          for (let cx = firstCell; cx <= ixb && cx < w; cx += 1) {
            const xr = Math.min(cx + 1, xb);
            if (xr <= xl) continue;
            const part = d * (xr - xl) * inv;
            const xm = (xl + xr) * 0.5 - cx;
            if (cx < 0) acc[rowBase] = acc[rowBase]! + part;
            else {
              acc[rowBase + cx] = acc[rowBase + cx]! + part * (1 - xm);
              if (cx + 1 < w) acc[rowBase + cx + 1] = acc[rowBase + cx + 1]! + part * xm;
            }
            xl = xr;
          }
        }
      }
      x = xNext;
    }
  };
  for (const pts of subpaths) {
    const n = pts.length >> 1;
    if (n < 2) continue;
    const q = (v: number): number => Math.trunc(v * 64) / 64;
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      addLine(q(pts[i * 2]!), q(pts[i * 2 + 1]!), q(pts[j * 2]!), q(pts[j * 2 + 1]!));
    }
  }
  const data = new Uint8Array(w * h);
  for (let row = 0; row < h; row += 1) {
    let sum = 0;
    const base = row * w;
    for (let col = 0; col < w; col += 1) {
      sum += acc[base + col]!;
      const a = Math.min(1, Math.abs(sum));
      data[base + col] = Math.min(255, Math.floor(a * 256 + 1e-9));
    }
  }
  return { x: x0, y: y0, width: w, height: h, data };
}

/** Emit a coverage mask as spans (one per run of equal coverage). */
export function maskSpans(mask: CoverageMask, sink: SpanSink): void {
  for (let row = 0; row < mask.height; row += 1) {
    const base = row * mask.width;
    let col = 0;
    while (col < mask.width) {
      const c = mask.data[base + col]!;
      let end = col + 1;
      while (end < mask.width && mask.data[base + end] === c) end += 1;
      if (c > 0) sink(mask.x + col, mask.y + row, end - col, c);
      col = end;
    }
  }
}
