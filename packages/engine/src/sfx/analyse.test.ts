import { describe, expect, it } from "vitest";
import { analyseKitSound } from "./analyse.js";

const SR = 48000;

function silence(seconds: number): Float32Array {
  return new Float32Array(Math.round(seconds * SR));
}

/** A decaying sine burst starting at `at` seconds. */
function hit(seconds: number, at: number, hz: number, tau: number, amp = 0.8): Float32Array {
  const out = silence(seconds);
  for (let i = Math.round(at * SR); i < out.length; i += 1) {
    const t = i / SR - at;
    out[i] = amp * Math.exp(-t / tau) * Math.sin(2 * Math.PI * hz * t);
  }
  return out;
}

describe("analyseKitSound", () => {
  it("finds a hit's onset, its fast attack and where it dies away", () => {
    const x = hit(1, 0.1, 1000, 0.05);
    const a = analyseKitSound([x, x], SR);
    expect(a.onsetMs).toBeGreaterThanOrEqual(100);
    expect(a.onsetMs).toBeLessThan(101);
    expect(a.attackMs).toBeLessThan(2);
    expect(a.peakMs).toBeGreaterThan(100);
    expect(a.peakMs).toBeLessThan(140);
    // 50 dB down at 5.76 tau = 288 ms after the onset.
    expect(a.endMs).toBeGreaterThan(350);
    expect(a.endMs).toBeLessThan(420);
    expect(a.centroidHz).toBeGreaterThan(900);
    expect(a.centroidHz).toBeLessThan(1150);
    expect(a.clippedRuns).toBe(0);
    expect(a.sideDb).toBeLessThan(-100);
    expect(a.noiseFloorDb).toBeLessThan(-60);
    expect(a.tailDb).toBeLessThan(-60);
    expect(a.airDb).toBeLessThan(-40);
  });

  it("hears a recording cut before its tail died away", () => {
    const x = hit(0.2, 0.01, 3000, 0.2);
    expect(analyseKitSound([x, x], SR).tailDb).toBeGreaterThan(-30);
  });

  it("puts a swell's peak where its 50 ms RMS is loudest", () => {
    const x = silence(1.2);
    for (let i = 0; i < x.length; i += 1) {
      const t = i / SR;
      const env = t < 0.8 ? (t / 0.8) ** 2 : Math.exp(-(t - 0.8) / 0.03);
      x[i] = 0.5 * env * Math.sin(2 * Math.PI * 3000 * t);
    }
    const a = analyseKitSound([x], SR);
    expect(Math.abs(a.peakMs - 800)).toBeLessThan(30);
    expect(a.attackMs).toBeGreaterThan(500);
    expect(a.channels).toBe(1);
  });

  it("reads a sub as low and a noisy, clipped recording as faulty", () => {
    const sub = hit(1.5, 0, 50, 0.4);
    expect(analyseKitSound([sub, sub], SR).lowShare).toBeGreaterThan(0.95);

    const noisy = hit(1, 0.05, 2000, 0.05, 1.4).map((v) => Math.max(-1, Math.min(1, v)));
    let seed = 1;
    for (let i = 0; i < noisy.length; i += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      noisy[i]! += 0.04 * (seed / 2147483648 - 0.5);
    }
    const a = analyseKitSound([noisy, noisy], SR);
    expect(a.clippedRuns).toBeGreaterThan(2);
    expect(a.noiseFloorDb).toBeGreaterThan(-45);
  });

  it("measures loudness of sounds shorter than one 400 ms block", () => {
    const x = hit(0.1, 0, 1000, 0.02);
    const a = analyseKitSound([x, x], SR);
    expect(Number.isFinite(a.lufs)).toBe(true);
    expect(a.truePeakDb).toBeLessThan(0);
  });

  it("tells true stereo from mono", () => {
    const l = hit(0.5, 0, 800, 0.1);
    const r = hit(0.5, 0.004, 1300, 0.1);
    expect(analyseKitSound([l, r], SR).sideDb).toBeGreaterThan(-10);
  });
});
