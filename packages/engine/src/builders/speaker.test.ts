import { describe, expect, it } from "vitest";
import { keptWindows, planSpeakerCut } from "./speaker.js";

const w = (text: string, startSec: number, endSec: number) => ({ text, startSec, endSec });

describe("speaker cuts", () => {
  const take = { fileId: "A", duration: 10, words: [w("so", 1, 1.3), w("here", 1.35, 1.7), w("is", 3, 3.2), w("the", 3.25, 3.4), w("trick", 3.45, 3.9), w("watch", 7, 7.5)] };

  it("keeps the phrases with a little air and drops the pauses", () => {
    expect(keptWindows(take, 0.45, 0.08).map(([a, b]) => [Number(a.toFixed(2)), Number(b.toFixed(2))])).toEqual([
      [0.92, 1.78],
      [2.92, 3.98],
      [6.92, 7.58],
    ]);
  });

  it("butts the phrases together, alternating the framing on every jump cut, and moves the words with them", () => {
    const cut = planSpeakerCut([take], { fps: 30, punch: 1.15 });
    expect(cut.segments.map((s) => s.scale)).toEqual([1, 1.15, 1]);
    for (let i = 1; i < cut.segments.length; i += 1) {
      const prev = cut.segments[i - 1]!;
      expect(cut.segments[i]!.position).toBeCloseTo(prev.position + (prev.sourceEnd - prev.sourceStart), 6);
    }
    const trick = cut.words.find((x) => x.text === "trick")!;
    const seg = cut.segments[1]!;
    expect(trick.start).toBeCloseTo(seg.position + (3.45 - seg.sourceStart), 6);
    expect(cut.duration).toBeLessThan(3);
    expect(cut.removed).toBeGreaterThan(7);
  });

  it("a take without words plays whole, and a new take opens wide", () => {
    const cut = planSpeakerCut([take, { fileId: "B", duration: 4, words: [] }], { fps: 30 });
    const last = cut.segments[cut.segments.length - 1]!;
    expect(last).toMatchObject({ fileId: "B", sourceStart: 0, scale: 1 });
    expect(last.sourceEnd).toBeCloseTo(4, 6);
  });
});
