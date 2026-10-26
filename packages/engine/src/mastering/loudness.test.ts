import { describe, expect, it } from "vitest";
import { kWeightingFilters, measureLoudness, SILENCE_LUFS, sliceWindows, truePeak } from "./loudness.js";
import { dbfsSine, stereoSine } from "./testing.js";

const RATE = 48000;

describe("K-weighting", () => {
  it("matches the BS.1770-4 table 1 coefficients at 48 kHz", () => {
    const [shelf, highPass] = kWeightingFilters(48000);
    expect(shelf.b[0]).toBeCloseTo(1.53512485958697, 9);
    expect(shelf.b[1]).toBeCloseTo(-2.69169618940638, 9);
    expect(shelf.b[2]).toBeCloseTo(1.19839281085285, 9);
    expect(shelf.a[0]).toBeCloseTo(-1.69065929318241, 9);
    expect(shelf.a[1]).toBeCloseTo(0.73248077421585, 9);
    expect(highPass.a[0]).toBeCloseTo(-1.99004745483398, 9);
    expect(highPass.a[1]).toBeCloseTo(0.99007225036621, 9);
  });
});

describe("integrated loudness (EBU Tech 3341 signals)", { timeout: 60_000 }, () => {
  it("reads a stereo 1 kHz sine at -23 dBFS as -23.0 LUFS (case 1)", () => {
    const report = measureLoudness(stereoSine(1000, -23, 20, RATE), RATE);
    expect(report.integrated).toBeCloseTo(-23, 1);
    expect(report.momentaryMax).toBeCloseTo(-23, 1);
    expect(report.shortTermMax).toBeCloseTo(-23, 1);
  });

  it("reads -33 dBFS as -33.0 LUFS (case 2)", () => {
    expect(measureLoudness(stereoSine(1000, -33, 20, RATE), RATE).integrated).toBeCloseTo(-33, 1);
  });

  it("follows the level per channel: a mono source reads 3 LU lower than the same signal on both channels", () => {
    const both = measureLoudness(stereoSine(1000, -20, 10, RATE), RATE).integrated;
    const left = dbfsSine(1000, -20, 10, RATE);
    const mono = measureLoudness([left, new Float32Array(left.length)], RATE).integrated;
    expect(both - mono).toBeCloseTo(3.01, 1);
  });

  it("is rate independent (44.1 kHz, 96 kHz)", () => {
    for (const rate of [44100, 96000]) {
      expect(measureLoudness(stereoSine(1000, -23, 20, rate), rate).integrated).toBeCloseTo(-23, 1);
    }
  });

  it("applies the relative gate: -36 / -23 / -36 LUFS tones read -23 LUFS (case 3)", () => {
    const parts = [stereoSine(1000, -36, 10, RATE), stereoSine(1000, -23, 60, RATE), stereoSine(1000, -36, 10, RATE)];
    const joined = [0, 1].map((c) => {
      const out = new Float32Array(parts.reduce((n, p) => n + p[c]!.length, 0));
      let at = 0;
      for (const p of parts) {
        out.set(p[c]!, at);
        at += p[c]!.length;
      }
      return out;
    });
    expect(measureLoudness(joined, RATE).integrated).toBeCloseTo(-23, 1);
  });

  it("applies the absolute gate: a -80 dBFS tone is silence", () => {
    expect(measureLoudness(stereoSine(1000, -80, 10, RATE), RATE).integrated).toBe(SILENCE_LUFS);
  });

  it("reads digital silence and clips shorter than one block as -Infinity", () => {
    expect(measureLoudness([new Float32Array(RATE * 3), new Float32Array(RATE * 3)], RATE).integrated).toBe(SILENCE_LUFS);
    expect(measureLoudness(stereoSine(1000, -20, 0.3, RATE), RATE).integrated).toBe(SILENCE_LUFS);
  });

  it("weighs the surround channels +1.5 dB and leaves the LFE out of a 5.1 mix", () => {
    const tone = dbfsSine(1000, -30, 10, RATE);
    const silent = new Float32Array(tone.length);
    const front = measureLoudness([tone, silent, silent, silent, silent, silent], RATE).integrated;
    const lfe = measureLoudness([silent, silent, silent, tone, silent, silent], RATE).integrated;
    const surround = measureLoudness([silent, silent, silent, silent, tone, silent], RATE).integrated;
    expect(lfe).toBe(SILENCE_LUFS);
    expect(surround - front).toBeCloseTo(1.5, 1);
  });
});

describe("loudness range (Tech 3342 case 1: 20 LU steps are not used, 10 LU is)", { timeout: 60_000 }, () => {
  it("reads a steady tone as 0 LU", () => {
    expect(measureLoudness(stereoSine(1000, -23, 30, RATE), RATE).range).toBeCloseTo(0, 1);
  });

  it("reads alternating -20 / -30 dBFS 20 s tones as about 10 LU", () => {
    const parts = [-30, -20, -30, -20].flatMap((db) => [stereoSine(1000, db, 20, RATE)]);
    const joined = [0, 1].map((c) => {
      const out = new Float32Array(parts.reduce((n, p) => n + p[c]!.length, 0));
      let at = 0;
      for (const p of parts) {
        out.set(p[c]!, at);
        at += p[c]!.length;
      }
      return out;
    });
    expect(measureLoudness(joined, RATE).range).toBeGreaterThan(8.5);
    expect(measureLoudness(joined, RATE).range).toBeLessThan(10.5);
  });
});

describe("peaks", () => {
  it("reports sample peak and true peak of a full-scale-adjacent sine", () => {
    const report = measureLoudness(stereoSine(1000, -6, 5, RATE), RATE);
    expect(report.samplePeakDb).toBeCloseTo(-6, 1);
    expect(report.truePeakDb).toBeCloseTo(-6, 1);
  });

  it("finds the inter-sample peak a sample-peak meter misses (fs/4 sine at 45 degrees)", () => {
    // Samples of sin(2π·fs/4·n + π/4) are ±0.7071: sample peak -3.01 dBFS, true peak 0 dBFS.
    const x = new Float32Array(4800);
    for (let n = 0; n < x.length; n += 1) x[n] = Math.sin((Math.PI / 2) * n + Math.PI / 4);
    const [l, r] = [x, x];
    const report = measureLoudness([l, r], RATE);
    expect(report.samplePeakDb).toBeCloseTo(-3.01, 1);
    expect(report.truePeakDb).toBeGreaterThan(-0.3);
    expect(report.truePeakDb).toBeLessThan(0.3);
    expect(20 * Math.log10(truePeak(x, RATE))).toBeCloseTo(report.truePeakDb, 6);
  });
});

describe("sliceWindows", () => {
  it("joins the parts of the signal inside the windows", () => {
    const x = Float32Array.from({ length: 100 }, (_, i) => i);
    const [out] = sliceWindows([x], 10, [
      [1, 2],
      [5, 6],
    ]);
    expect(Array.from(out!)).toEqual([...Array.from({ length: 10 }, (_, i) => 10 + i), ...Array.from({ length: 10 }, (_, i) => 50 + i)]);
  });
});
