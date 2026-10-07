import { describe, expect, it } from "vitest";
import { lcg } from "../testing/images.js";
import { fma, fmaExact, fmaf } from "./fma.js";

/** fmaf by exact BigInt arithmetic: round the exact double-free sum straight to float32. */
function fmafExact(a: number, b: number, c: number): number {
  // Exact sum as a rational with a power-of-two denominator.
  const parts = (x: number): [bigint, number] => {
    const v = new DataView(new ArrayBuffer(8));
    v.setFloat64(0, x);
    const hi = v.getUint32(0);
    const lo = v.getUint32(4);
    const eb = (hi >>> 20) & 0x7ff;
    let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
    let e = -1074;
    if (eb) {
      m |= 1n << 52n;
      e = eb - 1075;
    }
    return [hi >>> 31 ? -m : m, e];
  };
  if (a === 0 || b === 0 || c === 0) return Math.fround(a * b + c);
  const [ma, ea] = parts(a);
  const [mb, eb] = parts(b);
  const [mc, ec] = parts(c);
  const ep = ea + eb;
  const e = Math.min(ep, ec);
  let m = ((ma * mb) << BigInt(ep - e)) + (mc << BigInt(ec - e));
  if (m === 0n) return 0;
  const neg = m < 0n;
  if (neg) m = -m;
  const bits = m.toString(2).length;
  // Keep 24 bits, round half to even on the rest.
  let shift = bits - 24;
  let exp = e;
  if (shift > 0) {
    const rem = m & ((1n << BigInt(shift)) - 1n);
    const half = 1n << BigInt(shift - 1);
    m >>= BigInt(shift);
    if (rem > half || (rem === half && (m & 1n) === 1n)) m += 1n;
    exp += shift;
  } else shift = 0;
  const v = Number(m) * 2 ** exp;
  return neg ? -v : v;
}

describe("fma", () => {
  it("rounds once where a*b + c rounds twice", () => {
    const a = 1 + 2 ** -30;
    const b = 1 + 2 ** -30;
    // a*b = 1 + 2^-29 + 2^-60: the 2^-60 term is lost by a plain multiply.
    const c = -(1 + 2 ** -29);
    expect(a * b + c).toBe(0);
    expect(fma(a, b, c)).toBe(2 ** -60);
    expect(fmaExact(a, b, c)).toBe(2 ** -60);
  });

  it("matches the exact BigInt result on random and cancelling inputs", () => {
    const rand = lcg(7);
    const r = (): number => (rand() - 0.5 + rand() * 2 ** -26) * 2 ** Math.floor(rand() * 40 - 20);
    for (let i = 0; i < 4000; i += 1) {
      const a = r();
      const b = r();
      let c = r();
      // Every fourth case cancels most of the product.
      if (i % 4 === 0) c = -(a * b) * (1 + Math.floor(rand() * 7) * 2 ** -52);
      expect(fma(a, b, c)).toBe(fmaExact(a, b, c));
    }
  });

  it("handles extreme magnitudes through the exact path", () => {
    expect(fma(2 ** 600, 2 ** 400, -(2 ** 1000))).toBe(0);
    expect(fma(1e-200, 1e-200, 1)).toBe(1);
    expect(fma(3, 4, 5)).toBe(17);
  });
});

describe("fmaf", () => {
  it("is a single rounding to float32", () => {
    const rand = lcg(11);
    const f = (): number => Math.fround((rand() - 0.5) * 2 ** Math.floor(rand() * 30 - 10));
    for (let i = 0; i < 4000; i += 1) {
      const a = f();
      const b = f();
      const c = i % 3 === 0 ? Math.fround(-a * b) : f();
      expect(fmaf(a, b, c)).toBe(fmafExact(a, b, c));
    }
  });

  it("avoids the double-rounding tie", () => {
    // Exact sum 1 + 2^-23 + 2^-24 - 2^-70: via double it lands on the float
    // midpoint 1 + 3·2^-24 and ties up to 1 + 2^-22; once rounded it is 1 + 2^-23.
    const a = Math.fround(1 + 2 ** -23);
    const b = Math.fround(2 ** -24 - 2 ** -47);
    const c = Math.fround(1 + 2 ** -23);
    expect(Math.fround(a * b + c)).toBe(1 + 2 ** -22);
    expect(fmaf(a, b, c)).toBe(1 + 2 ** -23);
    expect(fmafExact(a, b, c)).toBe(1 + 2 ** -23);
  });
});
