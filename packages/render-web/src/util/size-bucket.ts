/**
 * Raster sizes for caches.
 *
 * Decoded frames and stills are cached per size. A zooming clip asks for a
 * slightly different size every frame, so sizes are rounded up to a ladder of
 * scales (steps of 2^(1/4), ≤ 19% larger than asked) relative to the natural
 * size. Drawing a bitmap at most 19% smaller than its size keeps filtering
 * quality, and the cache sees a handful of sizes instead of one per frame.
 */

export interface Size {
  width: number;
  height: number;
}

const STEPS_PER_OCTAVE = 4;

function quantizeScale(scale: number): number {
  if (!(scale > 0) || !Number.isFinite(scale)) return 1;
  const step = Math.ceil(Math.log2(scale) * STEPS_PER_OCTAVE - 1e-9);
  return 2 ** (step / STEPS_PER_OCTAVE);
}

/**
 * The cache size for drawing a `natural`-sized source at `requested` size.
 * Raster sources are never enlarged past their natural size (the GPU does that
 * when drawing); vector sources (SVG) may be, up to `maxDimension`.
 */
export function bucketSize(requested: Size, natural: Size, options: { allowUpscale?: boolean; maxDimension?: number } = {}): Size {
  const maxDimension = options.maxDimension ?? 8192;
  const reqW = Math.max(1, requested.width);
  const reqH = Math.max(1, requested.height);
  if (!(natural.width > 0) || !(natural.height > 0)) {
    return { width: Math.min(maxDimension, Math.ceil(reqW)), height: Math.min(maxDimension, Math.ceil(reqH)) };
  }
  let sx = quantizeScale(reqW / natural.width);
  let sy = quantizeScale(reqH / natural.height);
  if (!options.allowUpscale) {
    sx = Math.min(1, sx);
    sy = Math.min(1, sy);
  }
  return {
    width: Math.max(1, Math.min(maxDimension, Math.round(natural.width * sx))),
    height: Math.max(1, Math.min(maxDimension, Math.round(natural.height * sy))),
  };
}
