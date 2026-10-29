import { describe, expect, it } from "vitest";
import { getBlock } from "../../catalog.js";
import { checkParams } from "../../params.js";
import { overtakes, periodLabel, planRace, ranksOf, smoothRanks, valuesAt, type RacePlan } from "./race.js";

const plan = planRace({ series: ["A=10, 20", "B=20 10", "C=5;5"], periods: ["1990", "2000"] }) as RacePlan;

describe("bar race", () => {
  it("reads series and periods", () => {
    expect(plan.series.map((s) => s.values)).toEqual([[10, 20], [20, 10], [5, 5]]);
    expect(plan.numericPeriods).toEqual([1990, 2000]);
  });

  it("interpolates values and counts years between periods", () => {
    expect(valuesAt(plan, 0.25)).toEqual([12.5, 17.5, 5]);
    expect(valuesAt(plan, 9)).toEqual([20, 10, 5]);
    expect(periodLabel(plan, 0.75)).toBe("1997");
    expect(periodLabel(plan, 1)).toBe("2000");
    const named = planRace({ series: ["A=1 2", "B=2 1"], periods: ["Q1", "Q2"] }) as RacePlan;
    expect(periodLabel(named, 0.4)).toBe("Q1");
  });

  it("ranks the largest first and slides an overtake over the window", () => {
    expect(ranksOf([10, 20, 5])).toEqual([1, 0, 2]);
    // A and B cross at 0.5: just after, the eased ranks are between 0 and 1.
    const mid = smoothRanks(plan, 0.6, 0.3);
    expect(mid[0]).toBeGreaterThan(0);
    expect(mid[0]).toBeLessThan(1);
    expect(smoothRanks(plan, 1, 0.3)).toEqual([0, 1, 2]);
    expect(overtakes(plan, 3, 0.1)[0]).toBeCloseTo(0.5, 1);
  });

  it("refuses series that do not match the periods", () => {
    const manifest = getBlock("bar_race")!;
    expect(checkParams(manifest, { series: ["A=1,240, 3", "B=1, 2"], periods: ["2000", "2001"] })).toEqual({ ok: false, error: expect.stringContaining('"A" has 3 values for 2 periods') });
    expect(checkParams(manifest, { series: ["A=1, x", "B=1, 2"], periods: ["2000", "2001"] })).toMatchObject({ ok: false });
    expect(checkParams(manifest, { series: ["A=1, 2"], periods: ["2000", "2001"] })).toMatchObject({ ok: false });
  });
});
