/**
 * Easing curves: the named cubic-beziers of docs/TASTE.md §2, a 6 %
 * overshoot for playful pops, and a damped spring.
 */

export type Ease = (t: number) => number;

/**
 * A CSS `cubic-bezier(x1, y1, x2, y2)` as a function of progress: x is
 * solved for t by Newton's method, falling back to bisection where the
 * slope is flat, the way browsers evaluate it.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (s: number): number => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number): number => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number): number => (3 * ax * s + 2 * bx) * s + cx;
  const solve = (x: number): number => {
    let s = x;
    for (let i = 0; i < 8; i += 1) {
      const err = sampleX(s) - x;
      if (Math.abs(err) < 1e-7) return s;
      const d = slopeX(s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    let lo = 0;
    let hi = 1;
    s = x;
    for (let i = 0; i < 40; i += 1) {
      const v = sampleX(s);
      if (Math.abs(v - x) < 1e-7) return s;
      if (v < x) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return s;
  };
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return sampleY(solve(t));
  };
}

export interface SpringOptions {
  /** Higher is snappier (default 170). */
  stiffness?: number;
  /** Higher settles with less wobble (default 18; 26 is critically damped at the default stiffness). */
  damping?: number;
  mass?: number;
}

/**
 * A damped spring from 0 to 1, time-scaled so it has settled (within 0.1 %)
 * at progress 1: a spring tween lasts exactly its duration.
 */
export function spring(options: SpringOptions = {}): Ease {
  const k = options.stiffness ?? 170;
  const c = options.damping ?? 18;
  const m = options.mass ?? 1;
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  const raw = (tau: number): number => {
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      return 1 - Math.exp(-zeta * w0 * tau) * (Math.cos(wd * tau) + ((zeta * w0) / wd) * Math.sin(wd * tau));
    }
    return 1 - Math.exp(-w0 * tau) * (1 + w0 * tau);
  };
  // Settling time of the envelope to 0.1 %.
  const settle = Math.log(1000) / (Math.min(zeta, 1) * w0);
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return raw(t * settle);
  };
}

/** `easeOutBack` with c1 = 1.3: peaks 6.2 % past the target (TASTE.md §2: max 6 %). */
const backOut: Ease = (t) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c1 = 1.3;
  const u = t - 1;
  return 1 + (c1 + 1) * u * u * u + c1 * u * u;
};

export const EASES = {
  smooth: cubicBezier(0.33, 0, 0.2, 1),
  out: cubicBezier(0.16, 1, 0.3, 1),
  entrance: cubicBezier(0.16, 1, 0.3, 1),
  in: cubicBezier(0.7, 0, 0.84, 0),
  exit: cubicBezier(0.7, 0, 0.84, 0),
  "in-out": cubicBezier(0.65, 0, 0.35, 1),
  snap: cubicBezier(0.2, 0, 0, 1),
  linear: (t: number) => Math.min(1, Math.max(0, t)),
  hold: (t: number) => (t >= 1 ? 1 : 0),
  "back-out": backOut,
  spring: spring(),
} satisfies Record<string, Ease>;

export type EaseName = keyof typeof EASES;

export function resolveEase(ease: EaseName | Ease | undefined): Ease {
  if (ease === undefined) return EASES.smooth;
  if (typeof ease === "function") return ease;
  const named = EASES[ease];
  if (!named) throw new Error(`unknown easing ${String(ease)}`);
  return named;
}
