/**
 * Qt 5 `QRect` integer rectangle semantics (x1, y1, x2, y2 with inclusive
 * right/bottom), as the Blur and Pixelate effects use them for their margin
 * areas (qtbase src/corelib/tools/qrect.cpp: marginsRemoved, operator&).
 */

export interface QRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function qrect(x: number, y: number, w: number, h: number): QRect {
  return { x1: x, y1: y, x2: x + w - 1, y2: y + h - 1 };
}

export function rectWidth(r: QRect): number {
  return r.x2 - r.x1 + 1;
}

export function rectHeight(r: QRect): number {
  return r.y2 - r.y1 + 1;
}

export function isNull(r: QRect): boolean {
  return r.x2 === r.x1 - 1 && r.y2 === r.y1 - 1;
}

export function isEmpty(r: QRect): boolean {
  return r.x1 > r.x2 || r.y1 > r.y2;
}

/** `QRect::marginsRemoved(QMargins(l, t, r, b))`. */
export function marginsRemoved(rect: QRect, l: number, t: number, r: number, b: number): QRect {
  return { x1: rect.x1 + l, y1: rect.y1 + t, x2: rect.x2 - r, y2: rect.y2 - b };
}

/** `QRect::intersected` (`operator&`): normalizes rectangles with negative size first. */
export function intersected(a: QRect, b: QRect): QRect {
  const empty: QRect = { x1: 0, y1: 0, x2: -1, y2: -1 };
  if (isNull(a) || isNull(b)) return empty;
  let l1 = a.x1;
  let r1 = a.x2;
  if (a.x2 < a.x1 - 1) [l1, r1] = [r1, l1];
  let l2 = b.x1;
  let r2 = b.x2;
  if (b.x2 < b.x1 - 1) [l2, r2] = [r2, l2];
  if (l1 > r2 || l2 > r1) return empty;
  let t1 = a.y1;
  let b1 = a.y2;
  if (a.y2 < a.y1 - 1) [t1, b1] = [b1, t1];
  let t2 = b.y1;
  let b2 = b.y2;
  if (b.y2 < b.y1 - 1) [t2, b2] = [b2, t2];
  if (t1 > b2 || t2 > b1) return empty;
  return { x1: Math.max(l1, l2), x2: Math.min(r1, r2), y1: Math.max(t1, t2), y2: Math.min(b1, b2) };
}
