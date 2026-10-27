import { describe, expect, it } from "vitest";
import { ENV_HOP, NO_BED_DB, PROMINENCE_DB, bedLevelAt, envelope50, gainOverBed, peakNear } from "./levels.js";

const SR = 48000;

function tone(seconds: number, amplitude: number, from = 0, length = seconds): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = Math.round(from * SR); i < Math.min(out.length, Math.round((from + length) * SR)); i += 1) out[i] = amplitude * Math.sin((2 * Math.PI * 1000 * i) / SR);
  return out;
}

describe("levels", () => {
  it("measures a sine's 50 ms RMS every 10 ms, like METRICS.md's env50", () => {
    const env = envelope50(tone(1, 0.5), undefined, SR);
    expect(env.length).toBe(Math.floor(SR / (ENV_HOP * SR)) + 1);
    // 0.5 peak: RMS 0.354, -9.03 dBFS; the edges see half a window of zeros.
    expect(env[50]!).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 1);
    expect(env[0]!).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2 / Math.SQRT2), 1);
    // The mono sum: a channel against silence is 6 dB down.
    expect(envelope50(tone(1, 0.5), new Float32Array(SR), SR)[50]!).toBeCloseTo(env[50]! - 6.02, 1);
  });

  it("finds a cue's peak around its hit and the bed's median level around a moment", () => {
    const burst = envelope50(tone(2, 0.8, 1, 0.05), undefined, SR);
    expect(peakNear(burst, 1)).toBeGreaterThan(-6);
    expect(peakNear(burst, 1.5)).toBeLessThan(-100);
    const bed = envelope50(tone(4, 0.1), undefined, SR);
    expect(bedLevelAt(bed, 2)).toBeCloseTo(20 * Math.log10(0.1 / Math.SQRT2), 1);
  });

  it("sets the gain that lands a role's prominence over the bed, none over silence", () => {
    expect(gainOverBed("hero", -6, -24)).toBe(PROMINENCE_DB.hero - 24 + 6);
    expect(gainOverBed("micro", -10, -20, -1)).toBe(PROMINENCE_DB.micro - 1 - 20 + 10);
    expect(gainOverBed("hero", -6, NO_BED_DB - 1)).toBeNull();
  });
});
