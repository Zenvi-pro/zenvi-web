/**
 * Scaled, premultiplied copies of the extra images kernels read (masks,
 * displacement maps), cached per source image object and target size, like
 * libopenshot caches still masks per size (EffectBase.cpp:506-543). Renderers
 * keep passing the same `RgbaImage` object for a still, so the premultiply +
 * smooth scale runs once.
 */

import { premultiply, type PremulImage } from "../pixels.js";
import { smoothScale } from "../qt/smooth-scale.js";
import type { RgbaImage } from "../types.js";

const cache = new WeakMap<object, Map<string, PremulImage>>();

function cached(source: RgbaImage | PremulImage, key: string, make: () => PremulImage): PremulImage {
  let bySize = cache.get(source);
  if (!bySize) {
    bySize = new Map();
    cache.set(source, bySize);
  }
  let hit = bySize.get(key);
  if (!hit) {
    hit = make();
    // Keep a handful of sizes per source (preview resizes produce new ones).
    if (bySize.size >= 4) bySize.delete(bySize.keys().next().value!);
    bySize.set(key, hit);
  }
  return hit;
}

/**
 * `source` premultiplied and smooth-scaled (Qt::IgnoreAspectRatio) to
 * `width`×`height`. `delivered` is the size the effect's reader hands the
 * image over at (`EffectInstance.imageSizes`: readers parented to the clip
 * fit stills to its decode box first, QtImageReader.cpp:154-182); the image
 * is scaled to it before the final stretch, like the desktop.
 */
export function scaledPremul(source: RgbaImage, width: number, height: number, delivered?: { width: number; height: number }): PremulImage {
  let base: PremulImage | null = null;
  const premul = (): PremulImage => (base ??= cached(source, "premul", () => premultiply(source)));
  let from: () => PremulImage = premul;
  if (delivered && (delivered.width !== source.width || delivered.height !== source.height) && delivered.width > 0 && delivered.height > 0) {
    from = () => cached(source, `via ${delivered.width}x${delivered.height}`, () => smoothScale(premul(), delivered.width, delivered.height));
  }
  const via = delivered ? `${delivered.width}x${delivered.height}` : "";
  return cached(source, `${width}x${height}<${via}`, () => {
    const img = from();
    return img.width === width && img.height === height ? img : smoothScale(img, width, height);
  });
}
