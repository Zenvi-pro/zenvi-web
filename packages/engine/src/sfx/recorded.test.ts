import { describe, expect, it } from "vitest";
import { RECORDED_KIT } from "./recorded-kit.data.js";
import { RECORDED_GROUPS, RECORDED_GROUP_SPECS, pickRecorded, pickRecordedOne, recordedCredit, recordedGroupOf, recordedMaxSeconds, recordedPlaceRecipe, recordedSamples } from "./recorded.js";
import { kitTraits } from "./kit-search.js";
import { sfxRecipe } from "./recipes.js";

describe("the recorded kit", () => {
  it("is 400-600 CC0 sounds on Freesound's CDN, each listed once with a checksum, licence date and measurements, in every group", () => {
    expect(RECORDED_KIT.length).toBeGreaterThanOrEqual(400);
    expect(RECORDED_KIT.length).toBeLessThanOrEqual(600);
    expect(new Set(RECORDED_KIT.map((s) => s.id)).size).toBe(RECORDED_KIT.length);
    for (const s of RECORDED_KIT) {
      expect(s.license).toBe("CC0");
      expect(s.url).toMatch(/^https:\/\/cdn\.freesound\.org\/previews\/\d+\/\d+_\d+-hq\.mp3$/);
      expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(s.licenseCheckedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.sourceRate).toBeGreaterThanOrEqual(44100);
      expect(s.endMs).toBeGreaterThan(s.onsetMs);
      expect(s.peakMs).toBeGreaterThanOrEqual(s.onsetMs - 25);
      // Previews are MP3: a recording peaking at 0 dBFS decodes with inter-sample overs, levelled away when placed.
      expect(s.truePeakDb).toBeLessThan(3);
      expect(Number.isFinite(s.lufs) && Number.isFinite(s.gainDb) && s.centroidHz > 0).toBe(true);
    }
    // CRAFT: a pool of at least four per class, so a sound never has to repeat.
    for (const g of RECORDED_GROUPS) expect(recordedSamples(g).length, g).toBeGreaterThanOrEqual(4);
  });

  it("plays only recipes that exist, and now has recordings for sub drops, sparkles, tonal risers and notifications", () => {
    for (const g of RECORDED_GROUPS) for (const r of [...RECORDED_GROUP_SPECS[g].recipes, recordedPlaceRecipe(g)]) expect(sfxRecipe(r), r).toBeDefined();
    expect(recordedGroupOf("whoosh_short")).toBe("whoosh");
    expect(recordedGroupOf("camera_shutter")).toBe("shutter");
    expect(recordedGroupOf("sub_drop")).toBe("sub");
    expect(recordedGroupOf("sparkle")).toBe("sparkle");
    expect(recordedGroupOf("riser_tonal")).toBe("riser");
    expect(recordedGroupOf("notification_blip")).toBe("notify");
    expect(recordedGroupOf("reverse_swell")).toBe("reverse");
    expect(recordedGroupOf("swoosh_hit")).toBeUndefined();
  });

  it("puts only fast-attack recordings on a transient, and no soft ones on a hero hit", () => {
    for (const recipe of ["impact_punch", "impact_thud", "mouse_click", "pop"]) {
      const picks = pickRecorded(Array.from({ length: 30 }, (_, i) => ({ recipe, at: i * 2 })), 1);
      expect(picks.every((p) => p!.attackMs <= 30), recipe).toBe(true);
      expect(new Set(picks.map((p) => p!.id)).size, recipe).toBeGreaterThanOrEqual(4);
    }
    const booms = pickRecorded(Array.from({ length: 30 }, (_, i) => ({ recipe: "impact_boom", at: i * 2 })), 1);
    expect(booms.every((p) => kitTraits(p!).energy !== "soft")).toBe(true);
  });

  it("plays no sound more than three times in 30 s", () => {
    // 40 whooshes in 20 s: a pool of 14 or more covers them at three uses each.
    expect(recordedSamples("whoosh").length).toBeGreaterThanOrEqual(14);
    const picks = pickRecorded(Array.from({ length: 40 }, (_, i) => ({ recipe: "whoosh_medium", at: i * 0.5 })), 3);
    const counts = new Map<number, number>();
    for (const p of picks) counts.set(p!.id, (counts.get(p!.id) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(3);
  });

  it("never plays the same sound twice in a row, and rotates through a group", () => {
    const requests = Array.from({ length: 40 }, (_, i) => ({ recipe: i % 5 === 4 ? "impact_punch" : "whoosh_short", seconds: 0.45 }));
    const picks = pickRecorded(requests, 7);
    for (let i = 1; i < picks.length; i += 1) expect(picks[i]!.id).not.toBe(picks[i - 1]!.id);
    const whooshes = picks.filter((p) => p!.group === "whoosh").map((p) => p!.id);
    for (let i = 1; i < whooshes.length; i += 1) expect(whooshes[i]).not.toBe(whooshes[i - 1]);
    expect(new Set(whooshes).size).toBeGreaterThanOrEqual(4);
    // Another seed, another order; the same seed, the same design.
    expect(pickRecorded(requests, 8).map((p) => p!.id)).not.toEqual(picks.map((p) => p!.id));
    expect(pickRecorded(requests, 7)).toEqual(picks);
  });

  it("prefers sounds about as long as the cue, and cuts sustained ones to it", () => {
    const short = pickRecorded(Array.from({ length: 10 }, () => ({ recipe: "whoosh_short", seconds: 0.3 })), 1);
    expect(short.every((p) => (p!.endMs - p!.onsetMs) / 1000 <= 0.3 * 1.8 + 0.15)).toBe(true);
    expect(pickRecorded([{ recipe: "swoosh_hit" }], 1)).toEqual([undefined]);
    // Hits are cut to length: a short cue still rotates through the fast, hard punches (not only the shortest).
    const all = recordedSamples("punch").length;
    const punches = pickRecorded(Array.from({ length: 2 * all }, () => ({ recipe: "impact_punch", seconds: 0.3 })), 1);
    expect(new Set(punches.map((p) => p!.id)).size).toBeGreaterThanOrEqual(8);
    expect(recordedMaxSeconds("riser", 2)).toBe(2);
    expect(recordedMaxSeconds("whoosh", 0.3)).toBe(RECORDED_GROUP_SPECS.whoosh.maxSeconds);
  });

  it("picks one sound away from its neighbours, and credits it as CC0 with no credit required", () => {
    const first = pickRecordedOne({ recipe: "camera_shutter", at: 5 }, 1, [])!;
    const next = pickRecordedOne({ recipe: "camera_shutter", at: 6 }, 1, [{ id: first.id, at: 5 }])!;
    expect(next.id).not.toBe(first.id);
    // Between two placed sounds, neither of them.
    const between = pickRecordedOne({ recipe: "camera_shutter", at: 5.5 }, 1, [{ id: first.id, at: 5 }, { id: next.id, at: 6 }])!;
    expect([first.id, next.id]).not.toContain(between.id);
    const credit = recordedCredit(first);
    expect(credit).toMatchObject({ provider: "freesound", id: String(first.id), license: "cc0", attribution_required: false, landing_url: `https://freesound.org/s/${first.id}/` });
    expect(credit.attribution).toMatch(/CC0 1\.0/);
  });
});
