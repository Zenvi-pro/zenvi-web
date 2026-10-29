import { describe, expect, it } from "vitest";
import { planTrailer } from "./trailer.js";

describe("trailer plan", () => {
  const plan = planTrailer({ media: 6, seconds: 40, fps: 30, title: "THE LONG WAY", actCards: ["THIS WINTER", "ONE ROAD"], endCard: "SOON" });
  const len = (shots: { start: number; end: number }[]) => shots.map((s) => s.end - s.start);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  it("runs cold open, card, world, card, held hit, silence, escalation, title and end card, without gaps", () => {
    const spans = [...plan.shots.map((s) => [s.start, s.end]), ...plan.cards.map((c) => [c.start, c.end]), plan.silence].sort((a, b) => a[0]! - b[0]!);
    for (let i = 1; i < spans.length; i += 1) expect(spans[i]![0]).toBeCloseTo(spans[i - 1]![1]!, 6);
    expect(plan.cards.map((c) => c.kind)).toEqual(["act", "act", "title", "end"]);
    expect(plan.duration).toBeGreaterThan(38);
    expect(plan.duration).toBeLessThan(42);
    // The silence is the black before the escalation.
    expect(plan.silence[1]).toBeCloseTo(plan.acts[2]!.start, 6);
    expect(plan.silence[1] - plan.silence[0]).toBeCloseTo(0.8, 1);
  });

  it("cuts faster from act to act, the escalation faster shot by shot, with one held shot of 4-6 s", () => {
    const cold = len(plan.shots.filter((s) => s.act === 1));
    const world = len(plan.shots.filter((s) => s.act === 2 && !s.held));
    const esc = len(plan.shots.filter((s) => s.act === 3));
    expect(mean(cold)).toBeGreaterThan(mean(world));
    expect(mean(world)).toBeGreaterThan(mean(esc) * 2);
    // The first third against the last: 1.4-3x in the references.
    expect(mean(cold) / mean(esc)).toBeGreaterThan(2.5);
    const climbing = esc.slice(0, -1);
    for (let i = 1; i < climbing.length; i += 1) expect(climbing[i]!).toBeLessThanOrEqual(climbing[i - 1]! + 1 / 30 + 1e-6);
    const held = plan.shots.filter((s) => s.held);
    expect(held).toHaveLength(1);
    expect(held[0]!.end - held[0]!.start).toBeGreaterThanOrEqual(4);
    expect(held[0]!.end - held[0]!.start).toBeLessThanOrEqual(6);
  });

  it("braams on the held hit, the escalation and the title; one flash inside the escalation; the riser over the held hit", () => {
    const held = plan.shots.find((s) => s.held)!;
    expect(plan.braams).toEqual([held.start, plan.acts[2]!.start, plan.cards.find((c) => c.kind === "title")!.start]);
    expect(plan.flash).toBeGreaterThan(plan.acts[2]!.start);
    expect(plan.flash).toBeLessThan(plan.acts[2]!.end);
    expect(plan.riser).toEqual([held.start, plan.silence[0]]);
  });

  it("cuts the world on the beat grid when there is one", () => {
    const beats = Array.from({ length: 120 }, (_, i) => 0.37 + i * 0.6);
    const onBeat = planTrailer({ media: 4, seconds: 40, fps: 30, title: "T", actCards: [], beats });
    for (const s of onBeat.shots.filter((x) => x.act === 2 && !x.held).slice(1)) expect(Math.min(...beats.map((b) => Math.abs(b - s.start)))).toBeLessThanOrEqual(1 / 30 + 1e-6);
  });
});
