import { describe, expect, it } from "vitest";
import { cutTimes, fillShots, rampLengths, snapCutTimes } from "./ramp.js";

describe("rampLengths", () => {
  it("exponential: each shot the same fraction shorter, from first to last", () => {
    const lengths = rampLengths({ first: 4, last: 1, curve: "exponential", shots: 5 });
    expect(lengths[0]).toBeCloseTo(4, 9);
    expect(lengths[4]).toBeCloseTo(1, 9);
    const ratios = lengths.slice(1).map((x, i) => x / lengths[i]!);
    for (const r of ratios) expect(r).toBeCloseTo(ratios[0]!, 9);
  });

  it("ease_in holds long then collapses; ease_out drops fast then steadies", () => {
    const easeIn = rampLengths({ first: 2, last: 0.5, curve: "ease_in", shots: 9 });
    const easeOut = rampLengths({ first: 2, last: 0.5, curve: "ease_out", shots: 9 });
    expect(easeIn[4]!).toBeGreaterThan(easeOut[4]!);
    expect(easeIn[1]! - easeIn[0]!).toBeGreaterThan(easeIn[8]! - easeIn[7]!);
  });

  it("fills a duration exactly with the count that fits the curve, then settles", () => {
    const lengths = rampLengths({ first: 1.2, last: 0.3, curve: "exponential", duration: 6, settle: 2 });
    expect(lengths[lengths.length - 1]).toBe(2);
    const ramp = lengths.slice(0, -1);
    expect(ramp.reduce((s, x) => s + x, 0)).toBeCloseTo(6, 9);
    expect(ramp.length).toBeGreaterThan(5);
    for (let i = 1; i < ramp.length; i += 1) expect(ramp[i]!).toBeLessThan(ramp[i - 1]!);
  });
});

describe("cutTimes and snapCutTimes", () => {
  it("puts cuts on the frame grid with every shot at least two frames", () => {
    const times = cutTimes([0.5, 0.01, 0.01, 0.5], 30);
    expect(times[0]).toBe(0);
    for (let i = 1; i < times.length; i += 1) expect(Math.round((times[i]! - times[i - 1]!) * 30)).toBeGreaterThanOrEqual(2);
    for (const t of times) expect(Math.abs(t * 30 - Math.round(t * 30))).toBeLessThan(1e-9);
  });

  it("moves a cut to a hit within a third of its shorter shot, never past a neighbour", () => {
    const times = [0, 2, 3, 3.5];
    // 2.2 is within 0.35 s of 2 (shorter shot 1 s); 3.4 is too far from 3 (shorter shot 0.5 s: 0.175 s).
    const { times: out, snapped } = snapCutTimes(times, [2.2, 3.4], 30);
    expect(out).toEqual([0, 2.2, 3, 3.5]);
    expect(snapped).toEqual([true, false]);
  });
});

describe("snapCutTimes keeps a ramp's shape", () => {
  it("never lets a shortening ramp lengthen to reach a beat, and leaves the settle cut to the plain rule", () => {
    const lengths = rampLengths({ first: 1.5, last: 0.25, curve: "exponential", shots: 14, settle: 2 });
    const times = cutTimes(lengths, 30);
    const beats = Array.from({ length: 40 }, (_, k) => k * 0.5);
    const { times: out, snapped } = snapCutTimes(times, beats, 30, 14);
    const shots = out.slice(1).map((t, i) => t - out[i]!);
    for (let i = 1; i < 14; i += 1) expect(shots[i]!).toBeLessThanOrEqual(shots[i - 1]! + 1 / 30 + 1e-9);
    expect(snapped.filter(Boolean).length).toBeGreaterThanOrEqual(4);
  });
});

describe("fillShots", () => {
  const a = { fileId: "A", kind: "video" as const, start: 0, end: 5 };
  const b = { fileId: "B", kind: "video" as const, start: 0, end: 1 };
  const still = { fileId: "S", kind: "image" as const, start: 0, end: Infinity };

  it("takes sources in turn, continues each video where it was cut, and skips one too short", () => {
    const shots = fillShots([0, 2, 3.5, 4.5, 5.5], [a, b]);
    expect(Array.isArray(shots)).toBe(true);
    const list = shots as Exclude<typeof shots, { unfilled: number }>;
    // B (1 s) cannot hold the 2 s and 1.5 s shots: A fills them, continuing from 2 s.
    expect(list.map((s) => [s.fileId, s.sourceStart])).toEqual([["A", 0], ["A", 2], ["B", 0], ["A", 3.5]]);
  });

  it("brings the motif back every N shots from the same moment", () => {
    const shots = fillShots([0, 1, 2, 3, 4, 5, 6], [a], { source: { ...still, fileId: "M" }, every: 3 });
    const list = shots as Exclude<typeof shots, { unfilled: number }>;
    expect(list.map((s) => (s.motif ? "M" : s.fileId))).toEqual(["A", "A", "M", "A", "A", "M"]);
  });

  it("names the first shot nothing can fill", () => {
    expect(fillShots([0, 3], [b])).toEqual({ unfilled: 0, length: 3 });
  });
});
