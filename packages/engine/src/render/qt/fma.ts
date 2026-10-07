/**
 * Correctly rounded fused multiply-add.
 *
 * Qt and libopenshot are built for arm64 by clang with `-ffp-contract=on`:
 * within one expression `a*b + c` becomes a single `fmadd` (the left-hand
 * product is fused first: `a*b + c*d` is `fma(a, b, round(c*d))`). The
 * QtGui and libopenshot disassembly confirm it for QTransform and
 * Clip::get_transform. JavaScript has no `Math.fma`, so this emulates it:
 * an exact product (Dekker), an exact sum (Knuth) and one rounding to odd
 * before the final rounding to nearest (Boldo & Melquiond, "Emulation of FMA
 * and correctly rounded sums: proved algorithms using rounding to odd", IEEE
 * TC 57(4), 2008). Inputs whose products could overflow or underflow take an
 * exact BigInt path instead. Every render module imports its fused
 * operations from here.
 */

import { fma as fmaFast } from "../../model/fma.js";

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
const LO = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 0 : 1;

/** True when the last mantissa bit of `x` is 1. */
function isOdd(x: number): boolean {
  f64[0] = x;
  return (u32[LO]! & 1) === 1;
}

/** The double adjacent to `x` (non-zero) one step away from zero. */
function stepAwayFromZero(x: number): number {
  f64[0] = x;
  const lo = u32[LO]! + 1;
  if (lo > 0xffffffff) {
    u32[LO] = 0;
    u32[1 - LO] = u32[1 - LO]! + 1;
  } else u32[LO] = lo;
  return f64[0]!;
}

/** The double adjacent to `x` (non-zero) one step towards zero. */
function stepTowardZero(x: number): number {
  f64[0] = x;
  const lo = u32[LO]!;
  if (lo === 0) {
    u32[LO] = 0xffffffff;
    u32[1 - LO] = u32[1 - LO]! - 1;
  } else u32[LO] = lo - 1;
  return f64[0]!;
}

/** x + y rounded to odd: exact if representable, else the neighbour with an odd last bit. */
function addRoundToOdd(x: number, y: number): number {
  const s = x + y;
  const v = s - x;
  const err = x - (s - v) + (y - v);
  if (err === 0 || isOdd(s)) return s;
  // The exact sum lies strictly between s and its neighbour in the direction of err.
  return (err > 0) === (s > 0) ? stepAwayFromZero(s) : stepTowardZero(s);
}

const SAFE_MAX = 2 ** 480;
const SAFE_MIN = 2 ** -480;

function safe(x: number): boolean {
  const a = Math.abs(x);
  return a === 0 || (a < SAFE_MAX && a > SAFE_MIN);
}

/**
 * a·b + c with a single rounding to the nearest double (IEEE
 * fusedMultiplyAdd): the engine-wide Dekker/Knuth/round-to-odd emulation
 * (model/fma.ts), with the exact path where products could overflow or
 * underflow.
 */
export function fma(a: number, b: number, c: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return a * b + c;
  if (!safe(a) || !safe(b) || !safe(c) || !safe(a * b)) return fmaExact(a, b, c);
  return fmaFast(a, b, c);
}

/**
 * a·b + c for float32 inputs, rounded once to float32 (`fmadd s…`). The
 * product is exact in double; rounding the sum to odd at 53 bits and then to
 * nearest at 24 equals a single rounding.
 */
export function fmaf(a: number, b: number, c: number): number {
  const p = a * b;
  if (!Number.isFinite(p) || !Number.isFinite(c)) return Math.fround(p + c);
  return Math.fround(addRoundToOdd(p, c));
}

// --- Exact path -------------------------------------------------------------

const VIEW = new DataView(new ArrayBuffer(8));

/** `x = mantissa · 2^exponent` with an integer mantissa (finite, non-zero x). */
function decompose(x: number): { m: bigint; e: number } {
  VIEW.setFloat64(0, x);
  const bits = VIEW.getBigUint64(0);
  const sign = bits >> 63n ? -1n : 1n;
  const biased = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;
  if (biased === 0) return { m: sign * frac, e: -1074 };
  return { m: sign * (frac | 0x10000000000000n), e: biased - 1075 };
}

/** `x · 2^k` without intermediate overflow or underflow. */
function scale2(x: number, k: number): number {
  let v = x;
  let n = k;
  while (n > 1000) {
    v *= 2 ** 1000;
    n -= 1000;
  }
  while (n < -1000) {
    v *= 2 ** -1000;
    n += 1000;
  }
  return v * 2 ** n;
}

/** Round the exact value `m · 2^e` to the nearest double, ties to even (subnormals included). */
function roundToDouble(m: bigint, e: number): number {
  if (m === 0n) return 0;
  const neg = m < 0n;
  const a = neg ? -m : m;
  const top = e + a.toString(2).length - 1;
  const ulpExp = Math.max(top, -1022) - 52;
  let q = a;
  let qExp = e;
  if (ulpExp > e) {
    const shift = BigInt(ulpExp - e);
    q = a >> shift;
    const rem = a - (q << shift);
    const half = 1n << (shift - 1n);
    if (rem > half || (rem === half && (q & 1n) === 1n)) q += 1n;
    qExp = ulpExp;
  }
  // At most 54 bits after rounding up: exact as a double.
  const v = scale2(Number(q), qExp);
  return neg ? -v : v;
}

/** fma computed exactly with BigInt (slow; extreme magnitudes and tests). */
export function fmaExact(a: number, b: number, c: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || a === 0 || b === 0) return a * b + c;
  const da = decompose(a);
  const db = decompose(b);
  let pm = da.m * db.m;
  let pe = da.e + db.e;
  if (c === 0) return roundToDouble(pm, pe);
  const dc = decompose(c);
  let cm = dc.m;
  if (pe > dc.e) {
    pm <<= BigInt(pe - dc.e);
    pe = dc.e;
  } else {
    cm <<= BigInt(dc.e - pe);
  }
  return roundToDouble(pm + cm, pe);
}
