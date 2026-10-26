/**
 * Shape morphing: closed outlines (rings) resampled to matching point
 * counts, aligned, and interpolated point by point. An outline is a list of
 * rings filled nonzero: outer rings wind one way, holes the other, so a
 * glyph's counters morph as holes and overlapping rings merge.
 *
 * Our own instead of flubber: every frame is `morphRings(morph, p)`, a
 * pure function of p, with holes and many-to-many rings (letters splitting
 * and merging) handled the same way.
 */

import { random01 } from "./rng.js";

export interface Point {
  x: number;
  y: number;
}

/** A closed polygon (the last point joins the first). */
export type Ring = readonly Point[];

/** Shoelace area; positive is clockwise on screen (y down). */
export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function centroid(ring: Ring): Point {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / Math.max(1, ring.length), y: y / Math.max(1, ring.length) };
}

export function perimeter(ring: Ring): number {
  let len = 0;
  for (let i = 0; i < ring.length; i += 1) len += Math.hypot(ring[(i + 1) % ring.length]!.x - ring[i]!.x, ring[(i + 1) % ring.length]!.y - ring[i]!.y);
  return len;
}

/** `n` points evenly spaced along the ring's perimeter, starting at its first point. */
export function resampleRing(ring: Ring, n: number): Point[] {
  const total = perimeter(ring);
  if (ring.length === 0) return [];
  if (total === 0) return new Array<Point>(n).fill(ring[0]!).map((p) => ({ ...p }));
  const out: Point[] = [];
  const step = total / n;
  let seg = 0;
  let segStart = 0;
  let segLen = Math.hypot(ring[1 % ring.length]!.x - ring[0]!.x, ring[1 % ring.length]!.y - ring[0]!.y);
  for (let k = 0; k < n; k += 1) {
    const d = k * step;
    while (segStart + segLen < d && seg < ring.length - 1) {
      segStart += segLen;
      seg += 1;
      const a = ring[seg]!;
      const b = ring[(seg + 1) % ring.length]!;
      segLen = Math.hypot(b.x - a.x, b.y - a.y);
    }
    const a = ring[seg]!;
    const b = ring[(seg + 1) % ring.length]!;
    const u = segLen > 0 ? Math.min(1, (d - segStart) / segLen) : 0;
    out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  }
  return out;
}

/** `b` (same length as `a`) cyclically shifted so its points sit closest to `a`'s. */
export function alignRing(a: Ring, b: Ring): Point[] {
  const n = b.length;
  let best = 0;
  let bestCost = Infinity;
  // Every shift costs O(n); stepping coarsely then refining keeps long rings cheap.
  const coarse = Math.max(1, Math.floor(n / 64));
  const cost = (shift: number): number => {
    let c = 0;
    for (let i = 0; i < n; i += coarse) {
      const p = a[i]!;
      const q = b[(i + shift) % n]!;
      c += (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
    }
    return c;
  };
  for (let s = 0; s < n; s += coarse) {
    const c = cost(s);
    if (c < bestCost) [best, bestCost] = [s, c];
  }
  if (coarse > 1) {
    const around = best;
    for (let s = around - coarse; s <= around + coarse; s += 1) {
      const shift = (s + n) % n;
      const c = cost(shift);
      if (c < bestCost) [best, bestCost] = [shift, c];
    }
  }
  return b.map((_, i) => b[(i + best) % n]!);
}

function contains(ring: Ring, p: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export interface Outline {
  /** Outer rings, clockwise. */
  solids: Point[][];
  /** Holes, counter-clockwise. */
  holes: Point[][];
}

/** Sort rings into solids and holes by how deeply each is nested, and wind them for nonzero fill. */
export function toOutline(rings: readonly Ring[]): Outline {
  const out: Outline = { solids: [], holes: [] };
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const depth = rings.filter((other) => other !== ring && other.length >= 3 && contains(other, ring[0]!)).length;
    const hole = depth % 2 === 1;
    const clockwise = signedArea(ring) > 0;
    const wound = clockwise === !hole ? [...ring] : [...ring].reverse();
    (hole ? out.holes : out.solids).push(wound);
  }
  return out;
}

/** Ring pairs with equal point counts, aligned: interpolate them point by point. */
export interface Morph {
  pairs: [Point[], Point[]][];
}

export interface MorphOptions {
  /** Target spacing of resampled points, px (default 6). */
  spacing?: number;
}

function byPosition(rings: Point[][]): Point[][] {
  return rings.map((r) => ({ r, c: centroid(r) })).sort((a, b) => a.c.x - b.c.x || a.c.y - b.c.y).map((e) => e.r);
}

function pairUp(from: Point[][], to: Point[][], spacing: number, out: [Point[], Point[]][]): void {
  const a = byPosition(from);
  const b = byPosition(to);
  const k = Math.max(a.length, b.length);
  for (let i = 0; i < k; i += 1) {
    // Proportional mapping: with fewer rings on one side, neighbours split from (or merge into) one ring.
    const ra = a.length > 0 ? a[Math.floor((i * a.length) / k)]! : undefined;
    const rb = b.length > 0 ? b[Math.floor((i * b.length) / k)]! : undefined;
    const n = Math.max(24, Math.min(400, Math.ceil(Math.max(ra ? perimeter(ra) : 0, rb ? perimeter(rb) : 0) / spacing)));
    // No partner: collapse to (or grow from) a point at the ring's centre.
    const sa = ra ? resampleRing(ra, n) : new Array<Point>(n).fill(centroid(rb!));
    const sb = rb ? resampleRing(rb, n) : new Array<Point>(n).fill(centroid(ra!));
    out.push([sa, ra && rb ? alignRing(sa, sb) : sb]);
  }
}

/** Prepare a morph from one outline to another (build time; seeking is cheap). */
export function prepareMorph(from: Outline, to: Outline, options: MorphOptions = {}): Morph {
  const spacing = options.spacing ?? 6;
  const pairs: [Point[], Point[]][] = [];
  pairUp(from.solids, to.solids, spacing, pairs);
  pairUp(from.holes, to.holes, spacing, pairs);
  return { pairs };
}

/**
 * The rings `p` of the way through `morph`. `delay(i)` (0..1) holds pair i
 * back so a morph can sweep across a word; each pair still finishes at p = 1.
 */
export function morphRings(morph: Morph, p: number, delay?: (pair: number, center: Point) => number): Point[][] {
  return morph.pairs.map(([a, b], i) => {
    let q = p;
    if (delay) {
      const d = Math.min(0.9, Math.max(0, delay(i, centroid(a))));
      q = Math.min(1, Math.max(0, (p - d) / (1 - d)));
    }
    if (q <= 0) return a;
    if (q >= 1) return b;
    return a.map((pa, j) => ({ x: pa.x + (b[j]!.x - pa.x) * q, y: pa.y + (b[j]!.y - pa.y) * q }));
  });
}

/** SVG path data for rings (fill-rule nonzero). */
export function ringsPath(rings: readonly Ring[]): string {
  const f = (n: number): string => String(Math.round(n * 100) / 100);
  return rings
    .filter((r) => r.length > 1)
    .map((r) => `M${r.map((p) => `${f(p.x)} ${f(p.y)}`).join("L")}Z`)
    .join("");
}

export function outlinePath(outline: Outline): string {
  return ringsPath([...outline.solids, ...outline.holes]);
}

/** Move, scale and rotate (degrees) a ring about the origin, then offset by (x, y). */
export function transformRing(ring: Ring, t: { x?: number; y?: number; scale?: number; rotate?: number }): Point[] {
  const s = t.scale ?? 1;
  const a = ((t.rotate ?? 0) * Math.PI) / 180;
  const cos = Math.cos(a) * s;
  const sin = Math.sin(a) * s;
  return ring.map((p) => ({ x: p.x * cos - p.y * sin + (t.x ?? 0), y: p.x * sin + p.y * cos + (t.y ?? 0) }));
}

export function transformOutline(outline: Outline, t: Parameters<typeof transformRing>[1]): Outline {
  return { solids: outline.solids.map((r) => transformRing(r, t)), holes: outline.holes.map((r) => transformRing(r, t)) };
}

/** Bounding box of an outline's solids. */
export function bounds(outline: Outline): { x: number; y: number; width: number; height: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of outline.solids) {
    for (const p of r) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  }
  return x0 === Infinity ? { x: 0, y: 0, width: 0, height: 0 } : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// Shapes, centred on the origin, unit radius unless noted. Scale with transformRing.

/** A circle of radius r. */
export function circle(r = 1, n = 96): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
}

/** A regular polygon with one vertex up (radius r to the vertices). */
export function regularPolygon(sides: number, r = 1): Point[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
}

/** A star with `points` tips, outer radius r and inner radius r·inner. */
export function star(points = 5, inner = 0.48, r = 1): Point[] {
  return Array.from({ length: points * 2 }, (_, i) => {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * inner;
    return { x: Math.cos(a) * rr, y: Math.sin(a) * rr };
  });
}

/** A w × h rectangle with corner radius `radius` (clamped to a pill). */
export function roundRect(w: number, h: number, radius: number, perCorner = 12): Point[] {
  const rr = Math.max(0, Math.min(radius, w / 2, h / 2));
  const out: Point[] = [];
  const corners: [number, number, number][] = [
    [w / 2 - rr, -h / 2 + rr, -Math.PI / 2],
    [w / 2 - rr, h / 2 - rr, 0],
    [-w / 2 + rr, h / 2 - rr, Math.PI / 2],
    [-w / 2 + rr, -h / 2 + rr, Math.PI],
  ];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= perCorner; i += 1) {
      const a = start + (i / perCorner) * (Math.PI / 2);
      out.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
    }
  }
  return out;
}

/** An organic blob: a circle whose radius wobbles with a few seeded harmonics. */
export function blob(seed: number, wobble = 0.16, n = 120): Point[] {
  const harmonics = [2, 3, 5].map((k, i) => ({ k, amp: wobble * (0.5 + random01(seed, i, 0)) / (1 + i * 0.6), phase: random01(seed, i, 1) * Math.PI * 2 }));
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = 1 + harmonics.reduce((s, h) => s + h.amp * Math.sin(h.k * a + h.phase), 0);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
}

/** A plus sign, arms `arm` thick (fraction of the full width 2), corners rounded by `round`. */
export function plus(arm = 0.62, round = 0.12): Point[] {
  const h = arm / 2;
  const raw: Point[] = [
    { x: -h, y: -1 }, { x: h, y: -1 }, { x: h, y: -h }, { x: 1, y: -h }, { x: 1, y: h }, { x: h, y: h },
    { x: h, y: 1 }, { x: -h, y: 1 }, { x: -h, y: h }, { x: -1, y: h }, { x: -1, y: -h }, { x: -h, y: -h },
  ];
  return chaikin(raw, round > 0 ? 3 : 0, round);
}

/**
 * Chaikin corner cutting: each pass replaces every corner with two points
 * `cut` of the way along its edges, rounding corners.
 */
export function chaikin(ring: Ring, passes = 2, cut = 0.25): Point[] {
  let r: Point[] = [...ring];
  for (let k = 0; k < passes; k += 1) {
    const next: Point[] = [];
    for (let i = 0; i < r.length; i += 1) {
      const a = r[i]!;
      const b = r[(i + 1) % r.length]!;
      next.push({ x: a.x + (b.x - a.x) * cut, y: a.y + (b.y - a.y) * cut }, { x: a.x + (b.x - a.x) * (1 - cut), y: a.y + (b.y - a.y) * (1 - cut) });
    }
    r = next;
  }
  return r;
}

/** A pie slice from angle a0 to a1 (degrees, 0 = right, clockwise), radius r, about the origin. */
export function sector(a0: number, a1: number, r = 1, n = 48): Point[] {
  const out: Point[] = [{ x: 0, y: 0 }];
  for (let i = 0; i <= n; i += 1) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return out;
}
