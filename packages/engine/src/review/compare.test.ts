import { describe, expect, it } from "vitest";
import { combineOrders, combineSeparate, normalizeComparison, type CompareVerdict } from "./compare.js";
import { WATCH_DIMENSION_NAMES, type WatchCritique } from "./watch.js";

const flat = (n: number) => Object.fromEntries(WATCH_DIMENSION_NAMES.map((d) => [d, n])) as CompareVerdict["scores"]["A"];

function verdict(winner: CompareVerdict["winner"], a: number, b: number, fixes: CompareVerdict["fixes"] = []): CompareVerdict {
  return { model: "m", durations: { A: 10, B: 10 }, winner, why: `${winner} wins`, scores: { A: flat(a), B: flat(b) }, fixes, usage: { inputTokens: 10, outputTokens: 2 }, via: "gemini" };
}

describe("normalizeComparison", () => {
  it("clamps scores and times, keeps three fixes per video, and reads an unknown dimension as other", () => {
    const fix = (video: string, start: number, dimension = "pacing") => ({ video, start, dimension, problem: "p", fix: "f" });
    const out = normalizeComparison(
      {
        A: { hook: 12, pacing: "4", typography: null },
        B: { hook: 0 },
        winner: "B",
        why: " B lands it. ",
        fixes: [fix("A", 99), fix("A", 1), fix("A", 2), fix("A", 3), fix("B", -1, "vibes"), fix("C", 1), { video: "B", start: 1, problem: "", fix: "x" }],
      },
      { A: 8, B: 6 },
    );
    expect(out.winner).toBe("B");
    expect(out.why).toBe("B lands it.");
    expect(out.scores.A).toMatchObject({ hook: 10, pacing: 4, typography: null, look: null });
    expect(out.scores.B.hook).toBe(1);
    expect(out.fixes.map((f) => [f.video, f.start, f.dimension])).toEqual([
      ["A", 8, "pacing"],
      ["A", 1, "pacing"],
      ["A", 2, "pacing"],
      ["B", 0, "other"],
    ]);
    expect(normalizeComparison({ winner: "left" }, { A: 1, B: 1 }).winner).toBe("tie");
  });
});

describe("combineOrders", () => {
  it("names the winner both orders agree on and keeps only its fixes", () => {
    // a shown first wins as A; b shown first, a wins as B.
    const ab = verdict("A", 7, 5, [
      { video: "A", start: 1, dimension: "sound_design", problem: "silent cut", fix: "add a whoosh at 1 s" },
      { video: "B", start: 2, dimension: "pacing", problem: "drags", fix: "trim" },
    ]);
    const ba = verdict("B", 5, 8, [
      { video: "B", start: 1.4, dimension: "sound_design", problem: "silent cut", fix: "whoosh" },
      { video: "B", start: 5, dimension: "ending", problem: "stops", fix: "add an end card" },
    ]);
    const j = combineOrders(ab, ba);
    expect(j).toMatchObject({ method: "pairwise", winner: "a", decidedBy: "agreed", orders: ["a", "a"], margin: 2.5 });
    expect(j.overall).toEqual({ a: 7.5, b: 5 });
    // The near-duplicate sound fix of the second order is dropped; the ending fix stays.
    expect(j.fixes.map((f) => f.dimension)).toEqual(["sound_design", "ending"]);
    expect(j.fixes[0]!.tools[0]).toBe("add_sfx_tool");
    expect(j.usage).toEqual({ inputTokens: 20, outputTokens: 4, credits: 0 });
  });

  it("cancels a judge that always prefers the first video: the mean scores decide", () => {
    const j = combineOrders(verdict("A", 6, 5), verdict("A", 6, 6.5));
    // a: (6 + 6.5) / 2 = 6.25, b: (5 + 6) / 2 = 5.5.
    expect(j).toMatchObject({ winner: "a", decidedBy: "scores", orders: ["a", "b"] });
    const even = combineOrders(verdict("A", 6, 5), verdict("A", 6, 5));
    expect(even).toMatchObject({ winner: "a", decidedBy: "kept", margin: 0 });
  });
});

describe("combineSeparate", () => {
  const critique = (overall: number): WatchCritique => ({
    model: "m",
    duration: 10,
    hasAudio: true,
    verdict: `overall ${overall}`,
    overall,
    wouldPost: false,
    scores: flat(overall),
    issues: [{ start: 1, end: 2, dimension: "look", severity: "high", problem: "flat", fix: "raise contrast" }],
    strengths: [],
    usage: { inputTokens: 1, outputTokens: 1 },
    via: "backend",
  });

  it("needs half a point to beat the first render", () => {
    expect(combineSeparate(critique(5), critique(5.4))).toMatchObject({ method: "separate", winner: "a", decidedBy: "kept" });
    const j = combineSeparate(critique(5), critique(6));
    expect(j).toMatchObject({ winner: "b", decidedBy: "scores", why: "overall 6", margin: -1 });
    expect(j.fixes[0]!.tools).toContain("color_grade_clip_tool");
  });
});
