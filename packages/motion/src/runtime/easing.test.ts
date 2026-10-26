import { describe, expect, it } from "vitest";
import { cubicBezier, EASES, resolveEase, spring } from "./easing.js";

describe("easing", () => {
  it("evaluates cubic-beziers like CSS", () => {
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    // CSS `ease` at 50 % time (reference value from the WebKit solver).
    expect(ease(0.5)).toBeCloseTo(0.8024, 3);
    expect(cubicBezier(0, 0, 1, 1)(0.3)).toBeCloseTo(0.3, 6);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
  });

  it("has TASTE.md's named curves", () => {
    expect(EASES.smooth(0.5)).toBeCloseTo(cubicBezier(0.33, 0, 0.2, 1)(0.5), 9);
    expect(EASES.out(0.2)).toBeGreaterThan(0.5); // expo-out: most of the move early
    expect(EASES.in(0.2)).toBeLessThan(0.05);
    expect(EASES["in-out"](0.5)).toBeCloseTo(0.5, 3);
    expect(EASES.hold(0.99)).toBe(0);
    expect(EASES.hold(1)).toBe(1);
    expect(resolveEase(undefined)).toBe(EASES.smooth);
    expect(() => resolveEase("wobble" as never)).toThrow();
  });

  it("overshoots back-out by at most 6.5 %", () => {
    let peak = 0;
    for (let i = 0; i <= 1000; i += 1) peak = Math.max(peak, EASES["back-out"](i / 1000));
    expect(peak).toBeGreaterThan(1.05);
    expect(peak).toBeLessThan(1.065);
  });

  it("settles springs exactly at the end", () => {
    const s = spring({ stiffness: 200, damping: 12 });
    expect(s(0)).toBe(0);
    expect(s(1)).toBe(1);
    expect(Math.abs(s(0.98) - 1)).toBeLessThan(0.01);
    let peak = 0;
    for (let i = 0; i <= 200; i += 1) peak = Math.max(peak, s(i / 200));
    expect(peak).toBeGreaterThan(1); // underdamped: it wobbles past
  });
});
