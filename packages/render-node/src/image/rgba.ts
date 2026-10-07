/**
 * Straight-RGBA image helpers used by the decoders.
 *
 * Compositing math lives in the engine's CPU compositor; these helpers only
 * allocate and resample source images to the size a plan asks for.
 */

import type { RgbaImage } from "@zenvi/engine";

export function createRgba(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Wrap raw RGBA bytes (e.g. an ffmpeg rawvideo frame) without copying. */
export function rgbaView(bytes: Uint8Array, width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, width * height * 4) };
}

/**
 * Resample to `width`×`height`. Works in premultiplied space so transparent
 * edges do not bleed color. Downscaling averages every covered source pixel
 * (area filter); upscaling is bilinear.
 */
export function resizeRgba(src: RgbaImage, width: number, height: number): RgbaImage {
  if (src.width === width && src.height === height) return { width, height, data: new Uint8ClampedArray(src.data) };
  const out = createRgba(width, height);
  const sx = src.width / width;
  const sy = src.height / height;
  const s = src.data;
  const d = out.data;
  const sample = (x: number, y: number, acc: Float64Array, w: number) => {
    const i = (y * src.width + x) * 4;
    const a = s[i + 3]! * w;
    acc[0]! += s[i]! * a;
    acc[1]! += s[i + 1]! * a;
    acc[2]! += s[i + 2]! * a;
    acc[3]! += a;
  };
  const acc = new Float64Array(4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      acc.fill(0);
      let weight = 0;
      if (sx > 1 || sy > 1) {
        const x0 = x * sx;
        const x1 = Math.min(src.width, x0 + sx);
        const y0 = y * sy;
        const y1 = Math.min(src.height, y0 + sy);
        for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy += 1) {
          const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
          for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx += 1) {
            const w = (Math.min(xx + 1, x1) - Math.max(xx, x0)) * wy;
            if (w <= 0) continue;
            sample(xx, yy, acc, w);
            weight += w;
          }
        }
      } else {
        const fx = Math.max(0, Math.min(src.width - 1, (x + 0.5) * sx - 0.5));
        const fy = Math.max(0, Math.min(src.height - 1, (y + 0.5) * sy - 0.5));
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = fx - ix;
        const ty = fy - iy;
        const ix1 = Math.min(ix + 1, src.width - 1);
        const iy1 = Math.min(iy + 1, src.height - 1);
        sample(ix, iy, acc, (1 - tx) * (1 - ty));
        sample(ix1, iy, acc, tx * (1 - ty));
        sample(ix, iy1, acc, (1 - tx) * ty);
        sample(ix1, iy1, acc, tx * ty);
        weight = 1;
      }
      const o = (y * width + x) * 4;
      const alpha = acc[3]! / weight;
      if (alpha > 0) {
        d[o] = acc[0]! / acc[3]!;
        d[o + 1] = acc[1]! / acc[3]!;
        d[o + 2] = acc[2]! / acc[3]!;
      }
      d[o + 3] = alpha;
    }
  }
  return out;
}

/** Composite straight RGBA over an opaque color (for JPEG previews). */
export function flattenOver(src: RgbaImage, background: [number, number, number]): RgbaImage {
  const out = createRgba(src.width, src.height);
  const s = src.data;
  const d = out.data;
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3]! / 255;
    d[i] = s[i]! * a + background[0] * (1 - a);
    d[i + 1] = s[i + 1]! * a + background[1] * (1 - a);
    d[i + 2] = s[i + 2]! * a + background[2] * (1 - a);
    d[i + 3] = 255;
  }
  return out;
}
