import { describe, expect, it } from "vitest";
import { tileMaskSvg, type TileMaskSpec } from "./tile-masks.js";

const base: TileMaskSpec = { pattern: "tiles", order: "random", count: 4, horizontal: false, reverse: false, seed: 1 };
const greys = (svg: string) => [...svg.matchAll(/fill="rgb\((\d+),\1,\1\)"/g)].map((m) => Number(m[1]));

describe("tile masks", () => {
  it("give every tile of a frame-covering grid its own grey step, in the order asked for", () => {
    const rows = tileMaskSvg(1920, 1080, { ...base, order: "rows" });
    // 4 across the short side: 4 rows of 270 px, 8 columns (7.1 rounded up, centred).
    expect(rows.steps).toBe(32);
    const g = greys(rows.svg);
    expect(g).toHaveLength(32);
    expect(g[0]).toBe(16);
    expect(g[31]).toBe(239);
    expect([...g].sort((a, b) => a - b)).toEqual(g);
    // A shuffle is the same for a seed and different for another; reverse runs it backwards.
    expect(tileMaskSvg(1920, 1080, base).svg).toBe(tileMaskSvg(1920, 1080, base).svg);
    expect(tileMaskSvg(1920, 1080, { ...base, seed: 2 }).svg).not.toBe(tileMaskSvg(1920, 1080, base).svg);
    const rev = greys(tileMaskSvg(1920, 1080, { ...base, order: "rows", reverse: true }).svg);
    expect(rev[0]).toBe(239);
  });

  it("spiral in from the edge and sweep a diagonal from the top-left corner", () => {
    const spiral = greys(tileMaskSvg(1000, 1000, { ...base, order: "spiral", count: 3 }).svg);
    // 3 × 3 from the top-left round the edge, the middle last.
    expect(spiral.map((v) => Math.round(((v - 16) / 223) * 8))).toEqual([0, 1, 2, 7, 8, 3, 6, 5, 4]);
    const diag = greys(tileMaskSvg(1000, 1000, { ...base, order: "diagonal", count: 3 }).svg);
    expect(diag[0]).toBe(16);
    expect(diag[8]).toBe(239);
  });

  it("draw rings from the centre out and bars across the frame", () => {
    const rings = tileMaskSvg(1920, 1080, { ...base, pattern: "rings", count: 5 });
    expect(rings.svg.match(/<circle/g)).toHaveLength(5);
    // Painted outermost first: the last circle drawn is the centre, the darkest (first to switch).
    expect(greys(rings.svg).at(-1)).toBe(16);
    const bars = tileMaskSvg(1920, 1080, { ...base, pattern: "bars", count: 8, horizontal: true });
    expect(bars.svg.match(/<rect x="0"/g)).toHaveLength(8);
  });
});
