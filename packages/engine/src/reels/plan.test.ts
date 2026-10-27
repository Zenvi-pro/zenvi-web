import { describe, expect, it } from "vitest";
import { chooseMusicStart, cutBeats, dropBeat, freshFrom, MIN_SHOT_SECONDS, planReel, planReelGrid, REUSE_GAP_SECONDS, type MusicBeats, type ReelMedia } from "./plan.js";
import { REEL_STYLE_IDS, REEL_STYLES } from "./styles.js";

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
    // 15 s is not on a bar line at 120 BPM: the reel runs to the next one, 16 s, and says so.
    expect(plan.duration).toBe(16);
    expect(plan.lengthNote).toBe("16.00s, ends on a bar line at 120 BPM: the first one at or after the 15s asked for");
    expect(plan.downbeats.some((d) => Math.abs(d - plan.duration) < 1e-3)).toBe(true);
    expectContiguous(plan.shots, plan.duration);
    // Every cut on a beat, half-beat or (bursts) quarter-beat of the 120 BPM grid.
    for (const shot of plan.shots) expect(Math.abs(shot.start * 8 - Math.round(shot.start * 8))).toBeLessThan(1e-6);
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

  it("shows a moment of a clip not seen yet before it repeats one, wrapping past the end to the unseen start", () => {
    const plan = planReel({ style: REEL_STYLES.hype, media: "abcde".split("").map((id) => clip(id, 8)), music: music(), seconds: 15, frameRate: 30 });
    const byFile = new Map<string, [number, number][]>();
    for (const s of plan.shots) byFile.set(s.fileId, [...(byFile.get(s.fileId) ?? []), [s.sourceStart, s.sourceEnd]]);
    // Four body clips over ~55 shots: each comes back a dozen times.
    expect(plan.shots.length).toBeGreaterThan(40);
    for (const [, stretches] of byFile) {
      for (const [i, [a, b]] of stretches.entries()) for (const [c, d] of stretches.slice(i + 1)) expect(Math.min(b, d) - Math.max(a, c)).toBeLessThanOrEqual(1e-6);
    }
    expect(freshFrom({ start: 0, end: 4 }, 1, 3.5, [[1.2, 2.2], [2.5, 3.5]])).toBe(0);
    expect(freshFrom({ start: 0, end: 4 }, 1, 3.5, [[0, 1.2], [1.2, 2.2], [2.5, 3.5]])).toBeNull();
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

describe("reel styles", () => {
  it("use at most one look preset per family (a second colour preset would replace the first)", () => {
    for (const id of REEL_STYLE_IDS) {
      const families = REEL_STYLES[id].looks.map((look) => look.split(".")[0]);
      expect(new Set(families).size, id).toBe(families.length);
    }
  });
});

describe("planReelGrid length", () => {
  /** A steady track: `bpm`, a downbeat every 4 beats from 0, `seconds` long. */
  const steady = (bpm: number, seconds: number): MusicBeats => {
    const beats: number[] = [];
    for (let t = 0; t < seconds; t += 60 / bpm) beats.push(Math.round(t * 1000) / 1000);
    return { bpm, beats, downbeats: beats.filter((_, i) => i % 4 === 0), duration: seconds };
  };

  it("rounds 10 s at 140 BPM up to the next bar line (10.29 s, not 8.57 s) and says why", () => {
    // W25a E2E bug 4: duration_seconds 10 gave an 8.6 s reel with no word about it.
    const grid = planReelGrid({ music: steady(140, 60), seconds: 10, fallbackBpm: 120 });
    expect(grid.duration).toBeCloseTo(10.286, 2);
    expect(grid.lengthNote).toBe("10.29s, ends on a bar line at 140 BPM: the first one at or after the 10s asked for");
  });

  it("keeps a length that is already on a bar line", () => {
    const grid = planReelGrid({ music: null, seconds: 8, fallbackBpm: 120 });
    expect(grid.duration).toBe(8);
    expect(grid.lengthNote).toBe("8.00s, ends on a bar line at 120 BPM, as asked");
  });

  it("takes the nearest bar line when the music ends before the next one", () => {
    const grid = planReelGrid({ music: steady(120, 9.5), seconds: 9, fallbackBpm: 120 });
    expect(grid.duration).toBe(8);
    expect(grid.lengthNote).toMatch(/^8\.00s, ends on a bar line at 120 BPM: the (nearest one to|music runs out before) the 9s asked for$/);
  });
});

describe("planReel drop and reuse", () => {
  it("winds a hype reel up into a drop on the first bar line from two thirds in", () => {
    const plan = planReel({ style: REEL_STYLES.hype, media: "abcdefghijkl".split("").map((id) => clip(id)), music: music(), seconds: 15, frameRate: 30 });
    // 16 s at 120 BPM = 32 beats; two thirds in is beat 21.3, the next bar line beat 24 = 12 s.
    expect(dropBeat(REEL_STYLES.hype, 32)).toBe(24);
    expect(plan.drop).toBe(12);
    expect(plan.downbeats.some((d) => Math.abs(d - plan.drop!) < 1e-6)).toBe(true);
    const windups = plan.shots.filter((s) => s.windup);
    expect(windups).toHaveLength(1);
    // Two beats (1 s) that end on the drop.
    expect(windups[0]!.start).toBeCloseTo(11, 6);
    expect(windups[0]!.end).toBeCloseTo(12, 6);
    // The climax starts on the drop.
    expect(plan.shots.find((s) => s.climax)!.start).toBeCloseTo(12, 6);
    expectContiguous(plan.shots, plan.duration);
  });

  it("has no drop for a style without a wind-up, or a reel too short for one", () => {
    expect(planReel({ style: REEL_STYLES.cinematic, media: [clip("a"), clip("b"), clip("c")], music: music(), seconds: 20 }).drop).toBeNull();
    expect(dropBeat(REEL_STYLES.hype, 12)).toBeNull();
  });

  it("brings no clip back within 3 s when the bin has enough clips", () => {
    const plan = planReel({ style: REEL_STYLES.hype, media: "abcdefghijklmnop".split("").map((id) => clip(id)), music: music(), seconds: 15, frameRate: 30 });
    expect(plan.closeRepeats).toBe(0);
    const lastEnd = new Map<string, number>();
    for (const shot of plan.shots) {
      const seen = lastEnd.get(shot.fileId);
      if (seen !== undefined) expect(shot.start - seen).toBeGreaterThanOrEqual(REUSE_GAP_SECONDS - 1e-6);
      lastEnd.set(shot.fileId, shot.end);
    }
  });

  it("says how many clips the pace needs when the bin has too few", () => {
    const plan = planReel({ style: REEL_STYLES.hype, media: ["a", "b", "c", "d"].map((id) => clip(id)), music: music(), seconds: 15, frameRate: 30 });
    expect(plan.closeRepeats).toBeGreaterThan(0);
    expect(plan.clipsNeeded).toBeGreaterThan(4);
    // Still the least recently seen clip each time: never the same clip twice in a row.
    for (let i = 1; i < plan.shots.length; i += 1) expect(plan.shots[i]!.fileId).not.toBe(plan.shots[i - 1]!.fileId);
  });
});
