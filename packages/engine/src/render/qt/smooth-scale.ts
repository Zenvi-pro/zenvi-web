/**
 * `QImage::scaled(w, h, …, Qt::SmoothTransformation)` for premultiplied
 * RGBA8 images: Qt's `qSmoothScaleImage` (Imlib2 smoothscale), ported from
 * qtbase 5.15 src/gui/painting/qimagescale.cpp:107-230 (scale tables) and
 * :330-560 (`qt_qimageScaleAARGBA*`). Upscaled axes interpolate linearly with
 * 8-bit weights; downscaled axes average the covered area with 14-bit
 * fixed-point weights. The arm64 NEON variants (qimagescale_neon.cpp) compute
 * the same integers with unsigned lanes, which is what this port does.
 *
 * libopenshot uses this for mask images (EffectBase::GetMaskImage), Pixelate
 * (`scaledToWidth`), still-image decode sizes (QtImageReader::GetFrame) and
 * AudioVisualization's source background.
 */

import { createPremul, type PremulImage } from "../pixels.js";

interface ScaleAxis {
  /** Source index (pixels) for each destination position. */
  points: Int32Array;
  /** Interpolation weights (up) or packed `ap | (Cp << 16)` (down). */
  apoints: Int32Array;
  up: boolean;
}

/** `qimageCalcXPoints` / `qimageCalcYPoints` (qimagescale.cpp:107-161), without the mirror branch. */
function calcPoints(s: number, d: number): Int32Array {
  const p = new Int32Array(d);
  const up = d >= s;
  let val = up ? Math.trunc((0x8000 * s) / d) - 0x8000 : 0;
  const inc = Math.trunc((s * 65536) / d);
  for (let i = 0; i < d; i += 1) {
    p[i] = Math.max(0, Math.floor(val / 65536));
    val += inc;
  }
  return p;
}

/** `qimageCalcApoints` (qimagescale.cpp:163-203). */
function calcApoints(s: number, d: number, up: boolean): Int32Array {
  const p = new Int32Array(d);
  if (up) {
    let val = Math.trunc((0x8000 * s) / d) - 0x8000;
    const inc = Math.trunc((s * 65536) / d);
    for (let i = 0; i < d; i += 1) {
      const pos = Math.floor(val / 65536);
      if (pos < 0 || pos >= s - 1) p[i] = 0;
      else p[i] = Math.floor(val / 256) & 0xff;
      val += inc;
    }
  } else {
    let val = 0;
    const inc = Math.trunc((s * 65536) / d);
    const Cp = Math.trunc((d * 16384 + s - 1) / s);
    for (let i = 0; i < d; i += 1) {
      const ap = Math.floor(((0x10000 - (val & 0xffff)) * Cp) / 65536);
      p[i] = ap | (Cp << 16);
      val += inc;
    }
  }
  return p;
}

function axis(s: number, d: number): ScaleAxis {
  const up = d >= s;
  return { points: calcPoints(s, d), apoints: calcApoints(s, d, up), up };
}

/**
 * `qt_qimageScaleAARGBA_helper`: area sum of one channel group along one
 * axis starting at byte offset `o`, stepping `step` bytes. Writes the four
 * channel sums into `acc`.
 */
function areaSum(src: Uint8ClampedArray, o: number, xyap: number, Cxy: number, step: number, acc: Float64Array): void {
  let r = src[o]! * xyap;
  let g = src[o + 1]! * xyap;
  let b = src[o + 2]! * xyap;
  let a = src[o + 3]! * xyap;
  let j = 16384 - xyap;
  for (; j > Cxy; j -= Cxy) {
    o += step;
    r += src[o]! * Cxy;
    g += src[o + 1]! * Cxy;
    b += src[o + 2]! * Cxy;
    a += src[o + 3]! * Cxy;
  }
  o += step;
  r += src[o]! * j;
  g += src[o + 1]! * j;
  b += src[o + 2]! * j;
  a += src[o + 3]! * j;
  acc[0] = r;
  acc[1] = g;
  acc[2] = b;
  acc[3] = a;
}

/**
 * Smooth-scale `src` to `dw`×`dh` exactly like Qt's `qSmoothScaleImage` on an
 * image with an alpha channel. Returns `src` itself when the size is unchanged
 * (QImage::scaled returns `*this`).
 */
export function smoothScale(src: PremulImage, dw: number, dh: number): PremulImage {
  const sw = src.width;
  const sh = src.height;
  dw = Math.trunc(dw);
  dh = Math.trunc(dh);
  if (dw === sw && dh === sh) return src;
  const out = createPremul(dw, dh);
  if (dw <= 0 || dh <= 0 || sw <= 0 || sh <= 0) return out;

  const xs = axis(sw, dw);
  const ys = axis(sh, dh);
  const s = src.data;
  const d = out.data;
  const sow = sw * 4; // bytes per source row
  const xpoints = xs.points;
  const xapoints = xs.apoints;
  const ypoints = ys.points;
  const yapoints = ys.apoints;

  if (xs.up && ys.up) {
    // qt_qimageScaleAARGBA_up_xy (qimagescale.cpp:330-366); the 4-pixel case
    // is interpolate_4_pixels (NEON/SSE2: vertical first, then horizontal).
    for (let y = 0; y < dh; y += 1) {
      const rowBase = ypoints[y]! * sow;
      const yap = yapoints[y]!;
      let di = y * dw * 4;
      for (let x = 0; x < dw; x += 1, di += 4) {
        const pi = rowBase + xpoints[x]! * 4;
        const xap = xapoints[x]!;
        if (yap > 0) {
          if (xap > 0) {
            const iy = 256 - yap;
            const ix = 256 - xap;
            for (let c = 0; c < 4; c += 1) {
              const left = (s[pi + c]! * iy + s[pi + sow + c]! * yap) >> 8;
              const right = (s[pi + 4 + c]! * iy + s[pi + sow + 4 + c]! * yap) >> 8;
              d[di + c] = (left * ix + right * xap) >> 8;
            }
          } else {
            const iy = 256 - yap;
            for (let c = 0; c < 4; c += 1) d[di + c] = (s[pi + c]! * iy + s[pi + sow + c]! * yap) >> 8;
          }
        } else if (xap > 0) {
          const ix = 256 - xap;
          for (let c = 0; c < 4; c += 1) d[di + c] = (s[pi + c]! * ix + s[pi + 4 + c]! * xap) >> 8;
        } else {
          d[di] = s[pi]!;
          d[di + 1] = s[pi + 1]!;
          d[di + 2] = s[pi + 2]!;
          d[di + 3] = s[pi + 3]!;
        }
      }
    }
    return out;
  }

  const acc = new Float64Array(4);
  const acc2 = new Float64Array(4);

  if (xs.up) {
    // Up on X, down on Y: qt_qimageScaleAARGBA_up_x_down_y (:434-472).
    for (let y = 0; y < dh; y += 1) {
      const Cy = yapoints[y]! >> 16;
      const yap = yapoints[y]! & 0xffff;
      const rowBase = ypoints[y]! * sow;
      let di = y * dw * 4;
      for (let x = 0; x < dw; x += 1, di += 4) {
        const o = rowBase + xpoints[x]! * 4;
        areaSum(s, o, yap, Cy, sow, acc);
        const xap = xapoints[x]!;
        if (xap > 0) {
          areaSum(s, o + 4, yap, Cy, sow, acc2);
          for (let c = 0; c < 4; c += 1) {
            acc[c] = Math.floor((acc[c]! * (256 - xap) + acc2[c]! * xap) / 256);
          }
        }
        for (let c = 0; c < 4; c += 1) d[di + c] = Math.floor(acc[c]! / 16384);
      }
    }
    return out;
  }

  if (ys.up) {
    // Down on X, up on Y: qt_qimageScaleAARGBA_down_x_up_y (:474-513).
    for (let y = 0; y < dh; y += 1) {
      const rowBase = ypoints[y]! * sow;
      const yap = yapoints[y]!;
      let di = y * dw * 4;
      for (let x = 0; x < dw; x += 1, di += 4) {
        const Cx = xapoints[x]! >> 16;
        const xap = xapoints[x]! & 0xffff;
        const o = rowBase + xpoints[x]! * 4;
        areaSum(s, o, xap, Cx, 4, acc);
        if (yap > 0) {
          areaSum(s, o + sow, xap, Cx, 4, acc2);
          for (let c = 0; c < 4; c += 1) {
            acc[c] = Math.floor((acc[c]! * (256 - yap) + acc2[c]! * yap) / 256);
          }
        }
        for (let c = 0; c < 4; c += 1) d[di + c] = Math.floor(acc[c]! / 16384);
      }
    }
    return out;
  }

  // Down on both axes: qt_qimageScaleAARGBA_down_xy (:515-560). The sums
  // exceed 2^31 for bright pixels; the NEON lanes are unsigned, like here.
  const sum = new Float64Array(4);
  for (let y = 0; y < dh; y += 1) {
    const Cy = yapoints[y]! >> 16;
    const yap = yapoints[y]! & 0xffff;
    const rowBase = ypoints[y]! * sow;
    let di = y * dw * 4;
    for (let x = 0; x < dw; x += 1, di += 4) {
      const Cx = xapoints[x]! >> 16;
      const xap = xapoints[x]! & 0xffff;
      let o = rowBase + xpoints[x]! * 4;
      areaSum(s, o, xap, Cx, 4, acc);
      for (let c = 0; c < 4; c += 1) sum[c] = Math.floor(acc[c]! / 16) * yap;
      let j = 16384 - yap;
      for (; j > Cy; j -= Cy) {
        o += sow;
        areaSum(s, o, xap, Cx, 4, acc);
        for (let c = 0; c < 4; c += 1) sum[c] = sum[c]! + Math.floor(acc[c]! / 16) * Cy;
      }
      o += sow;
      areaSum(s, o, xap, Cx, 4, acc);
      for (let c = 0; c < 4; c += 1) {
        sum[c] = sum[c]! + Math.floor(acc[c]! / 16) * j;
        d[di + c] = Math.floor(sum[c]! / 16777216);
      }
    }
  }
  return out;
}

/**
 * The size `QImage::scaled(QSize(w, h), mode, Qt::SmoothTransformation)`
 * produces: `QSize::scale` then at least 1×1 (qimage.cpp:2821-2842), then
 * `QImage::transformed` rounds `int(scale * size + 0.9999)`.
 */
export function smoothScaledSize(sw: number, sh: number, w: number, h: number): { width: number; height: number } {
  return { width: Math.max(1, Math.trunc(w)), height: Math.max(1, Math.trunc(h)) };
}
