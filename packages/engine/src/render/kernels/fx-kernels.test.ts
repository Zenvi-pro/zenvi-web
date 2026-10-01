/**
 * AnalogTape, BeatSync and AudioVisualization against libopenshot 1.0
 * (goldens from scripts/parity/kernel_goldens_fx.py). Each case evaluates
 * the effect JSON libopenshot serialized (`evaluateEffectParams`) and runs
 * the kernel on the same premultiplied input and audio.
 */

import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createPremul, fillPremul, premultiply, type PremulImage } from "../pixels.js";
import { evaluateEffectParams } from "../plan/effect-params.js";
import { diffBytes, fromBase64, type ImageDiff } from "../testing/images.js";
import type { KernelAudio, KernelContext, RgbaImage } from "../types.js";
import { analogTape } from "./analog-tape.js";
import { audioVisualization } from "./audio-visualization.js";
import { mt19937Floats } from "./audio-visualization-analysis.js";
import { beatSync } from "./beat-sync.js";
import goldens from "./fx-goldens.json";

interface TapeCase {
  name: string;
  input: string;
  frame: number;
  timeline: [number, number] | null;
  fps: [number, number] | null;
  json: Record<string, unknown>;
  width: number;
  height: number;
  out: string;
}

interface BeatStep {
  frame: number;
  /** [offset, count, channels] into the decoded audio, or null for a frame without audio. */
  audio: [number, number, number] | null;
  width: number;
  height: number;
  color: [number, number, number, number];
}

interface BeatCase {
  name: string;
  input: string;
  timeline: [number, number] | null;
  json: Record<string, unknown>;
  steps: BeatStep[];
}

interface AvCase {
  name: string;
  input: string;
  frame: number;
  audio: [number, number, number] | null;
  timeline: [number, number] | null;
  json: Record<string, unknown>;
  width: number;
  height: number;
  out: string;
}

interface Doc {
  images: Record<string, { width: number; height: number; data: string }>;
  audio: { sampleRate: number; length: number; segments: Record<string, number>; data: string };
  base: Record<string, Record<string, unknown>>;
  analogTape: TapeCase[];
  beatSync: BeatCase[];
  audioVisualization: AvCase[];
}

const doc = goldens as unknown as Doc;

/**
 * Golden cases are deterministic, but the heavy ones (the exact double-FMA
 * spectrum DFT, 1280 radial-gradient particles) take ~1 s alone and can pass
 * vitest's 5 s default when the whole engine project runs in parallel.
 */
const HEAVY_CASE_TIMEOUT_MS = 60_000;

function inflate(b64: string): Uint8Array {
  return new Uint8Array(inflateSync(fromBase64(b64)));
}

/** The decoded test WAV as planar floats (exactly s16 / 32768, as FFmpegReader decodes it). */
const PCM: Float32Array[] = (() => {
  const bytes = inflate(doc.audio.data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = doc.audio.length;
  const planes = [new Float32Array(n), new Float32Array(n)];
  for (let c = 0; c < 2; c += 1) for (let i = 0; i < n; i += 1) planes[c]![i] = view.getInt16((c * n + i) * 2, true) / 32768;
  return planes;
})();

function audioSlice(spec: [number, number, number] | null): KernelAudio | undefined {
  if (!spec) return undefined;
  const [offset, count, channels] = spec;
  return { sampleRate: doc.audio.sampleRate, channels: PCM.slice(0, channels).map((p) => p.slice(offset, offset + count)) };
}

function input(name: string): PremulImage {
  if (name === "pixel") {
    // openshot::Frame(1, 1, 1, "#000000"): one opaque black pixel.
    const px = createPremul(1, 1);
    fillPremul(px, 0, 0, 0, 255);
    return px;
  }
  const img = doc.images[name]!;
  const straight: RgbaImage = { width: img.width, height: img.height, data: new Uint8ClampedArray(fromBase64(img.data)) };
  return premultiply(straight);
}

function params(type: string, json: Record<string, unknown>, frame: number): ReturnType<typeof evaluateEffectParams> {
  return evaluateEffectParams({ ...doc.base[type]!, ...json }, frame);
}

function baseContext(frame: number, width: number, height: number, effectId: unknown): KernelContext {
  return { frame, canvasWidth: width, canvasHeight: height, images: new Map(), effectId: typeof effectId === "string" ? effectId : "" };
}

describe("AnalogTape matches libopenshot 1.0", () => {
  for (const c of doc.analogTape) {
    it(c.name, { timeout: HEAVY_CASE_TIMEOUT_MS }, () => {
      const image = input(c.input);
      const ctx = baseContext(c.frame, image.width, image.height, c.json.id);
      if (c.timeline) {
        ctx.timelineWidth = c.timeline[0];
        ctx.timelineHeight = c.timeline[1];
      }
      if (c.fps) ctx.fps = { num: c.fps[0], den: c.fps[1] };
      const out = analogTape.run(image, params("AnalogTape", c.json, c.frame), ctx) ?? image;
      expect([out.width, out.height]).toEqual([c.width, c.height]);
      const diff = diffBytes(inflate(c.out), out.data);
      expect(diff.maxDiff, `${diff.differing} bytes differ`).toBe(0);
    });
  }
});

describe("BeatSync matches libopenshot 1.0 (stateful sequences)", () => {
  for (const c of doc.beatSync) {
    it(c.name, () => {
      const state = new Map<string, unknown>();
      for (const step of c.steps) {
        const image = input(c.input);
        const ctx = baseContext(step.frame, image.width, image.height, c.json.id);
        if (c.timeline) {
          ctx.timelineWidth = c.timeline[0];
          ctx.timelineHeight = c.timeline[1];
        }
        ctx.audio = audioSlice(step.audio);
        ctx.state = state;
        const out = beatSync.run(image, params("BeatSync", c.json, step.frame), ctx) ?? image;
        expect([out.width, out.height], `frame ${step.frame} size`).toEqual([step.width, step.height]);
        const expected = new Uint8Array(out.data.length);
        for (let i = 0; i < expected.length; i += 4) expected.set(step.color, i);
        const diff = diffBytes(expected, out.data);
        expect(diff.maxDiff, `frame ${step.frame}: got ${Array.from(out.data.subarray(0, 4)).join(",")} want ${step.color.join(",")}`).toBe(0);
      }
    });
  }

  it("starts every frame from a fresh envelope without ctx.state", () => {
    const c = doc.beatSync[0]!;
    const step = c.steps[0]!;
    const image = input(c.input);
    const ctx = baseContext(step.frame, image.width, image.height, c.json.id);
    ctx.audio = audioSlice(step.audio);
    const a = beatSync.run(image, params("BeatSync", c.json, step.frame), ctx) as PremulImage;
    const b = beatSync.run(image, params("BeatSync", c.json, step.frame), ctx) as PremulImage;
    expect(Array.from(a.data.subarray(0, 4))).toEqual(step.color);
    expect(Array.from(b.data.subarray(0, 4))).toEqual(step.color);
  });
});

describe("AudioVisualization against libopenshot 1.0", () => {
  for (const c of doc.audioVisualization) {
    it(c.name, { timeout: HEAVY_CASE_TIMEOUT_MS }, () => {
      const image = input(c.input);
      const ctx = baseContext(c.frame, image.width, image.height, c.json.id);
      if (c.timeline) {
        ctx.timelineWidth = c.timeline[0];
        ctx.timelineHeight = c.timeline[1];
      }
      ctx.audio = audioSlice(c.audio);
      const out = audioVisualization.run(image, params("AudioVisualization", c.json, c.frame), ctx) ?? image;
      expect([out.width, out.height]).toEqual([c.width, c.height]);
      const diff: ImageDiff = diffBytes(inflate(c.out), out.data);
      // Bit-exact against the macOS arm64 desktop build, antialiased strokes included.
      expect(diff.maxDiff, `${diff.differing} bytes differ (PSNR ${diff.psnr.toFixed(1)} dB)`).toBe(0);
    });
  }
});

describe("AudioVisualization particle randomness", () => {
  it("draws std::mt19937 + uniform_real_distribution<float> like libc++", () => {
    // Particle 0 is seeded with (0 + 1) * 747796405 (AudioVisualization.cpp:839-844).
    const draws = mt19937Floats(747796405, 4).map((v) => v.toPrecision(9));
    expect(draws).toEqual(["0.823273182", "0.855387032", "0.789077044", "0.333694041"]);
  });
});
