import { describe, expect, it } from "vitest";
import {
  INVERT_CONTRAST,
  MOTION_TRANSITION_IDS,
  coverScale,
  defaultFrames,
  easeIn,
  easeOut,
  listMotionTransitions,
  planMotionTransition,
  splitFrames,
} from "./presets.js";

const ASPECT = 16 / 9;

describe("motion transition presets", () => {
  it("lists every preset with a title, a description and TASTE.md timing", () => {
    const list = listMotionTransitions();
    expect(list.map((p) => p.id)).toEqual([...MOTION_TRANSITION_IDS]);
    const range: Record<string, [number, number]> = { whip: [6, 10], zoom_in: [6, 8], zoom_out: [6, 8], spin: [10, 14], glitch: [4, 6], flash_white: [2, 4], flash_black: [2, 4], flash_invert: [2, 4] };
    for (const p of list) {
      expect(p.title && p.description, p.id).toBeTruthy();
      const r = range[p.id];
      if (r) expect(p.frames30, p.id).toBeGreaterThanOrEqual(r[0]);
      if (r) expect(p.frames30, p.id).toBeLessThanOrEqual(r[1]);
    }
  });

  it("scales the default length with the frame rate", () => {
    expect(defaultFrames("whip", 30)).toBe(8);
    expect(defaultFrames("whip", 60)).toBe(16);
    expect(defaultFrames("whip", 24)).toBe(6);
    expect(defaultFrames("flash_white", 12)).toBe(2);
  });

  it("gives the incoming side the larger share", () => {
    expect(splitFrames(8)).toEqual({ out: 3, in: 5 });
    expect(splitFrames(2)).toEqual({ out: 1, in: 1 });
    expect(splitFrames(12)).toEqual({ out: 5, in: 7 });
  });

  it("eases like docs/TASTE.md (in accelerates, out decelerates)", () => {
    expect(easeIn(0.5)).toBeLessThan(0.25);
    expect(easeOut(0.5)).toBeGreaterThan(0.85);
    expect(easeIn(1)).toBe(1);
    expect(easeOut(0)).toBe(0);
  });

  it("plans deterministically", () => {
    for (const preset of MOTION_TRANSITION_IDS) {
      const a = planMotionTransition({ preset, fps: 30, aspect: ASPECT });
      const b = planMotionTransition({ preset, fps: 30, aspect: ASPECT });
      expect(a).toEqual(b);
      expect(a.out.frames.length + a.in.frames.length).toBe(a.frames);
    }
  });

  it("never scales below 1 and peaks at the cut", () => {
    for (const preset of MOTION_TRANSITION_IDS) {
      const plan = planMotionTransition({ preset, fps: 30, aspect: ASPECT, intensity: 2 });
      for (const f of [...plan.out.frames, ...plan.in.frames]) {
        expect(f.scale_x ?? 1, preset).toBeGreaterThanOrEqual(1);
        expect(f.scale_y ?? 1, preset).toBeGreaterThanOrEqual(1);
      }
    }
    const whip = planMotionTransition({ preset: "whip", fps: 30, aspect: ASPECT, direction: "right" });
    const shifts = whip.out.frames.map((f) => f["Shift.x"]!);
    expect(shifts[shifts.length - 1]).toBe(0.5);
    expect(shifts).toEqual([...shifts].sort((x, y) => x - y));
    // The incoming picture continues the motion: it starts left of rest and travels right to 0.
    const incoming = whip.in.frames.map((f) => f["Shift.x"]!);
    expect(incoming[0]).toBeLessThan(0);
    expect(incoming).toEqual([...incoming].sort((x, y) => x - y));
    const blurs = whip.out.frames.map((f) => f["Blur.horizontal_radius"]!);
    expect(Math.max(...blurs)).toBe(blurs[blurs.length - 1]);
    expect(whip.out.frames.every((f) => f["Blur.vertical_radius"] === undefined)).toBe(true);
  });

  it("covers the canvas while spinning", () => {
    expect(coverScale(0, ASPECT)).toBe(1);
    expect(coverScale(90, ASPECT)).toBeCloseTo(ASPECT, 6);
    const spin = planMotionTransition({ preset: "spin", fps: 30, aspect: ASPECT, direction: "ccw" });
    for (const f of [...spin.out.frames, ...spin.in.frames]) expect(f.scale_x!).toBeGreaterThanOrEqual(coverScale(f.rotation!, ASPECT));
    expect(spin.out.frames.at(-1)!.rotation).toBeLessThan(0);
  });

  it("inverts the frames on either side of the cut", () => {
    const plan = planMotionTransition({ preset: "flash_invert", fps: 30, aspect: ASPECT });
    expect(plan.out.frames.at(-1)!["Brightness.contrast"]).toBe(INVERT_CONTRAST);
    expect(plan.in.frames[0]!["Brightness.contrast"]).toBe(INVERT_CONTRAST);
    expect(plan.in.frames.at(-1)!["Brightness.contrast"]).toBe(0);
  });

  it("cues sound design on the cut", () => {
    const zoom = planMotionTransition({ preset: "zoom_in", fps: 30, aspect: ASPECT });
    expect(zoom.sfx).toEqual([
      { kind: "whoosh", offset: -3, frames: 7 },
      { kind: "hit", offset: 0, frames: 3 },
    ]);
    expect(planMotionTransition({ preset: "glitch", fps: 30, aspect: ASPECT }).sfx[0]!.kind).toBe("glitch");
  });
});
