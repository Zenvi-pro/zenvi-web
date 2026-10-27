import { describe, expect, it } from "vitest";
import { planAccents } from "./accents.js";
import { planReel, type MusicBeats, type ReelMedia } from "./plan.js";
import { REEL_STYLES } from "./styles.js";

/** 120 BPM from 0 for 60 s, a downbeat every 2 s. */
function music(): MusicBeats {
  const beats = Array.from({ length: 120 }, (_, i) => i * 0.5);
  return { bpm: 120, beats, downbeats: beats.filter((_, i) => i % 4 === 0), duration: 60 };
}

const clips = (n: number): ReelMedia[] => Array.from({ length: n }, (_, i) => ({ fileId: `c${i}`, kind: "video", start: 0, end: 12 }));

describe("planAccents", () => {
  const plan = planReel({ style: REEL_STYLES.hype, media: clips(14), music: music(), seconds: 24, frameRate: 30 });
  const accents = planAccents(REEL_STYLES.hype, plan, 30);
  const at = (shot: number) => plan.shots[shot]!.start;
  const byPreset = (preset: string) => accents.transitions.filter((t) => t.preset === preset).map((t) => at(t.shot));

  it("flashes white only where a section starts: the body, the drop and the payoff", () => {
    expect(plan.drop).toBe(16);
    expect(accents.flashes.map(at)).toEqual([2, 16, plan.shots[plan.shots.length - 1]!.start]);
  });

  it("glitches the drop, alternates negative and glitch hits in the climax, and lands with one pull-back", () => {
    expect(byPreset("glitch")[0]).toBe(16);
    const climax = accents.transitions.filter((t) => at(t.shot) > 16 && t.shot < plan.shots.length - 1).map((t) => t.preset);
    expect(climax).toEqual(["flash_invert", "glitch"]);
    expect(byPreset("zoom_out")).toEqual([plan.shots[plan.shots.length - 1]!.start]);
    expect(accents.transitions[accents.transitions.length - 1]!.preset).toBe("zoom_out");
  });

  it("whips on every other bar line of the body, never on two cuts in a row", () => {
    const whips = byPreset("whip");
    expect(whips).toEqual([4, 8, 12]);
    const shots = accents.transitions.map((t) => t.shot);
    for (let i = 1; i < shots.length; i += 1) expect(shots[i]! - shots[i - 1]!).toBeGreaterThan(1);
  });

  it("ramps the wind-up shot into the drop", () => {
    expect(accents.ramp).not.toBeNull();
    expect(plan.shots[accents.ramp!]!.windup).toBe(true);
    expect(plan.shots[accents.ramp!]!.end).toBe(16);
  });

  it("shortens a transition to leave both shots a frame at rest", () => {
    for (const t of accents.transitions) {
      const frames = (i: number) => Math.round((plan.shots[i]!.end - plan.shots[i]!.start) * 30);
      expect(t.frames).toBeLessThanOrEqual(2 * (Math.min(frames(t.shot - 1), frames(t.shot)) - 1));
      expect(t.frames).toBeGreaterThanOrEqual(2);
    }
  });

  it("gives a style without accents only its flashes", () => {
    const calm = planReel({ style: REEL_STYLES.cinematic, media: clips(6), music: music(), seconds: 20, frameRate: 30 });
    expect(planAccents(REEL_STYLES.cinematic, calm, 30)).toEqual({ flashes: [], transitions: [], ramp: null });
  });
});
