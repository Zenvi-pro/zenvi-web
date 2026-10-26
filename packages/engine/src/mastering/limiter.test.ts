import { describe, expect, it } from "vitest";
import { exportCeilingDb, limitTruePeak, TruePeakLimiter } from "./limiter.js";
import { amplitudeToDb, measureLoudness, truePeak } from "./loudness.js";
import { dbfsSine, stereoSine } from "./testing.js";

const RATE = 48000;

/** A drum-like hit every quarter second over a quiet bed: what a sound-designed reel sends the exporter. */
function overLoudMix(seconds: number): Float32Array[] {
  const bed = stereoSine(110, -12, seconds, RATE);
  for (let at = 0; at < seconds * RATE; at += RATE / 4) {
    for (let i = 0; i < 2400 && at + i < bed[0]!.length; i += 1) {
      const hit = 1.6 * Math.exp(-i / 400) * Math.sin((2 * Math.PI * 3000 * i) / RATE + 0.7);
      bed[0]![at + i]! += hit;
      bed[1]![at + i]! -= hit * 0.8;
    }
  }
  return bed;
}

describe("true-peak limiter", () => {
  it("holds an over-loud mix under -1 dBTP", () => {
    const mix = overLoudMix(2);
    expect(measureLoudness(mix, RATE).truePeakDb).toBeGreaterThan(3);
    const out = limitTruePeak(mix, { sampleRate: RATE, ceilingDb: -1 });
    expect(out[0]!.length).toBe(mix[0]!.length);
    expect(measureLoudness(out, RATE).truePeakDb).toBeLessThanOrEqual(-1 + 1e-6);
  });

  it("holds inter-sample peaks: a quarter-rate sine sampled off its crests", () => {
    // fs/4 at 45 degrees: every sample is at 0.707 of the crest, the true peak is 3 dB higher.
    const tone = dbfsSine(RATE / 4, 0, 1, RATE, Math.PI / 4);
    expect(amplitudeToDb(Math.max(...tone.map(Math.abs)))).toBeCloseTo(-3, 1);
    const [out] = limitTruePeak([tone], { sampleRate: RATE, ceilingDb: -1 });
    expect(amplitudeToDb(truePeak(out!, RATE))).toBeLessThanOrEqual(-1 + 1e-6);
  });

  it("passes a mix under the ceiling through unchanged, delayed back into place", () => {
    const mix = stereoSine(440, -6, 0.5, RATE);
    const out = limitTruePeak(mix, { sampleRate: RATE, ceilingDb: -1 });
    for (let c = 0; c < 2; c += 1) expect(Array.from(out[c]!)).toEqual(Array.from(mix[c]!));
  });

  it("streams: windows of any size give the same samples as one call", () => {
    const mix = overLoudMix(1);
    const whole = limitTruePeak(mix, { sampleRate: RATE, ceilingDb: -2 });
    const limiter = new TruePeakLimiter({ sampleRate: RATE, channels: 2, ceilingDb: -2 });
    const parts: Float32Array[][] = [];
    for (let at = 0, size = 7; at < mix[0]!.length; at += size, size = size * 3 + 1) {
      parts.push(limiter.process(mix.map((c) => c.subarray(at, Math.min(c.length, at + size)))));
    }
    parts.push(limiter.flush());
    for (let c = 0; c < 2; c += 1) {
      const joined = Float32Array.from(parts.flatMap((p) => Array.from(p[c]!)));
      expect(joined.length).toBe(mix[c]!.length);
      expect(Array.from(joined)).toEqual(Array.from(whole[c]!));
    }
  });

  it("flushes no more than went in", () => {
    const limiter = new TruePeakLimiter({ sampleRate: RATE, channels: 1, ceilingDb: -1 });
    const head = limiter.process([new Float32Array(10).fill(0.5)]);
    const tail = limiter.flush();
    expect(head[0]!.length + tail[0]!.length).toBe(10);
    expect(Array.from(tail[0]!).slice(-1)[0]).toBeCloseTo(0.5, 6);
  });

  it("aims lossy exports a codec's overshoot lower", () => {
    expect(exportCeilingDb(false)).toBe(-1);
    expect(exportCeilingDb(true)).toBe(-2);
  });
});
