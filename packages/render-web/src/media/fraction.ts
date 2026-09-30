/**
 * Rational numbers for reader info (`fps`, `display_ratio`, timebases).
 */

import type { Fraction } from "@zenvi/engine";

export function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    [x, y] = [y, x % y];
  }
  return x;
}

/** libopenshot `Fraction::Reduce` (`Fraction.cpp`): divide both terms by their GCD. */
export function reduceFraction(num: number, den: number): Fraction {
  const g = gcd(num, den);
  return g > 0 ? { num: num / g, den: den / g } : { num, den };
}

/** libopenshot's frame-rate fallback when a stream reports nothing usable (`FFmpegReader.cpp:653-662`). */
export const FALLBACK_FPS: Fraction = { num: 30, den: 1 };

/**
 * Express a measured frame rate as the fraction FFmpeg's `av_guess_frame_rate`
 * would report: integers as n/1, NTSC rates as n·1000/1001, otherwise the
 * track's timebase over the frame duration in ticks, otherwise the best
 * rational approximation with a denominator of at most 1001.
 */
export function frameRateToFraction(fps: number | null | undefined, timeResolution?: number): Fraction {
  if (fps === null || fps === undefined || !Number.isFinite(fps) || fps <= 0) return { ...FALLBACK_FPS };
  const integer = Math.round(fps);
  if (integer > 0 && Math.abs(fps - integer) < 5e-4) return { num: integer, den: 1 };

  const ntsc = Math.round((fps * 1001) / 1000);
  if (ntsc > 0 && Math.abs(fps - (ntsc * 1000) / 1001) < 5e-4) return { num: ntsc * 1000, den: 1001 };

  if (timeResolution !== undefined && Number.isFinite(timeResolution) && timeResolution > 0) {
    const ticks = timeResolution / fps;
    const whole = Math.round(ticks);
    if (whole > 0 && Math.abs(ticks - whole) < 1e-3 && Number.isInteger(timeResolution)) {
      return reduceFraction(timeResolution, whole);
    }
  }
  return approximateRational(fps, 1001);
}

/** Best rational approximation p/q of `x` with q ≤ maxDen (continued fractions). */
export function approximateRational(x: number, maxDen: number): Fraction {
  let [h0, h1] = [0, 1];
  let [k0, k1] = [1, 0];
  let value = x;
  for (let i = 0; i < 64; i += 1) {
    const a = Math.floor(value);
    const k2 = a * k1 + k0;
    if (k2 > maxDen) break;
    const h2 = a * h1 + h0;
    [h0, h1] = [h1, h2];
    [k0, k1] = [k1, k2];
    const frac = value - a;
    if (frac < 1e-12) break;
    value = 1 / frac;
  }
  return k1 === 0 ? { num: Math.round(x), den: 1 } : reduceFraction(h1, k1);
}

export function fractionValue(f: Fraction): number {
  return f.den === 0 ? 0 : f.num / f.den;
}
