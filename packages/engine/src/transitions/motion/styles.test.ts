import { describe, expect, it } from "vitest";
import { MOTION_TRANSITION_STYLE_IDS, styleEvery, styleForBrief, styleStep } from "./styles.js";

const plan = (style: Parameters<typeof styleStep>[0], count: number) => Array.from({ length: count }, (_, i) => styleStep(style, i, count)?.preset ?? null);

describe("motion transition styles", () => {
  it("keep the original every-cut mixes", () => {
    expect(plan("hype", 4)).toEqual(["whip", "whip", "zoom_in", "zoom_out"]);
    expect(plan("cinematic", 3)).toEqual(["slide", "blur_dissolve", "zoom_through"]);
  });

  it("leave most cuts hard in spaced styles, never moving the cut before the accent", () => {
    expect(plan("brand", 9)).toEqual([null, null, "slide", null, null, "blur_dissolve", null, null, "zoom_through"]);
    expect(plan("sport", 8)).toEqual([null, "whip", null, "tilt", null, "zoom_in", null, "zoom_through"]);
    for (const style of MOTION_TRANSITION_STYLE_IDS) {
      const steps = plan(style, 12);
      const moves = steps.filter((s) => s !== null).length;
      expect(moves, style).toBeLessThanOrEqual(Math.ceil(12 / styleEvery(style)) + 1);
      // No style puts one preset on every cut.
      expect(new Set(steps).size, style).toBeGreaterThan(1);
    }
  });

  it("still moves a lone cut", () => {
    expect(plan("travel", 1)).toEqual(["zoom_through"]);
    expect(plan("brand", 2)).toEqual([null, "slide"]);
  });

  it("maps brief styles to mixes", () => {
    expect(styleForBrief("brand-story-corporate")).toBe("brand");
    expect(styleForBrief("flash-montage")).toBe("flash");
    expect(styleForBrief("flash-cut-match-cut-edit")).toBe("flash");
    expect(styleForBrief("match-cut-montage")).toBe("punch");
    expect(styleForBrief("hype-reel")).toBe("hype");
    expect(styleForBrief("wedding-event-film")).toBe("gentle");
    expect(styleForBrief("real-estate-tour")).toBe("travel");
    expect(styleForBrief("saas-ui-promo")).toBe("cinematic");
    expect(styleForBrief("kinetic-captions")).toBe("editorial");
    expect(styleForBrief(undefined)).toBe("cinematic");
  });
});
