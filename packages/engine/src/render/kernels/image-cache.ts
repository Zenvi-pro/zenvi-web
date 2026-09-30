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

const cache = new WeakMap<RgbaImage, Map<string, PremulImage>>();

/** `source` premultiplied and smooth-scaled (Qt::IgnoreAspectRatio) to `width`×`height`. */
export function scaledPremul(source: RgbaImage, width: number, height: number): PremulImage {
  let bySize = cache.get(source);
  if (!bySize) {
    bySize = new Map();
    cache.set(source, bySize);
  }
  const key = `${width}x${height}`;
  let hit = bySize.get(key);
  if (!hit) {
    hit = smoothScale(premultiply(source), width, height);
    // Keep a handful of sizes per source (preview resizes produce new ones).
    if (bySize.size >= 4) bySize.delete(bySize.keys().next().value!);
    bySize.set(key, hit);
  }
  return hit;
}
