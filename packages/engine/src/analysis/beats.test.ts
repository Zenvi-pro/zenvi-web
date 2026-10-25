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
function track(bpm: number, seconds: number, leadIn = 0): Float32Array {
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
    add(t, n % 4 === 0 ? 0.9 : 0.6, 0.08, kick);
    if (n % 2 === 1) add(t, 0.35, 0.05, () => rand());
    add(t, 0.08, 0.008, () => rand());
    add(t + beat / 2, 0.12, 0.01, () => rand());
  }
  if (leadIn > 0) out.fill(0, 0, Math.round(leadIn * SR) - 1);
  return out;
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
});
