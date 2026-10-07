import { describe, expect, it } from "vitest";
import { wrapPremul } from "../pixels.js";
import { evaluateEffectParams } from "../plan/effect-params.js";
import { diffBytes, fromBase64 } from "../testing/images.js";
import type { KernelContext } from "../types.js";
import goldens from "./color-goldens.json";
import { appleExp2f, colorGrade, qColorFromString } from "./color-grade.js";
import { colorMap } from "./color-map.js";
import { cachedCubeLut, parseCubeLut, qtToFloat, qtToInt } from "./cube-lut.js";
import { denoiseImage } from "./denoise.js";
import { filmGrain, fnv1a } from "./film-grain.js";
import { processEffect, registerKernels } from "./registry.js";

interface GoldenStep {
  input: string;
  frame: number;
  width: number;
  height: number;
  data?: string;
  unchanged?: boolean;
}

interface GoldenCase {
  type: string;
  patch: unknown;
  context: { timelineWidth?: number; timelineHeight?: number };
  steps: GoldenStep[];
}

type JsonNumber = number | "inf" | "-inf" | "nan";

interface GoldenDoc {
  inputs: Record<string, { width: number; height: number; data: string }>;
  texts: Record<string, string>;
  defaults: Record<string, Record<string, unknown>>;
  cases: Record<string, GoldenCase>;
  vectors: {
    exp2f: [number, number, boolean][];
    qtToFloat: Record<string, JsonNumber>;
    qtToInt: Record<string, number>;
    qcolor: Record<string, [number, number, number, number] | null>;
  };
}

const doc = goldens as unknown as GoldenDoc;
const texts = new Map(Object.entries(doc.texts));

// The kernels run through the planner's entry point, like production frames.
registerKernels([colorMap, colorGrade, filmGrain, denoiseImage]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** RFC 7386 JSON merge patch, as the generator applies it before `SetJson`. */
function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isRecord(patch)) return patch;
  const out: Record<string, unknown> = isRecord(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}

function fromJsonNumber(v: JsonNumber): number {
  return v === "inf" ? Infinity : v === "-inf" ? -Infinity : v === "nan" ? NaN : v;
}

describe("color kernels match libopenshot 1.0 (goldens from scripts/parity/kernel_goldens_color.py)", () => {
  for (const [name, c] of Object.entries(doc.cases)) {
    it(`${name} (${c.type})`, () => {
      const json = mergePatch(doc.defaults[c.type], c.patch) as Record<string, unknown>;
      const id = String(json.id);
      // One state map per case: the steps run on one effect instance, in order.
      const state = new Map<string, unknown>();
      for (const step of c.steps) {
        const input = doc.inputs[step.input]!;
        const bytes = fromBase64(input.data);
        const image = wrapPremul(input.width, input.height, new Uint8ClampedArray(bytes));
        const params = evaluateEffectParams(json, step.frame);
        const ctx: KernelContext = {
          frame: step.frame,
          canvasWidth: input.width,
          canvasHeight: input.height,
          images: new Map(),
          texts,
          effectId: id,
          state,
          ...c.context,
        };
        const out = processEffect(image, { id, type: c.type, frame: step.frame, params }, ctx);
        expect([out.width, out.height]).toEqual([step.width, step.height]);
        const expected = step.unchanged ? bytes : fromBase64(step.data!);
        const diff = diffBytes(expected, out.data);
        // Bit-exact against the macOS arm64 desktop build.
        expect(diff.maxDiff, `frame ${step.frame}: ${diff.differing} bytes differ`).toBe(0);
      }
    });
  }
});

describe("appleExp2f", () => {
  it("matches macOS libm exp2f bit for bit, including its incorrectly rounded results", () => {
    const vectors = doc.vectors.exp2f;
    expect(vectors.filter((v) => v[2]).length).toBeGreaterThan(5);
    for (const [x, y] of vectors) expect(appleExp2f(x), `exp2f(${x})`).toBe(y);
  });

  it("is exact at integers", () => {
    for (let k = -4; k <= 4; k += 1) expect(appleExp2f(k)).toBe(2 ** k);
  });
});

describe("Qt parsing helpers", () => {
  it("qtToFloat / qtToInt match QLocale::c()", () => {
    for (const [token, value] of Object.entries(doc.vectors.qtToFloat)) {
      expect(qtToFloat(token), JSON.stringify(token)).toBe(fromJsonNumber(value));
    }
    for (const [token, value] of Object.entries(doc.vectors.qtToInt)) {
      expect(qtToInt(token), JSON.stringify(token)).toBe(value);
    }
  });

  it("qColorFromString matches QColor(QString)", () => {
    for (const [name, rgba] of Object.entries(doc.vectors.qcolor)) {
      expect(qColorFromString(name), JSON.stringify(name)).toEqual(rgba ?? undefined);
    }
  });
});

describe("cube LUT parsing", () => {
  it("reads LUT_3D_INPUT_RANGE after the size line as the first entry (libopenshot quirk)", () => {
    const lut = parseCubeLut(doc.texts["warm5.cube"]!)!;
    expect(lut.kind).toBe("3d");
    expect(lut.size).toBe(5);
    expect([...lut.data.slice(0, 3)]).toEqual([0, 0, 1]);
  });

  it("keeps a DOMAIN line seen by the failed 3D pass, even after the 1D data", () => {
    const lut = parseCubeLut(doc.texts["curve9-1d.cube"]!)!;
    expect(lut.kind).toBe("1d");
    expect(lut.size).toBe(9);
    expect(lut.domainMax).toEqual([Math.fround(1.1), 1, Math.fround(0.9)]);
  });

  it("rejects short data and absurd sizes without allocating", () => {
    expect(parseCubeLut(doc.texts["bad.cube"]!)).toBeNull();
    expect(parseCubeLut("LUT_3D_SIZE 900\n0 0 0\n")).toBeNull();
    expect(parseCubeLut("LUT_1D_SIZE 0\n")).toBeNull();
    expect(parseCubeLut("")).toBeNull();
  });

  it("caches by text", () => {
    const text = doc.texts["domain3.cube"]!;
    expect(cachedCubeLut(text)).toBe(cachedCubeLut(text));
  });
});

describe("FilmGrain seed hashing", () => {
  it("is FNV-1a over UTF-8", () => {
    expect(fnv1a("")).toBe(2166136261);
    expect(fnv1a("a")).toBe(0xe40c292c);
    expect(fnv1a("foobar")).toBe(0xbf9cf968);
    expect(fnv1a("é")).toBe(Math.imul(Math.imul(2166136261 ^ 0xc3, 16777619) ^ 0xa9, 16777619) >>> 0);
  });
});
