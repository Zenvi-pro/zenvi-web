import { describe, expect, it } from "vitest";
import { allocateBars, MOTION_STYLE_IDS, MOTION_STYLES, storyboard, tiledHook, type SceneDraft } from "./styles.js";
import { MOTION_TEMPLATE_IDS } from "./template.js";
import type { MotionMedia } from "./types.js";

const MEDIA: MotionMedia[] = ["POUR", "PAGES", "NOTES", "PRESS"].map((id, i) => ({ fileId: id, kind: i === 3 ? "image" : "video", width: 1920, height: 1080, duration: i === 3 ? 0 : 12 }));
const draft = (name: string, min: number, pref: number, optional = false): SceneDraft => ({ name, min, pref, optional, templates: [] });

describe("allocateBars", () => {
  it("keeps preferred lengths when they fit and lets the closing scene hold the rest", () => {
    const out = allocateBars([draft("a", 1, 2), draft("b", 1, 2), draft("end", 1, 2)], 8);
    expect(out.map((x) => x.bars)).toEqual([2, 2, 4]);
  });

  it("shrinks the roomiest scene first, then drops optional scenes, then middle ones", () => {
    expect(allocateBars([draft("a", 1, 3), draft("b", 1, 2), draft("end", 1, 2)], 5).map((x) => x.bars)).toEqual([2, 1, 2]);
    expect(allocateBars([draft("a", 2, 2), draft("opt", 2, 2, true), draft("end", 2, 2)], 4).map((x) => x.draft.name)).toEqual(["a", "end"]);
    const tight = allocateBars([draft("a", 1, 1), draft("b", 1, 1), draft("c", 1, 1), draft("end", 1, 1)], 2);
    expect(tight.map((x) => x.draft.name)).toEqual(["a", "end"]);
  });
});

describe("tiledHook", () => {
  it("swaps an inner O of the longest word that has one for an image tile", () => {
    expect(tiledHook("LIVING FORM")).toBe("LIVING F*RM");
    expect(tiledHook("Slow morning")).toBe("Slow m*rning");
    expect(tiledHook("NO TILE HERE")).toBe("NO TILE HERE");
    expect(tiledHook("KEEP * MINE")).toBe("KEEP * MINE");
  });
});

describe("storyboard", () => {
  it.each(MOTION_STYLE_IDS)("%s fills the bars exactly with scenes of known templates", (style) => {
    for (const bars of [3, 6, 8, 12]) {
      const scenes = storyboard({ style, bars, media: MEDIA, hook: "Living form", endCard: "Zenvi", labels: ["Slow pour", "Ten pages", "Notes"], words: ["Glass carafe: Borosilicate", "Steel filter: Mesh", "Begin"] });
      expect(scenes.reduce((sum, s) => sum + s.bars, 0)).toBe(bars);
      scenes.forEach((s, i) => expect(s.bar).toBe(i === 0 ? 0 : scenes[i - 1]!.bar + scenes[i - 1]!.bars));
      for (const scene of scenes) for (const t of scene.templates) expect(MOTION_TEMPLATE_IDS).toContain(t.template);
      // Every reel closes on its end card.
      expect(scenes[scenes.length - 1]!.templates.some((t) => t.template === "end_card")).toBe(true);
    }
  });

  it("tells each style's story: search, cards, words, logo for a UI promo", () => {
    const scenes = storyboard({ style: "ui_promo", bars: 8, media: MEDIA.slice(0, 3), hook: "Plan a slower morning", endCard: "Zenvi", labels: ["Slow pour"], words: ["Plan", "Begin"] });
    expect(scenes.map((s) => s.name)).toEqual(["search", "cards-1", "words", "end"]);
    expect(scenes[0]!.templates[1]!.content).toMatchObject({ text: "Plan a slower morning", tag: "Zenvi", labels: ["Slow pour"] });
    // Without words there is no word list.
    expect(storyboard({ style: "ui_promo", bars: 8, media: MEDIA.slice(0, 3) }).map((s) => s.name)).toEqual(["search", "cards-1", "end"]);
  });

  it("makes one step per clip in a tutorial, captions from labels and label boxes from words", () => {
    const scenes = storyboard({ style: "tutorial", bars: 9, media: MEDIA.slice(0, 3), hook: "Film better reels", labels: ["Mount your phone"], words: ["Eye level"] });
    expect(scenes.map((s) => s.name)).toEqual(["hook", "step-1", "step-2", "step-3", "save"]);
    expect(scenes[1]!.templates[1]!.content).toMatchObject({ step: 1, text: "Mount your phone", tag: "Eye level", subtitle: "Film better reels" });
    expect(scenes[2]!.templates[1]!.content).toMatchObject({ step: 2, text: "Step 2" });
  });

  it("splits product features 'Name: value' across the products", () => {
    const scenes = storyboard({ style: "product_callout", bars: 10, media: MEDIA.slice(0, 2), hook: "Northwind Press", words: ["Glass carafe: Borosilicate", "Filter: Mesh", "Capacity: 1 litre", "Lid: Locks heat in"] });
    const callouts = scenes.flatMap((s) => s.templates).filter((t) => t.template === "callout");
    expect(callouts.map((c) => c.content.labels)).toEqual([["Glass carafe", "Filter"], ["Capacity", "Lid"]]);
    expect(callouts[0]!.content.values).toEqual(["Borosilicate", "Mesh"]);
  });

  it("describes every style for the tools", () => {
    for (const id of MOTION_STYLE_IDS) {
      expect(MOTION_STYLES[id].summary.length).toBeGreaterThan(60);
      expect(MOTION_STYLES[id].defaultBpm).toBeGreaterThan(60);
    }
  });
});
