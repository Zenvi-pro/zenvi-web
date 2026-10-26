import { describe, expect, it } from "vitest";
import { MIN_TRANSIENT_GAP, musicClimax, planSoundDesign, type SoundDesignInput, type SoundMoment } from "./plan.js";
import { sfxRecipe } from "./recipes.js";

/** A 20 s edit cut every half second, every other cut on a downbeat-strength moment. */
function busyEdit(): SoundMoment[] {
  const moments: SoundMoment[] = [];
  for (let t = 0.5; t < 20; t += 0.5) moments.push({ kind: "cut", time: t, strength: Math.round(t * 2) % 4 === 0 ? 0.9 : 0.55, before: 0.5, after: 0.5 });
  moments.push({ kind: "transition", time: 6.25, strength: 0.6, duration: 0.5 });
  moments.push({ kind: "title", time: 1.1, strength: 0.45 });
  moments.push({ kind: "flash", time: 10, strength: 0.75 });
  return moments;
}

function input(over: Partial<SoundDesignInput> = {}): SoundDesignInput {
  return { moments: busyEdit(), duration: 20, climax: null, music: true, speech: [], intensity: "normal", seed: 1, ...over };
}

const transient = (cues: ReturnType<typeof planSoundDesign>) => [...new Set(cues.map((c) => c.at))].sort((a, b) => a - b);

describe("planSoundDesign", () => {
  it("is deterministic, and the seed changes the variation, not the moments", () => {
    const a = planSoundDesign(input());
    expect(planSoundDesign(input())).toEqual(a);
    const b = planSoundDesign(input({ seed: 2 }));
    expect(b.map((c) => c.params.seed)).not.toEqual(a.map((c) => c.params.seed));
  });

  it("caps density by intensity and never stacks transients closer than 80 ms", () => {
    const counts = (["subtle", "normal", "hype"] as const).map((intensity) => {
      const cues = planSoundDesign(input({ intensity }));
      const times = transient(cues);
      for (let i = 1; i < times.length; i += 1) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(MIN_TRANSIENT_GAP - 1e-9);
      return cues.length;
    });
    expect(counts[0]!).toBeLessThan(counts[1]!);
    expect(counts[1]!).toBeLessThan(counts[2]!);
    // Normal: tasteful, not one per cut (39 cuts here).
    expect(counts[1]!).toBeLessThan(25);
    expect(counts[0]!).toBeGreaterThan(0);
  });

  it("puts hits on strong cuts and flashes, spaced; whooshes elsewhere; nothing machine-guns", () => {
    const cues = planSoundDesign(input());
    const hits = cues.filter((c) => ["impact", "transition"].includes(sfxRecipe(c.recipe)!.family));
    expect(hits.length).toBeGreaterThan(2);
    for (let i = 1; i < hits.length; i += 1) expect(hits[i]!.at - hits[i - 1]!.at).toBeGreaterThanOrEqual(1.75 - 1e-9);
    expect(cues.find((c) => Math.abs(c.at - 10) < 1e-9)?.reason).toBe("flash frame");
    const whooshes = cues.filter((c) => sfxRecipe(c.recipe)!.family === "whoosh");
    expect(whooshes.length).toBeGreaterThan(3);
    // Alternating directions and a fresh seed each time.
    expect(new Set(whooshes.map((c) => Math.sign(c.params.pan ?? 0))).size).toBe(2);
    expect(new Set(cues.map((c) => c.params.seed)).size).toBe(cues.length);
    // The transition's whoosh is sized to the move.
    const transition = cues.find((c) => c.reason === "transition")!;
    expect(transition.params.duration).toBeCloseTo(0.7, 5);
  });

  it("builds a riser into the climax and lands an impact on it", () => {
    const cues = planSoundDesign(input({ climax: 12 }));
    const riser = cues.find((c) => sfxRecipe(c.recipe)!.family === "riser")!;
    expect(riser.at).toBe(12);
    expect(riser.params.duration).toBeCloseTo(2.4, 5);
    expect(cues.find((c) => c.recipe === "impact_boom")!.at).toBe(12);
    // The riser carries its stretch: no whooshes under it at normal intensity.
    expect(cues.filter((c) => c.at > 9.6 && c.at < 12 && sfxRecipe(c.recipe)!.family === "whoosh")).toEqual([]);
    const hype = planSoundDesign(input({ climax: 12, intensity: "hype" }));
    expect(hype.some((c) => c.recipe === "sub_drop" && c.at === 12)).toBe(true);
  });

  it("stages gain under the music, further under speech, and keeps clicks out of speech", () => {
    const cues = planSoundDesign(input());
    for (const cue of cues) {
      expect(cue.gainDb).toBeLessThanOrEqual(-7);
      expect(cue.gainDb).toBeGreaterThanOrEqual(-16);
    }
    const speech: [number, number][] = [[0, 20]];
    const talking = planSoundDesign(input({ speech }));
    expect(talking.some((c) => c.reason === "title entrance")).toBe(false);
    expect(talking.length).toBeLessThan(cues.length);
    for (const cue of talking) expect(cue.gainDb).toBeLessThanOrEqual(sfxRecipe(cue.recipe)!.mixDb - 6 + 1e-9);
  });
});

describe("musicClimax", () => {
  it("finds the downbeat where the loudness jumps, and nothing in flat music", () => {
    const beats = Array.from({ length: 40 }, (_, i) => ({ time: i * 0.5, energy: i < 20 ? 0.3 : 0.95 }));
    const downbeats = beats.filter((_, i) => i % 4 === 0).map((b) => b.time);
    expect(musicClimax(beats, downbeats, 20)).toBe(10);
    expect(musicClimax(beats.map((b) => ({ ...b, energy: 0.6 })), downbeats, 20)).toBeNull();
  });
});
