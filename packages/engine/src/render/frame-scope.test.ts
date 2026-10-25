/**
 * analyzeFrameScope against libopenshot 1.0's FrameScope (goldens from
 * scripts/parity/frame_scope_goldens.py): the same premultiplied frames,
 * whole or with a region, give the same histograms, vectorscope, average
 * luma and clipped counts.
 */

import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { analyzeFrameScope } from "./frame-scope.js";
import { wrapPremul } from "./pixels.js";
import { fromBase64 } from "./testing/images.js";
import goldens from "./frame-scope-goldens.json";

interface Case {
  name: string;
  image: string;
  vectorscope_size: number;
  region: [number, number, number, number] | null;
  width: number;
  height: number;
  avg_luma: number;
  clipped_shadows: number;
  clipped_highlights: number;
  luma: number[];
  red: number[];
  green: number[];
  blue: number[];
  vectorscope: string;
}

const images = goldens.images as Record<string, { width: number; height: number; premul: string }>;

function inflate(b64: string): Uint8Array {
  return new Uint8Array(inflateSync(fromBase64(b64)));
}

describe("analyzeFrameScope", () => {
  for (const c of goldens.cases as Case[]) {
    it(`matches libopenshot: ${c.name}`, () => {
      const src = images[c.image]!;
      const image = wrapPremul(src.width, src.height, new Uint8ClampedArray(inflate(src.premul)));
      const region = c.region ? { x: c.region[0], y: c.region[1], width: c.region[2], height: c.region[3] } : undefined;
      const scope = analyzeFrameScope(image, { vectorscopeSize: c.vectorscope_size, ...(region ? { region } : {}) })!;
      expect([scope.width, scope.height]).toEqual([c.width, c.height]);
      expect(Array.from(scope.luma)).toEqual(c.luma);
      expect(Array.from(scope.red)).toEqual(c.red);
      expect(Array.from(scope.green)).toEqual(c.green);
      expect(Array.from(scope.blue)).toEqual(c.blue);
      const vec = inflate(c.vectorscope);
      expect(Array.from(scope.vectorscope)).toEqual(Array.from(new Uint32Array(vec.buffer, vec.byteOffset, vec.byteLength / 4)));
      // The compiled C++ contracts and reorders float math (FMA), so the mean differs in the 9th decimal.
      expect(scope.avgLuma).toBeCloseTo(c.avg_luma, 7);
      expect([scope.clippedShadows, scope.clippedHighlights]).toEqual([c.clipped_shadows, c.clipped_highlights]);
    });
  }

  it("has no picture for an empty frame", () => {
    expect(analyzeFrameScope(wrapPremul(0, 0, new Uint8ClampedArray(0)))).toBeNull();
  });
});
