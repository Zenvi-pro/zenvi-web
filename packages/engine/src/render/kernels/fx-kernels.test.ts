/**
 * AnalogTape, BeatSync and AudioVisualization against libopenshot 1.0
 * (goldens from scripts/parity/kernel_goldens_fx.py). Each case evaluates
 * the effect JSON libopenshot serialized (`evaluateEffectParams`) and runs
 * the kernel on the same premultiplied input and audio.
 */

import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { premultiply, type PremulImage } from "../pixels.js";
import { evaluateEffectParams } from "../plan/effect-params.js";
import { diffBytes, fromBase64 } from "../testing/images.js";
import type { KernelContext, RgbaImage } from "../types.js";
import { analogTape } from "./analog-tape.js";
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

interface Doc {
  images: Record<string, { width: number; height: number; data: string }>;
  audio: { sampleRate: number; length: number; segments: Record<string, number>; data: string };
  base: Record<string, Record<string, unknown>>;
  analogTape: TapeCase[];
}

const doc = goldens as unknown as Doc;

function inflate(b64: string): Uint8Array {
  return new Uint8Array(inflateSync(fromBase64(b64)));
}

function input(name: string): PremulImage {
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
    it(c.name, () => {
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
