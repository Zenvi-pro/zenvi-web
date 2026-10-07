/**
 * Blur and Pixelate, ported from libopenshot src/effects/Blur.cpp:82-261 and
 * Pixelate.cpp:73-112. Both work on a margin-inset area and write back with
 * QPainter SourceOver over the original (so they are not replacements where
 * the result is semi-transparent).
 */

import { copyRect, createPremul, type PremulImage } from "../pixels.js";
import { drawImageRect } from "../qt/blit.js";
import { intersected, isEmpty, marginsRemoved, qrect, rectHeight, rectWidth, type QRect } from "../qt/rect.js";
import { smoothScale } from "../qt/smooth-scale.js";
import { getInt, num } from "./params.js";
import type { KernelSpec, Params } from "./types.js";

const f32 = Math.fround;

function clampMargin(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** The effect area: the image minus `int(clamp01(margin) * size)` on each side (Blur.cpp:99-107). */
export function marginArea(image: PremulImage, params: Params): QRect | null {
  const w = image.width;
  const h = image.height;
  const area = intersected(
    marginsRemoved(
      qrect(0, 0, w, h),
      Math.trunc(clampMargin(num(params, "left", 0)) * w),
      Math.trunc(clampMargin(num(params, "top", 0)) * h),
      Math.trunc(clampMargin(num(params, "right", 0)) * w),
      Math.trunc(clampMargin(num(params, "bottom", 0)) * h),
    ),
    qrect(0, 0, w, h),
  );
  return isEmpty(area) ? null : area;
}

/** Blur::boxBlurH: sliding window over rows, clamp-to-edge, all four channels. */
function boxBlurH(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number): void {
  const iarr = f32(1 / (r + r + 1));
  for (let y = 0; y < h; y += 1) {
    const row = y * w * 4;
    let v0 = 0;
    let v1 = 0;
    let v2 = 0;
    let v3 = 0;
    for (let j = -r; j <= r; j += 1) {
      const p = row + Math.min(Math.max(j, 0), w - 1) * 4;
      v0 += src[p]!;
      v1 += src[p + 1]!;
      v2 += src[p + 2]!;
      v3 += src[p + 3]!;
    }
    for (let j = 0; j < w; j += 1) {
      const o = row + j * 4;
      dst[o] = Math.trunc(f32(v0 * iarr + 0.5));
      dst[o + 1] = Math.trunc(f32(v1 * iarr + 0.5));
      dst[o + 2] = Math.trunc(f32(v2 * iarr + 0.5));
      dst[o + 3] = Math.trunc(f32(v3 * iarr + 0.5));
      const rem = row + Math.min(Math.max(j - r, 0), w - 1) * 4;
      const add = row + Math.min(Math.max(j + r + 1, 0), w - 1) * 4;
      v0 += src[add]! - src[rem]!;
      v1 += src[add + 1]! - src[rem + 1]!;
      v2 += src[add + 2]! - src[rem + 2]!;
      v3 += src[add + 3]! - src[rem + 3]!;
    }
  }
}

/** Blur::boxBlurT: the same window down each column. */
function boxBlurT(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number): void {
  const iarr = f32(1 / (r + r + 1));
  const stride = w * 4;
  for (let x = 0; x < w; x += 1) {
    const col = x * 4;
    let v0 = 0;
    let v1 = 0;
    let v2 = 0;
    let v3 = 0;
    for (let j = -r; j <= r; j += 1) {
      const p = col + Math.min(Math.max(j, 0), h - 1) * stride;
      v0 += src[p]!;
      v1 += src[p + 1]!;
      v2 += src[p + 2]!;
      v3 += src[p + 3]!;
    }
    for (let j = 0; j < h; j += 1) {
      const o = col + j * stride;
      dst[o] = Math.trunc(f32(v0 * iarr + 0.5));
      dst[o + 1] = Math.trunc(f32(v1 * iarr + 0.5));
      dst[o + 2] = Math.trunc(f32(v2 * iarr + 0.5));
      dst[o + 3] = Math.trunc(f32(v3 * iarr + 0.5));
      const rem = col + Math.min(Math.max(j - r, 0), h - 1) * stride;
      const add = col + Math.min(Math.max(j + r + 1, 0), h - 1) * stride;
      v0 += src[add]! - src[rem]!;
      v1 += src[add + 1]! - src[rem + 1]!;
      v2 += src[add + 2]! - src[rem + 2]!;
      v3 += src[add + 3]! - src[rem + 3]!;
    }
  }
}

export const blur: KernelSpec = {
  type: "Blur",
  supported: true,
  customMaskBlend: true,
  run(image: PremulImage, params: Params): void {
    // `int horizontal_radius_value = horizontal_radius.GetValue(n)` truncates.
    const hRadius = Math.trunc(num(params, "horizontal_radius", 6));
    const vRadius = Math.trunc(num(params, "vertical_radius", 6));
    const iterations = getInt(num(params, "iterations", 3));
    if (image.width <= 0 || image.height <= 0 || iterations <= 0) return;
    const area = marginArea(image, params);
    if (!area) return;
    const aw = rectWidth(area);
    const ah = rectHeight(area);
    let a: Uint8ClampedArray = copyRect(image, area.x1, area.y1, aw, ah).data;
    let b: Uint8ClampedArray = new Uint8ClampedArray(a);
    const hr = Math.min(Math.max(0, hRadius), Math.max(0, aw - 1));
    const vr = Math.min(Math.max(0, vRadius), Math.max(0, ah - 1));
    let blurred = false;
    for (let it = 0; it < iterations; it += 1) {
      if (hr > 0) {
        boxBlurH(a, b, aw, ah, hr);
        [a, b] = [b, a];
        blurred = true;
      }
      if (vr > 0) {
        boxBlurT(a, b, aw, ah, vr);
        [a, b] = [b, a];
        blurred = true;
      }
    }
    if (!blurred) return;
    // painter.drawImage(area, *blur_image): SourceOver onto the original.
    const layer: PremulImage = { width: aw, height: ah, data: a, premultiplied: true };
    drawImageRect(image, layer, { x: area.x1, y: area.y1, width: aw, height: ah }, { x: 0, y: 0, width: aw, height: ah });
  },
};

/** `QImage::scaledToWidth(w, Qt::SmoothTransformation)` (qimage.cpp:2858-2872). */
function scaledToWidth(src: PremulImage, w: number): PremulImage {
  const factor = w / src.width;
  if (factor === 1) return src;
  const wd = Math.trunc(Math.abs(factor) * src.width + 0.9999);
  const hd = Math.trunc(Math.abs(factor) * src.height + 0.9999);
  if (wd === 0 || hd === 0) return createPremul(0, 0);
  return smoothScale(src, wd, hd);
}

export const pixelate: KernelSpec = {
  type: "Pixelate",
  supported: true,
  customMaskBlend: true,
  run(image: PremulImage, params: Params): void {
    const value = Math.min(Math.pow(0.001, Math.abs(num(params, "pixelization", 0.5))), 1);
    if (!(value > 0)) return;
    if (image.width <= 0 || image.height <= 0) return;
    const area = marginArea(image, params);
    if (!area) return;
    const aw = rectWidth(area);
    const ah = rectHeight(area);
    const scaleTo = Math.max(1, Math.trunc(aw * value));
    const small = scaledToWidth(copyRect(image, area.x1, area.y1, aw, ah), scaleTo);
    if (small.width === 0 || small.height === 0) return;
    // painter.drawImage(QRect area, small): nearest-neighbour stretch, SourceOver.
    drawImageRect(image, small, { x: area.x1, y: area.y1, width: aw, height: ah }, { x: 0, y: 0, width: small.width, height: small.height });
  },
};
