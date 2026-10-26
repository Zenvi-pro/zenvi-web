import { describe, expect, it } from "vitest";
import { findClip } from "../../model/query.js";
import { runTool } from "../registry.js";
import { fakeHost } from "../test-support/fake-host.js";
import { IDS, fixtureDoc, snapshotOf } from "../test-support/fixture.js";
import type { ToolReceipt } from "../receipt.js";

interface RampData {
  duration_after: number;
  slowest_at: number;
  speed_min: number;
  audio: string;
  rippled: string[];
  overlaps: unknown[];
}

async function ramp(doc: ReturnType<typeof fixtureDoc>, args: Record<string, unknown>) {
  const result = await runTool({ doc, host: fakeHost() }, "speed_ramp_tool", args);
  return { result, receipt: result.data as ToolReceipt, data: (result.data as ToolReceipt).data as RampData };
}

describe("speed_ramp_tool", () => {
  it("velocity edit: lands the slowest moment on the beat, mutes, one undo step, arguments as strings", async () => {
    const doc = fixtureDoc();
    const before = snapshotOf(doc.project);
    const { receipt, data } = await ramp(doc, { clip_id: IDS.clipA, preset: "velocity", hit_at: "4.0", audio: "mute" });
    expect(receipt.status).toBe("applied");
    expect(receipt.undoSteps).toBe(1);
    expect(Math.abs(data.slowest_at - 4)).toBeLessThanOrEqual(1 / 30);
    expect(data.audio).toBe("muted");
    expect(findClip(doc.project, IDS.clipA)!.volume.Points[0]!.co.Y).toBe(0);
    // The rush shortens the clip: nothing else moved (no ripple).
    expect(data.duration_after).toBeLessThan(10);
    expect(findClip(doc.project, IDS.clipB)!.position).toBe(10);
    doc.undo();
    expect(snapshotOf(doc.project)).toEqual(before);
  });

  it("audio=keep leaves the clip's volume alone", async () => {
    const doc = fixtureDoc();
    const { data } = await ramp(doc, { clip_id: IDS.clipA, preset: "hero", audio: "keep", ripple: true });
    expect(data.audio).toBe("kept");
    expect(findClip(doc.project, IDS.clipA)!.volume.Points[0]!.co.Y).toBe(1);
  });

  it("refuses a longer clip that would run into the next one, unless ripple or allow_overlap", async () => {
    const doc = fixtureDoc();
    const before = snapshotOf(doc.project);
    const refused = await ramp(doc, { clip_id: IDS.clipA, preset: "ramp_in" });
    expect(refused.receipt.status).toBe("refused");
    expect(refused.receipt.summary).toMatch(/would overlap .* pass ripple=true/);
    expect(snapshotOf(doc.project)).toEqual(before);

    const overlap = await ramp(doc, { clip_id: IDS.clipA, preset: "ramp_in", allow_overlap: true });
    expect(overlap.receipt.status).toBe("applied");
    expect(overlap.data.overlaps).toHaveLength(1);
    expect(overlap.receipt.warnings.join(" ")).toMatch(/covers 1 other clip/);
  });

  it("ripple moves the later clips on the track by the change in length, in the same undo step", async () => {
    const doc = fixtureDoc();
    const { receipt, data } = await ramp(doc, { clip_id: IDS.clipA, preset: "ramp_in", ripple: true });
    expect(receipt.undoSteps).toBe(1);
    const delta = data.duration_after - 10;
    expect(delta).toBeGreaterThan(0);
    expect(data.rippled.sort()).toEqual([IDS.clipB, IDS.clipTail].sort());
    expect(findClip(doc.project, IDS.clipB)!.position).toBeCloseTo(10 + delta, 6);
    expect(findClip(doc.project, IDS.clipTail)!.position).toBeCloseTo(15 + delta, 6);
    // Other tracks stay where they were.
    expect(findClip(doc.project, IDS.clipLogo)!.position).toBe(2);
    expect(doc.undo()).toHaveLength(1);
    expect(findClip(doc.project, IDS.clipB)!.position).toBe(10);
  });

  it("ripple closes the gap when the ramp shortens the clip", async () => {
    const doc = fixtureDoc();
    const { data } = await ramp(doc, { clip_id: IDS.clipA, preset: "velocity", ripple: true });
    expect(data.duration_after).toBeLessThan(10);
    expect(findClip(doc.project, IDS.clipB)!.position).toBeCloseTo(data.duration_after, 2);
  });

  it("custom points, and the same ramp twice is a no-op with no undo step", async () => {
    const doc = fixtureDoc();
    const args = {
      clip_id: IDS.clipA,
      preset: "custom",
      ease: "in-out",
      points: [
        { at_seconds_in_clip: "0", speed: "1" },
        { at_seconds_in_clip: "2", speed: "0.5" },
        { at_seconds_in_clip: "4", speed: "1" },
      ],
    };
    const first = await ramp(doc, args);
    expect(first.receipt.status).toBe("applied");
    expect(first.data.duration_after).toBe(4);
    const steps = doc.undoLabels.length;
    const again = await ramp(doc, args);
    expect(again.receipt.status).toBe("unchanged");
    expect(doc.undoLabels).toHaveLength(steps);
  });

  it("the same ramp twice on a clip without sound is a no-op too", async () => {
    const doc = fixtureDoc();
    const reader = { ...findClip(doc.project, IDS.clipA)!.reader, has_audio: false };
    doc.transaction("no sound", (tx) => tx.update(["clips", { id: IDS.clipA }], { reader }));
    const args = { clip_id: IDS.clipA, preset: "velocity", ripple: true };
    expect((await ramp(doc, args)).receipt.status).toBe("applied");
    const again = await ramp(doc, args);
    expect(again.receipt.status).toBe("unchanged");
    expect(again.receipt.undoSteps).toBe(0);
  });

  it("warns that slow motion on a 30 fps source is choppy", async () => {
    const { receipt } = await ramp(fixtureDoc(), { clip_id: IDS.clipA, preset: "hero", slow: 0.2, ripple: true });
    expect(receipt.warnings.join(" ")).toMatch(/choppy.*optical-flow/);
  });

  it("refuses without touching history: unknown clip, bad speeds, footage that runs out, still images", async () => {
    const doc = fixtureDoc();
    const before = snapshotOf(doc.project);
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ clip_id: "NOPE", preset: "hero" }, /No timeline clip with id='NOPE'/],
      [{ clip_id: IDS.clipA, preset: "hero", slow: 0 }, /slow/],
      [{ clip_id: IDS.clipA, preset: "custom" }, /at least two/],
      [{ clip_id: IDS.clipA, preset: "velocity", hit_at: "9", fast: 8 }, /runs out/],
      [{ clip_id: IDS.clipA, preset: "velocity", hit_at: "0" }, /before the clip starts|lead-in/],
      [{ clip_id: IDS.clipLogo, preset: "hero" }, /no moving picture/],
    ];
    for (const [args, summary] of cases) {
      const { receipt } = await ramp(doc, args);
      expect(["refused", "error"], JSON.stringify(args)).toContain(receipt.status);
      expect(receipt.summary).toMatch(summary);
      expect(receipt.undoSteps).toBe(0);
    }
    expect(snapshotOf(doc.project)).toEqual(before);
  });
});
