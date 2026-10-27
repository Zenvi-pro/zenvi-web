import { describe, expect, it } from "vitest";
import { RECORDED_KIT } from "./recorded-kit.data.js";
import { energyOf, kitTraits, kitVariation, pickVaried, searchKit, soundSeconds } from "./kit-search.js";
import type { RecordedSample } from "./recorded.js";

function sound(id: number, over: Partial<RecordedSample> = {}): RecordedSample {
  return {
    group: "boom",
    id,
    name: `boom ${id}`,
    username: "u",
    duration: 1,
    url: `https://cdn.freesound.org/previews/1/${id}_1-hq.mp3`,
    sha256: "0".repeat(64),
    bytes: 1,
    license: "CC0",
    licenseCheckedAt: "2026-10-27",
    tags: [],
    onsetMs: 0,
    peakMs: 50,
    endMs: 1000,
    attackMs: 5,
    lufs: -20,
    truePeakDb: -3,
    gainDb: 0,
    crestDb: 15,
    centroidHz: 1000,
    lowShare: 0.3,
    stereo: false,
    sourceRate: 48000,
    ...over,
  };
}

const KIT: RecordedSample[] = [
  sound(1, { centroidHz: 300, endMs: 400, name: "dark thump" }),
  sound(2, { centroidHz: 900, endMs: 1200, tags: ["metal"] }),
  sound(3, { centroidHz: 2500, endMs: 3000, attackMs: 200, crestDb: 6, stereo: true, tags: ["metal", "slam"] }),
  sound(4, { group: "click", centroidHz: 5000, endMs: 50, name: "mouse click" }),
  sound(5, { group: "click", centroidHz: 3000, endMs: 80, name: "pen click" }),
  sound(6, { group: "click", centroidHz: 7000, endMs: 30, name: "button click" }),
];

describe("searchKit", () => {
  it("splits a category into thirds of brightness, length and energy", () => {
    expect(kitTraits(KIT[0]!, KIT)).toEqual({ brightness: "dark", length: "short", energy: "hard" });
    expect(kitTraits(KIT[2]!, KIT)).toMatchObject({ brightness: "bright", length: "long", energy: "soft" });
    // A bright boom is still a boom: thirds are per category.
    expect(kitTraits(KIT[4]!, KIT).brightness).toBe("dark");
    expect(energyOf(KIT[0]!)).toBeGreaterThan(energyOf(KIT[2]!));
    expect(soundSeconds(KIT[1]!)).toBeCloseTo(1.2);
  });

  it("filters by category, traits and stereo, ranks word matches first, and falls back to the nearest third", () => {
    expect(searchKit({ group: "boom", brightness: "dark" }, KIT).map((m) => m.sample.id)).toEqual([1]);
    expect(searchKit({ group: "boom", text: "metal slam" }, KIT).map((m) => m.sample.id)).toEqual([3, 2, 1]);
    expect(searchKit({ text: "click" }, KIT).map((m) => m.sample.id)).toEqual([4, 5, 6]);
    expect(searchKit({ group: "boom", stereo: true }, KIT).map((m) => m.sample.id)).toEqual([3]);
    expect(searchKit({ group: "click", maxSeconds: 0.06 }, KIT).map((m) => m.sample.id)).toEqual([4, 6]);
    // No stereo click is long: the long third wins over nothing.
    expect(searchKit({ group: "click", length: "long", energy: "soft" }, KIT).length).toBeGreaterThan(0);
  });

  it("answers every category of the real kit by brightness", () => {
    for (const group of new Set(RECORDED_KIT.map((s) => s.group))) {
      for (const brightness of ["dark", "bright"] as const) expect(searchKit({ group, brightness }).length, `${group} ${brightness}`).toBeGreaterThan(0);
    }
  });
});

describe("pickVaried", () => {
  const pool = KIT.slice(0, 3);

  it("never takes the sound just before or after the moment, and prefers the least used", () => {
    expect(pickVaried(pool, [{ id: 1, at: 1 }], 2)!.id).toBe(2);
    expect(pickVaried(pool, [{ id: 1, at: 1 }, { id: 2, at: 3 }], 2)!.id).toBe(3);
    expect(pickVaried(pool, [{ id: 1, at: 1 }, { id: 1, at: 2 }, { id: 3, at: 4 }, { id: 2, at: 5 }], 6)!.id).toBe(3);
  });

  it("keeps any sound to three uses in 30 s while another is free", () => {
    const used = [
      { id: 2, at: 0 },
      { id: 2, at: 2 },
      { id: 2, at: 4 },
      { id: 1, at: 5 },
      { id: 1, at: 6 },
      { id: 3, at: 7 },
      { id: 3, at: 8 },
    ];
    // 2 is the least recent but already three times in the window; 1 and 3 have room, 3 is the neighbour.
    expect(pickVaried(pool, used, 9)!.id).toBe(1);
    // Past the window, 2 is free again (3, the neighbour, is not).
    expect(pickVaried([KIT[1]!, KIT[2]!], [...used.slice(0, 3), { id: 3, at: 5 }], 40)!.id).toBe(2);
  });

  it("still plays from a pool of one", () => {
    expect(pickVaried([KIT[0]!], [{ id: 1, at: 0 }], 1)!.id).toBe(1);
    expect(pickVaried([], [], 0)).toBeUndefined();
  });
});

describe("kitVariation", () => {
  it("plays a first use as recorded and varies repeats within ±1 st and ±1.5 dB, the same way every time", () => {
    expect(kitVariation(7, 0, 1)).toEqual({ semitones: 0, gainDb: 0 });
    const vs = Array.from({ length: 50 }, (_, i) => kitVariation(7, i + 1, 1));
    for (const v of vs) {
      expect(Math.abs(v.semitones)).toBeLessThanOrEqual(1);
      expect(v.semitones).not.toBe(0);
      expect(Math.abs(v.gainDb)).toBeLessThanOrEqual(1.5);
    }
    expect(new Set(vs.map((v) => v.semitones)).size).toBeGreaterThan(3);
    expect(kitVariation(7, 3, 1)).toEqual(vs[2]);
  });
});
