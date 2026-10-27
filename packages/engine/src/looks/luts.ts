/**
 * Stylised looks as generated `.cube` LUTs, for the Color Grade effect's
 * LUT stage (libopenshot ColorMap, kernels/cube-lut.ts): solarise, chrome
 * (silver), bleach bypass, duotone (two colours) and colour accent (one hue
 * kept, the rest monochrome). Plain 3D LUTs, so the desktop renders them
 * with the same effect. Pure: colour in, cube text out.
 */

import { cubeLut, hexToRgb01 } from "../mattes/luts.js";

type Rgb = [number, number, number];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/**
 * Sabattier solarisation: each channel rises to white at mid-grey and folds
 * back to black in the highlights, so bright areas print as negatives with
 * colour fringes where channels cross (the "solarized flash" of hype reels).
 */
export function solarizeLut(): string {
  const fold = (x: number) => Math.pow(Math.sin(Math.PI * clamp01(x)), 0.85);
  return cubeLut("Zenvi solarize", 33, (r, g, b) => [fold(r), fold(g), fold(b)]);
}

/**
 * Chrome / silver: monochrome with a hard metallic curve, the top of the
 * range folded back down (a partial solarise reads as polished metal) and a
 * cold blue-steel cast.
 */
export function chromeLut(): string {
  return cubeLut("Zenvi chrome", 33, (r, g, b) => {
    const l = luma(r, g, b);
    // Contrast S, then highlights above 0.72 fold down to a sheen.
    const s = smooth((l - 0.06) / 0.8);
    const v = l < 0.72 ? s : mix(s, 1 - (l - 0.72) * 1.9, smooth((l - 0.72) / 0.12));
    const c = clamp01(v);
    return [clamp01(c * 0.94 + 0.01), clamp01(c * 0.98 + 0.015), clamp01(c * 1.04 + 0.03)];
  });
}

/**
 * Bleach bypass: the silver left in the print, i.e. the colour overlaid on
 * its own luminance (harder contrast, crunchy highlights) and about half the
 * saturation.
 */
export function bleachBypassLut(): string {
  return cubeLut("Zenvi bleach bypass", 17, (r, g, b) => {
    const l = luma(r, g, b);
    const overlay = (x: number) => (l < 0.5 ? 2 * x * l : 1 - 2 * (1 - x) * (1 - l));
    const o: Rgb = [mix(r, overlay(r), 0.75), mix(g, overlay(g), 0.75), mix(b, overlay(b), 0.75)];
    const ol = luma(...o);
    return [clamp01(mix(o[0], ol, 0.55)), clamp01(mix(o[1], ol, 0.55)), clamp01(mix(o[2], ol, 0.55))];
  });
}

/** Duotone: luminance (with a gentle S so both inks read) mapped from the shadow colour to the highlight colour. */
export function duotoneLut(shadow: string, highlight: string): string {
  const a = hexToRgb01(shadow);
  const c = hexToRgb01(highlight);
  return cubeLut(`Zenvi duotone ${shadow.toLowerCase()} ${highlight.toLowerCase()}`, 17, (r, g, b) => {
    const t = mix(luma(r, g, b), smooth(luma(r, g, b)), 0.5);
    return [mix(a[0], c[0], t), mix(a[1], c[1], t), mix(a[2], c[2], t)];
  });
}

/** Hue (degrees) and saturation (HSV) of a colour. */
function hueSat(r: number, g: number, b: number): [number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d <= 1e-9) return [0, 0];
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max > 0 ? d / max : 0];
}

/** Hue of a `#rrggbb` colour, degrees. */
export function hueOf(hex: string): number {
  return hueSat(...hexToRgb01(hex))[0];
}

/**
 * Colour accent: one hue family (within about `width` degrees of `hue`)
 * keeps its colour, a little richer; everything else goes monochrome, a red
 * light or a yellow jacket the only colour in the frame.
 */
export function accentLut(hue: number, width = 28): string {
  return cubeLut(`Zenvi accent ${Math.round(hue)}`, 17, (r, g, b) => {
    const [h, s] = hueSat(r, g, b);
    const d = Math.abs(((h - hue + 540) % 360) - 180);
    // Greys and near-greys have no hue to keep.
    const keep = smooth(1 - d / width) * smooth((s - 0.12) / 0.2);
    const l = luma(r, g, b);
    const rich = (x: number) => clamp01(l + (x - l) * 1.15);
    return [mix(l, rich(r), keep), mix(l, rich(g), keep), mix(l, rich(b), keep)];
  });
}
