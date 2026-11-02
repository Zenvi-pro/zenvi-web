import { describe, expect, it } from "vitest";
import { sceneEvents, sceneInfo, sceneSampleFrames } from "./scene-info.js";

describe("scene info", () => {
  it("checks the grid and fills in cues", () => {
    const r = sceneInfo({ fps: 60, duration: 120, draw: true, cues: { hit: 30, click: { at: 60, kind: "click", weight: 2, x: 0.7 }, run: { at: 10, kind: "type", until: 50, rate: 40 }, beat: { at: 90 } } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.info.cues.map((c) => c.name)).toEqual(["run", "hit", "click", "beat"]);
    expect(r.info.cues[2]).toEqual({ name: "click", frame: 60, kind: "click", weight: 1, x: 0.7, y: 0.5 });
    expect(r.info.cues[0]).toMatchObject({ until: 50, rate: 30 });
    // Only the cues with a kind make a sound.
    expect(sceneEvents(r.info)).toEqual([
      { t: 0.167, kind: "type", weight: 0.5, x: 0.5, y: 0.5, until: 0.833, rate: 30 },
      { t: 1, kind: "click", weight: 1, x: 0.7, y: 0.5 },
    ]);
  });

  it("refuses a scene without a usable grid", () => {
    expect(sceneInfo({ fps: 30, duration: 10.5, draw: true }).ok).toBe(false);
    expect(sceneInfo({ fps: 0, duration: 10, draw: true }).ok).toBe(false);
    expect(sceneInfo({ fps: 30, duration: 30 * 61, draw: true }).ok).toBe(false);
    expect(sceneInfo({ fps: 30, duration: 30, draw: false }).ok).toBe(false);
    const out = sceneInfo({ fps: 30, duration: 30, draw: true, cues: { late: 40 } });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.problems[0]!.message).toMatch(/outside the scene/);
  });

  it("warns on off-grid cues and unknown kinds", () => {
    const r = sceneInfo({ fps: 30, duration: 30, draw: true, cues: { a: 2.5, b: { at: 3, kind: "boom" } } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.problems.map((p) => p.code)).toEqual(["cues", "cues"]);
  });

  it("keeps motion blur sub-frames inside the shot", () => {
    expect(sceneSampleFrames(2, 1, [])).toEqual([0, 1]);
    const t = sceneSampleFrames(4, 4, [2]);
    // Frame 2 opens a shot: its early sub-frames stop at the cut instead of reaching back into frame 1.
    expect(t.slice(8, 12)).toEqual([2, 2, 2, 2.125]);
    // Frame 1 ends the first shot: its late sub-frames stay before the cut.
    expect(Math.max(...t.slice(4, 8))).toBeLessThan(2);
  });
});
