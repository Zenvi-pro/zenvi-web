/**
 * The libm calls the audio effects make, with float results as the desktop
 * computes them. clang rewrites `powf(10.0f, x)` to `__exp10f(x)`,
 * `pow(10.0, x)` to `__exp10(x)` and `powf(x, 2.0f)` to `x * x`
 * (libopenshot arm64 disassembly), so those are the functions that matter.
 *
 * `log10f` and `hypotf` of macOS libm are correctly rounded (0 of 200 000
 * random arguments differ from the rounded double result), so rounding the
 * double function reproduces them. `expf`, `__exp10f`, `powf`, `sinf` and
 * `cosf` are not: about 1 % of results are one float ulp away from the
 * correctly rounded value. See `apple-libm.ts` for exact ports of the ones
 * on the kernels' per-sample paths.
 */

import { f32 } from "./float.js";

export function log10f(x: number): number {
  return f32(Math.log10(x));
}

/** `hypotf`: the double hypotenuse of two floats is within 1 ulp, so its float rounding is exact. */
export function hypotf(x: number, y: number): number {
  if (x === Infinity || x === -Infinity || y === Infinity || y === -Infinity) return Infinity;
  return f32(Math.sqrt(x * x + y * y));
}

/** `__exp10` (double): `pow(10.0, x)` after clang's rewrite. */
export function exp10(x: number): number {
  return Math.pow(10, x);
}
