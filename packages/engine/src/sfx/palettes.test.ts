import { describe, expect, it } from "vitest";
import { PALETTES, PALETTE_IDS, guessPalette, traitsOf, type EditTraits } from "./palettes.js";
import { sfxRecipe } from "./recipes.js";
import type { HitPoint } from "./spot.js";

const base: EditTraits = { duration: 15, medianShot: 1, speech: false, captions: false, uiEvents: 0, scenes3d: 0, tiles: false, matchCuts: false, music: true };

describe("palettes", () => {
  it("names only recipes that exist, and density bands from DEPLOY.md S4.6", () => {
    for (const id of PALETTE_IDS) {
      const p = PALETTES[id];
      expect(p.id).toBe(id);
      for (const r of [...p.hit, ...p.whoosh.short, ...p.whoosh.long, ...p.ui, ...p.micro]) expect(sfxRecipe(r), `${id}: ${r}`).toBeDefined();
      expect(p.density[0]).toBeLessThan(p.density[1]);
    }
    expect(PALETTES.hype.density).toEqual([1.5, 3.5]);
    expect(PALETTES.talking_head.density).toEqual([0.3, 1.2]);
    expect(PALETTES.saas_ui.sub).toBe(false);
    expect(PALETTES.hype.preHitDuckDb).toBe(10);
  });

  it("reads the genre from the edit", () => {
    expect(guessPalette({ ...base, speech: true, captions: true })).toBe("talking_head");
    expect(guessPalette({ ...base, speech: true, medianShot: 4 })).toBe("documentary");
    expect(guessPalette({ ...base, speech: true })).toBe("video_essay");
    expect(guessPalette({ ...base, scenes3d: 2, uiEvents: 5 })).toBe("product_3d");
    expect(guessPalette({ ...base, uiEvents: 5 })).toBe("saas_ui");
    expect(guessPalette({ ...base, tiles: true })).toBe("multiplicity");
    expect(guessPalette({ ...base, medianShot: 0.15 })).toBe("flash_montage");
    expect(guessPalette({ ...base, medianShot: 0.45 })).toBe("hype");
    expect(guessPalette({ ...base, medianShot: 0.45, music: false })).toBe("editorial");
  });

  it("takes its traits from the cue sheet", () => {
    const at = (t: number, kind: HitPoint["kind"], role: HitPoint["role"] = "transition"): HitPoint => ({ t, kind, role, weight: 0.5, x: 0, needsCue: true, speech: false, ids: [], label: "" });
    const traits = traitsOf([at(0, "cut"), at(0.5, "cut"), at(1.5, "transition"), at(2, "block", "ui"), at(3, "word", "micro")], { duration: 4, speech: false, tiles: false, matchCuts: false, music: true });
    expect(traits.medianShot).toBe(1);
    expect(traits.uiEvents).toBe(1);
    expect(traits.captions).toBe(true);
  });
});
