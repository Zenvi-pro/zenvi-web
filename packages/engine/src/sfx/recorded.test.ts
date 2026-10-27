import { describe, expect, it } from "vitest";
import { RECORDED_KIT } from "./recorded-kit.data.js";
import { RECORDED_GROUPS, RECORDED_GROUP_SPECS, pickRecorded, pickRecordedOne, recordedCredit, recordedGroupOf, recordedMaxSeconds, recordedSamples } from "./recorded.js";
import { sfxRecipe } from "./recipes.js";

describe("the recorded kit", () => {
  it("is CC0 sounds on Freesound's CDN, each listed once with a checksum, in every group", () => {
    expect(RECORDED_KIT.length).toBeGreaterThanOrEqual(70);
    expect(new Set(RECORDED_KIT.map((s) => s.id)).size).toBe(RECORDED_KIT.length);
    for (const s of RECORDED_KIT) {
      expect(s.license).toBe("CC0");
      expect(s.url).toMatch(/^https:\/\/cdn\.freesound\.org\/previews\/\d+\/\d+_\d+-hq\.mp3$/);
      expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const g of RECORDED_GROUPS) expect(recordedSamples(g).length, g).toBeGreaterThanOrEqual(3);
  });

  it("plays only recipes that exist; sub drops, sparkles and tonal risers stay synthesised", () => {
    for (const g of RECORDED_GROUPS) for (const r of RECORDED_GROUP_SPECS[g].recipes) expect(sfxRecipe(r), r).toBeDefined();
    expect(recordedGroupOf("whoosh_short")).toBe("whoosh");
    expect(recordedGroupOf("camera_shutter")).toBe("shutter");
    for (const r of ["sub_drop", "sparkle", "riser_tonal", "notification_blip"]) expect(recordedGroupOf(r)).toBeUndefined();
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
    expect(short.every((p) => p!.duration <= 0.3 * 1.8 + 0.15)).toBe(true);
    expect(pickRecorded([{ recipe: "sub_drop" }], 1)).toEqual([undefined]);
    // Hits are cut to length: a short cue still rotates through every punch.
    const punches = pickRecorded(Array.from({ length: 16 }, () => ({ recipe: "impact_punch", seconds: 0.3 })), 1);
    expect(new Set(punches.map((p) => p!.id)).size).toBe(8);
    expect(recordedMaxSeconds("riser", 2)).toBe(2);
    expect(recordedMaxSeconds("whoosh", 0.3)).toBe(RECORDED_GROUP_SPECS.whoosh.maxSeconds);
  });

  it("picks one sound away from its neighbours, and credits it as CC0 with no credit required", () => {
    const first = pickRecordedOne({ recipe: "camera_shutter" }, 1, 0, [])!;
    const next = pickRecordedOne({ recipe: "camera_shutter" }, 1, 0, [first.id])!;
    expect(next.id).not.toBe(first.id);
    const credit = recordedCredit(first);
    expect(credit).toMatchObject({ provider: "freesound", id: String(first.id), license: "cc0", attribution_required: false, landing_url: `https://freesound.org/s/${first.id}/` });
    expect(credit.attribution).toMatch(/CC0 1\.0/);
  });
});
