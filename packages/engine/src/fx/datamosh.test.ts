import { describe, expect, it } from "vitest";
import { estimateFlow, flowSpeed, moshEase, moshMaps, MAX_DISPLACE, type FlowField, type GrayFrame } from "./datamosh.js";

/** Deterministic texture: a hash of the pixel, so every block is unique and matches only itself. */
function texture(x: number, y: number): number {
  let h = Math.imul(x + 1013, 374761393) ^ Math.imul(y + 7919, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) & 255;
}

/** A frame whose content has moved by (sx, sy) pixels per frame, `t` frames in. */
function moving(t: number, sx: number, sy: number, width = 96, height = 64): GrayFrame {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = texture(x - sx * t, y - sy * t);
  return { width, height, data };
}

const median = (values: ArrayLike<number>) => [...Array.from(values)].sort((a, b) => a - b)[values.length >> 1]!;

describe("estimateFlow", () => {
  it("measures the motion between frames: content moving right and down is positive", () => {
    const flow = estimateFlow([0, 1, 2, 3, 4].map((t) => moving(t, 3, 1)));
    expect(flow.cols).toBe(12);
    expect(flow.rows).toBe(8);
    expect(median(flow.dx)).toBeCloseTo(3, 0);
    expect(median(flow.dy)).toBeCloseTo(1, 0);
    expect(flowSpeed(flow)).toBeGreaterThan(2.5);
  });

  it("reads leftward motion as negative", () => {
    const flow = estimateFlow([0, 1, 2].map((t) => moving(t, -4, 0)));
    expect(median(flow.dx)).toBeCloseTo(-4, 0);
    expect(median(flow.dy)).toBeCloseTo(0, 0);
  });

  it("finds no motion in a still or a flat picture", () => {
    expect(flowSpeed(estimateFlow([moving(0, 0, 0), moving(0, 0, 0), moving(0, 0, 0)]))).toBe(0);
    const flat: GrayFrame = { width: 64, height: 48, data: new Uint8Array(64 * 48).fill(90) };
    expect(flowSpeed(estimateFlow([flat, flat, flat]))).toBe(0);
  });

  it("refuses a single frame or frames of different sizes", () => {
    expect(() => estimateFlow([moving(0, 1, 0)])).toThrow(/at least two frames/);
    expect(() => estimateFlow([moving(0, 1, 0), moving(0, 1, 0, 48, 32)])).toThrow(/differ in size/);
  });
});

describe("moshMaps", () => {
  const flow = (dx: number, dy = 0): FlowField => ({ width: 320, height: 180, block: 8, cols: 40, rows: 22, dx: new Float32Array(40 * 22).fill(dx), dy: new Float32Array(40 * 22).fill(dy) });
  const size = { width: 640, height: 360 };

  it("draws one map per frame, a pixel per block, 128 meaning no move", () => {
    const maps = moshMaps(flow(0), size, { frames: 6, block: 32, amount: 0.6 });
    expect([maps.cols, maps.rows, maps.x.length, maps.y.length]).toEqual([20, 12, 6, 6]);
    expect(maps.x[0]!.length).toBe(20 * 12);
    expect(new Set(maps.x.flatMap((m) => [...m]))).toEqual(new Set([128]));
  });

  it("keeps moving content moving: rightward flow pulls from the left (below 128), growing each frame", () => {
    const maps = moshMaps(flow(4), size, { frames: 12, block: 32, amount: 0.5 });
    // 4 px at 320 wide is 8 px at 640, times the gain 0.6 + 1.6 × 0.5.
    expect(128 - maps.x[0]![50]!).toBe(11);
    expect(128 - maps.x[1]![50]!).toBeGreaterThan(128 - maps.x[0]![50]!);
    expect(new Set(maps.y[3]!)).toEqual(new Set([128]));
  });

  it("lands clean: the push eases to nothing by the last frame", () => {
    const maps = moshMaps(flow(4, -2), size, { frames: 10, block: 32, amount: 1 });
    expect(new Set(maps.x[9]!)).toEqual(new Set([128]));
    expect(new Set(maps.y[9]!)).toEqual(new Set([128]));
    expect(moshEase(0, 10)).toBe(1);
    expect(moshEase(9, 10)).toBe(0);
    const eases = Array.from({ length: 10 }, (_, n) => moshEase(n, 10));
    expect(eases.every((e, i) => i === 0 || e <= eases[i - 1]!)).toBe(true);
  });

  it("stays inside what a displace map can hold, however fast the footage was", () => {
    const maps = moshMaps(flow(-60, 60), size, { frames: 20, block: 16, amount: 1 });
    for (const m of [...maps.x, ...maps.y]) for (const v of m) expect(Math.abs(v - 128)).toBeLessThanOrEqual(MAX_DISPLACE);
    // Content racing left pulls from the right (up to 255), content racing down from above (down to 1).
    expect(Math.max(...maps.x.flatMap((m) => [...m]))).toBe(128 + MAX_DISPLACE);
    expect(Math.min(...maps.y.flatMap((m) => [...m]))).toBe(128 - MAX_DISPLACE);
  });

  it("tears where neighbouring blocks move differently", () => {
    const f = flow(0);
    for (let r = 0; r < f.rows; r++) for (let c = 20; c < f.cols; c++) f.dx[r * f.cols + c] = 6;
    const maps = moshMaps(f, size, { frames: 8, block: 32, amount: 0.6 });
    const row = (m: Uint8Array, r: number) => [...m.slice(r * maps.cols, (r + 1) * maps.cols)];
    const early = row(maps.x[2]!, 5);
    expect(early[0]).toBe(128);
    expect(early[maps.cols - 1]!).toBeLessThan(120);
  });
});
