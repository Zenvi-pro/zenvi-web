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

export const f32 = Math.fround;

/**
 * `fmaf(a, b, c)` for float32 operands: the float nearest to the exact
 * `a * b + c` (an arm64 `fmadd s`).
 *
 * The float product is exact in a double (24 + 24 significant bits), so
 * `a * b + c` has one double rounding before the float rounding. That double
 * rounding can only change the float result when it lands exactly on a
 * midpoint between two floats; the exact remainder (Knuth's TwoSum) then
 * decides the direction.
 */
export function fmaf(a: number, b: number, c: number): number {
  const p = a * b;
  const s = p + c;
  const r = f32(s);
  if (r === s || !Number.isFinite(r)) return r;
  // s is a float midpoint exactly when the float on its other side is 2s − r.
  const t = 2 * s - r;
  if (f32(t) !== t) return r;
  const bb = s - p;
  const e = p - (s - bb) + (c - bb);
  if (e === 0) return r;
  return e > 0 ? Math.max(r, t) : Math.min(r, t);
}

// ---------------------------------------------------------------------------
// Exact double FMA (per-frame coefficient math, and the rare slow path below)
// ---------------------------------------------------------------------------

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

function bitLength(v: bigint): number {
  return v.toString(2).length;
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
  const top = e + bitLength(a) - 1;
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

/** `fma(a, b, c)` on doubles (an arm64 `fmadd d`), correctly rounded. Exact but slow: for per-frame math. */
export function fma64(a: number, b: number, c: number): number {
  // Non-finite operands, or an exact zero product (signed-zero rules included).
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
