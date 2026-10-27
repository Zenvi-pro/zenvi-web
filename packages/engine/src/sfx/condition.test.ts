import { describe, expect, it } from "vitest";
import { conditionSfx, loudestRms, recipeLoudness } from "./condition.js";
import { Rng, SFX_SAMPLE_RATE } from "./dsp.js";
import { SFX_PEAK_DBFS } from "./render.js";

const SR = 44100;

/** `lead` s of silence, a sound of `body` s shaped by `env(x)` (x 0..1), `tail` s of silence; mono. */
function sound(lead: number, body: number, tail: number, env: (x: number) => number, level = 0.3): Float32Array {
  const rng = new Rng(7);
  const out = new Float32Array(Math.round((lead + body + tail) * SR));
  const from = Math.round(lead * SR);
  const n = Math.round(body * SR);
  for (let i = 0; i < n; i += 1) out[from + i] = rng.bipolar() * level * env(i / n);
  return out;
}

const hitEnvelope = (x: number) => (x < 0.01 ? x / 0.01 : Math.exp(-(x - 0.01) * 8));
const whooshEnvelope = (x: number) => Math.sin(Math.PI * Math.pow(x, 0.8)) ** 2;

function peakDb(left: Float32Array, right: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < left.length; i += 1) peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!));
  return 20 * Math.log10(peak);
}

describe("conditionSfx", () => {
  it("trims the silence around a hit, keeps a little air, and puts the hit on the transient", () => {
    const out = conditionSfx({ sampleRate: SR, left: sound(0.4, 0.6, 0.8, hitEnvelope) }, { hit: "onset", maxSeconds: 5, targetRms: 0.1 })!;
    expect(out.sampleRate).toBe(SFX_SAMPLE_RATE);
    expect(out.trimmedHead).toBeGreaterThan(0.38);
    expect(out.trimmedHead).toBeLessThan(0.4);
    // The decay below -40 dB from the peak and the silence after it go.
    expect(out.trimmedTail).toBeGreaterThan(0.8);
    expect(out.hit).toBeLessThan(0.012);
    // Mono in, the same signal on both sides.
    expect(out.right).toEqual(out.left);
  });

  it("levels to the target loudness, never past the -1 dBFS ceiling", () => {
    const quiet = conditionSfx({ sampleRate: SR, left: sound(0, 1, 0, whooshEnvelope, 0.02) }, { hit: "peak", maxSeconds: 5, targetRms: 0.1 })!;
    expect(loudestRms(quiet.left, quiet.right, SFX_SAMPLE_RATE)).toBeCloseTo(0.1, 2);
    expect(quiet.gainDb).toBeGreaterThan(10);
    const spiky = conditionSfx({ sampleRate: SR, left: sound(0, 0.5, 0, hitEnvelope, 0.9) }, { hit: "onset", maxSeconds: 5, targetRms: 0.9 })!;
    // Its transient soft-limited just under the ceiling, its body driven louder than the peak alone allows.
    expect(peakDb(spiky.left, spiky.right)).toBeLessThanOrEqual(SFX_PEAK_DBFS);
    expect(peakDb(spiky.left, spiky.right)).toBeGreaterThan(SFX_PEAK_DBFS - 0.5);
    expect(spiky.gainDb).toBeGreaterThan(20 * Math.log10(10 ** (SFX_PEAK_DBFS / 20) / 0.9) + 3);
  });

  it("finds a whoosh's peak, and a riser's hit at its end", () => {
    const whoosh = conditionSfx({ sampleRate: SR, left: sound(0.2, 1, 0.2, whooshEnvelope) }, { hit: "peak", maxSeconds: 5, targetRms: 0.1 })!;
    // sin²(π x^0.8) peaks at x = 0.5^1.25 ≈ 0.42 of the body.
    expect(Math.abs(whoosh.hit - (0.42 - whoosh.trimmedHead + 0.2))).toBeLessThan(0.05);
    const riser = conditionSfx({ sampleRate: SR, left: sound(0, 3, 0, (x) => x) }, { hit: "end", maxSeconds: 2, targetRms: 0.1 })!;
    // Too long for its role: a riser keeps its end (the build into the hit), not its start.
    expect(riser.duration).toBeCloseTo(2, 2);
    expect(riser.trimmedHead).toBeCloseTo(1, 2);
    expect(riser.hit).toBeCloseTo(riser.duration, 6);
  });

  it("cuts what runs too long after the hit and fades the cut", () => {
    const out = conditionSfx({ sampleRate: SR, left: sound(0, 4, 0, () => 1) }, { hit: "onset", maxSeconds: 1, targetRms: 0.1 })!;
    expect(out.duration).toBeCloseTo(1, 2);
    expect(Math.abs(out.left[out.left.length - 1]!)).toBeLessThan(1e-3);
  });

  it("keeps stereo apart and returns null for silence", () => {
    const left = sound(0, 0.5, 0, hitEnvelope);
    const right = left.map((x) => -x);
    const out = conditionSfx({ sampleRate: SR, left, right }, { hit: "onset", maxSeconds: 5, targetRms: 0.1 })!;
    expect(out.left[100]).toBeCloseTo(-out.right[100]!, 6);
    expect(conditionSfx({ sampleRate: SR, left: new Float32Array(SR) }, { hit: "onset", maxSeconds: 5, targetRms: 0.1 })).toBeNull();
  });
});

describe("recipeLoudness", () => {
  it("measures what a recipe renders at, so a library stand-in matches its mix level", () => {
    const punch = recipeLoudness("impact_punch");
    expect(punch).toBeGreaterThan(0.05);
    expect(punch).toBeLessThan(0.9);
    expect(recipeLoudness("impact_punch")).toBe(punch);
  });
});
