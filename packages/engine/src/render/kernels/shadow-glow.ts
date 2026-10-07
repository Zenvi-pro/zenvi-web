/**
 * Shadow and Glow, ported from libopenshot src/effects/Shadow.cpp:24-287 and
 * src/effects/Glow.cpp:24-274. Both turn the layer's alpha into a float mask,
 * dilate it by `spread`, blur it with three horizontal-then-vertical sliding
 * box passes, tint it into a premultiplied overlay and composite with
 * QPainter SourceOver: the shadow and the outer glow go under the source,
 * the inner glow over it.
 *
 * Both default to `apply_before_clip = false` (Shadow.cpp:232, Glow.cpp:182):
 * the planner runs them on the canvas-sized, already transformed layer. The
 * kernels only process the image they are given.
 *
 * Divergences (docs/PARITY.md):
 * - Box blur on images smaller than the window. Shadow.cpp:33-102 and
 *   Glow.cpp:33-102 read and write past the row (or column) when the image is
 *   narrower (or shorter) than `2 * blur_radius + 1`. That is undefined
 *   behavior: it overflows the heap on the last row or column, and the result
 *   depends on OpenMP scheduling. This port clamps every window index to the
 *   edge, which is exactly what the C++ computes whenever the image is large
 *   enough.
 * - Tint channels outside 0..255. The C++ stores `(unsigned char)(c * alpha)`
 *   through `fcvtzs`, so values wrap (Shadow.cpp:201-203, Glow.cpp:232-234,
 *   251-253). This port clamps the rounded channels to 0..255 first.
 */

import { roundHalfAway } from "../../model/rounding.js";
import { createPremul, type PremulImage } from "../pixels.js";
import { CompositionMode, composerFor } from "../qt/compose.js";
import { color, getInt, int, num } from "./params.js";
import type { KernelSpec, Params } from "./types.js";

const f32 = Math.fround;
const DEG_TO_RAD_F = f32(Math.PI / 180);

/** `shadow_clampf` / `glow_clampf` (Shadow.cpp:25-31): NaN passes through, like the C++. */
function clampf(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * One sliding box pass of radius `r` over `count` lines of `len` samples
 * (`shadow_blur_horizontal` / `_vertical`, Shadow.cpp:33-102). `step` is the
 * distance between samples in a line and `lineStep` between lines. The
 * running sum is a float accumulated in the C++ order: `(r+1)*first`, the
 * first `r` samples, then `+= (add - sub)` per output, `out = value * inv`.
 */
function boxPass(src: Float32Array, dst: Float32Array, len: number, count: number, step: number, lineStep: number, r: number): void {
  const inv = f32(1 / (r * 2 + 1));
  const lastIndex = len - 1;
  for (let line = 0; line < count; line += 1) {
    const base = line * lineStep;
    const first = src[base]!;
    const last = src[base + lastIndex * step]!;
    let value = f32((r + 1) * first);
    for (let j = 0; j < r; j += 1) value = f32(value + src[base + Math.min(j, lastIndex) * step]!);
    for (let x = 0; x < len; x += 1) {
      const ai = x + r;
      const add = ai < lastIndex ? src[base + ai * step]! : last;
      const si = x - r - 1;
      const sub = si < 0 ? first : src[base + si * step]!;
      value = f32(value + f32(add - sub));
      dst[base + x * step] = value * inv;
    }
  }
}

/** `shadow_apply_box_blur` (Shadow.cpp:104-113): `iterations` × (horizontal, vertical). */
function boxBlur(mask: Float32Array, w: number, h: number, r: number, iterations: number): void {
  if (r <= 0 || iterations <= 0 || w <= 0 || h <= 0) return;
  const temp = new Float32Array(mask.length);
  for (let i = 0; i < iterations; i += 1) {
    boxPass(mask, temp, w, h, 1, w, r);
    boxPass(temp, mask, h, w, w, 1, r);
  }
}

/**
 * One max-filter pass (`shadow_spread_horizontal` / `_vertical`,
 * Shadow.cpp:115-152): each output is `max(0, window max)` over the window
 * clipped to the line. A monotonic deque gives the same maxima in O(len).
 */
function maxPass(src: Float32Array, dst: Float32Array, len: number, count: number, step: number, lineStep: number, r: number, queue: Int32Array): void {
  for (let line = 0; line < count; line += 1) {
    const base = line * lineStep;
    let head = 0;
    let tail = 0;
    let next = 0;
    for (let x = 0; x < len; x += 1) {
      const right = Math.min(len - 1, x + r);
      while (next <= right) {
        const v = src[base + next * step]!;
        while (tail > head && src[base + queue[tail - 1]! * step]! <= v) tail -= 1;
        queue[tail] = next;
        tail += 1;
        next += 1;
      }
      while (queue[head]! < x - r) head += 1;
      const m = src[base + queue[head]! * step]!;
      dst[base + x * step] = m > 0 ? m : 0;
    }
  }
}

/** `shadow_apply_spread` (Shadow.cpp:154-161): separable dilation, rows then columns. */
function spread(mask: Float32Array, w: number, h: number, r: number): void {
  if (r <= 0 || w <= 0 || h <= 0) return;
  const temp = new Float32Array(mask.length);
  const queue = new Int32Array(Math.max(w, h));
  maxPass(mask, temp, w, h, 1, w, r, queue);
  maxPass(temp, mask, h, w, w, 1, r, queue);
}

/** `alpha / 255.0f` of every pixel (Shadow.cpp:259-264). */
function alphaMask(image: PremulImage): Float32Array {
  const d = image.data;
  const mask = new Float32Array(image.width * image.height);
  for (let i = 0; i < mask.length; i += 1) mask[i] = d[i * 4 + 3]! / 255;
  return mask;
}

/** `Color::GetColorRGBA` (Color.cpp:58-66): `GetInt` per channel; color channels clamped (see module doc). */
function tint(params: Params, fallback: [number, number, number, number]): { r: number; g: number; b: number; a: number } {
  const c = color(params, "color", fallback);
  const ch = (v: number): number => Math.min(255, Math.max(0, getInt(v)));
  return { r: ch(c[0]), g: ch(c[1]), b: ch(c[2]), a: f32(getInt(c[3]) / 255) };
}

/**
 * Write the tinted overlay for one pixel: `(uchar)(c * alpha)` per channel
 * and `(uchar)(255 * alpha)` (make_shadow_overlay, Shadow.cpp:182-209).
 */
function overlayPixel(out: Uint8ClampedArray, i: number, r: number, g: number, b: number, alpha: number): void {
  out[i] = Math.trunc(f32(r * alpha));
  out[i + 1] = Math.trunc(f32(g * alpha));
  out[i + 2] = Math.trunc(f32(b * alpha));
  out[i + 3] = Math.trunc(f32(255 * alpha));
}

/** `src` drawn over `dst` with QPainter SourceOver at full opacity (in place on `dst`). */
function sourceOver(dst: PremulImage, src: PremulImage): void {
  composerFor(CompositionMode.SourceOver)(dst.data, 0, src.data, 0, dst.width * dst.height, 255);
}

/** Shadow::GetFrame (Shadow.cpp:235-287). */
function shadowKernel(image: PremulImage, params: Params): PremulImage | void {
  const w = image.width;
  const h = image.height;
  if (w <= 0 || h <= 0) return;
  const opacity = clampf(f32(num(params, "opacity", 0.6)), 0, 1);
  const blur = Math.max(0, getInt(num(params, "blur_radius", 18)));
  const spreadValue = clampf(f32(num(params, "spread", 0.12)), 0, 1);
  const distance = f32(num(params, "distance", 10));
  const angle = f32(num(params, "angle", 60));
  const c = tint(params, [0, 0, 0, 255]);
  // std::cos/std::sin of a float are cosf/sinf; Apple's equal fround(Math.cos) on
  // every tenth of a degree in ±720° (checked), so whole-degree angles are exact.
  const radians = f32(angle * DEG_TO_RAD_F);
  const shiftX = roundHalfAway(f32(f32(Math.cos(radians)) * distance));
  const shiftY = roundHalfAway(f32(f32(Math.sin(radians)) * distance));

  const mask = alphaMask(image);
  const spreadRadius = Math.max(0, roundHalfAway(f32(blur * spreadValue)));
  if (spreadRadius > 0) spread(mask, w, h, spreadRadius);

  // shadow_shift_mask (Shadow.cpp:163-180): move by (dx, dy), zero fill.
  const shifted = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const sy = y - shiftY;
    if (sy < 0 || sy >= h) continue;
    for (let x = 0; x < w; x += 1) {
      const sx = x - shiftX;
      if (sx >= 0 && sx < w) shifted[y * w + x] = mask[sy * w + sx]!;
    }
  }
  if (blur > 0) boxBlur(shifted, w, h, blur, 3);

  // Overlay on a transparent image, then the source over it (Shadow.cpp:274-283).
  const out = createPremul(w, h);
  for (let i = 0; i < shifted.length; i += 1) {
    const alpha = clampf(f32(f32(shifted[i]! * opacity) * c.a), 0, 1);
    if (alpha <= 0) continue;
    overlayPixel(out.data, i * 4, c.r, c.g, c.b, alpha);
  }
  sourceOver(out, image);
  return out;
}

/** Glow::GetFrame (Glow.cpp:185-274). `mode` 0 is outer, anything else inner. */
function glowKernel(image: PremulImage, params: Params): PremulImage | void {
  const w = image.width;
  const h = image.height;
  if (w <= 0 || h <= 0) return;
  const outer = int(params, "mode", 0) === 0;
  const opacity = clampf(f32(num(params, "opacity", 0.45)), 0, 1);
  const blur = Math.max(0, getInt(num(params, "blur_radius", 20)));
  const spreadValue = clampf(f32(num(params, "spread", 0.1)), 0, 1);
  const c = tint(params, [255, 244, 194, 255]);

  const mask = alphaMask(image);
  const spreadRadius = Math.max(0, roundHalfAway(f32(blur * spreadValue)));
  if (spreadRadius > 0) spread(mask, w, h, spreadRadius);

  const overlay = createPremul(w, h);
  if (outer) {
    const blurred = new Float32Array(mask);
    if (blur > 0) boxBlur(blurred, w, h, blur, 3);
    for (let i = 0; i < blurred.length; i += 1) {
      const alpha = clampf(f32(f32(blurred[i]! * opacity) * c.a), 0, 1);
      overlayPixel(overlay.data, i * 4, c.r, c.g, c.b, alpha);
    }
    // Overlay first, the source over it (Glow.cpp:263-265).
    sourceOver(overlay, image);
    return overlay;
  }
  const inverse = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) inverse[i] = 1 - mask[i]!;
  if (blur > 0) boxBlur(inverse, w, h, blur, 3);
  for (let i = 0; i < inverse.length; i += 1) {
    const alpha = clampf(f32(f32(f32(inverse[i]! * mask[i]!) * opacity) * c.a), 0, 1);
    overlayPixel(overlay.data, i * 4, c.r, c.g, c.b, alpha);
  }
  // The source first, the overlay over it (Glow.cpp:266-269).
  sourceOver(image, overlay);
}

export const shadow: KernelSpec = { type: "Shadow", supported: true, run: shadowKernel };

export const glow: KernelSpec = { type: "Glow", supported: true, run: glowKernel };
