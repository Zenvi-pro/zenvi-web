import { describe, expect, it } from "vitest";
import { SFX_SAMPLE_RATE } from "./dsp.js";
import { SFX_RECIPES, SFX_RECIPE_IDS, sfxRecipe } from "./recipes.js";
import { framePad, padSfx, renderSfx, resolveSfxParams, sfxKey, type SfxAudio } from "./render.js";

/** FNV-1a over the float bits of both channels. */
function hashOf(audio: SfxAudio): string {
  let h = 2166136261;
  for (const ch of [audio.left, audio.right]) {
    const bytes = new Uint8Array(ch.buffer, ch.byteOffset, ch.byteLength);
    for (let i = 0; i < bytes.length; i += 1) h = Math.imul(h ^ bytes[i]!, 16777619);
  }
  return (h >>> 0).toString(16);
}

/** RMS of the loudest 50 ms, dBFS. */
function loudestRmsDb(audio: SfxAudio): number {
  const w = Math.min(audio.left.length, Math.round(0.05 * SFX_SAMPLE_RATE));
  let best = 0;
  for (let s = 0; s + w <= audio.left.length; s += 240) {
    let sum = 0;
    for (let i = s; i < s + w; i += 1) sum += (audio.left[i]! ** 2 + audio.right[i]! ** 2) / 2;
    best = Math.max(best, sum / w);
  }
  return 10 * Math.log10(best);
}

/** Spectral centroid (Hz) of each 2048-sample frame of the mono mix, from a DFT at 96 log-spaced frequencies; frames below -50 dB are skipped. */
function centroids(audio: SfxAudio): number[] {
  const n = 2048;
  const freqs = Array.from({ length: 96 }, (_, k) => 100 * Math.pow(160, k / 95));
  const out: number[] = [];
  for (let s = 0; s + n <= audio.left.length; s += n / 2) {
    let energy = 0;
    for (let i = s; i < s + n; i += 1) energy += ((audio.left[i]! + audio.right[i]!) / 2) ** 2;
    if (10 * Math.log10(energy / n + 1e-20) < -50) continue;
    let num = 0;
    let den = 0;
    for (const f of freqs) {
      let re = 0;
      let im = 0;
      const w = (2 * Math.PI * f) / SFX_SAMPLE_RATE;
      for (let i = 0; i < n; i += 1) {
        const x = ((audio.left[s + i]! + audio.right[s + i]!) / 2) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
        re += x * Math.cos(w * i);
        im -= x * Math.sin(w * i);
      }
      // Log-spaced bins: weight by bandwidth (∝ f) so the centroid is not biased low.
      const p = (re * re + im * im) * f;
      num += f * p;
      den += p;
    }
    out.push(num / den);
  }
  return out;
}

describe("procedural sound effects", () => {
  it("has at least 24 recipes across every family, each with taste notes", () => {
    expect(SFX_RECIPES.length).toBeGreaterThanOrEqual(24);
    expect(new Set(SFX_RECIPE_IDS).size).toBe(SFX_RECIPES.length);
    expect(new Set(SFX_RECIPES.map((r) => r.family))).toEqual(new Set(["whoosh", "impact", "riser", "click", "ui", "texture", "transition"]));
    for (const r of SFX_RECIPES) {
      expect(r.use.length, r.id).toBeGreaterThan(40);
      expect(r.duration.min, r.id).toBeLessThanOrEqual(r.duration.default);
      expect(r.duration.default, r.id).toBeLessThanOrEqual(r.duration.max);
      expect(r.mixDb, r.id).toBeLessThan(-6);
    }
  });

  it.each(SFX_RECIPE_IDS)("%s renders clean, normalised, deterministic audio", (id) => {
    const a = renderSfx(id, { seed: 3 });
    const b = renderSfx(id, { seed: 3 });
    expect(hashOf(a)).toBe(hashOf(b));
    expect(hashOf(renderSfx(id, { seed: 4 }))).not.toBe(hashOf(a));

    expect(a.sampleRate).toBe(48000);
    expect(a.left.length).toBe(a.right.length);
    expect(a.duration).toBeCloseTo(sfxRecipe(id)!.duration.default, 2);
    let peak = 0;
    let bad = 0;
    for (const ch of [a.left, a.right]) {
      for (const x of ch) {
        // No NaN, and no denormals: every sample is exactly zero or audible-scale.
        if (!Number.isFinite(x) || (x !== 0 && Math.abs(x) < 1e-9)) bad += 1;
        peak = Math.max(peak, Math.abs(x));
      }
    }
    expect(bad).toBe(0);
    expect(20 * Math.log10(peak)).toBeCloseTo(-1, 3);
    const rms = loudestRmsDb(a);
    expect(rms).toBeLessThan(-2);
    expect(rms).toBeGreaterThan(-26);
    expect(a.hit).toBeGreaterThanOrEqual(0);
    expect(a.hit).toBeLessThanOrEqual(a.duration);
    // Starts and ends at silence: no click at the clip edges.
    expect(Math.abs(a.left[0]!)).toBeLessThan(1e-3);
    expect(Math.abs(a.left[a.left.length - 1]!)).toBeLessThan(1e-3);
  });

  it("puts the hit where the recipe says: a whoosh's peak, an impact's onset, a riser's end", () => {
    const whoosh = renderSfx("whoosh_medium");
    const env = (audio: SfxAudio, at: number) => {
      const i = Math.round(at * SFX_SAMPLE_RATE);
      let sum = 0;
      for (let k = i - 480; k < i + 480; k += 1) sum += (audio.left[k] ?? 0) ** 2;
      return sum;
    };
    expect(env(whoosh, whoosh.hit)).toBeGreaterThan(env(whoosh, whoosh.hit - 0.25) * 2);
    expect(env(whoosh, whoosh.hit)).toBeGreaterThan(env(whoosh, whoosh.hit + 0.25) * 2);
    expect(renderSfx("impact_punch").hit).toBe(0);
    const riser = renderSfx("riser_noise", { duration: 2 });
    expect(riser.hit).toBeCloseTo(2, 5);
  });

  it("sweeps: a rising whoosh brightens to its end, a falling one darkens, a pass-by goes up then down", () => {
    const rise = centroids(renderSfx("whoosh_rise"));
    expect(rise[rise.length - 1]!).toBeGreaterThan(rise[0]! * 3);
    const third = Math.floor(rise.length / 3);
    expect(rise.slice(-third).reduce((a, b) => a + b) / third).toBeGreaterThan(rise.slice(0, third).reduce((a, b) => a + b) / third * 2);
    const fall = centroids(renderSfx("whoosh_fall"));
    expect(fall[0]!).toBeGreaterThan(fall[fall.length - 1]! * 3);
    const by = renderSfx("whoosh_long");
    const c = centroids(by);
    const peakFrame = c.indexOf(Math.max(...c));
    expect(peakFrame).toBeGreaterThan(1);
    expect(peakFrame).toBeLessThan(c.length - 2);
    expect(c[peakFrame]!).toBeGreaterThan(c[0]! * 2);
    expect(c[peakFrame]!).toBeGreaterThan(c[c.length - 1]! * 2);
  });

  it("travels across the stereo field: a whoosh starts on one side and ends on the other", () => {
    const side = (pan: number) => {
      const a = renderSfx("whoosh_medium", { pan });
      const q = Math.floor(a.left.length / 4);
      const level = (ch: Float32Array, from: number, to: number) => ch.slice(from, to).reduce((s, x) => s + x * x, 0);
      return [level(a.left, 0, q) / level(a.right, 0, q), level(a.left, 3 * q, 4 * q) / level(a.right, 3 * q, 4 * q)];
    };
    const [startLr, endLr] = side(0.8);
    expect(startLr!).toBeGreaterThan(2);
    expect(endLr!).toBeLessThan(0.5);
    const [backStart, backEnd] = side(-0.8);
    expect(backStart!).toBeLessThan(0.5);
    expect(backEnd!).toBeGreaterThan(2);
  });

  it("follows duration, pitch and pan", () => {
    expect(renderSfx("whoosh_short", { duration: 0.3 }).duration).toBeCloseTo(0.3, 3);
    // Clamped to the recipe's range.
    expect(renderSfx("whoosh_short", { duration: 10 }).duration).toBeCloseTo(sfxRecipe("whoosh_short")!.duration.max, 3);
    const left = renderSfx("ui_tap", { pan: -1 });
    let l = 0;
    let r = 0;
    for (let i = 0; i < left.left.length; i += 1) {
      l += left.left[i]! ** 2;
      r += left.right[i]! ** 2;
    }
    expect(l).toBeGreaterThan(r * 2);
    expect(hashOf(renderSfx("pop", { pitch: 5 }))).not.toBe(hashOf(renderSfx("pop")));
  });

  it("resolves parameters to rounded, clamped values so equal sounds share a cache key", () => {
    const recipe = sfxRecipe("impact_punch")!;
    expect(resolveSfxParams(recipe, { pitch: 30, brightness: -1, intensity: 0.7004, seed: 2.9 })).toEqual({
      duration: 0.6,
      pitch: 12,
      brightness: 0,
      intensity: 0.7,
      pan: 0,
      seed: 2,
    });
    const a = sfxKey("impact_punch", resolveSfxParams(recipe, { intensity: 0.7004 }), 30);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(sfxKey("impact_punch", resolveSfxParams(recipe, { intensity: 0.7 }), 30)).toBe(a);
    expect(sfxKey("impact_punch", resolveSfxParams(recipe, {}), 25)).not.toBe(a);
    expect(sfxKey("impact_thud", resolveSfxParams(recipe, {}), 30)).not.toBe(a);
  });

  it("pads the head so the hit lands on a frame boundary", () => {
    expect(framePad(0, 30)).toBe(0);
    expect(framePad(0.5, 30)).toBeCloseTo(0, 9);
    const pad = framePad(0.26, 30);
    expect(pad).toBeCloseTo(8 / 30 - 0.26, 9);
    const audio = renderSfx("whoosh_short");
    const padded = padSfx(audio, framePad(audio.hit, 30));
    expect((padded.hit * 30) % 1).toBeLessThan(1e-3 + 48000 ** -1 * 30);
    expect(padded.left.length).toBe(audio.left.length + Math.round(framePad(audio.hit, 30) * 48000));
  });
});
