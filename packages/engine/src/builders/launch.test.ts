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
    const shots = planExplainerShots(11, words, hits, ["A", "B"], 30);
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
});
