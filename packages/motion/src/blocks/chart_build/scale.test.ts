import { describe, expect, it } from "vitest";
import { highlightIndex, niceMax, parseValue, percentChange } from "./scale.js";

describe("chart_build scale", () => {
  it("reads the numbers agents send as text", () => {
    expect(parseValue("$1,240")).toBe(1240);
    expect(parseValue("46%")).toBe(46);
    expect(parseValue("-3.5k")).toBe(-3.5);
    expect(parseValue("n/a")).toBe(0);
  });
  it("rounds the axis top up to 1, 2, 2.5 or 5 × 10^k", () => {
    expect(niceMax(46)).toBe(50);
    expect(niceMax(50)).toBe(50);
    expect(niceMax(51)).toBe(100);
    expect(niceMax(0.18)).toBe(0.2);
    expect(niceMax(2300)).toBe(2500);
    expect(niceMax(0)).toBe(1);
  });
  it("highlights the asked item, else the largest bar or the line's last point", () => {
    expect(highlightIndex([3, 9, 4], -1, false)).toBe(1);
    expect(highlightIndex([3, 9, 4], -1, true)).toBe(2);
    expect(highlightIndex([3, 9, 4], 0, false)).toBe(0);
    expect(highlightIndex([3, 9, 4], 7, false)).toBe(1);
  });
  it("writes the change as a signed percentage", () => {
    expect(percentChange(12, 46)).toBe("+283%");
    expect(percentChange(40, 30)).toBe("−25%");
    expect(percentChange(0, 30)).toBe("");
  });
});
