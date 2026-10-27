import { describe, expect, it } from "vitest";
import { fitMontageFrames, gridRecutPresets, planMontageTransitions, type MontageCut } from "./montage.js";

/** Cuts every third of a beat at 120 BPM and 30 fps (shots of 5 frames), downbeats every 2 s flashed. */
function cuts(count: number, frames = 5): MontageCut[] {
  return Array.from({ length: count }, (_, i) => {
    const time = ((i + 1) * frames) / 30;
    const beat = Math.abs(time * 2 - Math.round(time * 2)) < 1e-6;
    const downbeat = Math.abs(time / 2 - Math.round(time / 2)) < 1e-6;
    return { time, onDownbeat: downbeat, onBeat: beat, flashed: downbeat, outFrames: frames, inFrames: frames };
  });
}

describe("planMontageTransitions", () => {
  it("accents one beat a bar between the flashed downbeats, repeating the rule's presets, and lands on the last cut", () => {
    const all = cuts(45);
    const planned = planMontageTransitions("punch", all, 0.5, 30);
    const times = planned.map((t) => Math.round(all[t.cut]!.time * 100) / 100);
    // Two beats clear of every downbeat (2, 4, 6 s) and of the landing (7.5 s): one beat a bar.
    expect(times).toEqual([0.5, 3, 5, 7.5]);
    expect(planned.map((t) => t.preset)).toEqual(["zoom_in", "glitch", "zoom_in", "zoom_through"]);
    for (const t of planned) expect(all[t.cut]!.flashed && t.cut !== all.length - 1).toBe(false);
  });

  it("shortens a preset so both shots keep a rest frame, and skips shots too short for any", () => {
    expect(fitMontageFrames("whip", 3, 6, 30)).toBe(4);
    expect(fitMontageFrames("whip", 20, 20, 30)).toBe(8);
    expect(fitMontageFrames("glitch", 1, 6, 30)).toBeNull();
    expect(planMontageTransitions("flash", cuts(10, 1), 0.5, 30)).toEqual([]);
  });

  it("keeps one direction's preset per grid re-cut, alternating only for flash", () => {
    expect(gridRecutPresets("whip", 3)).toEqual(["whip", "whip", "whip"]);
    expect(gridRecutPresets("flash", 3)).toEqual(["flash_invert", "glitch", "flash_invert"]);
  });
});
