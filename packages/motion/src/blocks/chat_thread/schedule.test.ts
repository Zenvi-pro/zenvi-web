import { describe, expect, it } from "vitest";
import { planChat } from "./schedule.js";

describe("chat_thread schedule", () => {
  it("types, sends, then dots and streams, in order", () => {
    const plan = planChat([{ role: "user", units: 44 }, { role: "assistant", units: 18 }], 12, 1.4);
    const [q, a] = plan.turns;
    expect(plan.cps).toBe(22);
    expect(q!.end).toBeCloseTo(0.5 + 2, 5);
    expect(q!.send).toBeGreaterThan(q!.end);
    expect(a!.start).toBeGreaterThan(q!.send);
    expect(a!.send).toBeCloseTo(a!.start + 0.8, 5);
    expect(a!.end).toBeCloseTo(a!.send + 2, 5);
  });
  it("speeds typing and streaming up together to fit a short block", () => {
    const plan = planChat([{ role: "user", units: 88 }, { role: "assistant", units: 36 }], 6, 1.4);
    expect(plan.cps).toBeGreaterThan(22);
    expect(plan.cps / 22).toBeCloseTo(plan.wps / 9, 5);
    expect(plan.turns[1]!.end).toBeLessThanOrEqual(6 - 1.4 + 1e-6);
  });
  it("never more than 4× faster", () => {
    const plan = planChat([{ role: "user", units: 240 }, { role: "assistant", units: 60 }], 3.5, 1.4);
    expect(plan.cps).toBe(88);
  });
});
