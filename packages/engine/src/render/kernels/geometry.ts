/**
 * Pixel-moving effects: Crop, Shift, ColorShift, Wave, Deinterlace and Bars,
 * ported from libopenshot src/effects/Crop.cpp:54-112, Shift.cpp:47-110,
 * ColorShift.cpp:47-170, Wave.cpp:55-91, Deinterlace.cpp:47-90 and
 * Bars.cpp:58-110.
 */

import { roundHalfAway } from "../../model/rounding.js";
import { createPremul, type PremulImage } from "../pixels.js";
import { drawImageRect, fastScaled, toRect } from "../qt/blit.js";
import { bool, color, hexColorRgb, num } from "./params.js";
import type { KernelSpec, Params } from "./types.js";

const f32 = Math.fround;

/** QRectF with Qt's setLeft/setRight semantics (left moves, width adjusts). */
interface RectF {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const crop: KernelSpec = {
  type: "Crop",
  supported: true,
  run(image: PremulImage, params: Params): PremulImage {
    const left = num(params, "left", 0);
    const top = num(params, "top", 0);
    const right = num(params, "right", 0);
    const bottom = num(params, "bottom", 0);
    const xShift = num(params, "x", 0);
    const yShift = num(params, "y", 0);
    const W = image.width;
    const H = image.height;

    const paint: RectF = { x: left * W, y: top * H, w: Math.max(0, 1 - left - right) * W, h: Math.max(0, 1 - top - bottom) * H };
    const copy: RectF = { x: paint.x + xShift * W, y: paint.y + yShift * H, w: paint.w, h: paint.h };
    const setLeft = (r: RectF, pos: number): void => {
      const diff = pos - r.x;
      r.x += diff;
      r.w -= diff;
    };
    const setTop = (r: RectF, pos: number): void => {
      const diff = pos - r.y;
      r.y += diff;
      r.h -= diff;
    };
    if (copy.x < 0) {
      setLeft(paint, paint.x - copy.x);
      setLeft(copy, 0);
    }
    if (copy.x + copy.w > W) {
      paint.w = paint.x + paint.w - (copy.x + copy.w - W) - paint.x;
      copy.w = W - copy.x;
    }
    if (copy.y < 0) {
      setTop(paint, paint.y - copy.y);
      setTop(copy, 0);
    }
    if (copy.y + copy.h > H) {
      paint.h = paint.y + paint.h - (copy.y + copy.h - H) - paint.y;
      copy.h = H - copy.y;
    }

    const cropped = createPremul(W, H);
    drawImageRect(cropped, image, { x: paint.x, y: paint.y, width: paint.w, height: paint.h }, { x: copy.x, y: copy.y, width: copy.w, height: copy.h });

    if (!bool(params, "resize", false)) return cropped;
    // cropped.copy(paint_r.toRect()): a smaller image, out-of-range pixels transparent.
    const r = toRect({ x: paint.x, y: paint.y, width: paint.w, height: paint.h });
    if (r.width === 0 && r.height === 0) return cropped; // QImage::copy(null rect) copies everything
    if (r.width <= 0 || r.height <= 0) return createPremul(0, 0);
    const out = createPremul(r.width, r.height);
    for (let row = 0; row < r.height; row += 1) {
      const sy = r.y + row;
      if (sy < 0 || sy >= H) continue;
      for (let col = 0; col < r.width; col += 1) {
        const sx = r.x + col;
        if (sx < 0 || sx >= W) continue;
        const si = (sy * W + sx) * 4;
        const di = (row * r.width + col) * 4;
        out.data[di] = cropped.data[si]!;
        out.data[di + 1] = cropped.data[si + 1]!;
        out.data[di + 2] = cropped.data[si + 2]!;
        out.data[di + 3] = cropped.data[si + 3]!;
      }
    }
    return out;
  },
};

export const shift: KernelSpec = {
  type: "Shift",
  supported: true,
  run(image: PremulImage, params: Params): void {
    const W = image.width;
    const H = image.height;
    const d = image.data;
    const xShift = num(params, "x", 0);
    const yShift = num(params, "y", 0);
    const xLimit = Math.abs(xShift) % 1;
    const yLimit = Math.abs(yShift) % 1;
    if (xShift !== 0) {
      const s = Math.trunc(roundHalfAway(W * xLimit));
      const row = new Uint8ClampedArray(W * 4);
      for (let y = 0; y < H; y += 1) {
        const base = y * W * 4;
        row.set(d.subarray(base, base + W * 4));
        if (xShift > 0) {
          d.set(row.subarray(0, (W - s) * 4), base + s * 4);
          d.set(row.subarray((W - s) * 4, W * 4), base);
        } else {
          d.set(row.subarray(s * 4, W * 4), base);
          d.set(row.subarray(0, s * 4), base + (W - s) * 4);
        }
      }
    }
    if (yShift !== 0) {
      const s = W * Math.trunc(roundHalfAway(H * yLimit));
      const n = W * H;
      const tmp = new Uint8ClampedArray(d);
      if (yShift > 0) {
        d.set(tmp.subarray(0, (n - s) * 4), s * 4);
        d.set(tmp.subarray((n - s) * 4, n * 4), 0);
      } else {
        d.set(tmp.subarray(s * 4, n * 4), 0);
        d.set(tmp.subarray(0, s * 4), (n - s) * 4);
      }
    }
  },
};

export const colorShift: KernelSpec = {
  type: "ColorShift",
  supported: true,
  run(image: PremulImage, params: Params): void {
    const W = image.width;
    const H = image.height;
    if (W <= 0 || H <= 0) return;
    const keys = ["red", "green", "blue", "alpha"] as const;
    const src = new Uint8ClampedArray(image.data);
    const d = image.data;
    keys.forEach((name, c) => {
      const xs = f32(num(params, `${name}_x`, 0));
      const ys = f32(num(params, `${name}_y`, 0));
      const xl = Math.trunc(roundHalfAway(W * (Math.abs(xs) % 1)));
      const yl = Math.trunc(roundHalfAway(H * (Math.abs(ys) % 1)));
      // Pixel (row, col) moves to (row + dy, col + dx) with wraparound.
      const dx = xs > 0 ? xl : xs < 0 ? -xl : 0;
      const dy = ys > 0 ? yl : ys < 0 ? -yl : 0;
      if (dx === 0 && dy === 0) return;
      for (let row = 0; row < H; row += 1) {
        const ty = (((row + dy) % H) + H) % H;
        for (let col = 0; col < W; col += 1) {
          const tx = (((col + dx) % W) + W) % W;
          d[(ty * W + tx) * 4 + c] = src[(row * W + col) * 4 + c]!;
        }
      }
    });
  },
};

export const wave: KernelSpec = {
  type: "Wave",
  supported: true,
  run(image: PremulImage, params: Params, ctx): void {
    const W = image.width;
    const count = W * image.height;
    if (count === 0) return;
    const original = new Uint8ClampedArray(image.data);
    const d = image.data;
    const time = ctx.frame;
    const wavelength = num(params, "wavelength", 0.06);
    const amplitude = num(params, "amplitude", 0.3);
    const multiplier = num(params, "multiplier", 0.2);
    const shiftX = num(params, "shift_x", 0);
    const speedY = num(params, "speed_y", 0.2);
    let rowOffset = 0;
    for (let Y = 0; Y < image.height; Y += 1) {
      const noiseVal = f32((100 + Y * 0.001) * multiplier);
      const noiseAmp = f32(noiseVal * amplitude);
      const waveform = f32(Math.sin(Y * wavelength + time * speedY));
      const waveVal = f32((waveform + shiftX) * noiseAmp);
      for (let x = 0; x < W; x += 1) {
        const pixel = rowOffset + x;
        // lround(pixel + waveVal): the sum is a float addition.
        let source = roundHalfAway(f32(pixel + waveVal));
        if (source < 0) source = 0;
        if (source >= count) source = count - 1;
        d[pixel * 4] = original[source * 4]!;
        d[pixel * 4 + 1] = original[source * 4 + 1]!;
        d[pixel * 4 + 2] = original[source * 4 + 2]!;
        d[pixel * 4 + 3] = original[source * 4 + 3]!;
      }
      rowOffset += W;
    }
  },
};

export const deinterlace: KernelSpec = {
  type: "Deinterlace",
  supported: true,
  run(image: PremulImage, params: Params): PremulImage {
    const W = image.width;
    const H = image.height;
    const start = bool(params, "isOdd", true) ? 1 : 0;
    const rows = Math.trunc((H - start + 1) / 2);
    if (rows <= 0 || W <= 0) return createPremul(0, 0);
    const half = createPremul(W, rows);
    for (let i = 0; i < rows; i += 1) {
      const row = start + 2 * i;
      half.data.set(image.data.subarray(row * W * 4, (row + 1) * W * 4), i * W * 4);
    }
    return fastScaled(half, W, H);
  },
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export const bars: KernelSpec = {
  type: "Bars",
  supported: true,
  run(image: PremulImage, params: Params): void {
    const W = image.width;
    const H = image.height;
    if (W <= 0 || H <= 0) return;
    const [r, g, b] = hexColorRgb(color(params, "color", [0, 0, 0, 255]));
    const top = Math.trunc(clamp01(num(params, "top", 0.1)) * H);
    const bottom = Math.trunc(clamp01(num(params, "bottom", 0.1)) * H);
    const left = Math.trunc(clamp01(num(params, "left", 0)) * W);
    const right = Math.trunc(clamp01(num(params, "right", 0)) * W);
    const d = image.data;
    const paint = (row: number, from: number, to: number): void => {
      for (let x = from; x < to; x += 1) {
        const i = (row * W + x) * 4;
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = 255;
      }
    };
    for (let row = 0; row < H; row += 1) {
      if ((top > 0 && row <= top) || (bottom > 0 && row >= H - bottom)) {
        paint(row, 0, W);
      } else {
        if (left > 0) paint(row, 0, left);
        if (right > 0) paint(row, W - right, W);
      }
    }
  },
};
