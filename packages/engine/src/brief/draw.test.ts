import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../history/document.js";
import { createProject } from "../model/defaults.js";
import { ensureBrief, matchStyle } from "./auto.js";
import { readBrief } from "./brief.js";
import { STYLE_FILES } from "../styles/library.gen.js";
import { CINETIC_TECHNIQUES } from "./cinetic-library.js";
import { DRAW_ORDER, drawSize, drawTechnique, drawTechniques, type DrawEntry } from "./draw.js";
import { HOUSE_STYLES, houseDraw, tasteProfile } from "./house.js";

const byId = new Map(CINETIC_TECHNIQUES.map((e) => [e.id, e]));

describe("the technique draw (cinetic pick.py)", () => {
  it("sizes a plan by length and energy, at least the format's minimum", () => {
    expect(drawSize("launch", 30, "calm")).toBe(9);
    expect(drawSize("launch", 30, "high")).toBe(12);
    expect(drawSize("sting", 6, "calm")).toBe(4);
    expect(drawSize("loop", 10, "calm")).toBe(4);
  });

  it("is seeded, fills the format's order of need and never repeats a pick", () => {
    const a = drawTechniques(CINETIC_TECHNIQUES, { format: "launch", energy: "calm", seconds: 30, seed: 41 });
    const b = drawTechniques(CINETIC_TECHNIQUES, { format: "launch", energy: "calm", seconds: 30, seed: 41 });
    expect(a).toEqual(b);
    expect(a.picks).toHaveLength(9);
    expect(new Set(a.picks.map((p) => p.id)).size).toBe(9);
    expect(a.picks[0]!.category).toBe("opening_hook");
    for (const p of a.picks) expect(byId.get(p.id)!.formats.some((f) => f === "launch" || f === "any")).toBe(true);
    expect(a.picks.filter((p) => p.role === "signature").length).toBeLessThanOrEqual(1);
  });

  it("never draws a high-energy entry for a calm film", () => {
    for (let seed = 1; seed < 40; seed += 1) {
      const d = drawTechniques(CINETIC_TECHNIQUES, { format: "launch", energy: "calm", seconds: 45, seed });
      expect(d.picks.every((p) => byId.get(p.id)!.energy !== "high")).toBe(true);
    }
  });

  it("skips what recent films drew while anything else fits", () => {
    const first = drawTechniques(CINETIC_TECHNIQUES, { format: "launch", energy: "calm", seconds: 30, seed: 7 });
    const next = drawTechniques(CINETIC_TECHNIQUES, { format: "launch", energy: "calm", seconds: 30, seed: 7, avoid: first.picks.map((p) => p.technique) });
    expect(next.picks).toHaveLength(9);
    expect(next.picks.some((p) => first.picks.some((q) => q.id === p.id))).toBe(false);
  });

  it("passes a slot on when its category has run out, and reuses recent picks before leaving a slot empty", () => {
    const tiny: DrawEntry[] = [
      { id: "a", category: "opening_hook", role: "workhorse", energy: "calm", formats: ["sting"], evidence: 1 },
      { id: "b", category: "logo_and_end_card", role: "workhorse", energy: "calm", formats: ["any"], evidence: 1 },
      { id: "c", category: "camera", role: "accent", energy: "any", formats: ["sting"], evidence: 0 },
      { id: "d", category: "camera", role: "accent", energy: "calm", formats: ["sting"], evidence: 0, bans: ["glass"] },
    ];
    const d = drawTechniques(tiny, { format: "sting", energy: "calm", seconds: 6, seed: 3, avoid: ["cin-a"] });
    expect(d.picks.map((p) => p.id).sort()).toEqual(["a", "b", "c", "d"]);
    expect(d.picks.find((p) => p.id === "d")!.ban_safe_variant).toBe(true);
    expect(drawTechniques(tiny, { format: "sting", energy: "calm", seconds: 6, seed: 3, houseBans: false }).picks.find((p) => p.id === "d")!.ban_safe_variant).toBe(false);
  });

  it("hands out technique files the styles library serves, and every house style is a style there", () => {
    const files = new Map(STYLE_FILES.map((f) => [f.id, f.kind]));
    for (const e of CINETIC_TECHNIQUES) expect(files.get(drawTechnique(e)), drawTechnique(e)).toBe("technique");
    for (const id of Object.keys(HOUSE_STYLES)) expect(files.get(id)).toBe("style");
  });

  it("covers every category the formats ask for", () => {
    const cats = new Set(CINETIC_TECHNIQUES.map((e) => e.category));
    for (const order of Object.values(DRAW_ORDER)) for (const c of order) expect(cats.has(c)).toBe(true);
    expect(CINETIC_TECHNIQUES).toHaveLength(273);
  });
});

describe("house styles", () => {
  it("draw only for a cinetic style; a vertical launch draws the vertical order; energy words raise a calm style", () => {
    expect(houseDraw({ style: "hype-reel", aspect: "16:9", seconds: 15, text: "" })).toBeNull();
    const v = houseDraw({ style: "cinetic-launch-film", aspect: "9:16", seconds: 20, text: "a launch film" })!;
    expect(v.format).toBe("vertical");
    expect(v.energy).toBe("calm");
    expect(houseDraw({ style: "cinetic-launch-film", aspect: "16:9", seconds: 20, text: "make it punchy" })!.energy).toBe("high");
  });

  it("are what a request naming cinetic routes to, by its format's word", () => {
    expect(matchStyle("a 25-second launch teaser in the cinetic style")).toBe("cinetic-launch-film");
    expect(matchStyle("a 6-second logo sting, cinetic")).toBe("cinetic-logo-sting");
    expect(matchStyle("a looping feature animation, cinetic style")).toBe("cinetic-feature-loop");
    expect(matchStyle("a 12-second vertical product video, cinetic")).toBe("cinetic-launch-film");
    expect(matchStyle("a movie teaser")).toBe("movie-game-trailer");
  });

  it("are never reached by a format's word alone: their bans hold only where the house was asked for", () => {
    expect(matchStyle("a seamless loop of my travel clips")).toBe("travel-cinematic-montage");
    expect(matchStyle("a tutorial walkthrough of the settings page")).toBe("tutorial");
    expect(matchStyle("an onboarding video for our app")).toBe("saas-ui-promo");
    const summaries = STYLE_FILES.filter((f) => f.kind === "style").map((f) => ({ id: f.id, summary: f.summary }));
    expect(matchStyle("a logo sting for my channel", summaries)).not.toMatch(/^cinetic-/);
    expect(matchStyle("a logo sting for my channel, cinetic", summaries)).toBe("cinetic-logo-sting");
  });

  it("hold a brief to the cinetic bans only without a brand of the person's", () => {
    expect(tasteProfile({ style: "cinetic-logo-sting" })).toBe("cinetic");
    expect(tasteProfile({ style: "cinetic-logo-sting", brand: "Our serif wordmark, orange #FF6A00" })).toBeNull();
    expect(tasteProfile({ style: "saas-app-launch" })).toBeNull();
  });

  it("the auto brief of a house style carries its draw, avoiding recent films", () => {
    const doc = new ProjectDocument(createProject());
    const saved = ensureBrief(doc, "a launch film for a CI cache", [], { style: "cinetic-launch-film", length_seconds: 30, avoid: [] })!;
    expect(saved.draw?.library).toBe("cinetic");
    expect(saved.draw?.picks.length).toBe(9);
    expect(readBrief(doc.project)?.draw).toEqual(saved.draw);
    const again = ensureBrief(doc, "a launch film for a CI cache", [], { style: "cinetic-launch-film", length_seconds: 30, avoid: saved.draw!.picks.map((p) => p.technique) })!;
    expect(again.draw!.picks.some((p) => saved.draw!.picks.some((q) => q.id === p.id))).toBe(false);
  });
});
