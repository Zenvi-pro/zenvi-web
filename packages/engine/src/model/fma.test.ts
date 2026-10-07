import { describe, expect, it } from "vitest";
import { fma } from "./fma.js";

/** Exact value of a finite double as m · 2^e. */
function exact(x: number): [bigint, number] {
  if (x === 0) return [0n, 0];
  let e = 0;
  let v = x;
  while (!Number.isInteger(v)) {
    v *= 2;
    e -= 1;
  }
  return [BigInt(v), e];
}

/** Reference fma with exact BigInt arithmetic and round-half-even. */
function fmaExact(a: number, b: number, c: number): number {
  const [ma, ea] = exact(a);
  const [mb, eb] = exact(b);
  const [mc, ec] = exact(c);
  const ep = ea + eb;
  const e = Math.min(ep, ec);
  const n = ma * mb * (1n << BigInt(ep - e)) + mc * (1n << BigInt(ec - e));
  if (n === 0n) return 0;
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const length = abs.toString(2).length;
  let q = abs;
  let shift = 0;
  if (length > 53) {
    shift = length - 53;
    q = abs >> BigInt(shift);
    const r = abs - (q << BigInt(shift));
    const half = 1n << BigInt(shift - 1);
    if (r > half || (r === half && (q & 1n) === 1n)) q += 1n;
  }
  const value = Number(q) * 2 ** (e + shift);
  return negative ? -value : value;
}

describe("fma", () => {
  it("rounds once (the libopenshot linear-interpolation case)", () => {
    const slope = (2 - 8) / (50 - 25);
    expect(slope * 18 + 8).toBe(3.6799999999999997);
    expect(fma(slope, 18, 8)).toBe(3.68);
  });

  it("matches exact arithmetic on structured and random inputs", () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const decimals = [0.1, 0.2, 0.3, 0.25, 1 / 3, 2 / 3, 0.24, 1.3, 29.97, 0.01, 3, -1, 255, 0.5, 1e-3];
    let checked = 0;
    for (const a of decimals) {
      for (const b of decimals) {
        for (const c of decimals) {
          expect(fma(a, b, c), `${a},${b},${c}`).toBe(fmaExact(a, b, c));
          expect(fma(-a, b, c)).toBe(fmaExact(-a, b, c));
          checked += 2;
        }
      }
    }
    for (let i = 0; i < 4000; i += 1) {
      const a = (rand() - 0.5) * 10 ** Math.floor(rand() * 8 - 3);
      const b = (rand() - 0.5) * 10 ** Math.floor(rand() * 8 - 3);
      const c = (rand() - 0.5) * 10 ** Math.floor(rand() * 8 - 3);
      expect(fma(a, b, c)).toBe(fmaExact(a, b, c));
      // Near-cancellation: c ≈ -a*b.
      const d = -(a * b) * (1 + (rand() - 0.5) * 1e-12);
      expect(fma(a, b, d)).toBe(fmaExact(a, b, d));
      checked += 2;
    }
    expect(checked).toBeGreaterThan(14000);
  }, 60_000);

  it("exact midpoints round to even", () => {
    // 1 + 2^-53 is a midpoint between 1 and 1 + 2^-52.
    expect(fma(2 ** -27, 2 ** -26, 1)).toBe(1);
    expect(fma(2 ** -27, 3 * 2 ** -26, 1)).toBe(1 + 2 ** -51);
  });

  it("passes infinities and NaN through", () => {
    expect(fma(Infinity, 2, 1)).toBe(Infinity);
    expect(Number.isNaN(fma(NaN, 2, 1))).toBe(true);
  });
});
