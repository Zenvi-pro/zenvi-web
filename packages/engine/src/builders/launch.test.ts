import { describe, expect, it } from "vitest";
import { planLaunch } from "./launch.js";
import { numberSlots, planChapters, planExplainerShots } from "./explainer.js";

describe("launch plan", () => {
  it("puts each section on a bar line: problem 2, reveal 2, a bar per feature, proof 2, end 2", () => {
    const downbeats = Array.from({ length: 6 }, (_, i) => 0.5 + i * 2);
    const plan = planLaunch({ features: 3, hasProblem: true, hasProof: true, downbeats, fps: 30 });
    expect(plan.sections.map((s) => s.kind)).toEqual(["problem", "reveal", "feature", "feature", "feature", "proof", "end"]);
    // The first section starts at 0 (a pickup before the first bar line), the rest on the bars, extended past the given ones at the bar's length.
    expect(plan.sections.map((s) => s.start)).toEqual([0, 2.5, 6.5, 8.5, 10.5, 12.5, 16.5]);
    expect(plan.duration).toBeCloseTo(20.5, 6);
  });
});

describe("launch plan to a length", () => {
  it("gives up second bars, proof first, until it fits", () => {
    const downbeats = Array.from({ length: 20 }, (_, i) => i * 2.6);
    const plan = planLaunch({ features: 3, hasProblem: false, hasProof: false, downbeats, fps: 30, maxSeconds: 15 });
    // reveal 2 + 3 features + end 2 = 7 bars = 18.2 s; the reveal gives up a bar: 6 bars = 15.6 s; the end card: 5 bars = 13 s.
    expect(plan.sections.map((s) => Math.round((s.end - s.start) / 2.6))).toEqual([1, 1, 1, 1, 1]);
    expect(plan.duration).toBeLessThanOrEqual(15);
  });
});

describe("explainer plan", () => {
  const words = [
    { text: "Every", start: 0.2, end: 0.5 },
    { text: "city", start: 0.55, end: 0.9 },
    { text: "grows.", start: 0.95, end: 1.4 },
    { text: "Rivers", start: 2.4, end: 2.9 },
    { text: "carried", start: 2.95, end: 3.4 },
    { text: "40%", start: 3.5, end: 4 },
    { text: "of", start: 4.05, end: 4.2 },
    { text: "trade.", start: 4.25, end: 4.8 },
    { text: "Then", start: 6.4, end: 6.7 },
    { text: "came", start: 6.75, end: 7 },
    { text: "railways", start: 7.05, end: 7.7 },
    { text: "in", start: 9.3, end: 9.4 },
    { text: "1850.", start: 9.45, end: 10 },
  ];

  it("covers the voice with shots between 2 and 4.5 s, cutting on the keyword or in a pause", () => {
    const hits = [{ word: 10, text: "railways", fileId: "RAIL", start: 7.05, end: 9, source: "matched" as const }];
    const shots = planExplainerShots(11, words, hits, ["A", "B"], 30, "essay");
    expect(shots[0]!.start).toBe(0);
    expect(shots[shots.length - 1]!.end).toBeCloseTo(11, 6);
    for (let i = 1; i < shots.length; i += 1) expect(shots[i]!.start).toBeCloseTo(shots[i - 1]!.end, 6);
    const rail = shots.find((s) => s.fileId === "RAIL")!;
    expect(rail).toMatchObject({ cue: "keyword", keyword: "railways" });
    expect(rail.start).toBeCloseTo(7.05, 1);
    for (const s of shots.slice(0, -1)) expect(s.end - s.start).toBeGreaterThanOrEqual(2 - 1e-6);
  });

  it("puts chapter cards in pauses, and turns a spoken percentage into a counter but not a year", () => {
    const chapters = planChapters(["Rivers", "Rails"], words, 11);
    expect(chapters.map((c) => c.at)).toEqual([1.4, 4.8]);
    expect(numberSlots(words)).toEqual([{ word: 5, value: "40", prefix: "", suffix: "%", at: 3.5 }]);
  });

  it("reads a number said in words before 'percent', and keeps chapters out of the hook", () => {
    const said = [
      { text: "Rivers", start: 0, end: 0.4 },
      { text: "carried", start: 0.45, end: 0.8 },
      { text: "forty-five", start: 0.85, end: 1.3 },
      { text: "percent.", start: 1.35, end: 1.8 },
      { text: "Then", start: 3, end: 3.2 },
      { text: "ninety", start: 9, end: 9.3 },
      { text: "nine", start: 9.35, end: 9.6 },
      { text: "percent", start: 9.65, end: 10 },
    ];
    expect(numberSlots(said).map((n) => [n.value, n.suffix])).toEqual([
      ["45", "%"],
      ["99", "%"],
    ]);
    expect(planChapters(["One"], words, 11, 2).map((c) => c.at)).toEqual([4.8]);
  });

  it("reads 'per cent' as percent but a bare 'per' as a rate", () => {
    const said = (...tokens: string[]) => tokens.map((text, i) => ({ text, start: i * 7, end: i * 7 + 0.3 }));
    expect(numberSlots(said("forty", "per", "day"))).toEqual([]);
    expect(numberSlots(said("12", "per", "user")).map((n) => [n.value, n.suffix])).toEqual([["12", ""]]);
    expect(numberSlots(said("forty", "per", "cent")).map((n) => [n.value, n.suffix])).toEqual([["40", "%"]]);
  });
});
