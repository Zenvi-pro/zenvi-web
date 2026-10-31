/**
 * Visible bands in smooth gradients: cinetic's banding check
 * (scripts/forensics.py banding_tiles, MIT, (c) 2026 Leonxlnx) on one
 * decoded frame. A tile (64 px at 1080p) is banded when it holds a real
 * low-frequency gradient (1-12 levels across it) drawn as flat 8-bit
 * plateaus split by 1-2 level contours. A dithered gradient is not flat, a
 * flat fill has no gradient, and edges or texture are not smooth, so none
 * of those count. The fix is a dithered render (the encoder's deband pass).
 */

export interface BandingImage {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

/** Share of the frame above which banding is reported (forensics.py --band-area). */
export const BANDED_AREA = 0.03;

/** Luma, 0-255 integers (BT.709 weights). */
function luma(image: BandingImage): Uint8Array {
  const out = new Uint8Array(image.width * image.height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += 4) out[i] = Math.round(0.2126 * image.data[p]! + 0.7152 * image.data[p + 1]! + 0.0722 * image.data[p + 2]!);
  return out;
}

/** Local max minus local min over a (2r+1)^2 window, separably. */
function localRange(gray: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const pass = (src: Uint8Array, horizontal: boolean, max: boolean): Uint8Array => {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let v = max ? 0 : 255;
        for (let d = -r; d <= r; d += 1) {
          const xx = horizontal ? Math.min(w - 1, Math.max(0, x + d)) : x;
          const yy = horizontal ? y : Math.min(h - 1, Math.max(0, y + d));
          const s = src[yy * w + xx]!;
          v = max ? (s > v ? s : v) : s < v ? s : v;
        }
        out[y * w + x] = v;
      }
    }
    return out;
  };
  const hi = pass(pass(gray, true, true), false, true);
  const lo = pass(pass(gray, true, false), false, false);
  for (let i = 0; i < hi.length; i += 1) hi[i] = hi[i]! - lo[i]!;
  return hi;
}

export interface Banding {
  /** Share of the frame in banded tiles, 0-1. */
  area: number;
  tiles: number;
}

/** How much of `image` shows gradient banding. */
export function bandingOf(image: BandingImage): Banding {
  const { width: w, height: h } = image;
  const tile = Math.max(16, Math.round((64 * h) / 1080));
  const cols = Math.floor(w / tile);
  const rows = Math.floor(h / tile);
  if (cols === 0 || rows === 0) return { area: 0, tiles: 0 };
  const gray = luma(image);
  const range = localRange(gray, w, h, 2);
  const block = Math.max(1, Math.floor(tile / 4));
  let banded = 0;
  for (let ty = 0; ty < rows; ty += 1) {
    for (let tx = 0; tx < cols; tx += 1) {
      let smooth = 0;
      let flat = 0;
      let step = 0;
      for (let y = ty * tile; y < (ty + 1) * tile; y += 1) {
        for (let x = tx * tile; x < (tx + 1) * tile; x += 1) {
          const r = range[y * w + x]!;
          if (r <= 2) smooth += 1;
          if (r === 0) flat += 1;
          else if (r <= 2) step += 1;
        }
      }
      const n = tile * tile;
      if (!(smooth / n > 0.97 && flat / n > 0.5 && flat / n < 0.97 && step / n > 0.03)) continue;
      // The gradient's span across the tile, from 4x4 block means (the low-pass of forensics.py).
      let lo = Infinity;
      let hi = -Infinity;
      for (let by = ty * tile; by + block <= (ty + 1) * tile; by += block) {
        for (let bx = tx * tile; bx + block <= (tx + 1) * tile; bx += block) {
          let sum = 0;
          for (let y = by; y < by + block; y += 1) for (let x = bx; x < bx + block; x += 1) sum += gray[y * w + x]!;
          const mean = sum / (block * block);
          lo = Math.min(lo, mean);
          hi = Math.max(hi, mean);
        }
      }
      if (hi - lo >= 1 && hi - lo <= 12) banded += 1;
    }
  }
  return { area: Math.round(((banded * tile * tile) / (w * h)) * 1000) / 1000, tiles: banded };
}
