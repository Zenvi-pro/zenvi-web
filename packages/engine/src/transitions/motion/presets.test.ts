import { describe, expect, it } from "vitest";
import {
  INVERT_CONTRAST,
  MOTION_TRANSITION_IDS,
  rotationCoverScale,
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

  it("splits moves evenly (mirrored) and gives flashes' incoming side the larger share", () => {
    expect(splitFrames(8)).toEqual({ out: 4, in: 4 });
    expect(splitFrames(2)).toEqual({ out: 1, in: 1 });
    expect(splitFrames(12)).toEqual({ out: 6, in: 6 });
    expect(splitFrames(5, false)).toEqual({ out: 2, in: 3 });
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

  // The vector law (HeyGen HyperFrames motion-doctrine, Apache-2.0): same axis, same direction, matched
  // speed, mid-motion on both sides of the cut; on Z the scale never changes sign across it.
  it("obeys the vector law on every move", () => {
    const moves: [Parameters<typeof planMotionTransition>[0]["preset"], string, string][] = [
      ["whip", "left", "Shift.x"],
      ["whip", "right", "Shift.x"],
      ["whip", "up", "Shift.y"],
      ["whip", "down", "Shift.y"],
      ["slide", "left", "Shift.x"],
      ["tilt", "up", "Shift.y"],
      ["tilt", "down", "Shift.y"],
      ["squash", "left", "Shift.x"],
      ["spin", "cw", "rotation"],
      ["spin", "ccw", "rotation"],
    ];
    for (const [preset, direction, ch] of moves) {
      for (const frames of [6, 8, 12, 16]) {
        const plan = planMotionTransition({ preset, fps: 30, aspect: ASPECT, frames, direction: direction as never });
        const key = ch as keyof (typeof plan.out.frames)[number];
        const a = plan.out.frames.map((f) => f[key]!);
        const b = plan.in.frames.map((f) => f[key]!);
        // Same axis: the other axis never moves.
        const other = ch === "Shift.x" ? "Shift.y" : ch === "Shift.y" ? "Shift.x" : undefined;
        if (other) for (const f of [...plan.out.frames, ...plan.in.frames]) expect(f[other as keyof typeof f] ?? 0).toBe(0);
        const exit = a.at(-1)! - (a.at(-2) ?? 0);
        // The incoming shot starts its path where the outgoing one's mirror ends: -end (Shift wraps; spin turns on).
        const entry = b[0]! - -a.at(-1)!;
        const label = `${preset} ${direction} ${frames}`;
        expect(Math.sign(entry), label).toBe(Math.sign(exit));
        expect(exit, label).not.toBe(0);
        expect(Math.abs(entry), label).toBeCloseTo(Math.abs(exit), 5);
        // Mid-flight: at least half way along its path on its first frame, at rest on its last.
        expect(Math.abs(b[0]!), label).toBeLessThanOrEqual(0.5 * Math.abs(a.at(-1)!));
        expect(b.at(-1), label).toBe(0);
        // Motion blur follows speed: largest on the frames either side of the cut, equal there.
        const blurKey = (ch === "Shift.y" ? "Blur.vertical_radius" : "Blur.horizontal_radius") as keyof (typeof plan.out.frames)[number];
        const blurA = plan.out.frames.map((f) => f[blurKey]!);
        const blurB = plan.in.frames.map((f) => f[blurKey]!);
        expect(blurA.at(-1), label).toBe(Math.max(...blurA));
        expect(blurB[0], label).toBe(Math.max(...blurB));
        expect(blurB[0], label).toBeCloseTo(blurA.at(-1)!, 5);
      }
    }
  });

  it("never answers a push with a pull (or a pull with a push) on zoom seams", () => {
    for (const preset of ["zoom_in", "zoom_out", "zoom_through", "blur_dissolve"] as const) {
      const plan = planMotionTransition({ preset, fps: 30, aspect: ASPECT });
      const a = plan.out.frames.map((f) => f.scale_x ?? 1);
      const b = plan.in.frames.map((f) => f.scale_x ?? 1);
      const exit = a.at(-1)! - a.at(-2)!;
      const entry = b[1]! - b[0]!;
      expect(exit * entry, preset).toBeGreaterThanOrEqual(0);
      expect(Math.abs(exit) + Math.abs(entry), preset).toBeGreaterThan(0);
      expect(b.at(-1), preset).toBe(1);
    }
  });

  it("covers the canvas while spinning", () => {
    expect(rotationCoverScale(0, ASPECT)).toBe(1);
    expect(rotationCoverScale(90, ASPECT)).toBeCloseTo(ASPECT, 6);
    const spin = planMotionTransition({ preset: "spin", fps: 30, aspect: ASPECT, direction: "ccw" });
    for (const f of [...spin.out.frames, ...spin.in.frames]) expect(f.scale_x!).toBeGreaterThanOrEqual(rotationCoverScale(f.rotation!, ASPECT));
    expect(spin.out.frames.at(-1)!.rotation).toBeLessThan(0);
  });

  it("tilts on the vertical axis with a roll that keeps one sign of change and covers the canvas", () => {
    const tilt = planMotionTransition({ preset: "tilt", fps: 30, aspect: ASPECT, direction: "left" });
    expect(tilt.direction).toBe("up");
    // Like a spin, each side turns the same way (the cut is where the next shot picks the roll up mid-flight).
    for (const side of [tilt.out.frames, tilt.in.frames]) {
      const rolls = side.map((f) => f.rotation!);
      for (let i = 1; i < rolls.length; i += 1) expect(rolls[i]! - rolls[i - 1]!).toBeGreaterThanOrEqual(-1e-9);
    }
    expect(tilt.in.frames[0]!.rotation).toBeLessThan(0);
    expect(tilt.in.frames.at(-1)!.rotation).toBe(0);
    for (const f of [...tilt.out.frames, ...tilt.in.frames]) expect(f.scale_x!).toBeGreaterThanOrEqual(rotationCoverScale(f.rotation!, ASPECT));
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
      { kind: "whoosh", offset: -4, frames: 8 },
      { kind: "hit", offset: 0, frames: 3 },
    ]);
    expect(planMotionTransition({ preset: "glitch", fps: 30, aspect: ASPECT }).sfx[0]!.kind).toBe("glitch");
  });
});
