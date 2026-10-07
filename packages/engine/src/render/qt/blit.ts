/**
 * Untransformed and nearest-neighbour image blits that libopenshot effects
 * get from QPainter without SmoothPixmapTransform, ported from qtbase 5.15:
 * `QRasterPaintEnginePrivate::drawImage` (qpaintengine_raster.cpp:943-1013)
 * with `qt_blend_argb32_on_argb32`, `qt_scale_image_32bit`
 * (qblendfunctions_p.h:152-231) with `Blend_ARGB32_on_ARGB32_SourceAlpha` /
 * `…SourceAndConstAlpha` (qblendfunctions.cpp:424-446), and
 * `QImage::scaled(…, Qt::FastTransformation)` (qimage.cpp:4788-4900), which
 * paints through the same scale function.
 */

import { byteMul, createPremul, qCeil, qFloor, qRound, type PremulImage } from "../pixels.js";

export interface RectF {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** blend_pixel with an 8-bit constant alpha (qdrawhelper_p.h:666-680). */
function blendPixel(d: Uint8ClampedArray, di: number, s: Uint8ClampedArray, si: number, constAlpha255: number): void {
  if (constAlpha255 === 255) {
    const sa = s[si + 3]!;
    if (sa === 255) {
      d[di] = s[si]!;
      d[di + 1] = s[si + 1]!;
      d[di + 2] = s[si + 2]!;
      d[di + 3] = 255;
    } else if (sa !== 0 || s[si] !== 0 || s[si + 1] !== 0 || s[si + 2] !== 0) {
      const ia = 255 - sa;
      d[di] = s[si]! + byteMul(d[di]!, ia);
      d[di + 1] = s[si + 1]! + byteMul(d[di + 1]!, ia);
      d[di + 2] = s[si + 2]! + byteMul(d[di + 2]!, ia);
      d[di + 3] = sa + byteMul(d[di + 3]!, ia);
    }
    return;
  }
  if (s[si] === 0 && s[si + 1] === 0 && s[si + 2] === 0 && s[si + 3] === 0) return;
  const r = byteMul(s[si]!, constAlpha255);
  const g = byteMul(s[si + 1]!, constAlpha255);
  const b = byteMul(s[si + 2]!, constAlpha255);
  const a = byteMul(s[si + 3]!, constAlpha255);
  const ia = 255 - a;
  d[di] = r + byteMul(d[di]!, ia);
  d[di + 1] = g + byteMul(d[di + 1]!, ia);
  d[di + 2] = b + byteMul(d[di + 2]!, ia);
  d[di + 3] = a + byteMul(d[di + 3]!, ia);
}

/** `QRectF::toRect()`: corners rounded independently. */
export function toRect(r: RectF): { x: number; y: number; width: number; height: number } {
  const x = qRound(r.x);
  const y = qRound(r.y);
  return { x, y, width: qRound(r.x + r.width) - x, height: qRound(r.y + r.height) - y };
}

/**
 * SourceOver `drawImage(QRectF target, img, QRectF source)` when target and
 * source have the same size (an integer blit at `qRound(target)` of the
 * source pixels `source.toRect()`). Falls back to the scaling blit otherwise,
 * exactly like the raster engine's `stretch_sr` test.
 */
export function drawImageRect(dst: PremulImage, src: PremulImage, target: RectF, source: RectF, intOpacity = 256): void {
  // QPainter::drawImage(QRectF, QImage, QRectF) sanity clipping (qpainter.cpp).
  let { x, y, width: w, height: h } = target;
  let { x: sx, y: sy, width: sw, height: sh } = source;
  if (sw <= 0) sw = src.width - sx;
  if (sh <= 0) sh = src.height - sy;
  if (w < 0) w = sw;
  if (h < 0) h = sh;
  if (sx < 0) {
    const wRatio = (sx * w) / sw;
    x -= wRatio;
    w += wRatio;
    sw += sx;
    sx = 0;
  }
  if (sy < 0) {
    const hRatio = (sy * h) / sh;
    y -= hRatio;
    h += hRatio;
    sh += sy;
    sy = 0;
  }
  if (sw + sx > src.width) {
    const delta = sw - (src.width - sx);
    const wRatio = (delta * w) / sw;
    sw -= delta;
    w -= wRatio;
  }
  if (sh + sy > src.height) {
    const delta = sh - (src.height - sy);
    const hRatio = (delta * h) / sh;
    sh -= delta;
    h -= hRatio;
  }
  if (w === 0 || h === 0 || sw <= 0 || sh <= 0) return;

  if (w !== sw || h !== sh) {
    scaleBlit(dst, src, { x, y, width: w, height: h }, { x: sx, y: sy, width: sw, height: sh }, intOpacity);
    return;
  }
  if (intOpacity === 0) return;
  const sr = toRect({ x: sx, y: sy, width: sw, height: sh });
  let iw = sr.width;
  let ih = sr.height;
  let srcX = sr.x;
  let srcY = sr.y;
  let dx = qRound(x);
  let dy = qRound(y);
  if (dx < 0) {
    srcX -= dx;
    iw += dx;
    dx = 0;
  }
  if (dx + iw > dst.width) iw = dst.width - dx;
  if (dy < 0) {
    srcY -= dy;
    ih += dy;
    dy = 0;
  }
  if (dy + ih > dst.height) ih = dst.height - dy;
  if (iw <= 0 || ih <= 0) return;
  const ca = intOpacity >= 256 ? 255 : (intOpacity * 255) >> 8;
  for (let row = 0; row < ih; row += 1) {
    let di = ((dy + row) * dst.width + dx) * 4;
    let si = ((srcY + row) * src.width + srcX) * 4;
    for (let col = 0; col < iw; col += 1, di += 4, si += 4) blendPixel(dst.data, di, src.data, si, ca);
  }
}

/**
 * `qt_scale_image_32bit` with SourceOver: nearest-neighbour stretch of
 * `source` (in `src` pixels) onto `target` (device pixels).
 */
export function scaleBlit(dst: PremulImage, src: PremulImage, target: RectF, source: RectF, intOpacity = 256): void {
  if (intOpacity === 0) return;
  const sxScale = source.width / target.width;
  const syScale = source.height / target.height;
  const ix = Math.trunc(65536 * sxScale);
  const iy = Math.trunc(65536 * syScale);

  // targetRect.normalized().toRect() ∩ device.
  let nx = target.x;
  let ny = target.y;
  let nw = target.width;
  let nh = target.height;
  if (nw < 0) {
    nx += nw;
    nw = -nw;
  }
  if (nh < 0) {
    ny += nh;
    nh = -nh;
  }
  const tr = toRect({ x: nx, y: ny, width: nw, height: nh });
  const left = Math.max(tr.x, 0);
  const top = Math.max(tr.y, 0);
  const right = Math.min(tr.x + tr.width, dst.width);
  const bottom = Math.min(tr.y + tr.height, dst.height);
  if (right <= left || bottom <= top) return;
  const tx1 = left;
  const ty1 = top;
  let w = right - left;
  let h = bottom - top;

  let basex: number;
  let srcy: number;
  if (sxScale < 0) {
    const dstx = qFloor((tx1 + 0.5 - (target.x + target.width)) * sxScale * 65536) + 1;
    basex = Math.trunc((source.x + source.width) * 65536) + dstx;
  } else {
    const dstx = qCeil((tx1 + 0.5 - target.x) * sxScale * 65536) - 1;
    basex = Math.trunc(source.x * 65536) + dstx;
  }
  if (syScale < 0) {
    const dsty = qFloor((ty1 + 0.5 - (target.y + target.height)) * syScale * 65536) + 1;
    srcy = Math.trunc((source.y + source.height) * 65536) + dsty;
  } else {
    const dsty = qCeil((ty1 + 0.5 - target.y) * syScale * 65536) - 1;
    srcy = Math.trunc(source.y * 65536) + dsty;
  }

  const srch = src.height;
  const srcw = src.width;
  // Bounds checks for float rounding (qblendfunctions_p.h:200-217).
  if (Math.floor(srcy / 65536) >= srch && iy < 0) {
    srcy += iy;
    h -= 1;
  }
  if (Math.floor(basex / 65536) >= srcw && ix < 0) {
    basex += ix;
    w -= 1;
  }
  const yend = Math.floor((srcy + iy * (h - 1)) / 65536);
  if (yend < 0 || yend >= srch) h -= 1;
  const xend = Math.floor((basex + ix * (w - 1)) / 65536);
  if (xend < 0 || xend >= srcw) w -= 1;

  const ca = intOpacity >= 256 ? 255 : (intOpacity * 255) >> 8;
  for (let row = 0; row < h; row += 1) {
    const sRow = Math.floor(srcy / 65536);
    let srcx = basex;
    let di = ((ty1 + row) * dst.width + tx1) * 4;
    for (let col = 0; col < w; col += 1, di += 4) {
      const si = (sRow * srcw + Math.floor(srcx / 65536)) * 4;
      blendPixel(dst.data, di, src.data, si, ca);
      srcx += ix;
    }
    srcy += iy;
  }
}

/** `QImage::scaled(w, h, Qt::IgnoreAspectRatio, Qt::FastTransformation)`. */
export function fastScaled(src: PremulImage, w: number, h: number): PremulImage {
  w = Math.max(1, Math.trunc(w));
  h = Math.max(1, Math.trunc(h));
  if (w === src.width && h === src.height) return src;
  const sx = w / src.width;
  const sy = h / src.height;
  // transformed(): wd = qRound(|m11| * ws), hd = qRound(|m22| * hs); zeroed target.
  const out = createPremul(qRound(Math.abs(sx) * src.width), qRound(Math.abs(sy) * src.height));
  scaleBlit(out, src, { x: 0, y: 0, width: src.width * sx, height: src.height * sy }, { x: 0, y: 0, width: src.width, height: src.height });
  return out;
}
