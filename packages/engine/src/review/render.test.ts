import { describe, expect, it } from "vitest";
import type { RenderInspection } from "../tools/types.js";
import { differenceHash, endVerdict, hashDistance, renderProblems, repeatedShots, sheetShots, shotsFromCuts, type Shot } from "./render.js";

function inspection(over: Partial<RenderInspection> = {}): RenderInspection {
  return {
    path: "/out.mp4",
    duration: 10,
    width: 1080,
    height: 1920,
    fps: 30,
    hasAudio: true,
    black: [],
    frozen: [],
    cuts: [],
    silences: [],
    loudness: { integratedLufs: -14.2, rangeLu: 3, truePeakDb: -1.2 },
    ...over,
  };
}

/** A 16x16 image: vertical stripes `period` pixels wide (different periods hash apart). */
function stripes(period: number, invert = false): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(16 * 16 * 4);
  for (let i = 0; i < 256; i += 1) {
    const on = Math.floor((i % 16) / period) % 2 === (invert ? 1 : 0);
    data.set([on ? 230 : 20, on ? 230 : 20, on ? 230 : 20, 255], i * 4);
  }
  return { width: 16, height: 16, data };
}

describe("shotsFromCuts", () => {
  it("splits the file at its cuts and folds a flash frame into the shot before", () => {
    const shots = shotsFromCuts([{ time: 4 }, { time: 2 }, { time: 2.05 }, { time: 9.95 }], 10);
    expect(shots).toEqual([
      { index: 1, start: 0, end: 2, mid: 1 },
      { index: 2, start: 2, end: 4, mid: 3 },
      { index: 3, start: 4, end: 10, mid: 7 },
    ]);
  });
});

describe("endVerdict", () => {
  const shots = (lastStart: number): Shot[] => shotsFromCuts([{ time: lastStart }], 10);

  it("calls out an end on black, but not a fade of a few frames", () => {
    expect(endVerdict(inspection({ black: [{ start: 9.07, end: 9.967 }] }), shots(5))).toMatchObject({ kind: "black", ok: false, seconds: 0.93 });
    expect(endVerdict(inspection({ black: [{ start: 9.9, end: 9.967 }] }), shots(5))).toMatchObject({ kind: "final_shot", ok: true });
  });

  it("is happy with a hold or a settled final shot, not with a cut-off one", () => {
    expect(endVerdict(inspection({ frozen: [{ start: 8.5, end: 10 }] }), shots(9.5))).toMatchObject({ kind: "hold", ok: true, seconds: 1.5 });
    // Black counts as frozen too; that is not a hold.
    expect(endVerdict(inspection({ frozen: [{ start: 9.9, end: 10 }], black: [{ start: 9.9, end: 9.967 }] }), shots(5)).kind).toBe("final_shot");
    expect(endVerdict(inspection(), shots(9.5))).toMatchObject({ kind: "abrupt", ok: false, seconds: 0.5 });
  });
});

describe("repeated shots", () => {
  it("hashes structure, not brightness", () => {
    const a = differenceHash(stripes(4));
    expect(a).toHaveLength(16);
    expect(hashDistance(a, differenceHash(stripes(4)))).toBe(0);
    expect(hashDistance(a, differenceHash(stripes(2)))).toBeGreaterThan(6);
  });

  it("groups shots that show the same picture, ignoring neighbours and flat frames", () => {
    const shots = shotsFromCuts(
      [1, 2, 3, 4, 5].map((time) => ({ time })),
      6,
    );
    const a = differenceHash(stripes(4));
    const b = differenceHash(stripes(2));
    const flat = "0000000000000000";
    const groups = repeatedShots(shots, [a, b, b, a, flat, flat]);
    // Shots 2 and 3 are neighbours (one shot split by a false cut); 4 repeats 1 three seconds later.
    expect(groups).toEqual([{ shots: [1, 4], minGapSeconds: 3 }]);
  });
});

describe("renderProblems", () => {
  it("lists what to fix, in time order, then the audio", () => {
    const shots = shotsFromCuts([{ time: 2 }, { time: 4 }, { time: 6 }], 10);
    const insp = inspection({
      black: [
        { start: 0, end: 0.8 },
        { start: 3, end: 3.4 },
        { start: 5, end: 5.033 },
        { start: 9.2, end: 9.967 },
      ],
      frozen: [{ start: 6.5, end: 7.5 }],
      silences: [{ start: 4.5, end: 5 }],
      loudness: { integratedLufs: -10.3, rangeLu: 2.3, truePeakDb: 0.9 },
    });
    const end = endVerdict(insp, shots);
    const problems = renderProblems(insp, shots, [{ shots: [1, 3], minGapSeconds: 4 }], end);
    expect(problems.map((p) => [p.kind, p.severity])).toEqual([
      ["opens_on_black", "problem"],
      ["repeated_shot", "warning"],
      ["black_frames", "problem"],
      ["audio_dropout", "warning"],
      ["frozen_picture", "warning"],
      ["ends_on_black", "problem"],
      ["true_peak", "problem"],
      ["loudness", "warning"],
    ]);
    expect(problems.find((p) => p.kind === "true_peak")!.message).toBe("true peak +0.9 dBTP is over the -1.0 dBTP ceiling: it clips; master the audio");
  });

  it("calls a shot back within three seconds a problem, and names silent or missing audio", () => {
    const shots = shotsFromCuts([{ time: 1 }, { time: 2 }], 3);
    const quick = renderProblems(inspection({ duration: 3 }), shots, [{ shots: [1, 3], minGapSeconds: 2 }], {
      kind: "final_shot",
      ok: true,
      seconds: 1,
      message: "",
    });
    expect(quick[0]).toMatchObject({ kind: "repeated_shot", severity: "problem" });
    expect(quick[0]!.message).toMatch(/again after only 2\.00s: use more footage$/);
    const silent = renderProblems(inspection({ loudness: { integratedLufs: null, rangeLu: null, truePeakDb: null } }), shots, [], {
      kind: "hold",
      ok: true,
      seconds: 1,
      message: "",
    });
    expect(silent.map((p) => p.kind)).toEqual(["silent_audio"]);
    expect(renderProblems(inspection({ hasAudio: false, loudness: null }), shots, [], { kind: "hold", ok: true, seconds: 1, message: "" })[0]!.kind).toBe(
      "no_audio",
    );
  });
});

describe("sheetShots", () => {
  it("keeps every shot when they fit, else spreads them and keeps the repeats", () => {
    const shots = shotsFromCuts(
      Array.from({ length: 29 }, (_, i) => ({ time: (i + 1) * 0.5 })),
      15,
    );
    expect(sheetShots(shots.slice(0, 5), [], 12)).toHaveLength(5);
    const picked = sheetShots(shots, [{ shots: [2, 30], minGapSeconds: 14 }], 12);
    expect(picked).toHaveLength(11);
    expect(picked.map((s) => s.index)).toEqual(expect.arrayContaining([2, 30]));
    expect(picked.map((s) => s.index)).toEqual([...picked.map((s) => s.index)].sort((a, b) => a - b));
  });
});
