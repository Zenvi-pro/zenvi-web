import { describe, expect, it } from "vitest";
import { byteMul, createPremul, premultiply, type PremulImage } from "../pixels.js";
import { evaluateEffectParams } from "../plan/effect-params.js";
import { diffBytes, fromBase64 } from "../testing/images.js";
import type { EvaluatedParam, KernelContext, RgbaImage } from "../types.js";
import { displace, displaceMapPath } from "./displace.js";
import { fmaExact, fmaf } from "../qt/fma.js";
import { lensFlare } from "./lens-flare.js";
import goldens from "./light-goldens.json";
import { processEffect, registerKernels } from "./registry.js";
import { glow, shadow } from "./shadow-glow.js";
import { unpremultiplyNeon } from "../qt/convert.js";
import { sphericalProjection } from "./spherical.js";

registerKernels([shadow, glow, lensFlare, displace, sphericalProjection]);

interface GoldenResult {
  frame: number;
  width: number;
  height: number;
  layout: "rgba-premul" | "argb32";
  data: string;
}

interface GoldenCase {
  type: string;
  input: string;
  effect: Record<string, unknown>;
  results: GoldenResult[];
}

interface GoldenInput {
  width: number;
  height: number;
  data: string;
}

const doc = goldens as unknown as { libopenshot: string; inputs: Record<string, GoldenInput>; cases: Record<string, GoldenCase> };

function straight(name: string): RgbaImage {
  const input = doc.inputs[name]!;
  return { width: input.width, height: input.height, data: new Uint8ClampedArray(fromBase64(input.data)) };
}

/** Every fixture image under the name the sanitized reader JSON uses (`<input>.png`). */
const IMAGES: ReadonlyMap<string, RgbaImage> = new Map(Object.keys(doc.inputs).map((name) => [`${name}.png`, straight(name)]));

/** Straight ARGB32 (B, G, R, A bytes) to premultiplied RGBA, as QPainter composites it. */
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

function context(frame: number, image: PremulImage, state?: Map<string, unknown>): KernelContext {
  return { frame, canvasWidth: image.width, canvasHeight: image.height, images: IMAGES, fps: { num: 30, den: 1 }, ...(state ? { state } : {}) };
}

function run(type: string, image: PremulImage, params: Record<string, EvaluatedParam>, frame = 1, state?: Map<string, unknown>): PremulImage {
  return processEffect(image, { id: "K2LIGHT1", type, frame, params }, context(frame, image, state));
}

describe("light kernels match libopenshot 1.0 (goldens from scripts/parity/kernel_goldens_light.py)", () => {
  for (const [name, c] of Object.entries(doc.cases)) {
    it(`${name} (${c.type})`, () => {
      // One effect instance per case: SphericalProjection keeps its UV map across frames.
      const state = new Map<string, unknown>();
      for (const r of c.results) {
        const image = premultiply(straight(c.input));
        const params = evaluateEffectParams(c.effect, r.frame);
        const out = processEffect(image, { id: "K2LIGHT1", type: c.type, frame: r.frame, params }, context(r.frame, image, state));
        expect([out.width, out.height]).toEqual([r.width, r.height]);
        let expected = fromBase64(r.data);
        if (r.layout === "argb32") expected = argb32ToPremulRgba(expected);
        const diff = diffBytes(expected, out.data);
        // Bit-exact against the macOS arm64 desktop build.
        expect(diff.maxDiff, `frame ${r.frame}: ${diff.differing} bytes differ`).toBe(0);
      }
    });
  }
});

describe("float helpers", () => {
  it("fmaf rounds once when the double sum lands on a float midpoint", () => {
    // a*b = 2^-24 + 2^-57: the exact sum with 1 lies just above the midpoint between 1 and 1 + 2^-23.
    const a = 1 + 2 ** -11;
    const b = 2 ** -24 * (1 - 2 ** -11 + 2 ** -22);
    expect(Math.fround(a * b + 1)).toBe(1);
    expect(fmaf(a, b, 1)).toBe(1 + 2 ** -23);
    expect(fmaf(-a, b, -1)).toBe(-(1 + 2 ** -23));
    expect(fmaf(0.5, 3, 0.25)).toBe(1.75);
  });

  it("fmaExact keeps the low product bits a double multiply drops", () => {
    const x = 1 + 2 ** -30;
    expect(x * x - 1).toBe(2 ** -29);
    expect(fmaExact(x, x, -1)).toBe(2 ** -29 + 2 ** -60);
    // Cancellation: the fused result is the product's rounding error, which Dekker's
    // two-product recovers exactly from double operations.
    const p = 0.1 * 0.7;
    const split = (v: number): [number, number] => {
      const t = 134217729 * v;
      const hi = t - (t - v);
      return [hi, v - hi];
    };
    const [ah, al] = split(0.1);
    const [bh, bl] = split(0.7);
    const err = ah * bh - p + ah * bl + al * bh + al * bl;
    expect(err).not.toBe(0);
    expect(fmaExact(0.1, 0.7, -p)).toBe(err);
    expect(fmaExact(3, 4, 5)).toBe(17);
    expect(fmaExact(0, 4, 5)).toBe(5);
    expect(fmaExact(2, 3, 0)).toBe(6);
  });
});

describe("unpremultiplyNeon (Qt RGBA8888_Premultiplied -> ARGB32 on arm64)", () => {
  function convert(width: number, pixels: number[][]): number[][] {
    const img = createPremul(width, 1);
    pixels.forEach((p, i) => img.data.set(p, i * 4));
    const out = unpremultiplyNeon(img);
    return pixels.map((_, i) => Array.from(out.subarray(i * 4, i * 4 + 4)));
  }

  it("takes the reciprocal-estimate path in groups of four and the exact path in the row tail", () => {
    // (c, a) = (1, 2): 127.5 rounds to 127 through FRECPE + one Newton step, 128 in qUnpremultiply.
    const px = [1, 1, 1, 2];
    expect(convert(4, [px, px, px, px])).toEqual([[127, 127, 127, 2], [127, 127, 127, 2], [127, 127, 127, 2], [127, 127, 127, 2]]);
    expect(convert(5, [px, px, px, px, px])[4]).toEqual([128, 128, 128, 2]);
    expect(convert(4, [[1, 0, 1, 6], [1, 1, 1, 10], [0, 0, 0, 0], [200, 9, 0, 255]])).toEqual([[42, 0, 42, 6], [25, 25, 25, 10], [0, 0, 0, 0], [200, 9, 0, 255]]);
  });

  it("copies opaque groups and zeroes transparent ones", () => {
    expect(convert(4, [[9, 8, 7, 255], [1, 2, 3, 255], [4, 5, 6, 255], [7, 8, 9, 255]])[1]).toEqual([1, 2, 3, 255]);
    expect(convert(4, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]])[2]).toEqual([0, 0, 0, 0]);
  });
});

describe("Shadow and Glow on images smaller than the blur window", () => {
  // libopenshot reads past the row here (undefined behavior); the port clamps to the edge.
  it("keeps a uniform layer uniform", () => {
    const image = createPremul(6, 5);
    for (let i = 0; i < image.data.length; i += 4) image.data.set([40, 80, 120, 160], i);
    const out = run("Glow", image, { blur_radius: 20, spread: 0.3, opacity: 1, color: [255, 0, 0, 255] });
    const first = Array.from(out.data.subarray(0, 4));
    for (let i = 0; i < out.data.length; i += 4) expect(Array.from(out.data.subarray(i, i + 4))).toEqual(first);
  });

  it("produces a symmetric shadow for a symmetric shape", () => {
    const image = createPremul(7, 7);
    image.data.set([255, 255, 255, 255], (3 * 7 + 3) * 4);
    const out = run("Shadow", image, { blur_radius: 9, distance: 0, spread: 0, opacity: 1, color: [0, 0, 0, 255] });
    for (let y = 0; y < 7; y += 1) {
      for (let x = 0; x < 7; x += 1) {
        const a = out.data[(y * 7 + x) * 4 + 3];
        expect(out.data[(y * 7 + (6 - x)) * 4 + 3]).toBe(a);
        expect(out.data[((6 - y) * 7 + x) * 4 + 3]).toBe(a);
      }
    }
  });
});

describe("Displace map reader", () => {
  it("prefers a present map_reader, even an empty one, over the legacy reader", () => {
    expect(displaceMapPath({ map_reader: { path: "a.png" }, reader: { path: "b.png" } })).toBe("a.png");
    expect(displaceMapPath({ map_reader: {}, reader: { path: "b.png" } })).toBeUndefined();
    expect(displaceMapPath({ reader: { path: "b.png" } })).toBe("b.png");
    expect(displaceMapPath({})).toBeUndefined();
  });

  it("leaves the frame alone without a loaded map", () => {
    const image = premultiply(straight("photo"));
    const before = new Uint8ClampedArray(image.data);
    run("Displace", image, { map_reader: { path: "missing.png" } });
    expect(diffBytes(before, image.data).maxDiff).toBe(0);
  });
});

describe("SphericalProjection UV cache", () => {
  it("reuses the map for sub-microradian angle changes and rebuilds it otherwise", () => {
    const state = new Map<string, unknown>();
    const frame = (yaw: number): void => {
      run("SphericalProjection", premultiply(straight("pano")), { yaw, interpolation: 1 }, 1, state);
    };
    frame(30);
    const first = state.get("SphericalProjection.uv");
    expect(first).toBeDefined();
    frame(30.000025);
    expect(state.get("SphericalProjection.uv")).toBe(first);
    frame(31);
    expect(state.get("SphericalProjection.uv")).not.toBe(first);
  });

  it("works without renderer state and returns valid premultiplied pixels", () => {
    const out = run("SphericalProjection", premultiply(straight("pano-alpha")), { yaw: 5 });
    expect([out.width, out.height]).toEqual([30, 20]);
    for (let i = 0; i < out.data.length; i += 4) {
      const a = out.data[i + 3]!;
      expect(Math.max(out.data[i]!, out.data[i + 1]!, out.data[i + 2]!)).toBeLessThanOrEqual(a);
    }
  });
});
