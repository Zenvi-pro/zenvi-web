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
 * exact BigInt path instead.
 */

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

const SPLIT = 134217729; // 2^27 + 1
const SAFE_MAX = 2 ** 480;
const SAFE_MIN = 2 ** -480;

function safe(x: number): boolean {
  const a = Math.abs(x);
  return a === 0 || (a < SAFE_MAX && a > SAFE_MIN);
}

/** a·b + c with a single rounding to the nearest double (IEEE fusedMultiplyAdd). */
export function fma(a: number, b: number, c: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return a * b + c;
  if (a === 0 || b === 0) return a * b + c;
  if (c === 0) return a * b;
  if (!safe(a) || !safe(b) || !safe(c) || !safe(a * b)) return fmaExact(a, b, c);
  // Exact product a·b = uh + ul (Dekker).
  const uh = a * b;
  let t = SPLIT * a;
  const ah = t - (t - a);
  const al = a - ah;
  t = SPLIT * b;
  const bh = t - (t - b);
  const bl = b - bh;
  const ul = ah * bh - uh + ah * bl + al * bh + al * bl;
  // Exact sum c + uh = th + tl (Knuth).
  const th = c + uh;
  const v = th - c;
  const tl = c - (th - v) + (uh - v);
  return th + addRoundToOdd(tl, ul);
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

// --- Exact reference path ---------------------------------------------------

const view = new DataView(new ArrayBuffer(8));

/** x = mantissa · 2^exponent exactly (x finite and non-zero). */
function decompose(x: number): [bigint, number] {
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e = expBits - 1075;
  }
  return [hi >>> 31 ? -m : m, e];
}

/** Round m · 2^e (m > 0) to the nearest double, ties to even. */
function roundToDouble(m: bigint, e: number): number {
  const bits = m.toString(2).length;
  if (bits > 64) {
    const shift = bits - 64;
    const sticky = (m & ((1n << BigInt(shift)) - 1n)) !== 0n ? 1n : 0n;
    m = (m >> BigInt(shift)) | sticky;
    e += shift;
  }
  // Number(bigint) rounds to nearest-even; the sticky bit breaks false ties.
  let v = Number(m);
  const half = Math.trunc(e / 2);
  v *= 2 ** half;
  v *= 2 ** (e - half);
  return v;
}

/** fma computed exactly with BigInt (slow; extreme magnitudes and tests). */
export function fmaExact(a: number, b: number, c: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return a * b + c;
  if (a === 0 || b === 0) return a * b + c;
  if (c === 0) return a * b;
  const [ma, ea] = decompose(a);
  const [mb, eb] = decompose(b);
  const [mc, ec] = decompose(c);
  const mp = ma * mb;
  const ep = ea + eb;
  let m: bigint;
  let e: number;
  if (ep <= ec) {
    m = mp + (mc << BigInt(ec - ep));
    e = ep;
  } else {
    m = (mp << BigInt(ep - ec)) + mc;
    e = ec;
  }
  if (m === 0n) return 0;
  return m < 0n ? -roundToDouble(-m, e) : roundToDouble(m, e);
}
