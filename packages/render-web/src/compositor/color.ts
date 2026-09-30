/**
 * Plan colors (`RGBA`, libopenshot `Color` channels, each 0–255) as CSS.
 */

import type { RGBA } from "@zenvi/engine/render";

function channel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(Number.isFinite(value) ? value : 0)));
}

/** `rgba(r g b / a)` with alpha 0–255 mapped to 0–1. */
export function cssColor(color: RGBA): string {
  const [r, g, b, a] = color;
  return `rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${channel(a) / 255})`;
}

/**
 * The timeline background. libopenshot's canvas is always opaque: the color
 * without its alpha (`GetColorHex` drops it, libopenshot-semantics §3.5).
 */
export function opaqueCssColor(color: RGBA): string {
  const [r, g, b] = color;
  return `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`;
}
