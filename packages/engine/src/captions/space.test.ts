import { describe, expect, it } from "vitest";
import type { RgbaImage } from "../render/types.js";
import { boxCost, gridSize, matteCells, matteHead, pictureCells, sceneCost, textCells } from "./space.js";

/** A W × H image, white where `on(x, y)`, else black. */
function image(W: number, H: number, on: (x: number, y: number) => boolean): RgbaImage {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const v = on(x, y) ? 255 : 0;
      data.set([v, v, v, 255], (y * W + x) * 4);
    }
  }
  return { width: W, height: H, data };
}

/** A matte of a person: a round head (radius r at cx, cy), a neck, a torso 4.4 r wide, and optionally arms held out level with the head. */
const person = (W: number, H: number, cx: number, cy: number, r: number, arms = false) =>
  image(W, H, (x, y) => {
    const dx = Math.abs(x - cx);
    if (dx ** 2 + (y - cy) ** 2 <= r * r) return true;
    // Arms raised to the side of the head, as the beach reference shot holds them.
    if (arms && y > cy + r * 0.4 && y < cy + r * 0.6 && dx < r * 8) return true;
    if (y > cy + r * 0.9 && y < cy + r * 1.4) return dx < r * 0.5;
    return y >= cy + r * 1.4 && dx < r * 2.2;
  });

describe("matteHead", () => {
  it("finds the head of a person matte, not the shoulders", () => {
    const head = matteHead(person(160, 90, 80, 30, 10))!;
    expect(head.x).toBeCloseTo(0.5, 1);
    expect(head.y - head.h / 2).toBeCloseTo(20 / 90, 1);
    expect(head.w).toBeLessThan(0.2);
    expect(head.h).toBeLessThan(0.35);
  });

  it("stops at outstretched arms", () => {
    const armsOut = matteHead(person(160, 90, 80, 25, 8, true))!;
    const plain = matteHead(person(160, 90, 80, 25, 8))!;
    expect(armsOut.w).toBeCloseTo(plain.w, 9);
    expect(armsOut.h).toBeLessThanOrEqual(plain.h);
    expect(armsOut.w).toBeLessThan(0.12);
  });

  it("is null for an empty or speck matte", () => {
    expect(matteHead(image(100, 100, () => false))).toBeNull();
    expect(matteHead(image(100, 100, (x, y) => x === 5 && y === 5))).toBeNull();
  });
});

describe("scene cost", () => {
  it("grids by the long side, square cells", () => {
    expect(gridSize(1080, 1920)).toEqual({ cols: 9, rows: 16 });
    expect(gridSize(1920, 1080)).toEqual({ cols: 16, rows: 9 });
  });

  it("scores busy and bright picture high, a flat dark field low", () => {
    const stripes = image(64, 32, (x) => x >= 34 && x % 2 === 0);
    const { busy, luma } = pictureCells(stripes, 2, 1);
    expect(busy[0]).toBe(0);
    expect(busy[1]).toBe(1);
    expect(luma[0]).toBe(0);
    expect(luma[1]).toBeCloseTo(0.47, 1);
  });

  it("counts the subject's share of each cell, and weighs it over any picture", () => {
    const matte = image(40, 20, (x) => x < 20);
    expect(matteCells(matte, 2, 1)).toEqual([1, 0]);
    const grid = sceneCost(image(40, 20, () => false), matte, 2, 1)!;
    expect(grid.cells[0]).toBeCloseTo(1, 9);
    expect(grid.cells[1]).toBe(0);
    expect(sceneCost(null, null, 2, 1)).toBeNull();
    // The busiest, brightest background costs less than a dark, calm body.
    const white = image(40, 20, (x, y) => (x + y) % 2 === 0);
    const busy = sceneCost(white, null, 2, 1)!;
    expect(Math.max(...busy.cells)).toBeLessThan(grid.cells[0]!);
  });

  it("averages a box's cells by the area it covers", () => {
    const grid = { cols: 2, rows: 1, cells: [1, 0] };
    expect(boxCost(grid, { x: 0, y: 0, width: 100, height: 10 }, 100, 10)).toBeCloseTo(0.5, 9);
    expect(boxCost(grid, { x: 50, y: 0, width: 50, height: 10 }, 100, 10)).toBe(0);
    expect(boxCost(grid, { x: 25, y: 0, width: 50, height: 10 }, 100, 10)).toBeCloseTo(0.5, 9);
  });
});

describe("textCells", () => {
  /** Mid-grey footage with a line of "type" across `y0..y1`: white letters (upright strokes) with a black outline. */
  const typed = (W: number, H: number, y0: number, y1: number): RgbaImage => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        let v = 90 + Math.round((40 * x) / W);
        if (y >= y0 && y < y1 && x > W * 0.15 && x < W * 0.85) {
          const p = x % 6;
          v = p < 2 ? 250 : p === 2 || p === 5 ? 10 : v;
        }
        data.set([v, v, v, 255], (y * W + x) * 4);
      }
    }
    return { width: W, height: H, data };
  };

  it("finds a line of burnt-in type and nothing in calm footage", () => {
    const { cols, rows } = gridSize(240, 427);
    const img = typed(240, 427, 290, 306);
    const cells = textCells(img, cols, rows);
    const hitRows = [...new Set(cells.flatMap((t, k) => (t ? [Math.floor(k / cols)] : [])))];
    expect(hitRows.length).toBeGreaterThan(0);
    for (const r of hitRows) expect(r).toBeGreaterThanOrEqual(Math.floor((290 * rows) / 427) - 1);
    expect(cells.filter(Boolean).length).toBeGreaterThanOrEqual(3);
    expect(textCells(typed(240, 427, 0, 0), cols, rows).some(Boolean)).toBe(false);
    // Cost: the type's cells cost as much as a subject.
    const cost = sceneCost(img, null, cols, rows, cells)!;
    const k = cells.findIndex(Boolean);
    expect(cost.cells[k]).toBeGreaterThan(1);
  });

  it("ignores a lone busy patch (texture, not a line of type)", () => {
    const { cols, rows } = gridSize(240, 427);
    const img = typed(240, 427, 0, 0);
    // One cell-sized checker block.
    for (let y = 100; y < 115; y += 1) for (let x = 120; x < 135; x += 1) img.data.fill((x + y) % 2 ? 255 : 0, (y * 240 + x) * 4, (y * 240 + x) * 4 + 3);
    expect(textCells(img, cols, rows).some(Boolean)).toBe(false);
  });
});
