/**
 * QColor arithmetic and AudioVisualization's palettes, ported from
 * libopenshot 1.0 src/effects/AudioVisualization.cpp:50-192 and qtbase 5.15
 * src/gui/painting/qcolor.cpp (`toHsv` :2203-2246, `toRgb` HSV branch
 * :2050-2110, `fromHsv` :2514-2531).
 *
 * QColor keeps 16-bit channels: `QColor(r, g, b, a)` stores `x * 257`,
 * `fromHsv` produces channels that are not multiples of 257, and painting
 * uses all 16 bits (`rgba64()`), so colors here are 16-bit RGB. Every HSV
 * color the effect builds comes from an RGB seed, so storing HSV results as
 * RGB loses nothing. The HSV → RGB step fuses `1 - s*f` like the arm64 Qt
 * build (fmsub).
 */

import { fma, fmaf } from "../qt/fma.js";
import { clampf, clampi, f32, lround } from "./audio-visualization-analysis.js";

/** A QColor in RGB spec with 16-bit channels (`ct.argb`). */
export interface QtColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export function rgb8(r: number, g: number, b: number, a = 255): QtColor {
  return { r: r * 257, g: g * 257, b: b * 257, a: a * 257 };
}

/** `qt_div_257`: 16 → 8 bits, rounded. */
export function div257(x: number): number {
  const v = x + 128;
  return (v - (v >> 8)) >> 8;
}

export function red8(c: QtColor): number {
  return div257(c.r);
}
export function green8(c: QtColor): number {
  return div257(c.g);
}
export function blue8(c: QtColor): number {
  return div257(c.b);
}
export function alpha8(c: QtColor): number {
  return div257(c.a);
}

/** `QColor::setAlpha(int)`. */
export function withAlpha(c: QtColor, a: number): QtColor {
  return { r: c.r, g: c.g, b: c.b, a: a * 257 };
}

/** qRound for the non-negative values QColor converts. */
function qRoundPos(x: number): number {
  return Math.trunc(x + 0.5);
}

function fuzzyCompare(p1: number, p2: number): boolean {
  return Math.abs(p1 - p2) * 1e12 <= Math.min(Math.abs(p1), Math.abs(p2));
}

/** `QColor::getHsv(&h, &s, &v, &a)` on an RGB color (via `toHsv`). */
export function getHsv(c: QtColor): { h: number; s: number; v: number; a: number } {
  const r = c.r / 65535;
  const g = c.g / 65535;
  const b = c.b / 65535;
  const max = r > g && r > b ? r : g > b ? g : b;
  const min = r < g && r < b ? r : g < b ? g : b;
  const delta = max - min;
  const value = qRoundPos(max * 65535);
  let hue16 = 65535;
  let sat16 = 0;
  if (!(Math.abs(delta) <= 1e-12)) {
    sat16 = qRoundPos((delta / max) * 65535);
    let hue = 0;
    if (fuzzyCompare(r, max)) hue = (g - b) / delta;
    else if (fuzzyCompare(g, max)) hue = 2 + (b - r) / delta;
    else if (fuzzyCompare(b, max)) hue = 4 + (r - g) / delta;
    hue *= 60;
    if (hue < 0) hue += 360;
    hue16 = qRoundPos(hue * 100);
  }
  return {
    h: hue16 === 65535 ? -1 : Math.trunc(hue16 / 100),
    s: div257(sat16),
    v: div257(value),
    a: div257(c.a),
  };
}

/** `QColor::fromHsv(h, s, v, a)` converted to RGB (`toRgb`). Arguments are in range. */
export function fromHsv(h: number, s: number, v: number, a: number): QtColor {
  const hue16 = h === -1 ? 65535 : (h % 360) * 100;
  const sat16 = s * 257;
  const val16 = v * 257;
  const alpha = a * 257;
  if (sat16 === 0 || hue16 === 65535) return { r: val16, g: val16, b: val16, a: alpha };
  const hh = hue16 === 36000 ? 0 : hue16 / 6000;
  const ss = sat16 / 65535;
  const vv = val16 / 65535;
  const i = Math.trunc(hh);
  const f = hh - i;
  const p = vv * (1 - ss);
  const R = (x: number): number => qRoundPos(x * 65535);
  if (i & 1) {
    const q = vv * fma(-ss, f, 1);
    if (i === 1) return { r: R(q), g: R(vv), b: R(p), a: alpha };
    if (i === 3) return { r: R(p), g: R(q), b: R(vv), a: alpha };
    return { r: R(vv), g: R(p), b: R(q), a: alpha };
  }
  const t = vv * fma(-ss, 1 - f, 1);
  if (i === 0) return { r: R(vv), g: R(t), b: R(p), a: alpha };
  if (i === 2) return { r: R(p), g: R(vv), b: R(t), a: alpha };
  return { r: R(t), g: R(p), b: R(vv), a: alpha };
}

// ---------------------------------------------------------------------------
// Effect color helpers (:50-103)
// ---------------------------------------------------------------------------

/** `mix_color`: per 8-bit channel `lround(fma(a, 1 - t, b*t))`, alpha included. */
export function mixColor(a: QtColor, b: QtColor, amount: number): QtColor {
  const t = clampf(amount, 0, 1);
  const inv = f32(1 - t);
  const ch = (x: number, y: number): number => clampi(lround(fmaf(x, inv, f32(t * y))), 0, 255);
  return rgb8(ch(red8(a), red8(b)), ch(green8(a), green8(b)), ch(blue8(a), blue8(b)), ch(alpha8(a), alpha8(b)));
}

/** `alpha_color`: alpha becomes `lround(alpha * s)`. */
export function alphaColor(c: QtColor, scale: number): QtColor {
  return withAlpha(c, clampi(lround(f32(scale * alpha8(c))), 0, 255));
}

/** `hue_shift`. */
export function hueShift(c: QtColor, degrees: number): QtColor {
  const hsv = getHsv(c);
  const h = hsv.h < 0 ? 0 : hsv.h;
  return fromHsv((h + degrees + 360) % 360, hsv.s, hsv.v, alpha8(c));
}

/** `rainbow_color`: the seed's hue rotated by `pos*360`, saturation/value scaled by the spread. */
export function rainbowColor(seed: QtColor, position: number, spread: number): QtColor {
  const hsv = getHsv(seed);
  const h = hsv.h < 0 ? 0 : hsv.h;
  const sp = clampf(spread, 0, 1);
  const hue = (h + lround(f32(clampf(position, 0, 1) * 360))) % 360;
  const saturation = clampi(lround(f32(fmaf(sp, f32(0.35), f32(0.65)) * hsv.s)), 0, 255);
  const value = clampi(lround(f32(fmaf(sp, f32(0.12), f32(0.88)) * hsv.v)), 0, 255);
  return fromHsv(hue, saturation, value, alpha8(seed));
}

// ---------------------------------------------------------------------------
// Palette and style helpers (:105-192)
// ---------------------------------------------------------------------------

export const STYLE_CLEAN = 0;
export const STYLE_SOFT = 1;
export const STYLE_NEON = 2;
export const STYLE_MINIMAL = 3;

export interface Palette {
  base: QtColor;
  dark: QtColor;
  light: QtColor;
  accent: QtColor;
  glow: QtColor;
}

function basePalette(base: QtColor, glowAmount: number, style: number): Palette {
  const a = alpha8(base);
  const dark = mixColor(base, rgb8(0, 0, 0, a), f32(0.62));
  let light = mixColor(base, rgb8(255, 255, 255, a), f32(0.28));
  let accent = mixColor(base, light, f32(0.35));
  if (style === STYLE_MINIMAL) {
    light = base;
    accent = base;
  } else if (style === STYLE_SOFT) {
    light = mixColor(base, rgb8(255, 255, 255, a), f32(0.42));
    accent = light;
  } else if (style === STYLE_NEON) {
    light = mixColor(base, rgb8(255, 255, 255, a), f32(0.18));
    accent = light;
  }
  const glow = alphaColor(light, fmaf(glowAmount, f32(0.65), f32(0.18)));
  return { base, dark, light, accent, glow };
}

/** `make_palette(base, glow, style, color_spread)`: the glow alpha is applied twice (:133-141). */
export function makePalette(base: QtColor, glowAmount: number, style: number, colorSpread: number): Palette {
  const p = basePalette(base, glowAmount, style);
  const spread = clampf(colorSpread, 0, 1);
  return {
    base,
    dark: mixColor(base, p.dark, spread),
    light: mixColor(base, p.light, spread),
    accent: mixColor(base, p.accent, spread),
    glow: alphaColor(mixColor(base, p.glow, spread), fmaf(glowAmount, f32(0.65), f32(0.18))),
  };
}

/** `style_glow_amount` (:143-151). */
export function styleGlowAmount(style: number, glow: number): number {
  if (style === STYLE_NEON) return clampf(glow < f32(0.45) ? f32(0.45) : glow, 0, 1);
  if (style === STYLE_SOFT) return clampf(glow < f32(0.22) ? f32(0.22) : glow, 0, 1);
  if (style === STYLE_MINIMAL) return f32(glow * f32(0.2));
  return glow;
}

/** `style_stroke_width` (:153-161), fused like the build. */
export function styleStrokeWidth(style: number, glow: number): number {
  if (style === STYLE_MINIMAL) return 1;
  if (style === STYLE_SOFT) return fmaf(glow, f32(1.4), f32(2.4));
  if (style === STYLE_NEON) return fmaf(glow, f32(1.2), f32(1.8));
  return fmaf(glow, f32(1.6), 1.5);
}

/** `style_fill_alpha` (:163-171). */
export function styleFillAlpha(style: number): number {
  if (style === STYLE_MINIMAL) return 1;
  if (style === STYLE_NEON) return f32(0.82);
  if (style === STYLE_SOFT) return f32(0.74);
  return f32(0.72);
}

/** A gradient stop: position (double) and color. */
export interface GradientStop {
  pos: number;
  color: QtColor;
}

/** `QGradient::setColorAt`: sorted insert, an equal position replaces (qbrush.cpp). */
export function setColorAt(stops: GradientStop[], pos: number, color: QtColor): void {
  if (pos > 1 || pos < 0) return;
  let index = 0;
  while (index < stops.length && stops[index]!.pos < pos) index += 1;
  if (index < stops.length && stops[index]!.pos === pos) stops[index] = { pos, color };
  else stops.splice(index, 0, { pos, color });
}

const RAINBOW_STOPS = [0, 0.16, 0.33, 0.5, 0.66, 0.83, 1].map((v) => f32(v));

/** `set_rainbow_stops` (:98-103): float stop positions, rainbow colors at an alpha scale. */
export function rainbowStops(seed: QtColor, spread: number, alphaScale = 1): GradientStop[] {
  const stops: GradientStop[] = [];
  for (const stop of RAINBOW_STOPS) setColorAt(stops, stop, alphaColor(rainbowColor(seed, stop, spread), alphaScale));
  return stops;
}

/** The brush `vertical_style_fill` returns (:173-192): a solid color or a linear gradient. */
export type StyleFill =
  | { kind: "solid"; color: QtColor }
  | { kind: "linear"; x1: number; y1: number; x2: number; y2: number; stops: GradientStop[] };

export function verticalStyleFill(x0: number, y0: number, x1: number, y1: number, palette: Palette, style: number, alphaScale = 1): StyleFill {
  if (style === STYLE_MINIMAL) return { kind: "solid", color: alphaColor(palette.base, f32(styleFillAlpha(style) * alphaScale)) };
  const stops: GradientStop[] = [];
  if (style === STYLE_NEON) {
    setColorAt(stops, 0, alphaColor(palette.light, f32(f32(0.92) * alphaScale)));
    setColorAt(stops, 0.5, alphaColor(palette.base, f32(f32(0.7) * alphaScale)));
    setColorAt(stops, 1, alphaColor(palette.base, f32(f32(0.28) * alphaScale)));
  } else if (style === STYLE_SOFT) {
    setColorAt(stops, 0, alphaColor(palette.light, f32(f32(0.48) * alphaScale)));
    setColorAt(stops, 0.5, alphaColor(palette.base, f32(f32(0.78) * alphaScale)));
    setColorAt(stops, 1, alphaColor(palette.base, f32(f32(0.48) * alphaScale)));
  } else {
    setColorAt(stops, 0, alphaColor(palette.light, f32(f32(0.72) * alphaScale)));
    setColorAt(stops, 0.62, alphaColor(palette.base, f32(f32(0.72) * alphaScale)));
    setColorAt(stops, 1, alphaColor(palette.base, f32(f32(0.38) * alphaScale)));
  }
  return { kind: "linear", x1: x0, y1: y0, x2: x1, y2: y1, stops };
}
