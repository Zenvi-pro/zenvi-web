import { describe, expect, it } from "vitest";
import { byteMul, premultiply, wrapPremul } from "../pixels.js";
import { diffBytes, fromBase64 } from "../testing/images.js";
import type { EvaluatedParam, KernelContext, RgbaImage } from "../types.js";
import goldens from "./libopenshot-goldens.json";
import { processEffect } from "./registry.js";

interface GoldenCase {
  type: string;
  input: string;
  frame: number;
  keyframes: Record<string, number>;
  plain: Record<string, EvaluatedParam>;
  colors: Record<string, number[]>;
  mask: string | null;
  width: number;
  height: number;
  data: string;
}

const doc = goldens as unknown as { size: [number, number]; inputs: Record<string, string>; cases: Record<string, GoldenCase> };
const [W, H] = doc.size;

function straightInput(name: string): RgbaImage {
  return { width: W, height: H, data: new Uint8ClampedArray(fromBase64(doc.inputs[name]!)) };
}

/** libopenshot leaves Sharpen's frame in straight ARGB32 (B, G, R, A bytes): convert for comparison. */
function argb32ToPremulRgba(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 4) {
    const a = bytes[i + 3]!;
    out[i] = byteMul(bytes[i + 2]!, a);
    out[i + 1] = byteMul(bytes[i + 1]!, a);
    out[i + 2] = byteMul(bytes[i]!, a);
    out[i + 3] = a;
  }
  return out;
}

describe("effect kernels match libopenshot 1.0 (goldens from scripts/parity/kernel_goldens.py)", () => {
  for (const [name, c] of Object.entries(doc.cases)) {
    it(`${name} (${c.type})`, () => {
      const image = premultiply(straightInput(c.input));
      const params: Record<string, EvaluatedParam> = { ...c.keyframes, ...c.plain };
      for (const [k, v] of Object.entries(c.colors)) params[k] = [v[0]!, v[1]!, v[2]!, v[3] ?? 255];
      const images = new Map<string, RgbaImage>();
      if (c.mask) {
        images.set(`${c.mask}.png`, straightInput(c.mask));
        params.mask_reader = { path: `${c.mask}.png` };
      }
      const ctx: KernelContext = { frame: c.frame, canvasWidth: W, canvasHeight: H, images };
      const out = processEffect(wrapPremul(W, H, image.data), { id: "E1", type: c.type, frame: c.frame, params }, ctx);
      expect([out.width, out.height]).toEqual([c.width, c.height]);
      let expected = fromBase64(c.data);
      if (c.type === "Sharpen") expected = argb32ToPremulRgba(expected);
      const diff = diffBytes(expected, out.data);
      // Bit-exact against the macOS arm64 desktop build.
      expect(diff.maxDiff, `${diff.differing} bytes differ`).toBe(0);
    });
  }
});
