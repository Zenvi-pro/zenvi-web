// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { random01 } from "./rng.js";
import { formatNumber, odometerPositions, scrambledText, splitText, typedCount } from "./text.js";

describe("text animators", () => {
  it("types at the given rate and erases", () => {
    expect(typedCount("hello", 0.9, { at: 1, cps: 10 })).toBe(0);
    expect(typedCount("hello", 1.25, { at: 1, cps: 10 })).toBe(2);
    expect(typedCount("hello", 9, { at: 1, cps: 10 })).toBe(5);
    expect(typedCount("hello", 3.2, { at: 1, cps: 10, eraseAt: 3 })).toBe(0);
    // Characters, not UTF-16 units.
    expect(typedCount("👋🏽 hi", 0.1, { at: 0, cps: 10 })).toBe(1);
  });

  it("scrambles deterministically and resolves to the text", () => {
    const o = { at: 1, duration: 1, seed: 3 };
    expect(scrambledText("ALL READY", 0.5, o)).toBe("");
    const mid = scrambledText("ALL READY", 1.5, o);
    expect(mid).toBe(scrambledText("ALL READY", 1.5, o));
    expect(mid).not.toBe("ALL READY");
    expect(scrambledText("ALL READY", 2, o)).toBe("ALL READY");
    expect(scrambledText("A B", 1.01, o).includes(" ") || scrambledText("A B", 1.01, o).length <= 1).toBe(true);
  });

  it("formats numbers", () => {
    expect(formatNumber(1234567.891, { decimals: 2, prefix: "$" })).toBe("$1,234,567.89");
    expect(formatNumber(-0.0001)).toBe("0");
    expect(formatNumber(58, { suffix: "k", separator: "" })).toBe("58k");
  });

  it("rolls odometer wheels like a mechanical counter", () => {
    expect(odometerPositions(58, 2)).toEqual([8, 5]);
    // 19.5: the ones wheel is half way 9 → 0, so the tens wheel is half way 1 → 2.
    const p = odometerPositions(19.5, 2);
    expect(p[0]).toBeCloseTo(9.5);
    expect(p[1]).toBeCloseTo(1.5);
    expect(odometerPositions(12.5, 2)[1]).toBe(1);
  });

  it("splits text into words and characters", () => {
    const el = document.createElement("p");
    el.textContent = "Hello  big world";
    const split = splitText(el, { chars: true });
    expect(split.words.map((w) => w.textContent)).toEqual(["Hello", "big", "world"]);
    expect(split.chars).toHaveLength(13);
    expect(el.textContent).toBe("Hello big world");
  });

  it("seeds randomness", () => {
    expect(random01(1, 2, 3)).toBe(random01(1, 2, 3));
    expect(random01(1, 2, 3)).not.toBe(random01(2, 2, 3));
  });
});
