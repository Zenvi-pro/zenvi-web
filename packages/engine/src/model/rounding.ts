/**
 * Rounding that matches the two languages the desktop is written in.
 *
 * - C++ `round`/`llround` (libopenshot): half away from zero.
 * - Python 3 `round(x)` (zenvi-core): half to even ("banker's rounding"),
 *   decided on the exact binary value of `x`.
 *
 * JS `Math.round` is neither (it rounds halves toward +Infinity), so ported
 * code must pick one of these explicitly.
 */

/** C++ `round(x)`: nearest integer, halves away from zero. Never returns -0. */
export function roundHalfAway(x: number): number {
  if (!Number.isFinite(x)) return x;
  const a = Math.abs(x);
  const f = Math.floor(a);
  // `a - f` is exact for doubles, so this does not suffer from the
  // floor(a + 0.5) error at 0.49999999999999994.
  const r = a - f >= 0.5 ? f + 1 : f;
  return x < 0 && r !== 0 ? -r : r;
}

/** Python 3 `round(x)`: nearest integer, halves to even. Never returns -0. */
export function pyRound(x: number): number {
  if (!Number.isFinite(x)) return x;
  const f = Math.floor(x);
  const diff = x - f;
  let r: number;
  if (diff > 0.5) r = f + 1;
  else if (diff < 0.5) r = f;
  else r = f % 2 === 0 ? f : f + 1;
  return r === 0 ? 0 : r;
}

/** C++ conversion of a double to an integer type: truncation toward zero. */
export function truncInt(x: number): number {
  const t = Math.trunc(x);
  return t === 0 ? 0 : t;
}

/** IEEE single-precision narrowing (C++ `float`). */
export const f32: (x: number) => number = Math.fround;
