import { describe, expect, it } from "vitest";
import { alignRing, centroid, circle, morphRings, perimeter, prepareMorph, resampleRing, ringsPath, roundRect, signedArea, star, toOutline, transformRing } from "./morph.js";
import { traceContours } from "./outline.js";
import type { Point } from "./morph.js";

const square = (s: number, x = 0, y = 0) => transformRing(roundRect(s, s, 0, 1), { x, y });

describe("resampleRing", () => {
  it("spaces points evenly along the perimeter", () => {
    const r = resampleRing(square(4), 16);
    expect(r).toHaveLength(16);
    for (let i = 0; i < 16; i += 1) {
      const a = r[i]!;
      const b = r[(i + 1) % 16]!;
      expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeCloseTo(1, 6);
    }
    expect(perimeter(r)).toBeCloseTo(16, 6);
  });
});

describe("alignRing", () => {
  it("undoes a cyclic shift", () => {
    const a = resampleRing(circle(10), 40);
    const shifted = [...a.slice(13), ...a.slice(0, 13)];
    const aligned = alignRing(a, shifted);
    aligned.forEach((p, i) => {
      expect(p.x).toBeCloseTo(a[i]!.x, 9);
      expect(p.y).toBeCloseTo(a[i]!.y, 9);
    });
  });
});

describe("toOutline", () => {
  it("winds solids clockwise and holes counter-clockwise by nesting", () => {
    const outer = [...square(10)].reverse();
    const hole = square(4);
    const o = toOutline([outer, hole]);
    expect(o.solids).toHaveLength(1);
    expect(o.holes).toHaveLength(1);
    expect(signedArea(o.solids[0]!)).toBeGreaterThan(0);
    expect(signedArea(o.holes[0]!)).toBeLessThan(0);
  });
});

describe("prepareMorph / morphRings", () => {
  it("starts at the source, ends at the target, and is a pure function of p", () => {
    const m = prepareMorph(toOutline([circle(100)]), toOutline([star(5, 0.5, 100)]));
    expect(m.pairs).toHaveLength(1);
    const [a, b] = m.pairs[0]!;
    expect(a).toHaveLength(b.length);
    expect(morphRings(m, 0)[0]).toBe(a);
    expect(morphRings(m, 1)[0]).toBe(b);
    expect(ringsPath(morphRings(m, 0.37))).toBe(ringsPath(morphRings(m, 0.37)));
    // Halfway, every point sits halfway.
    const mid = morphRings(m, 0.5)[0]!;
    expect(mid[3]!.x).toBeCloseTo((a[3]!.x + b[3]!.x) / 2, 9);
  });

  it("splits one ring into two and grows a hole from a point", () => {
    const from = toOutline([square(10)]);
    const to = toOutline([square(10, -20), square(10, 20), square(4, 20)]);
    const m = prepareMorph(from, to);
    expect(m.pairs).toHaveLength(3);
    // Both solids start as the one square.
    expect(centroid(m.pairs[0]![0]).x).toBeCloseTo(0, 6);
    expect(centroid(m.pairs[1]![0]).x).toBeCloseTo(0, 6);
    // The hole starts collapsed at its own centre: no area.
    const hole = m.pairs[2]![0];
    expect(Math.abs(signedArea(hole))).toBe(0);
    expect(centroid(hole).x).toBeCloseTo(20, 6);
  });

  it("delays pairs for a sweep but still lands every pair at p = 1", () => {
    const m = prepareMorph(toOutline([square(10, -20), square(10, 20)]), toOutline([circle(5, 24).map((p) => ({ x: p.x - 20, y: p.y })), circle(5, 24).map((p) => ({ x: p.x + 20, y: p.y }))]));
    const delay = (_: number, c: { x: number }) => (c.x > 0 ? 0.5 : 0);
    const early = morphRings(m, 0.4, { delay });
    expect(early[1]).toBe(m.pairs[1]![0]);
    expect(early[0]).not.toBe(m.pairs[0]![0]);
    expect(morphRings(m, 1, { delay })[1]).toBe(m.pairs[1]![1]);
  });
});

describe("prepareMorph counters", () => {
  /** Nonzero winding number of `rings` around `p` (0: unfilled). */
  const winding = (rings: Point[][], p: Point): number =>
    rings.reduce((w, r) => {
      let n = 0;
      for (let i = 0; i < r.length; i += 1) {
        const a = r[i]!;
        const b = r[(i + 1) % r.length]!;
        const side = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
        if (a.y <= p.y && b.y > p.y && side > 0) n += 1;
        else if (a.y > p.y && b.y <= p.y && side < 0) n -= 1;
      }
      return w + n;
    }, 0);
  // An "o" (square with a counter) and an "l", against three bars: the "o" splits (or the bars merge into it).
  const ol = toOutline([square(10), square(4), square(10, 30)]);
  const bars = toOutline([square(8, -20), square(8), square(8, 20)]);
  const counter = { x: 0, y: 0.3 };

  it("keeps a splitting letter's counter open at the start", () => {
    expect(winding(morphRings(prepareMorph(ol, bars), 0), counter)).toBe(0);
    expect(winding(morphRings(prepareMorph(ol, bars), 0.02), counter)).toBe(0);
  });

  it("opens a counter in a letter several rings merge into at the end", () => {
    expect(winding(morphRings(prepareMorph(bars, ol), 1), counter)).toBe(0);
    expect(winding(morphRings(prepareMorph(bars, ol), 0.98), counter)).toBe(0);
  });
});

describe("morphRings smoothing", () => {
  it("relaxes only in between: the ends are exact", () => {
    const m = prepareMorph(toOutline([square(100)]), toOutline([star(5, 0.4, 60)]));
    const raw = morphRings(m, 0.5)[0]!;
    const soft = morphRings(m, 0.5, { smooth: 20 })[0]!;
    expect(perimeter(soft)).toBeLessThan(perimeter(raw));
    expect(morphRings(m, 1, { smooth: 20 })[0]).toBe(m.pairs[0]![1]);
    expect(morphRings(m, 0, { smooth: 20 })[0]).toBe(m.pairs[0]![0]);
  });
});

describe("traceContours", () => {
  it("traces a filled square with a hole into two rings at sub-pixel edges", () => {
    const w = 20;
    const h = 20;
    const v = new Array<number>(w * h).fill(0);
    for (let y = 2; y < 18; y += 1) for (let x = 2; x < 18; x += 1) v[y * w + x] = 255;
    for (let y = 8; y < 12; y += 1) for (let x = 8; x < 12; x += 1) v[y * w + x] = 0;
    const rings = traceContours(v, w, h);
    expect(rings).toHaveLength(2);
    const o = toOutline(rings);
    expect(o.solids).toHaveLength(1);
    expect(o.holes).toHaveLength(1);
    // Edges sit halfway between the 0 and 255 pixels: the outer square spans 1.5..17.5.
    const xs = o.solids[0]!.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(1.5 + 0.5 / 255, 3);
    expect(Math.max(...xs)).toBeCloseTo(17.5 - 0.5 / 255, 3);
    expect(Math.abs(signedArea(o.solids[0]!))).toBeGreaterThan(200);
  });

  it("drops specks smaller than minArea", () => {
    const v = new Array<number>(100).fill(0);
    v[55] = 255;
    expect(traceContours(v, 10, 10, 128, 4)).toHaveLength(0);
    expect(traceContours(v, 10, 10, 128, 0.1)).toHaveLength(1);
  });
});
