import { describe, expect, it } from "vitest";
import { chooseMusicStart, cutBeats, MIN_SHOT_SECONDS, planReel, type MusicBeats, type ReelMedia } from "./plan.js";
import { REEL_STYLES } from "./styles.js";

/** 120 BPM from 1 s for 60 s; quiet for the first 8 bars, loud after. */
function music(): MusicBeats {
  const beats: number[] = [];
  for (let t = 1; t < 61; t += 0.5) beats.push(t);
  return {
    bpm: 120,
    beats,
    downbeats: beats.filter((_, i) => i % 4 === 0),
    beatEnergy: beats.map((t) => (t < 17 ? 0.2 : 0.9)),
    duration: 61.5,
  };
}

const clip = (id: string, seconds = 10): ReelMedia => ({ fileId: id, kind: "video", start: 0, end: seconds });

function expectContiguous(shots: { start: number; end: number }[], duration: number): void {
  expect(shots[0]!.start).toBe(0);
  for (let i = 1; i < shots.length; i += 1) expect(shots[i]!.start).toBeCloseTo(shots[i - 1]!.end, 6);
  expect(shots[shots.length - 1]!.end).toBeCloseTo(duration, 6);
}

describe("chooseMusicStart", () => {
  it("skips a quiet intro and starts on a downbeat of the loud part", () => {
    const start = chooseMusicStart(music(), 15);
    expect(start).toBe(17);
  });

  it("keeps the first downbeat when the track is too short to choose", () => {
    const short = { ...music(), duration: 16 };
    expect(chooseMusicStart(short, 15)).toBe(1);
  });
});

describe("cutBeats", () => {
  it("holds the first and last shots and follows the pattern between", () => {
    const cuts = cutBeats(REEL_STYLES.cinematic, 32);
    expect(cuts.slice(0, 3)).toEqual([0, 4, 6]);
    expect(cuts[cuts.length - 1]).toBe(32);
    expect(32 - cuts[cuts.length - 2]!).toBeGreaterThanOrEqual(REEL_STYLES.cinematic.lastBeats);
  });
});

describe("planReel", () => {
  it("cuts a hype reel on the beat grid, ending on a downbeat, with faster cuts in the climax", () => {
    const plan = planReel({ style: REEL_STYLES.hype, media: ["a", "b", "c", "d", "payoff"].map((id) => clip(id)), music: music(), seconds: 15 });
    expect(plan.musicStart).toBe(17);
    expect(plan.duration).toBeLessThanOrEqual(15);
    expect(plan.downbeats.some((d) => Math.abs(d - plan.duration) < 1e-3)).toBe(true);
    expectContiguous(plan.shots, plan.duration);
    // Every cut on a beat or half-beat of the 120 BPM grid (0.25 s steps).
    for (const shot of plan.shots) expect(Math.abs(shot.start * 4 - Math.round(shot.start * 4))).toBeLessThan(1e-6);
    expect(plan.shots[0]!.end).toBeCloseTo(1, 6);
    const body = plan.shots.filter((s) => !s.climax).slice(1, -1);
    const climax = plan.shots.filter((s) => s.climax).slice(0, -1);
    const avg = (list: typeof body) => list.reduce((s, x) => s + x.end - x.start, 0) / list.length;
    expect(avg(climax)).toBeLessThan(avg(body));
    // The payoff closes the reel; flashes can find the downbeats.
    expect(plan.shots[plan.shots.length - 1]!.fileId).toBe("payoff");
    expect(plan.shots.filter((s) => s.onDownbeat).length).toBeGreaterThan(2);
  });

  it("shows a different moment each time a clip comes back", () => {
    const plan = planReel({ style: REEL_STYLES.match_cut, media: [clip("only", 30)], music: music(), seconds: 12 });
    const windows = plan.shots.map((s) => s.sourceStart);
    expect(new Set(windows).size).toBe(windows.length);
    for (const shot of plan.shots) expect(shot.sourceEnd - shot.sourceStart).toBeCloseTo(shot.end - shot.start, 6);
  });

  it("splits a shot on the beat, or slows a clip, instead of leaving a gap when clips are short", () => {
    const plan = planReel({ style: REEL_STYLES.cinematic, media: [clip("tiny", 0.6), clip("short", 0.9)], music: music(), seconds: 12 });
    expectContiguous(plan.shots, plan.duration);
    for (const shot of plan.shots) {
      expect(shot.end - shot.start).toBeGreaterThanOrEqual(MIN_SHOT_SECONDS - 1e-6);
      const played = (shot.sourceEnd - shot.sourceStart) / shot.speed;
      expect(played).toBeGreaterThanOrEqual(shot.end - shot.start - 1e-3);
    }
  });

  it("cuts to the style's own tempo without music, and keeps stills whole", () => {
    const plan = planReel({ style: REEL_STYLES.minimal, media: [{ fileId: "photo", kind: "image", start: 0, end: 0 }, clip("v")], music: null, seconds: 20 });
    expect(plan.musicStart).toBeNull();
    expect(plan.bpm).toBe(REEL_STYLES.minimal.defaultBpm);
    expectContiguous(plan.shots, plan.duration);
    expect(plan.shots[0]!.end - plan.shots[0]!.start).toBeCloseTo((60 / 80) * 4, 3);
  });

  it("puts every cut on the frame grid, so shots meet without a one-frame gap", () => {
    const fps = 30;
    const plan = planReel({ style: REEL_STYLES.hype, media: ["a", "b", "c"].map((id) => clip(id)), music: { ...music(), bpm: 140, beats: music().beats.map((t) => t * (120 / 140)), downbeats: music().downbeats.map((t) => t * (120 / 140)) }, seconds: 14, frameRate: fps });
    for (const shot of plan.shots) {
      expect(Math.abs(shot.start * fps - Math.round(shot.start * fps))).toBeLessThan(1e-9);
      expect(Math.abs(shot.end * fps - Math.round(shot.end * fps))).toBeLessThan(1e-9);
    }
    for (let i = 1; i < plan.shots.length; i += 1) expect(plan.shots[i]!.start).toBe(plan.shots[i - 1]!.end);
    // Source windows are whole frames, exactly as long as their shots (a rounded in and out point lost one).
    for (const shot of plan.shots.filter((s) => s.speed === 1)) {
      // Times are reported to the millisecond: well inside the half frame that decides the rounding.
      expect(Math.abs(shot.sourceStart * fps - Math.round(shot.sourceStart * fps))).toBeLessThan(0.05);
      expect(Math.round((shot.sourceEnd - shot.sourceStart) * fps)).toBe(Math.round((shot.end - shot.start) * fps));
    }
  });

  it("refuses an empty media list", () => {
    expect(() => planReel({ style: REEL_STYLES.hype, media: [], music: null })).toThrow(/at least one/);
  });
});
