/**
 * Generated `.cube` LUTs for the ColorMap effect (libopenshot
 * src/effects/ColorMap.cpp, kernels/cube-lut.ts): a solid fill (every input
 * colour maps to one colour, so a cut-out becomes a flat silhouette) and
 * gradient maps (luminance → a colour ramp, the thermal / duotone looks).
 * Plain 3D LUTs keep the desktop rendering them with the same effect.
 */

export interface GradientStop {
  /** Input luminance 0..1. */
  at: number;
  /** `#rrggbb`. */
  color: string;
}

/** Iron-bow thermal camera ramp: cold black-blue through magenta and orange to white hot (skin, mid-gray, reads orange). */
export const THERMAL_RAMP: readonly GradientStop[] = [
  { at: 0, color: "#05003a" },
  { at: 0.12, color: "#3a0a8c" },
  { at: 0.25, color: "#b0127a" },
  { at: 0.38, color: "#f0402a" },
  { at: 0.52, color: "#ff9a1a" },
  { at: 0.7, color: "#ffe14d" },
  { at: 0.9, color: "#ffffff" },
];

/** The cold end of the thermal palette, for the scene behind a hot subject. */
export const THERMAL_COLD_RAMP: readonly GradientStop[] = [
  { at: 0, color: "#000010" },
  { at: 0.5, color: "#0b1f6b" },
  { at: 1, color: "#2f6fd0" },
];

/** `#rrggbb` → 0..1 channels. */
export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const v = Number.parseInt(m[1]!, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function fmt(v: number): string {
  return (Math.round(Math.min(1, Math.max(0, v)) * 1e6) / 1e6).toString();
}

/** A 3D cube file of `size`³ entries, red fastest (the order ColorMap reads). */
function cube(title: string, size: number, map: (r: number, g: number, b: number) => [number, number, number]): string {
  const lines = [`TITLE "${title.replace(/"/g, "")}"`, `LUT_3D_SIZE ${size}`];
  const step = 1 / (size - 1);
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        const [R, G, B] = map(r * step, g * step, b * step);
        lines.push(`${fmt(R)} ${fmt(G)} ${fmt(B)}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Every colour → `hex`: a flat silhouette fill. */
export function solidLut(hex: string): string {
  const rgb = hexToRgb01(hex);
  return cube(`Zenvi solid ${hex.toLowerCase()}`, 2, () => rgb);
}

/** The ramp's colour at `t` (0..1), linear between stops. */
export function rampColor(stops: readonly GradientStop[], t: number): [number, number, number] {
  if (stops.length === 0) throw new Error("a gradient needs at least one stop");
  const sorted = [...stops].sort((a, b) => a.at - b.at);
  if (t <= sorted[0]!.at) return hexToRgb01(sorted[0]!.color);
  for (let i = 1; i < sorted.length; i += 1) {
    const hi = sorted[i]!;
    if (t <= hi.at) {
      const lo = sorted[i - 1]!;
      const k = hi.at > lo.at ? (t - lo.at) / (hi.at - lo.at) : 1;
      const a = hexToRgb01(lo.color);
      const c = hexToRgb01(hi.color);
      return [a[0] + (c[0] - a[0]) * k, a[1] + (c[1] - a[1]) * k, a[2] + (c[2] - a[2]) * k];
    }
  }
  return hexToRgb01(sorted[sorted.length - 1]!.color);
}

/** Rec. 709 luminance → the ramp (a gradient map). 33³ like common grading LUTs. */
export function gradientMapLut(title: string, stops: readonly GradientStop[], size = 33): string {
  return cube(title, size, (r, g, b) => rampColor(stops, 0.2126 * r + 0.7152 * g + 0.0722 * b));
}
