import { describe, expect, it } from "vitest";
import { num } from "../kernels/params.js";
import { evaluateEffectParams } from "../plan/effect-params.js";
import { fromBase64 } from "../testing/images.js";
import { exp10f, expf, powf } from "./apple-libm.js";
import goldens from "./audio-goldens.json";
import { fnv1a32, LibcRand } from "./libc-rand.js";
import { noiseBlock } from "./noise.js";
import { getAudioKernel } from "./registry.js";
import { diffSamples, signal, type SignalKind } from "./testing.js";

interface GoldenCase {
  type: string;
  signal: SignalKind;
  seed: number;
  channels: number;
  sampleRate: number;
  fps: [number, number];
  frameSizes: number[];
  effect: Record<string, unknown>;
  /** `SetJson` calls made before a frame (mid-stream property edits). */
  updates?: { frame: number; json: Record<string, unknown> }[];
  output: string;
  noiseSeeds?: number[];
  srand?: number;
}

const doc = goldens as unknown as {
  libopenshot: string;
  libm: Record<"expf" | "exp10f" | "powf", string[]>;
  cases: Record<string, GoldenCase>;
};

/**
 * Max |error| allowed per effect type. Everything else must be bit-exact.
 * The FFT effects differ by the desktop FFT's rounding: Apple vDSP's float32
 * butterflies vs the kernels' double-precision FFT (fft.ts). Measured: at
 * most 1.2e-7 (Robotization) and 6e-8 (Whisperization).
 */
const TOLERANCE: Record<string, number> = { Robotization: 1e-6, Whisperization: 1e-6 };

function floats(b64: string): Float32Array {
  const bytes = fromBase64(b64);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

/** Run a case frame by frame like `Clip::apply_effects`; returns the output in the fixture layout. */
function replay(c: GoldenCase): Float32Array {
  const total = c.frameSizes.reduce((a, b) => a + b, 0);
  const input = signal(c.signal, c.channels, total, c.seed);
  const kernel = getAudioKernel(c.type);
  if (!kernel) throw new Error(`no kernel for ${c.type}`);
  const state = new Map<string, unknown>();
  const out = new Float32Array(total * c.channels);
  let effect = c.effect;
  let offset = 0;
  let o = 0;
  c.frameSizes.forEach((size, index) => {
    const frame = index + 1;
    const update = c.updates?.find((u) => u.frame === frame);
    if (update) effect = { ...effect, ...update.json };
    const block = input.map((ch) => ch.slice(offset, offset + size));
    const params = evaluateEffectParams(effect, frame);
    if (c.type === "Noise") {
      // libopenshot reseeds rand() with time(NULL) every frame; the fixture recorded the seconds.
      noiseBlock(block, Math.trunc(num(params, "level", 30)), new LibcRand(c.noiseSeeds![index]));
    } else {
      // ParametricEQ: the desktop passes the frame's sample count as the sample rate (ParametricEQ.cpp:64).
      kernel(block, c.type === "ParametricEQ" ? size : c.sampleRate, params, state);
    }
    for (const ch of block) {
      out.set(ch, o);
      o += size;
    }
    offset += size;
  });
  return out;
}

describe(`audio kernels match libopenshot ${doc.libopenshot} (goldens from scripts/parity/audio_goldens.py)`, () => {
  for (const [name, c] of Object.entries(doc.cases)) {
    it(`${name} (${c.type})`, () => {
      const expected = floats(c.output);
      const actual = replay(c);
      const diff = diffSamples(expected, actual);
      const tolerance = TOLERANCE[c.type];
      const summary = `${diff.differing}/${expected.length} samples differ, max |error| ${diff.maxAbs}`;
      if (tolerance === undefined) expect(diff.differing, summary).toBe(0);
      else expect(diff.maxAbs, summary).toBeLessThan(tolerance);
    });
  }

  it("Whisperization's srand seed is fnv1a32(effect id), as the kernel seeds itself", () => {
    for (const c of Object.values(doc.cases)) {
      if (c.type === "Whisperization") expect(c.srand).toBe(fnv1a32(String(c.effect.id)));
    }
  });
});

describe("apple-libm ports match the macOS system functions bit for bit", () => {
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  const value = (row: string, i: number): number => {
    u[0] = Number.parseInt(row.slice(8 * i, 8 * i + 8), 16);
    return f[0]!;
  };
  const bits = (x: number): number => {
    f[0] = x;
    return u[0]!;
  };
  const check = (name: string, rows: string[], fn: (...args: number[]) => number, arity: number): void => {
    const bad: string[] = [];
    for (const row of rows) {
      const args = Array.from({ length: arity }, (_, i) => value(row, i));
      const want = value(row, arity);
      const got = fn(...args);
      if (!(Number.isNaN(want) && Number.isNaN(got)) && bits(got) !== bits(want)) bad.push(`${name}(${args.join(", ")}) = ${got}, want ${want}`);
    }
    expect(bad.slice(0, 5), `${bad.length} of ${rows.length} differ`).toEqual([]);
  };
  it("expf", () => check("expf", doc.libm.expf, expf, 1));
  it("__exp10f", () => check("exp10f", doc.libm.exp10f, exp10f, 1));
  it("powf", () => check("powf", doc.libm.powf, powf, 2));
});
