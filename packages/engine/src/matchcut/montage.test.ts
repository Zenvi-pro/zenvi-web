import { describe, expect, it } from "vitest";
import { planMontage, type MontageMusic } from "./montage.js";

/** 120 BPM for `seconds`, bars from 0, an off-beat hit every beat (a hat just before each beat). */
function music(seconds: number, bpm = 120): MontageMusic {
  const period = 60 / bpm;
  const beats = Array.from({ length: Math.floor(seconds / period) }, (_, i) => i * period);
  return {
    bpm,
    beats,
    downbeats: beats.filter((_, i) => i % 4 === 0),
    beatEnergy: beats.map(() => 1),
    onsets: beats.slice(1).map((t) => Math.round((t - 0.1) * 1000) / 1000),
    duration: seconds,
  };
}

describe("planMontage", () => {
  it("holds the first shot, cuts the body every 3-8 frames, and holds the last shot to the end", () => {
    const plan = planMontage({ clips: 7, fps: 30, music: music(30), seconds: 8 });
    expect(plan.duration).toBe(8);
    const [open, ...rest] = plan.shots;
    const close = rest.pop()!;
    expect(open!.role).toBe("open");
    expect(open!.end).toBe(2); // the first downbeat after 1 s
    expect(close.role).toBe("close");
    expect(close.end).toBe(8);
    expect(close.frames).toBeGreaterThanOrEqual(36);
    expect(close.onDownbeat).toBe(true);
    for (const shot of rest) {
      expect(shot.frames).toBeGreaterThanOrEqual(3);
      expect(shot.frames).toBeLessThanOrEqual(8);
    }
    // Back to back on the frame grid.
    plan.shots.forEach((shot, i) => {
      if (i > 0) expect(shot.start).toBe(plan.shots[i - 1]!.end);
      expect(Math.abs(shot.start * 30 - Math.round(shot.start * 30))).toBeLessThan(1e-9);
    });
    // Most body cuts land on a hit or the beat grid.
    const onEvents = rest.filter((s) => s.onOnset || s.onDownbeat || [0, 0.25, 0.5, 0.75].some((p) => Math.abs((((s.start / 0.5) % 1) + 1) % 1 - p) < 0.04));
    expect(onEvents.length / rest.length).toBeGreaterThan(0.7);
    // The chain speeds up.
    const half = Math.floor(rest.length / 2);
    const mean = (xs: typeof rest) => xs.reduce((a, s) => a + s.frames, 0) / xs.length;
    expect(mean(rest.slice(half))).toBeLessThan(mean(rest.slice(0, half)));
  });

  it("opens on the first clip, closes on the last and cycles the others", () => {
    const plan = planMontage({ clips: 4, fps: 30, music: music(30), seconds: 6 });
    expect(plan.shots[0]!.clip).toBe(0);
    expect(plan.shots[plan.shots.length - 1]!.clip).toBe(3);
    const body = plan.shots.slice(1, -1).map((s) => s.clip);
    expect(body.slice(0, 2)).toEqual([1, 2]);
    expect(body).not.toContain(3);
    body.forEach((c, i) => i > 0 && expect(c).not.toBe(body[i - 1]));
    // A clip that comes back counts its uses (a later moment of it).
    const second = plan.shots.find((s) => s.clip === 1 && s.use === 1);
    expect(second).toBeDefined();
  });

  it("cuts to its own tempo without music, and copes with one clip", () => {
    const plan = planMontage({ clips: 3, fps: 24, music: null });
    expect(plan.musicStart).toBeNull();
    expect(plan.duration).toBeGreaterThanOrEqual(6);
    expect(plan.shots.slice(1, -1).every((s) => s.frames >= 3 && s.frames <= 8)).toBe(true);
    const single = planMontage({ clips: 1, fps: 30, music: music(10), seconds: 4 });
    expect(single.shots.every((s) => s.clip === 0)).toBe(true);
    expect(single.shots[single.shots.length - 1]!.end).toBe(single.duration);
  });
});
