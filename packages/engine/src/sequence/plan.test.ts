import { describe, expect, it } from "vitest";
import { shotFeatures, THUMB_H, THUMB_W, type ShotFrames } from "./features.js";
import { arcTarget, planSequence, ranks, type SequenceShotInput } from "./plan.js";

/** A frame of one continuous take: a bright square at column x on a dark ramp, tinted per take. */
function frame(x: number, tint: [number, number, number] = [0, 0, 0]): Uint8Array {
  const out = new Uint8Array(THUMB_W * THUMB_H * 3);
  for (let y = 0; y < THUMB_H; y += 1) {
    for (let c = 0; c < THUMB_W; c += 1) {
      const inside = c >= x && c < x + 6 && y >= 6 && y < 12;
      const base = inside ? 230 : 20 + y * 2;
      const o = (y * THUMB_W + c) * 3;
      out[o] = Math.min(255, base + tint[0]);
      out[o + 1] = Math.min(255, base + tint[1]);
      out[o + 2] = Math.min(255, base + tint[2]);
    }
  }
  return out;
}

/** Frames x0..x1 of the take (one column per frame). */
function take(x0: number, x1: number, tint?: [number, number, number]): ShotFrames {
  const all = Array.from({ length: x1 - x0 + 1 }, (_, k) => frame(x0 + k, tint));
  return { head: all.slice(0, 2), tail: all.slice(-2), body: all, step: 1 };
}

function shot(frames: ShotFrames, seconds = 1, extra: Partial<SequenceShotInput> = {}): SequenceShotInput {
  return { features: shotFeatures(frames), seconds, ...extra };
}

describe("planSequence", () => {
  it("puts the pieces of one moving take back in order: the action continues across every cut", () => {
    // A square sweeping right across the frame, cut into five pieces, given shuffled.
    const pieces = [take(0, 4), take(5, 9), take(10, 14), take(15, 19), take(20, 24)].map((f) => shot(f));
    const given = [3, 0, 4, 1, 2];
    const plan = planSequence(given.map((i) => pieces[i]!), { arc: "flat", close: null });
    expect(plan.order.map((k) => given[k])).toEqual([0, 1, 2, 3, 4]);
    expect(plan.meanMatch).toBeGreaterThan(plan.givenMatch);
    expect(plan.cuts.every((c) => c.reasons.includes("action continues"))).toBe(true);
  });

  it("keeps windows of one source file in their source order", () => {
    const still = take(10, 10);
    const shots = [2, 0, 1].map((k) => shot(still, 1, { source: { key: "F", start: k, end: k + 1 } }));
    const plan = planSequence(shots, { arc: "flat", close: null });
    expect(plan.order).toEqual([1, 2, 0]);
    expect(plan.cuts[0]!.reasons).toContain("next moment of the same source");
  });

  it("does not put the same picture twice in a row", () => {
    const a = take(3, 3, [0, 0, 0]);
    const b = take(20, 20, [60, 0, 0]);
    const plan = planSequence([shot(a), shot(a), shot(b)], { arc: "flat", close: null });
    // The duplicate pair is split by the other shot.
    expect(plan.order[1]).toBe(2);
  });

  it("holds the strongest shot for the payoff, and the given close when there is one", () => {
    const weak = [take(0, 2), take(10, 12)].map((f) => shot(f, 0.5));
    const strong = shot(take(20, 22, [0, 120, 200]), 3);
    expect(planSequence([strong, ...weak]).close).toEqual({ index: 0, why: "strongest shot" });
    expect(planSequence([strong, ...weak]).order.at(-1)).toBe(0);
    const given = planSequence([strong, ...weak], { close: 1, open: 0 });
    expect(given.order).toEqual([0, 2, 1]);
    expect(given.close).toEqual({ index: 1, why: "given" });
  });

  it("starts a voice-synced shot on its words", () => {
    const shots = [take(0, 4), take(8, 12), take(16, 20), take(24, 26)].map((f) => shot(f));
    // Shot 0's line is said 2 s in: two one-second shots must come before it.
    shots[0] = { ...shots[0]!, speechAt: 2 };
    const plan = planSequence(shots, { arc: "flat", close: null });
    expect(plan.order[2]).toBe(0);
    expect(plan.starts[2]).toBe(2);
    expect(plan.offSpeech).toEqual([]);
  });

  it("fills slots: leaves the duplicate and the weakest out and trims to the slot lengths", () => {
    const a = take(3, 3);
    const shots = [shot(a, 2), shot(a, 2), shot(take(12, 12, [90, 40, 0]), 2), shot(take(22, 22, [0, 0, 160]), 2)];
    const plan = planSequence(shots, { slots: [1, 0.5, 1.5], close: null });
    expect(plan.order).toHaveLength(3);
    expect(plan.dropped.map((d) => d.why)).toEqual(["near duplicate"]);
    expect(plan.lengths).toEqual([1, 0.5, 1.5]);
    expect(plan.starts).toEqual([0, 1, 1.5]);
  });

  it("gives up the default payoff, not a slot length, when the pinned shots fill every slot", () => {
    const shots = [shot(take(0, 1), 2), shot(take(10, 11, [90, 40, 0]), 3), shot(take(20, 21, [0, 0, 160]), 4)];
    const plan = planSequence(shots, { open: 0, slots: [1] });
    expect(plan.order).toEqual([0]);
    expect(plan.lengths).toEqual([1]);
    expect(plan.close).toBeNull();
    expect(() => planSequence(shots, { open: 0, close: 2, slots: [1] })).toThrow(/pinned/);
  });

  it("refuses impossible goals as programmer errors", () => {
    const s = [shot(take(0, 1)), shot(take(5, 6))];
    expect(() => planSequence([], {})).toThrow();
    expect(() => planSequence(s, { slots: [1, 1, 1] })).toThrow();
    expect(() => planSequence(s, { open: 5 })).toThrow();
  });
});

describe("energy arcs and ranks", () => {
  it("ranks with ties sharing a rank", () => {
    expect(ranks([5, 1, 5, 3])).toEqual([5 / 6, 0, 5 / 6, 1 / 3]);
    expect(ranks([7])).toEqual([0.5]);
  });

  it("peaks three quarters in and releases to half", () => {
    expect(arcTarget("peak", 0)).toBeCloseTo(0.15);
    expect(arcTarget("peak", 0.75)).toBeCloseTo(1);
    expect(arcTarget("peak", 1)).toBeCloseTo(0.5);
    expect(arcTarget("build", 0.3)).toBe(0.3);
    expect(arcTarget("release", 0.3)).toBe(0.7);
  });
});
