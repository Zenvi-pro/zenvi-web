import { describe, expect, it } from "vitest";
import { chooseReelLook, daylightShare, hasNightWords, lookTarget, orderByFit, REEL_LOOKS } from "./grade.js";

const profile = (avg_luma: number, warm_cool = 0) => ({ present: true, avg_luma, warm_cool, green_magenta: 0, contrast_span: 0.45 });

describe("reel looks", () => {
  it("sets the reel at night from the titles' words, else from how dark the footage is", () => {
    expect(hasNightWords(["No brakes", "After dark"])).toBe(true);
    expect(hasNightWords(["NIGHT RUN"])).toBe(true);
    expect(hasNightWords(["Summer drop", undefined])).toBe(false);
    expect(chooseReelLook(["night run"], [profile(0.6)])).toMatchObject({ look: { id: "night" }, fromWords: true });
    expect(chooseReelLook(["Launch"], [profile(0.1), profile(0.15), profile(0.5)])).toMatchObject({ look: { id: "night" }, fromWords: false });
    expect(chooseReelLook(["Launch"], [profile(0.45), profile(0.5)]).look.id).toBe("teal_orange");
    expect(chooseReelLook([], []).look.id).toBe("teal_orange");
  });

  it("aims a night look darker and cooler than the neutral band", () => {
    const clips = [profile(0.5, 0.05), profile(0.55, 0.06), profile(0.2, 0)];
    const night = lookTarget(REEL_LOOKS.night, clips);
    const day = lookTarget(REEL_LOOKS.teal_orange, clips);
    expect(night.avg_luma).toBe(0.34);
    expect(Number(night.warm_cool)).toBeLessThanOrEqual(0);
    expect(day.avg_luma).toBe(0.5);
  });

  it("orders the bin by fit without dropping a clip: the best fit closes, the next opens", () => {
    const profiles = new Map([
      ["day", profile(0.6, 0.06)],
      ["dusk", profile(0.36, 0)],
      ["night", profile(0.3, -0.02)],
      ["noon", profile(0.7, 0.06)],
    ]);
    const target = lookTarget(REEL_LOOKS.night, [...profiles.values()]);
    const order = orderByFit(["day", "dusk", "noon", "night", "unmeasured"], profiles, target);
    expect(order).toHaveLength(5);
    expect(order[0]).toBe("night");
    expect(order[order.length - 1]).toBe("dusk");
    expect(order.indexOf("noon")).toBeGreaterThan(order.indexOf("day"));
    expect(order.indexOf("unmeasured")).toBe(3);
  });

  it("measures how much of the reel is daylight footage by screen time", () => {
    const profiles = new Map([
      ["day", profile(0.6)],
      ["night", profile(0.15)],
    ]);
    const shots = [
      { fileId: "day", start: 0, end: 3 },
      { fileId: "night", start: 3, end: 4 },
    ];
    expect(daylightShare(shots, profiles)).toBeCloseTo(0.75, 6);
    expect(daylightShare([], profiles)).toBe(0);
  });
});
