import { describe, expect, it } from "vitest";
import type { AudioKernel, EvaluatedParam } from "../types.js";
import { exp10f } from "./apple-libm.js";
import { f32, f32Fma64, fma64, fmaf } from "./float.js";
import { fnv1a32, LibcRand } from "./libc-rand.js";
import { getAudioKernel, supportedAudioEffects } from "./registry.js";
import { signal } from "./testing.js";

type Params = Record<string, EvaluatedParam>;

function kernel(type: string): AudioKernel {
  const k = getAudioKernel(type);
  if (!k) throw new Error(type);
  return k;
}

/** Run `type` over `channels` in frame-sized blocks (one kernel call per block), returning new arrays. */
function run(type: string, channels: Float32Array[], params: Params, sampleRate = 48000, block = 1600, state = new Map<string, unknown>()): Float32Array[] {
  const out = channels.map((c) => Float32Array.from(c));
  const k = kernel(type);
  for (let start = 0; start < out[0]!.length; start += block) {
    k(
      out.map((c) => c.subarray(start, Math.min(c.length, start + block))),
      sampleRate,
      params,
      state,
    );
  }
  return out;
}

function tone(frequency: number, sampleRate: number, length: number): Float32Array {
  return Float32Array.from({ length }, (_, n) => Math.sin((2 * Math.PI * frequency * n) / sampleRate));
}

/** Amplitude of the `frequency` component over the last `periods` whole periods (least squares on sin/cos). */
function amplitudeAt(x: Float32Array, frequency: number, sampleRate: number, periods = 40): number {
  const n = Math.round((periods * sampleRate) / frequency);
  let s = 0;
  let c = 0;
  for (let i = x.length - n; i < x.length; i += 1) {
    const w = (2 * Math.PI * frequency * i) / sampleRate;
    s += x[i]! * Math.sin(w);
    c += x[i]! * Math.cos(w);
  }
  return (2 * Math.hypot(s, c)) / n;
}

describe("registry", () => {
  it("lists every libopenshot audio effect", () => {
    expect(supportedAudioEffects()).toEqual(["Noise", "Delay", "Echo", "Distortion", "ParametricEQ", "Compressor", "Expander", "Robotization", "Whisperization"]);
    for (const t of supportedAudioEffects()) expect(typeof getAudioKernel(t)).toBe("function");
    expect(getAudioKernel("Brightness")).toBeUndefined();
  });
});

describe("ParametricEQ uses the real sample rate (intended math, not the desktop's samples-per-frame)", () => {
  const sr = 48000;
  const len = 48000;
  const eq = (filter_type: number, frequency: number, extra: Params = {}): Params => ({ filter_type, frequency, ...extra });

  it("low pass: -3 dB at the cutoff, unity at DC", () => {
    const [y] = run("ParametricEQ", [tone(1000, sr, len)], eq(0, 1000));
    expect(amplitudeAt(y!, 1000, sr)).toBeCloseTo(Math.SQRT1_2, 3);
    const [dc] = run("ParametricEQ", [new Float32Array(len).fill(0.5)], eq(0, 1000));
    expect(dc![len - 1]).toBeCloseTo(0.5, 5);
  });

  it("high pass: -3 dB at the cutoff, blocks DC", () => {
    const [y] = run("ParametricEQ", [tone(2000, sr, len)], eq(1, 2000));
    expect(amplitudeAt(y!, 2000, sr)).toBeCloseTo(Math.SQRT1_2, 3);
    const [dc] = run("ParametricEQ", [new Float32Array(len).fill(0.5)], eq(1, 2000));
    expect(Math.abs(dc![len - 1]!)).toBeLessThan(1e-5);
  });

  it("shelves: gain G at DC (low) or Nyquist (high), unity at the other end", () => {
    const g = 10 ** (6 / 20);
    const nyquist = Float32Array.from({ length: len }, (_, i) => (i % 2 ? -0.25 : 0.25));
    const [lowDc] = run("ParametricEQ", [new Float32Array(len).fill(0.25)], eq(2, 500, { gain: 6 }));
    const [lowNy] = run("ParametricEQ", [nyquist], eq(2, 500, { gain: 6 }));
    expect(lowDc![len - 1]! / 0.25).toBeCloseTo(g, 4);
    expect(Math.abs(lowNy![len - 1]!) / 0.25).toBeCloseTo(1, 4);
    const [highDc] = run("ParametricEQ", [new Float32Array(len).fill(0.25)], eq(3, 5000, { gain: 6 }));
    const [highNy] = run("ParametricEQ", [nyquist], eq(3, 5000, { gain: 6 }));
    expect(highDc![len - 1]! / 0.25).toBeCloseTo(1, 4);
    expect(Math.abs(highNy![len - 1]!) / 0.25).toBeCloseTo(g, 4);
  });

  it("band pass is unity, band stop zero and peaking G at the center frequency", () => {
    const x = tone(3000, sr, len);
    expect(amplitudeAt(run("ParametricEQ", [x], eq(4, 3000, { q_factor: 2 }))[0]!, 3000, sr)).toBeCloseTo(1, 3);
    expect(amplitudeAt(run("ParametricEQ", [x], eq(5, 3000, { q_factor: 2 }))[0]!, 3000, sr)).toBeLessThan(1e-3);
    expect(amplitudeAt(run("ParametricEQ", [x], eq(6, 3000, { q_factor: 1, gain: 9 }))[0]!, 3000, sr)).toBeCloseTo(10 ** (9 / 20), 3);
  });

  it("differs from the desktop's ω = 2πf/samples_per_frame (reproduced by passing the frame size as the rate)", () => {
    const x = signal("music", 1, 3200, 3);
    const intended = run("ParametricEQ", x, eq(0, 500), 48000, 1600);
    const desktop = run("ParametricEQ", x, eq(0, 500), 1600, 1600);
    expect(intended[0]).not.toEqual(desktop[0]);
  });

  it("an unknown filter type keeps the (initially zero) coefficients: silence", () => {
    const [y] = run("ParametricEQ", signal("music", 1, 1600, 1), eq(9, 500));
    expect(y!.every((v) => v === 0)).toBe(true);
  });
});

describe("Delay and Echo", () => {
  const impulse = (n: number): Float32Array => {
    const x = new Float32Array(n);
    x[0] = 1;
    return x;
  };

  it("Delay: an integer delay moves the impulse, a fractional one splits it between two samples", () => {
    const [y] = run("Delay", [impulse(400)], { delay_time: 0.125 }, 1000, 100);
    expect([...y!].map((v, i) => (v ? i : -1)).filter((i) => i >= 0)).toEqual([125]);
    expect(y![125]).toBe(1);
    const [z] = run("Delay", [impulse(400)], { delay_time: 0.0105 }, 1000, 100);
    expect([z![10], z![11]]).toEqual([0.5, 0.5]);
    expect(z!.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("Delay: zero delay passes samples through and does not write the ring", () => {
    const state = new Map<string, unknown>();
    const x = signal("music", 1, 200, 4);
    const [same] = run("Delay", x, { delay_time: 0 }, 1000, 100, state);
    expect(same).toEqual(x[0]);
    // A 5-sample delay right after: the ring still holds zeros, not the passed-through samples.
    const [next] = run("Delay", [Float32Array.from({ length: 10 }, () => 0.5)], { delay_time: 0.005 }, 1000, 100, state);
    expect([...next!.subarray(0, 5)]).toEqual([0, 0, 0, 0, 0]);
    expect(next![5]).toBe(0.5);
  });

  it("Echo: mix and geometric feedback decay", () => {
    const [y] = run("Echo", [impulse(450)], { echo_time: 0.1, feedback: 0.5, mix: 0.5 }, 1000, 150);
    expect([y![0], y![100], y![200], y![300], y![400]]).toEqual([0.5, 0.5, 0.25, 0.125, 0.0625]);
    expect(y![50]).toBe(0);
  });
});

describe("Compressor and Expander", () => {
  it("defaults (ratio 1) are a constant +1 dB makeup gain: x · __exp10f(0.05f)", () => {
    const x = signal("music", 2, 3200, 9);
    const y = run("Compressor", x, {});
    const g = exp10f(f32(0.05));
    expect(g).toBeCloseTo(10 ** (1 / 20), 6);
    for (let c = 0; c < 2; c += 1) for (let i = 0; i < 3200; i += 1) expect(y[c]![i]).toBe(f32(x[c]![i]! * g));
  });

  it("Compressor settles at threshold + (level − threshold)/ratio + makeup", () => {
    const x = new Float32Array(48000).fill(0.5);
    const [y] = run("Compressor", [x], { threshold: -20, ratio: 4, attack: 0.0001, release: 0.1, makeup_gain: 0 });
    const level = 20 * Math.log10(0.5);
    const expectedDb = -20 + (level + 20) / 4;
    expect(20 * Math.log10(y![47999]!)).toBeCloseTo(expectedDb, 3);
  });

  it("Expander settles at threshold + (level − threshold)·ratio + makeup below the threshold", () => {
    const x = new Float32Array(240000).fill(0.01);
    const [y] = run("Expander", [x], { threshold: -30, ratio: 2, attack: 0.001, release: 0.001, makeup_gain: 1 });
    const expectedDb = -30 + (-40 + 30) * 2 + 1;
    expect(20 * Math.log10(y![239999]!)).toBeCloseTo(expectedDb, 2);
  });

  it("bypass leaves samples and envelope untouched", () => {
    const x = signal("music", 2, 1600, 5);
    const state = new Map<string, unknown>();
    const p = { threshold: -30, ratio: 8, attack: 0.001, release: 0.01 };
    const bypassed = run("Compressor", x, { ...p, bypass: 1 }, 48000, 1600, state);
    expect(bypassed).toEqual(x);
    const after = run("Compressor", x, p, 48000, 1600, state);
    expect(after).toEqual(run("Compressor", x, p));
  });
});

describe("Distortion", () => {
  // tone 0 dB makes the shelf the identity, so the waveshaper is observable directly.
  const flat = { input_gain: 0, output_gain: 0, tone: 0 };
  const shape = (type: number, values: number[]): number[] => [...run("Distortion", [Float32Array.from(values)], { ...flat, distortion_type: type })[0]!];

  it("waveshapers", () => {
    expect(shape(0, [0.25, 0.75, -0.9, 0.5])).toEqual([0.25, 0.5, -0.5, 0.5]);
    const soft = shape(1, [0.25, 0.5, 0.9, -0.5, -0.9]);
    expect(soft[0]).toBe(0.25);
    expect(soft[1]).toBeCloseTo((1 - (2 - 1.5) ** 2 / 3) * 0.5, 6);
    expect(soft[2]).toBe(0.5);
    expect(soft[3]).toBeCloseTo(-(1 - (2 - 1.5) ** 2 / 3) * 0.5, 6);
    expect(soft[4]).toBe(-0.5);
    const ex = shape(2, [1, -1]);
    expect(ex[0]).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(ex[1]).toBeCloseTo(Math.exp(-1) - 1, 6);
    expect(shape(3, [-0.3, 0.2])).toEqual([f32(0.3), f32(0.2)]);
    expect(shape(4, [-0.3, 0.2])).toEqual([0, f32(0.2)]);
  });

  it("gains are truncated to whole dB", () => {
    const x = signal("music", 1, 800, 2);
    expect(run("Distortion", x, { input_gain: 6.9, output_gain: -3.2 })).toEqual(run("Distortion", x, { input_gain: 6, output_gain: -3 }));
  });

  it("the tone filter restarts every frame: a block's output does not depend on earlier blocks", () => {
    const x = signal("music", 1, 3200, 6);
    const whole = run("Distortion", x, { tone: 9 }, 48000, 1600);
    const second = run("Distortion", [x[0]!.slice(1600)], { tone: 9 }, 48000, 1600);
    expect(whole[0]!.slice(1600)).toEqual(second[0]);
    const unsplit = run("Distortion", x, { tone: 9 }, 48000, 3200);
    expect(unsplit[0]).not.toEqual(whole[0]);
  });
});

describe("Noise", () => {
  it("level 0 is the float gain 1 − 1/100", () => {
    const x = signal("music", 1, 1000, 1);
    const [y] = run("Noise", x, { level: 0, id: "N" });
    const keep = f32(f32(f32(1) / -100) + 1);
    expect([...y!]).toEqual([...x[0]!].map((v) => f32(keep * v)));
  });

  it("is deterministic per effect id and continuous across blocks", () => {
    const x = signal("music", 2, 3200, 2);
    const a = run("Noise", x, { level: 40, id: "A" });
    expect(run("Noise", x, { level: 40, id: "A" })).toEqual(a);
    expect(run("Noise", x, { level: 40, id: "B" })).not.toEqual(a);
    expect(run("Noise", x, { level: 40, id: "A" }, 48000, 3200)).not.toEqual(a); // channel order of the draws changes
    const gain = a[0]!.map((v, i) => v / x[0]![i]!).filter(Number.isFinite);
    expect(Math.min(...gain)).toBeGreaterThan(0.59 - 1e-6);
    expect(Math.max(...gain)).toBeLessThan(0.99 + 1e-6);
  });
});

describe("Robotization and Whisperization (STFT)", () => {
  it("output starts at the first synthesis position (hop): earlier samples are exactly zero", () => {
    // Robotization 512 / overlap 2 → hop 256; Whisperization 128 / overlap 8 → hop 16. The
    // N-sample latency is the frames' alignment; zero-phase frames spread energy over the frame.
    for (const [type, fft_size, hop] of [["Robotization", 4, 256], ["Whisperization", 2, 16]] as const) {
      const [y] = run(type, signal("music", 1, 2048, 7), { fft_size, id: "S" }, 48000, 256);
      expect(y!.subarray(0, hop).every((v) => v === 0)).toBe(true);
      expect(y![hop]).not.toBe(0);
    }
  });

  it("Robotization reconstructs a DC signal with the rectangular window", () => {
    const [y] = run("Robotization", [new Float32Array(4096).fill(0.25)], { fft_size: 4, hop_size: 0, window_type: 0 }, 48000, 256);
    for (let i = 1024; i < 4096; i += 1) expect(Math.abs(y![i]! - 0.25)).toBeLessThan(1e-6);
  });

  it("Whisperization phases are deterministic per effect id", () => {
    const x = signal("music", 2, 2048, 8);
    const a = run("Whisperization", x, { id: "W1" }, 48000, 256);
    expect(run("Whisperization", x, { id: "W1" }, 48000, 256)).toEqual(a);
    expect(run("Whisperization", x, { id: "W2" }, 48000, 256)).not.toEqual(a);
  });
});

describe("libc rand() and seeds", () => {
  it("matches macOS libc rand()", () => {
    const draws = (seed: number): number[] => {
      const r = new LibcRand(seed);
      return Array.from({ length: 6 }, () => r.next());
    };
    expect(draws(1)).toEqual([16807, 282475249, 1622650073, 984943658, 1144108930, 470211272]);
    expect(draws(0)).toEqual([520932930, 28925691, 822784415, 890459872, 145532761, 2132723841]);
    expect(draws(12345)).toEqual([207482415, 1790989824, 2035175616, 77048696, 24794531, 109854999]);
    expect(draws(0xffffffff)).toEqual(draws(1));
  });

  it("fnv1a32", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });
});

describe("exact fused multiply-adds", () => {
  it("fmaf rounds a*b+c once, even when the double sum lands on a float midpoint", () => {
    const a = 1 + 2 ** -12;
    const b = 1 - 2 ** -12 + 2 ** -24; // a·b = 1 + 2^-36 exactly
    expect(f32(a * b + 2 ** 24)).toBe(16777216); // double rounding: tie to even
    expect(fmaf(a, b, 2 ** 24)).toBe(16777218);
    expect(fmaf(a, b, 2 ** 24 + 4)).toBe(16777222);
    expect(fmaf(-a, b, 2 ** 24 + 4)).toBe(16777218);
    expect(fmaf(0.5, 0.25, 1)).toBe(1.125);
  });

  it("fma64 is the correctly rounded double", () => {
    expect(0.1 * 10 - 1).toBe(0);
    expect(fma64(0.1, 10, -1)).toBe(5.551115123125783e-17);
    expect(fma64(2, 3, 4)).toBe(10);
    expect(fma64(1e308, 10, -1e308)).toBe(Infinity);
    expect(Object.is(fma64(-0, 1, 0), 0)).toBe(true);
  });

  it("f32Fma64 is (float)fma(a, b, c): the double rounding happens first", () => {
    // From Noise: the exact value is 6.5e-19 above a float midpoint.
    expect(f32Fma64(0.000432586669921875, 30, 0.11939392238855362)).toBe(0.13237151503562927);
  });
});
