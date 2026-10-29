import { describe, expect, it } from "vitest";
import { planTrailer } from "./trailer.js";

describe("trailer plan", () => {
  const plan = planTrailer({ media: 6, seconds: 40, fps: 30, title: "THE LONG WAY", actCards: ["THIS WINTER", "ONE ROAD"], endCard: "SOON" });

  it("runs three acts, cards between them, a silence, the title and the end card, in that order, without gaps", () => {
    const spans = [...plan.shots.map((s) => [s.start, s.end]), ...plan.cards.map((c) => [c.start, c.end]), plan.silence].sort((a, b) => a[0]! - b[0]!);
    for (let i = 1; i < spans.length; i += 1) expect(spans[i]![0]).toBeCloseTo(spans[i - 1]![1]!, 6);
    expect(plan.cards.map((c) => c.kind)).toEqual(["act", "act", "title", "end"]);
    expect(plan.duration).toBeGreaterThan(38);
    expect(plan.duration).toBeLessThan(42);
    expect(plan.silence[1] - plan.silence[0]).toBeCloseTo(0.8, 1);
  });

  it("cuts faster act by act, and faster shot by shot in the climax", () => {
    const len = (act: number) => plan.shots.filter((s) => s.act === act).map((s) => s.end - s.start);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(len(1))).toBeGreaterThan(mean(len(2)) * 1.6);
    expect(mean(len(2))).toBeGreaterThan(mean(len(3)) * 1.6);
    const climax = len(3).slice(0, -1);
    expect(climax[0]!).toBeGreaterThan(climax[climax.length - 1]! * 2.5);
    for (let i = 1; i < climax.length; i += 1) expect(climax[i]!).toBeLessThanOrEqual(climax[i - 1]! + 1 / 30 + 1e-6);
  });

  it("braams open act two, the climax and the title", () => {
    expect(plan.braams).toEqual([plan.acts[1]!.start, plan.acts[2]!.start, plan.silence[1]]);
  });

  it("cuts act two on the beat grid when there is one", () => {
    const beats = Array.from({ length: 120 }, (_, i) => 0.37 + i * 0.6);
    const onBeat = planTrailer({ media: 4, seconds: 40, fps: 30, title: "T", actCards: [], beats });
    for (const s of onBeat.shots.filter((x) => x.act === 2).slice(1)) expect(Math.min(...beats.map((b) => Math.abs(b - s.start)))).toBeLessThanOrEqual(1 / 30 + 1e-6);
  });
});
