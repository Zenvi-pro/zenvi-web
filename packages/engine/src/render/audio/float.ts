/**
 * C++ float/double semantics in JavaScript numbers, as the macOS arm64
 * desktop build executes them.
 *
 * clang contracts `a * b + c` into one fused multiply-add (`fmadd`) on arm64
 * (checked in the libopenshot and libopenshot-audio disassembly for every
 * kernel in this folder). A fused operation rounds the exact `a * b + c`
 * once; computing it as two JavaScript operations rounds twice, so these
 * helpers compute the single rounding exactly.
 */

import { fma, fmaf } from "../qt/fma.js";

export const f32 = Math.fround;

export { fmaf };

/** `fma(a, b, c)` on doubles (an arm64 `fmadd d`), correctly rounded. */
export const fma64 = fma;

/**
 * `(float)fma(a, b, c)` for double operands (`fmadd d` then `fcvt s`): the
 * fused result rounded to double, then to float — two roundings, as the
 * desktop does them. Fast path in doubles; the exact `fma64` only when the
 * double result is too close to a float rounding boundary to decide.
 */
export function f32Fma64(a: number, b: number, c: number): number {
  const p = a * b;
  const d = p + c;
  const r = f32(d);
  if (!Number.isFinite(d)) return r;
  // |fma64(a, b, c) − d| ≤ ulp(p)/2 + ulp(d) ≤ 2^-52·(|p| + |d|); widen generously.
  const err = (Math.abs(p) + Math.abs(d)) * 2 ** -50 + 2 ** -1074;
  if (f32(d - err) === r && f32(d + err) === r) return r;
  return f32(fma64(a, b, c));
}
