/**
 * Generated luma masks for the native wipe transition (T099: a square-tile
 * dissolve, concentric rings, staggered bars at a section change). A luma
 * transition reveals the next clip through its mask from one grey level to
 * the other as it runs, so a mask of flat-grey cells reveals cell by cell
 * in the order of their greys: the order is the design. Cells are hard
 * edged (no anti-aliasing between greys would matter: neighbours differ by
 * whole steps). Pure.
 */

export const MASK_PATTERNS = ["tiles", "rings", "bars"] as const;
export type MaskPattern = (typeof MASK_PATTERNS)[number];
export const TILE_ORDERS = ["random", "diagonal", "rows", "columns", "centre", "spiral"] as const;
export type TileOrder = (typeof TILE_ORDERS)[number];

export interface TileMaskSpec {
  pattern: MaskPattern;
  /** tiles: how cells are ranked; rings and bars ignore it (rings go outward, bars across). */
  order: TileOrder;
  /** Cells across the frame's short side (tiles), rings from the centre to a corner, or bars across the frame. */
  count: number;
  /** bars: vertical (default) or horizontal. */
  horizontal: boolean;
  /** Reverse the order (rings inward, the last tile first). */
  reverse: boolean;
  seed: number;
}

/** Darkest and lightest grey used: the first and last cells switch inside the transition, not on its ends. */
const LOW = 16;
const HIGH = 239;

/** A small seeded generator (mulberry32): the same seed gives the same random order. */
function random(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ranks 0..n-1 of `keys` (ties keep their index order). */
function ranks(keys: readonly number[]): number[] {
  const order = keys.map((k, i) => ({ k, i })).sort((a, b) => a.k - b.k || a.i - b.i);
  const out = new Array<number>(keys.length);
  order.forEach((e, r) => (out[e.i] = r));
  return out;
}

/** Spiral rank of cell (c, r) in a cols × rows grid, from the outside in. */
function spiralKeys(cols: number, rows: number): number[] {
  const key = new Array<number>(cols * rows);
  let top = 0;
  let left = 0;
  let bottom = rows - 1;
  let right = cols - 1;
  let n = 0;
  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c += 1) key[top * cols + c] = n++;
    for (let r = top + 1; r <= bottom; r += 1) key[r * cols + right] = n++;
    if (top < bottom) for (let c = right - 1; c >= left; c -= 1) key[bottom * cols + c] = n++;
    if (left < right) for (let r = bottom - 1; r > top; r -= 1) key[r * cols + left] = n++;
    top += 1;
    left += 1;
    bottom -= 1;
    right -= 1;
  }
  return key;
}

export interface TileMask {
  svg: string;
  /** Distinct grey steps: the cells (or rings, bars) that switch one after another. */
  steps: number;
}

/** The mask at `w` × `h` px. */
export function tileMaskSvg(w: number, h: number, spec: TileMaskSpec): TileMask {
  const grey = (rank: number, of: number) => {
    const t = of <= 1 ? 0.5 : (spec.reverse ? of - 1 - rank : rank) / (of - 1);
    const g = Math.round(LOW + t * (HIGH - LOW));
    return `rgb(${g},${g},${g})`;
  };
  const f = (v: number) => (Math.round(v * 100) / 100).toString();
  let body = "";
  let steps: number;
  if (spec.pattern === "tiles") {
    const side = Math.min(w, h) / spec.count;
    const cols = Math.ceil(w / side - 1e-9);
    const rows = Math.ceil(h / side - 1e-9);
    // Centred: partial cells split evenly between the edges.
    const x0 = (w - cols * side) / 2;
    const y0 = (h - rows * side) / 2;
    const rnd = random(spec.seed);
    const keys = Array.from({ length: cols * rows }, (_, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      switch (spec.order) {
        case "random":
          return rnd();
        case "diagonal":
          return c + r + rnd() * 0.5;
        case "rows":
          return r * cols + c;
        case "columns":
          return c * rows + r;
        case "centre":
          return Math.hypot(c + 0.5 - cols / 2, (r + 0.5 - rows / 2) * 1) + rnd() * 0.3;
        case "spiral":
          return 0;
      }
    });
    const ranked = spec.order === "spiral" ? spiralKeys(cols, rows) : ranks(keys);
    steps = cols * rows;
    for (let i = 0; i < cols * rows; i += 1) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      // A hair of overlap so no seam of the background shows between cells.
      body += `<rect x="${f(x0 + c * side)}" y="${f(y0 + r * side)}" width="${f(side + 0.5)}" height="${f(side + 0.5)}" fill="${grey(ranked[i]!, steps)}"/>`;
    }
  } else if (spec.pattern === "rings") {
    steps = spec.count;
    const far = Math.hypot(w, h) / 2;
    // Outermost first, so each smaller circle paints over the larger: ring k spans radii k..k+1 of `count`.
    for (let k = steps - 1; k >= 0; k -= 1) body += `<circle cx="${f(w / 2)}" cy="${f(h / 2)}" r="${f(((k + 1) / steps) * far + 1)}" fill="${grey(k, steps)}"/>`;
  } else {
    steps = spec.count;
    const along = spec.horizontal ? h : w;
    const size = along / steps;
    for (let k = 0; k < steps; k += 1) {
      body += spec.horizontal
        ? `<rect x="0" y="${f(k * size)}" width="${w}" height="${f(size + 0.5)}" fill="${grey(k, steps)}"/>`
        : `<rect x="${f(k * size)}" y="0" width="${f(size + 0.5)}" height="${h}" fill="${grey(k, steps)}"/>`;
    }
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${body}</svg>\n`, steps };
}
