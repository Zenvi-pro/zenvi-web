import { describe, expect, it } from "vitest";
import { assembleAt, hitCamera, hitEnvelope, hitFinish, HIT_LOOKS, noise1, polylineTo, shapeParticles, stamp, subframeTimes } from "./kinetic.js";

describe("hits", () => {
  const hits = [{ t: 1, strength: 1 }, { t: 2, strength: 1.35, shake: 20 }];

  it("decay from the frame they land on and stop counting after 1.2 s", () => {
    expect(hitEnvelope(hits, 0.99, 7)).toBe(0);
    expect(hitEnvelope(hits, 1, 7)).toBe(1);
    expect(hitEnvelope(hits, 1.1, 7)).toBeCloseTo(Math.exp(-0.7), 6);
    expect(hitEnvelope([{ t: 0, strength: 1 }], 1.2, 7)).toBe(0);
  });

  it("punch the camera in and shake only the hits that carry a shake", () => {
    const calm = hitCamera(hits, 1.02, 0.05);
    expect(calm.zoom).toBeGreaterThan(1.04);
    expect(calm.x).toBe(0);
    const climax = hitCamera(hits, 2.03, 0.05);
    expect(Math.hypot(climax.x, climax.y)).toBeGreaterThan(5);
    expect(hitCamera(hits, 5, 0.05)).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  it("flash for a few frames while the aberration and bloom linger", () => {
    const at = (t: number): ReturnType<typeof hitFinish> => hitFinish(hits, t, HIT_LOOKS.punchy, 0.5);
    expect(at(1).flash).toBeCloseTo(0.3, 6);
    expect(at(1.2).flash).toBeLessThan(0.01);
    expect(at(1.2).chroma).toBeGreaterThan(at(5).chroma);
    expect(at(5).chroma).toBeCloseTo(1.6 / 960, 9);
    expect(at(5).bloom).toBeCloseTo(0.36, 6);
  });
});

describe("sub-frames", () => {
  it("spread over the shutter around the frame time", () => {
    const ts = subframeTimes(1, 4, 0.6, 30, 0, 2);
    expect(ts).toHaveLength(4);
    expect(Math.max(...ts) - Math.min(...ts)).toBeCloseTo((0.6 / 30) * 0.75, 9);
    expect(ts.reduce((a, b) => a + b, 0) / 4).toBeCloseTo(1, 9);
  });

  it("never cross the shot's cut", () => {
    for (const t of subframeTimes(1, 8, 1, 30, 1, 1.5)) expect(t).toBeGreaterThanOrEqual(1);
    for (const t of subframeTimes(1.5 - 1e-3, 8, 1, 30, 1, 1.5)) expect(t).toBeLessThan(1.5);
  });
});

describe("parts", () => {
  it("stamp from (1 + k) to rest", () => {
    expect(stamp(0)).toBeCloseTo(2.2, 6);
    expect(stamp(0.28)).toBe(1);
  });

  it("smooth noise stays in [-1, 1] and is the same for the same input", () => {
    for (let x = 0; x < 20; x += 0.37) {
      expect(Math.abs(noise1(x, 3))).toBeLessThanOrEqual(1);
      expect(noise1(x, 3)).toBe(noise1(x, 3));
    }
  });

  it("cut a polyline by length", () => {
    const pts = [[0, 0], [10, 0], [10, 10]] as const;
    expect(polylineTo(pts, 0.25).head).toEqual([5, 0]);
    expect(polylineTo(pts, 0.75).pts).toEqual([[0, 0], [10, 0], [10, 5]]);
    expect(polylineTo(pts, 1).head).toEqual([10, 10]);
  });

  it("sample particles inside a mask and land them on their targets", () => {
    const side = 20;
    // A filled square in the middle: every target lies inside it.
    const mask = Array.from({ length: side * side }, (_, k) => (k % side >= 5 && k % side < 15 && Math.floor(k / side) >= 5 && Math.floor(k / side) < 15 ? 1 : 0));
    const pts = shapeParticles(mask, side, 200, 7);
    expect(pts).toHaveLength(200);
    expect(shapeParticles(mask, side, 200, 7)).toEqual(pts);
    for (const p of pts) {
      const end = assembleAt(p, 3, 100);
      expect(end.settled).toBe(1);
      expect(Math.abs(end.x)).toBeLessThanOrEqual(51);
      expect(Math.abs(end.y)).toBeLessThanOrEqual(51);
    }
    expect(shapeParticles(new Array(side * side).fill(0), side, 10, 1)).toEqual([]);
  });
});
