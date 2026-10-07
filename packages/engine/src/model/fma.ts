/**
 * Fused multiply-add: `a * b + c` with a single rounding.
 *
 * The reference libopenshot 1.0 build (macOS arm64, clang) contracts
 * `a * b + c` into `fmadd`, e.g. KeyFrame.cpp `InterpolateLinearCurve` and
 * `InterpolateBezierCurve` (see the disassembly in the libopenshot spec's
 * probes). JavaScript has no FMA, so matching its results bit for bit needs
 * an emulation. Builds without FMA (x86-64 baseline) can differ by one ulp.
 *
 * Algorithm: Boldo & Melquiond, "Emulation of FMA and correctly rounded sums:
 * proved algorithms using rounding to odd", IEEE Trans. Computers 57(4), 2008:
 *   (uh, ul) = ExactMult(a, b); (th, tl) = ExactAdd(c, uh);
 *   v = RoundToOdd(tl + ul);    result = RoundNearest(th + v).
 * Valid away from overflow and the subnormal range, which keyframe values
 * never approach.
 */

/** 2^27 + 1 (Veltkamp splitting constant for doubles). */
const SPLITTER = 134217729;

/** Error of the rounded product: a * b = p + error exactly (Dekker). */
function productError(a: number, b: number, p: number): number {
  let t = SPLITTER * a;
  const ah = t - (t - a);
  const al = a - ah;
  t = SPLITTER * b;
  const bh = t - (t - b);
  const bl = b - bh;
  return ah * bh - p + ah * bl + al * bh + al * bl;
}

const bits = new Float64Array(1);
const words = new Uint32Array(bits.buffer);
/** Index of the low 32-bit word of a double on this platform. */
const LOW = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 0 : 1;
const HIGH = 1 - LOW;

/**
 * Round-to-odd of the exact value `s + err`, given `s = RN(s + err)`: `s`
 * itself when exact or already odd, otherwise its neighbour toward the exact
 * value (adjacent doubles alternate significand parity).
 */
function roundToOdd(s: number, err: number): number {
  if (err === 0 || s === 0) return s;
  bits[0] = s;
  if ((words[LOW]! & 1) === 1) return s;
  const awayFromZero = s > 0 === err > 0;
  if (awayFromZero) {
    const low = (words[LOW]! + 1) >>> 0;
    words[LOW] = low;
    if (low === 0) words[HIGH] = (words[HIGH]! + 1) >>> 0;
  } else {
    if (words[LOW] === 0) words[HIGH] = (words[HIGH]! - 1) >>> 0;
    words[LOW] = (words[LOW]! - 1) >>> 0;
  }
  return bits[0]!;
}

/** `a * b + c`, rounded once to the nearest double (ties to even), like C `fma`. */
export function fma(a: number, b: number, c: number): number {
  const uh = a * b;
  if (!Number.isFinite(uh) || !Number.isFinite(c)) return uh + c;
  const ul = productError(a, b, uh);
  // (th, tl) = TwoSum(c, uh)
  const th = c + uh;
  const bv = th - c;
  const tl = c - (th - bv) + (uh - bv);
  // v = RO(tl + ul)
  const s = tl + ul;
  const sv = s - tl;
  const err = tl - (s - sv) + (ul - sv);
  return th + roundToOdd(s, err);
}
