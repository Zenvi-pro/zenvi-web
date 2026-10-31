import { describe, expect, it } from "vitest";
import { getBlock } from "../../catalog.js";
import { checkParams } from "../../params.js";
import { addSteps, formatDate, parseDate, planClock, runFor, stepsBetween } from "./dates.js";

describe("dates", () => {
  it("parses years, months and days, refusing impossible dates", () => {
    expect(parseDate("2006")).toEqual({ y: 2006, m: 1, d: 1 });
    expect(parseDate("2006-03")).toEqual({ y: 2006, m: 3, d: 1 });
    expect(parseDate("2024/02/29")).toEqual({ y: 2024, m: 2, d: 29 });
    expect(parseDate("2023-02-29")).toBeUndefined();
    expect(parseDate("March")).toBeUndefined();
  });

  it("steps across month and year ends, clamping the day", () => {
    expect(addSteps({ y: 2006, m: 1, d: 31 }, "day", 1)).toEqual({ y: 2006, m: 2, d: 1 });
    expect(addSteps({ y: 2006, m: 1, d: 31 }, "month", 1)).toEqual({ y: 2006, m: 2, d: 28 });
    expect(addSteps({ y: 2006, m: 11, d: 1 }, "quarter", 1)).toEqual({ y: 2007, m: 2, d: 1 });
    expect(addSteps({ y: 2006, m: 12, d: 30 }, "week", 1)).toEqual({ y: 2007, m: 1, d: 6 });
    expect(stepsBetween({ y: 2006, m: 1, d: 20 }, { y: 2006, m: 2, d: 5 }, "day")).toBe(16);
    expect(stepsBetween({ y: 1990, m: 1, d: 1 }, { y: 2024, m: 1, d: 1 }, "year")).toBe(34);
  });

  it("reads years before 100 literally and counts clamped month steps", () => {
    expect(addSteps({ y: 79, m: 8, d: 24 }, "day", 1)).toEqual({ y: 79, m: 8, d: 25 });
    expect(addSteps({ y: 99, m: 12, d: 31 }, "week", 1)).toEqual({ y: 100, m: 1, d: 7 });
    expect(stepsBetween({ y: 50, m: 1, d: 1 }, { y: 50, m: 3, d: 1 }, "day")).toBe(59);
    expect(stepsBetween({ y: 2006, m: 1, d: 31 }, { y: 2006, m: 2, d: 28 }, "month")).toBe(1);
    expect(stepsBetween({ y: 2006, m: 1, d: 20 }, { y: 2006, m: 2, d: 19 }, "month")).toBe(0);
    expect(stepsBetween({ y: 2006, m: 1, d: 20 }, { y: 2007, m: 1, d: 19 }, "year")).toBe(0);
    expect(stepsBetween({ y: 2006, m: 1, d: 20 }, { y: 2007, m: 4, d: 20 }, "quarter")).toBe(5);
  });

  it("formats by step", () => {
    const d = { y: 2006, m: 3, d: 21 };
    expect(formatDate(d, "auto", "day")).toBe("2006 / 03 / 21");
    expect(formatDate(d, "auto", "month")).toBe("Mar 2006");
    expect(formatDate(d, "auto", "quarter")).toBe("Q1 2006");
    expect(formatDate(d, "auto", "year")).toBe("2006");
    expect(formatDate(d, "day", "day")).toBe("21 Mar 2006");
  });

  it("fits start..end into the block, or runs at a set rate", () => {
    const fit = planClock({ start: "2006-01-20", end: "2006-02-05", step: "day", rate: 0, legends: [] }, 8);
    expect(fit).toMatchObject({ count: 16, rate: 16 / runFor(8) });
    const capped = planClock({ start: "2006-01-20", end: "2007-01-01", step: "day", rate: 2, legends: [] }, 8);
    expect(capped).toMatchObject({ count: Math.floor(2 * runFor(8)), rate: 2 });
    // A rate too slow for one step in the block still takes one, so progress never divides by zero.
    const slow = planClock({ start: "2006", end: "2010", step: "year", rate: 0.1, legends: [] }, 4);
    expect(slow).toMatchObject({ count: 1, rate: 0.1 });
  });

  it("refuses bad dates, ranges and ramps through checkParams", () => {
    const m = getBlock("data_clock")!;
    expect(checkParams(m, { start: "yesterday" })).toMatchObject({ ok: false });
    expect(checkParams(m, { start: "2006-02-05", end: "2006-01-20" })).toMatchObject({ ok: false, error: expect.stringContaining("after start") });
    expect(checkParams(m, { legends: ["Heat=0..1@rainbow"] })).toMatchObject({ ok: false, error: expect.stringContaining("rainbow") });
    expect(checkParams(m, { legends: ["Heat 0 to 1"] })).toMatchObject({ ok: false });
    // A name Object.prototype has is not a ramp (it threw in the renderer).
    expect(checkParams(m, { legends: ["Heat=0..1@constructor"] })).toMatchObject({ ok: false, error: expect.stringContaining("constructor") });
  });
});
