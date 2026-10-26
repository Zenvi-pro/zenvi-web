import { describe, expect, it } from "vitest";
import { createProject } from "../model/defaults.js";
import { KIT_SLOTS, SOUND_KIT_KEY, applyKit, fitsSlot, guessSlot, kitFileIds, librarySlots, proceduralKit, readSoundKit, type SoundKit } from "./kit.js";
import type { SfxCue } from "./plan.js";

const cue = (recipe: string, at: number, params: SfxCue["params"] = {}): SfxCue => ({ recipe, at, params, gainDb: -10, reason: "cut" });

describe("proceduralKit", () => {
  it("is the same kit for the same seed and tone, another for another seed", () => {
    const a = proceduralKit({ name: "A", seed: 3, source: "procedural", tone: "neutral" });
    expect(proceduralKit({ name: "A", seed: 3, source: "procedural", tone: "neutral" })).toEqual(a);
    expect(Object.keys(a.slots)).toEqual([...KIT_SLOTS]);
    const others = [4, 5, 6, 7].map((seed) => proceduralKit({ name: "A", seed, source: "procedural", tone: "neutral" }));
    expect(others.some((k) => JSON.stringify(k.slots) !== JSON.stringify(a.slots))).toBe(true);
  });

  it("colours every slot with the tone: dark is lower and duller than bright", () => {
    const dark = proceduralKit({ name: "d", seed: 1, source: "procedural", tone: "dark" });
    const bright = proceduralKit({ name: "b", seed: 1, source: "procedural", tone: "bright" });
    for (const slot of KIT_SLOTS) {
      const d = dark.slots[slot]!;
      const b = bright.slots[slot]!;
      if (d.source !== "procedural" || b.source !== "procedural") throw new Error("procedural kits only");
      expect(d.brightness).toBeLessThan(b.brightness);
      expect(d.pitch).toBeLessThan(b.pitch);
    }
    expect(proceduralKit({ name: "p", seed: 1, source: "procedural", tone: "dark", pitch: 4, brightness: 0.9 })).toMatchObject({ pitch: 4, brightness: 0.9 });
  });
});

describe("applyKit", () => {
  const kit = proceduralKit({ name: "K", seed: 2, source: "procedural", tone: "dark" });

  it("plays every whoosh, whatever size the planner picked, as the kit's one whoosh, rotating its seeds", () => {
    const cues = [cue("whoosh_short", 1, { duration: 0.3, pitch: 1, seed: 11, pan: 0.5 }), cue("whoosh_long", 2, { duration: 2, pitch: -1, seed: 12 }), cue("whoosh_medium", 3, { seed: 13 }), cue("whoosh_rise", 4, { seed: 14 })];
    const picks = applyKit(kit, cues);
    const slot = kit.slots.whoosh!;
    if (slot.source !== "procedural") throw new Error("procedural");
    for (const pick of picks) {
      if (pick.kind !== "procedural") throw new Error("procedural");
      expect(pick.recipe).toBe(slot.recipe);
      expect(pick.params.brightness).toBe(slot.brightness);
    }
    const params = picks.map((p) => (p.kind === "procedural" ? p.params : {}));
    expect(params.map((p) => p.seed)).toEqual([slot.seeds[0], slot.seeds[1], slot.seeds[2], slot.seeds[0]]);
    // The planner's length and pan stay; its pitch becomes a nuance around the slot's.
    expect(params[0]).toMatchObject({ duration: 0.3, pan: 0.5, pitch: Math.round((slot.pitch + 0.3) * 10) / 10 });
  });

  it("takes library sounds in turn and gives recipes without a slot the kit's tone", () => {
    const sounds = [
      { file_id: "F1", provider: "openverse" as const, id: "a", title: "One", license: "cc0" },
      { file_id: "F2", provider: "openverse" as const, id: "b", title: "Two", license: "by" },
    ];
    const withLibrary: SoundKit = { ...kit, source: "mixed", slots: { ...kit.slots, hit: { source: "library", recipe: "impact_punch", sounds } } };
    const picks = applyKit(withLibrary, [cue("impact_punch", 1), cue("impact_thud", 2), cue("impact_slam", 3), cue("sparkle", 4, { pitch: 1 })]);
    expect(picks.slice(0, 3).map((p) => (p.kind === "library" ? p.sound.file_id : p.kind))).toEqual(["F1", "F2", "F1"]);
    expect(picks[3]).toEqual({ kind: "procedural", recipe: "sparkle", params: { pitch: Math.round((kit.pitch + 0.3) * 10) / 10, brightness: kit.brightness } });
    expect([...kitFileIds(withLibrary)]).toEqual(["F1", "F2"]);
  });
});

describe("readSoundKit", () => {
  it("reads the kit from the project's settings and ignores what is not one", () => {
    const project = createProject();
    expect(readSoundKit(project)).toBeNull();
    const kit = proceduralKit({ name: "K", seed: 1, source: "procedural", tone: "neutral" });
    project.settings = { [SOUND_KIT_KEY]: kit };
    expect(readSoundKit(project)).toEqual(kit);
    project.settings = { [SOUND_KIT_KEY]: { ...kit, slots: { whoosh: { source: "procedural", recipe: "no_such_recipe", pitch: 0, brightness: 0.5, seeds: [1] } } } };
    expect(readSoundKit(project)).toBeNull();
    project.settings = { [SOUND_KIT_KEY]: { ...kit, version: 2 } };
    expect(readSoundKit(project)).toBeNull();
  });
});

describe("slots", () => {
  it("guesses what a library sound plays from its title, then its tags", () => {
    expect(guessSlot("Deep Whoosh #1")).toBe("whoosh");
    expect(guessSlot("Cinematic riser build up")).toBe("riser");
    expect(guessSlot("Glass impact hit")).toBe("hit");
    expect(guessSlot("Untitled 4", ["ui", "click"])).toBe("click");
    expect(guessSlot("Untitled 4")).toBe("hit");
  });

  it("lets a punch be a boom and a swish a whoosh, but never an impact a riser", () => {
    expect(fitsSlot("boom", "PUNCH-BOXING-01.wav")).toBe(true);
    expect(fitsSlot("whoosh", "Swipe 3")).toBe(true);
    expect(fitsSlot("riser", "2 Impact Wet")).toBe(false);
    expect(fitsSlot("riser", "Impact", ["riser", "build"])).toBe(false);
    expect(fitsSlot("riser", "Cinematic build up")).toBe(true);
  });

  it("takes whooshes, swishes, hits, booms and risers from the library in a mixed kit", () => {
    expect(librarySlots("procedural")).toEqual([]);
    expect(librarySlots("library")).toEqual([...KIT_SLOTS]);
    expect(librarySlots("mixed")).toEqual(["whoosh", "swish", "hit", "boom", "riser"]);
    expect(librarySlots("mixed", ["click", "riser"])).toEqual(["riser"]);
  });
});
