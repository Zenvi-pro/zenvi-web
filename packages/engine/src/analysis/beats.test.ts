import { describe, expect, it } from "vitest";
import { BEAT_SAMPLE_RATE, detectBeats } from "./beats.js";

const SR = BEAT_SAMPLE_RATE;

/** Deterministic noise for the snare and hats. */
function noise(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 1073741824 - 1;
  };
}

/**
 * A drum-machine groove: a low kick on every beat (heavier on the first of
 * each bar), a noise snare on 2 and 4, closed hats on every eighth, over a
 * quiet pad.
 */
function track(bpm: number, seconds: number, leadIn = 0, perBar = 4): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  const beat = 60 / bpm;
  const rand = noise(7);
  for (let i = 0; i < out.length; i += 1) out[i] = 0.02 * Math.sin((2 * Math.PI * 220 * i) / SR);
  const add = (at: number, gain: number, decay: number, wave: (k: number) => number) => {
    const start = Math.round(at * SR);
    for (let k = 0; k < SR * 0.3 && start + k < out.length; k += 1) out[start + k] = out[start + k]! + gain * Math.exp(-k / (decay * SR)) * wave(k);
  };
  const kick = (k: number) => Math.sin((2 * Math.PI * (50 + 80 * Math.exp(-k / (0.02 * SR))) * k) / SR);
  for (let n = 0; leadIn + n * beat < seconds; n += 1) {
    const t = leadIn + n * beat;
    add(t, n % perBar === 0 ? 0.9 : 0.6, 0.08, kick);
    if (n % 2 === 1 && perBar === 4) add(t, 0.35, 0.05, () => rand());
    add(t, 0.08, 0.008, () => rand());
    add(t + beat / 2, 0.12, 0.01, () => rand());
  }
  if (leadIn > 0) out.fill(0, 0, Math.round(leadIn * SR) - 1);
  return out;
}

/** A bare click on every beat: no snare, hats or pad, so nothing says which octave the tempo is in. */
function clicks(bpm: number, seconds: number, offset = 0): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let t = offset; t < seconds; t += 60 / bpm) {
    const start = Math.round(t * SR);
    for (let k = 0; k < 0.02 * SR && start + k < out.length; k += 1) out[start + k] = Math.exp(-k / (0.004 * SR)) * Math.sin((2 * Math.PI * 1500 * k) / SR);
  }
  return out;
}

/** The share of `beats` within `tolerance` seconds of a multiple of `period` from `offset`. */
function onGrid(beats: number[], period: number, offset: number, tolerance = 0.03): number {
  const near = beats.filter((t) => Math.abs(t - offset - Math.round((t - offset) / period) * period) <= tolerance);
  return near.length / beats.length;
}

describe("detectBeats", () => {
  it("finds the tempo, a regular grid on the kicks and the bar's first beats", () => {
    const result = detectBeats(track(120, 12), SR);
    expect(result.bpm).toBeGreaterThan(118.5);
    expect(result.bpm).toBeLessThan(121.5);
    const times = result.beats.map((b) => b.timeSec);
    expect(times.length).toBeGreaterThanOrEqual(20);
    // Every beat sits on a kick (multiples of 0.5 s), within 30 ms.
    for (const t of times) expect(Math.abs(t - Math.round(t * 2) / 2)).toBeLessThan(0.03);
    // Downbeats are the heavy kicks: every 2 s.
    for (const d of result.downbeats) expect(Math.abs(d.timeSec / 2 - Math.round(d.timeSec / 2))).toBeLessThan(0.02);
    expect(result.beatEnergy).toHaveLength(times.length);
    expect(result.onsets.length).toBeGreaterThan(10);
  });

  it("times beats on the kicks, not a quarter window early", () => {
    // Kicks at 0.37 s + n/2 s, off the frame grid.
    const times = detectBeats(track(120, 20, 0.37), SR).beats.map((b) => b.timeSec);
    const offsets = times.map((t) => t - (0.37 + Math.round((t - 0.37) * 2) / 2));
    const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
    expect(Math.abs(mean)).toBeLessThan(0.004);
    for (const o of offsets) expect(Math.abs(o)).toBeLessThan(0.012);
  });

  it("does not fold an unusual tempo onto the prior", () => {
    const result = detectBeats(track(92, 15), SR);
    expect(Math.abs(result.bpm - 92)).toBeLessThan(1.5);
  });

  it("starts with the music, not in the silence before it", () => {
    const result = detectBeats(track(128, 12, 2.5), SR);
    expect(result.beats[0]!.timeSec).toBeGreaterThan(2.3);
  });

  it("answers no beats for silence and for audio shorter than two seconds", () => {
    expect(detectBeats(new Float32Array(SR * 5), SR)).toMatchObject({ bpm: 0, beats: [] });
    expect(detectBeats(track(120, 1.5), SR).beats).toEqual([]);
  });

  describe("tempo octave", () => {
    // 70 is a ballad (nothing at 140), the rest are grooves with a kick on every beat and hats on the eighths.
    for (const bpm of [90, 128, 174]) {
      it(`reads a ${bpm} BPM groove as ${bpm} or an octave of it, with the true tempo reported`, () => {
        const result = detectBeats(track(bpm, 16), SR);
        const octave = [result.bpm, ...result.alternatives.map((a) => a.bpm)].some((b) => Math.abs(b - bpm) < 0.02 * bpm);
        expect(octave).toBe(true);
        expect(result.bpm).toBeGreaterThanOrEqual(80);
        expect(result.bpm).toBeLessThanOrEqual(180);
        // Whichever octave it picks, its beats are beats of the true tempo.
        expect(onGrid(result.beats.map((b) => b.timeSec), 60 / bpm, 0)).toBeGreaterThan(0.9);
      });
    }

    it("keeps a click track at 70 BPM: no pulse at 140 means it really is slow", () => {
      const result = detectBeats(clicks(70, 16, 0.2), SR);
      expect(Math.abs(result.bpm - 70)).toBeLessThan(1.5);
      expect(onGrid(result.beats.map((b) => b.timeSec), 60 / 70, 0.2)).toBeGreaterThan(0.9);
    });

    it("doubles a slow groove whose eighth notes are in the audio", () => {
      // Search only the slow octave so the estimate is 70 and the edit-range rule has to move it.
      const result = detectBeats(track(70, 16), SR, { minBpm: 60, maxBpm: 100 });
      expect(result.foldedFrom).toBeCloseTo(70, 0);
      expect(result.bpm).toBeGreaterThan(138);
      expect(result.bpm).toBeLessThan(142);
      expect(result.alternatives.some((a) => Math.abs(a.bpm - 70) < 1.5)).toBe(true);
    });

    it("halves a tempo above 180", () => {
      const result = detectBeats(clicks(200, 16), SR, { minBpm: 150, maxBpm: 240 });
      expect(Math.abs(result.bpm - 100)).toBeLessThan(2);
      expect(result.foldedFrom).toBeGreaterThan(190);
    });
  });

  describe("a given tempo", () => {
    it("tracks the phase of the audio at the tempo the caller names", () => {
      const result = detectBeats(clicks(80, 16, 0.31), SR, { bpm: 160 });
      expect(result).toMatchObject({ bpm: 160, forced: true });
      expect(result.foldedFrom).toBeUndefined();
      expect(onGrid(result.beats.map((b) => b.timeSec), 60 / 160, 0.31)).toBeGreaterThan(0.9);
    });
  });

  describe("confidence and bars", () => {
    it("is sure of a steady groove and not of noise", () => {
      expect(detectBeats(track(120, 12), SR).confidence).toBeGreaterThan(0.7);
      const hiss = Float32Array.from({ length: SR * 12 }, (_, i) => 0.2 * (Math.sin(i * 12.9898) * 43758.5453 % 1));
      expect(detectBeats(hiss, SR).confidence).toBeLessThan(0.4);
    });

    it("counts bars of four with the heavy kick on the first beat, and of three in waltz time", () => {
      const four = detectBeats(track(120, 16), SR);
      expect(four.beatsPerBar).toBe(4);
      expect(four.barConfidence).toBeGreaterThan(0.2);
      const waltz = detectBeats(track(120, 18, 0, 3), SR);
      expect(waltz.beatsPerBar).toBe(3);
      for (let i = 1; i < waltz.downbeats.length; i += 1) expect(waltz.downbeats[i]!.timeSec - waltz.downbeats[i - 1]!.timeSec).toBeCloseTo(1.5, 1);
    });
  });
});
