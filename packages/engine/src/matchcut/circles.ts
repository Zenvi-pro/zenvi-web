/**
 * Circle detection without a model, for the shapes match cuts chain (iris,
 * moon, cup rim, vinyl, lens, eclipse, clock): a Hough gradient detector over
 * one decoded frame, like OpenCV's HOUGH_GRADIENT.
 *
 *   1. luma, shrunk so the longest edge is at most WORK_EDGE pixels, then a
 *      3×3 blur (sensor noise and JPEG blocks make spurious edges);
 *   2. Sobel gradients; edge pixels are the strongest ~EDGE_FRACTION of the
 *      gradient magnitudes;
 *   3. every edge pixel votes along its gradient, both ways, for centres at
 *      every radius in range (a circle's edge gradients all point through
 *      its centre);
 *   4. accumulator peaks are candidate centres; for each, a histogram of
 *      the distances of edge pixels whose gradient points at it gives the
 *      radius, scored by how much of the circumference is supported;
 *   5. candidates that are the same circle are merged, best first.
 *
 * Coordinates are normalised to the frame (0-1) so the boxes go straight
 * into align_match_cut_tool.
 */

import type { RgbaImage } from "../render/types.js";
import type { SubjectBox } from "./fit.js";

export interface CircleCandidate {
  /** Centre, 0-1 of the frame width / height. */
  cx: number;
  cy: number;
  /** Radius as a fraction of the frame height. */
  r: number;
  /** 0..1: the share of the circumference with an edge pointing at the centre. */
  score: number;
  /** The circle's bounding box on the frame, 0-1. */
  box: SubjectBox;
}

export interface CircleOptions {
  /** Smallest and largest radius looked for, as fractions of the frame height (default 0.04 and 0.6). */
  minRadius?: number;
  maxRadius?: number;
  /** How many circles to return at most (default 5). */
  limit?: number;
}

const WORK_EDGE = 400;
const EDGE_FRACTION = 0.18;
/** Below this circumference support a peak is noise. */
const MIN_SCORE = 0.45;
/** Rank bonus of the outer ring of concentric circles. */
const OUTER_BONUS = 0.15;
/** Directions sampled when measuring a candidate's circumference support. */
const ARC_SAMPLES = 180;

export interface Gray {
  width: number;
  height: number;
  data: Float32Array;
}

export interface Shrunk extends Gray {
  /** Source pixels per work pixel. */
  factor: number;
}

/** Luma (Rec. 601) box-averaged down to at most `edge` pixels on the longest side. */
export function shrinkLuma(image: RgbaImage, edge: number): Shrunk {
  const factor = Math.max(1, Math.ceil(Math.max(image.width, image.height) / edge));
  const width = Math.max(1, Math.floor(image.width / factor));
  const height = Math.max(1, Math.floor(image.height / factor));
  const data = new Float32Array(width * height);
  const src = image.data;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        let i = ((y * factor + dy) * image.width + x * factor) * 4;
        for (let dx = 0; dx < factor; dx += 1, i += 4) sum += 0.299 * src[i]! + 0.587 * src[i + 1]! + 0.114 * src[i + 2]!;
      }
      data[y * width + x] = sum / (factor * factor);
    }
  }
  return { width, height, data, factor };
}

export function blur3(g: Gray): Gray {
  const { width, height, data } = g;
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let weight = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const w = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
          sum += data[yy * width + xx]! * w;
          weight += w;
        }
      }
      out[y * width + x] = sum / weight;
    }
  }
  return { width, height, data: out };
}

interface Edges {
  width: number;
  height: number;
  /** Unit gradient per edge pixel, 0 elsewhere. */
  gx: Float32Array;
  gy: Float32Array;
  mag: Float32Array;
  list: Int32Array;
}

function sobelEdges(g: Gray): Edges {
  const { width, height, data } = g;
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  const mag = new Float32Array(width * height);
  const px = (x: number, y: number) => data[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]!;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const sx = px(x + 1, y - 1) + 2 * px(x + 1, y) + px(x + 1, y + 1) - px(x - 1, y - 1) - 2 * px(x - 1, y) - px(x - 1, y + 1);
      const sy = px(x - 1, y + 1) + 2 * px(x, y + 1) + px(x + 1, y + 1) - px(x - 1, y - 1) - 2 * px(x, y - 1) - px(x + 1, y - 1);
      const i = y * width + x;
      const m = Math.hypot(sx, sy);
      mag[i] = m;
      if (m > 0) {
        gx[i] = sx / m;
        gy[i] = sy / m;
      }
    }
  }
  // Threshold: the strongest EDGE_FRACTION of non-flat pixels, and never below a faint contrast.
  const sorted = Array.from(mag).filter((m) => m > 4).sort((a, b) => b - a);
  const threshold = Math.max(24, sorted[Math.floor(sorted.length * EDGE_FRACTION)] ?? Infinity);
  const list: number[] = [];
  for (let i = 0; i < mag.length; i += 1) {
    if (mag[i]! >= threshold) list.push(i);
    else mag[i] = 0;
  }
  return { width, height, gx, gy, mag, list: Int32Array.from(list) };
}

/** Accumulator votes for centres: each edge pixel walks its gradient line both ways over the radius range. */
function voteCentres(e: Edges, rMin: number, rMax: number): Float32Array {
  const acc = new Float32Array(e.width * e.height);
  for (const i of e.list) {
    const x = i % e.width;
    const y = (i - x) / e.width;
    const dx = e.gx[i]!;
    const dy = e.gy[i]!;
    for (const sign of [1, -1]) {
      for (let r = rMin; r <= rMax; r += 1) {
        const cx = Math.round(x + sign * dx * r);
        const cy = Math.round(y + sign * dy * r);
        if (cx < 0 || cy < 0 || cx >= e.width || cy >= e.height) break;
        acc[cy * e.width + cx]! += 1;
      }
    }
  }
  return acc;
}

/** Local maxima of the (3×3 smoothed) accumulator, strongest first. */
function peaks(acc: Float32Array, width: number, height: number, count: number, spacing: number): Array<[number, number]> {
  const smooth = blur3({ width, height, data: acc }).data;
  const found: Array<[number, number, number]> = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const v = smooth[y * width + x]!;
      if (v < 2) continue;
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if ((dx || dy) && smooth[(y + dy) * width + x + dx]! > v) isMax = false;
      if (isMax) found.push([x, y, v]);
    }
  }
  found.sort((a, b) => b[2] - a[2]);
  const out: Array<[number, number]> = [];
  for (const [x, y] of found) {
    if (out.some(([ox, oy]) => Math.hypot(ox - x, oy - y) < spacing)) continue;
    out.push([x, y]);
    if (out.length >= count) break;
  }
  return out;
}

/**
 * Circumference support of the circle (cx, cy, r): the share of ARC_SAMPLES
 * directions with an edge pixel within a pixel of the circle whose gradient
 * is radial (|cos| ≥ 0.85). Arcs outside the frame do not count against it.
 */
function support(e: Edges, cx: number, cy: number, r: number): number {
  let inside = 0;
  let hit = 0;
  for (let k = 0; k < ARC_SAMPLES; k += 1) {
    const a = (k / ARC_SAMPLES) * Math.PI * 2;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const x0 = cx + ux * r;
    const y0 = cy + uy * r;
    if (x0 < 1 || y0 < 1 || x0 >= e.width - 1 || y0 >= e.height - 1) continue;
    inside += 1;
    for (const d of [0, -0.7, 0.7, -1.2, 1.2]) {
      const i = Math.round(cy + uy * (r + d)) * e.width + Math.round(cx + ux * (r + d));
      if (e.mag[i]! > 0 && Math.abs(e.gx[i]! * ux + e.gy[i]! * uy) >= 0.85) {
        hit += 1;
        break;
      }
    }
  }
  // A circle mostly off the frame is not a subject.
  return inside < ARC_SAMPLES * 0.5 ? 0 : hit / inside;
}

/**
 * Radii around a centre: a histogram of the distances of edge pixels whose
 * gradient points at it, weighted by gradient strength; its peaks are the
 * rings (a disc's rim, a pupil inside an iris).
 */
function ringRadii(e: Edges, x: number, y: number, rMin: number, rMax: number): number[] {
  const hist = new Float32Array(rMax + 3);
  for (const i of e.list) {
    const px = i % e.width;
    const py = (i - px) / e.width;
    const dx = px - x;
    const dy = py - y;
    const d = Math.hypot(dx, dy);
    if (d < rMin - 1 || d > rMax + 1) continue;
    if (Math.abs((e.gx[i]! * dx + e.gy[i]! * dy) / d) < 0.85) continue;
    // Normalised by circumference, so big rings do not win by length alone.
    hist[Math.round(d)]! += e.mag[i]! / d;
  }
  const smooth = (r: number) => (hist[r - 1] ?? 0) + 2 * (hist[r] ?? 0) + (hist[r + 1] ?? 0);
  const out: Array<[number, number]> = [];
  for (let r = rMin; r <= rMax; r += 1) {
    const v = smooth(r);
    if (v > 0 && v >= smooth(r - 1) && v > smooth(r + 1)) out.push([r, v]);
  }
  return out.sort((a, b) => b[1] - a[1]).slice(0, 4).map(([r]) => r);
}

/**
 * Least-squares circle through the edge pixels near (cx, cy, r) whose
 * gradient is radial (Kåsa fit: minimise Σ w·(x² + y² + D·x + E·y + F)²,
 * weights = gradient strength), for a sub-pixel centre and radius.
 */
function refineCircle(e: Edges, cx: number, cy: number, r: number): { cx: number; cy: number; r: number } {
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const v = [0, 0, 0];
  for (const i of e.list) {
    const x = i % e.width;
    const y = (i - x) / e.width;
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d < 1 || Math.abs(d - r) > 2.5) continue;
    if (Math.abs((e.gx[i]! * dx + e.gy[i]! * dy) / d) < 0.85) continue;
    const w = e.mag[i]!;
    const z = -(x * x + y * y);
    const row = [x, y, 1];
    for (let a = 0; a < 3; a += 1) {
      for (let b = 0; b < 3; b += 1) m[a * 3 + b]! += w * row[a]! * row[b]!;
      v[a]! += w * row[a]! * z;
    }
  }
  const det = (q: number[]) => q[0]! * (q[4]! * q[8]! - q[5]! * q[7]!) - q[1]! * (q[3]! * q[8]! - q[5]! * q[6]!) + q[2]! * (q[3]! * q[7]! - q[4]! * q[6]!);
  const base = det(m);
  if (!(Math.abs(base) > 1e-9)) return { cx, cy, r };
  // Cramer's rule for [D, E, F].
  const solve = (col: number) => det(m.map((value, k) => (k % 3 === col ? v[Math.floor(k / 3)]! : value))) / base;
  const D = solve(0);
  const E = solve(1);
  const F = solve(2);
  const fx = -D / 2;
  const fy = -E / 2;
  const fr = Math.sqrt(Math.max(0, fx * fx + fy * fy - F));
  // A fit that wandered off (too few pixels) keeps the coarse circle.
  return Math.hypot(fx - cx, fy - cy) < 3 && Math.abs(fr - r) < 3 ? { cx: fx, cy: fy, r: fr } : { cx, cy, r };
}

/**
 * How different the inside of a ring is from the outside (0..1): the mean
 * luma just inside against just outside. A disc, a rim or a pupil has a
 * clear step; arcs of texture (grooves, swirls, wood grain) do not.
 */
function ringContrast(g: Gray, cx: number, cy: number, r: number): number {
  let inner = 0;
  let outer = 0;
  let ni = 0;
  let no = 0;
  for (let k = 0; k < ARC_SAMPLES; k += 1) {
    const a = (k / ARC_SAMPLES) * Math.PI * 2;
    for (const [f, side] of [
      [0.8, -1],
      [0.9, -1],
      [1.1, 1],
      [1.2, 1],
    ] as const) {
      const x = Math.round(cx + Math.cos(a) * r * f);
      const y = Math.round(cy + Math.sin(a) * r * f);
      if (x < 0 || y < 0 || x >= g.width || y >= g.height) continue;
      const v = g.data[y * g.width + x]!;
      if (side < 0) {
        inner += v;
        ni += 1;
      } else {
        outer += v;
        no += 1;
      }
    }
  }
  return ni > 0 && no > 0 ? Math.abs(inner / ni - outer / no) / 255 : 0;
}

/** The rings around a centre peak with enough circumference support, refined. */
function circlesAt(g: Gray, e: Edges, x: number, y: number, rMin: number, rMax: number): Found[] {
  const out: Found[] = [];
  for (const r0 of ringRadii(e, x, y, rMin, rMax)) {
    const c = refineCircle(e, x, y, r0);
    const score = support(e, c.cx, c.cy, c.r);
    if (score < MIN_SCORE) continue;
    // A faint step (below ~10% of full scale) halves the rank: texture, not an object.
    const contrast = 0.5 + 0.5 * Math.min(1, ringContrast(g, c.cx, c.cy, c.r) * 10);
    // Match-cut subjects are framed near the middle: a circle in a corner ranks up to a third lower.
    const offCentre = Math.min(1, Math.hypot(c.cx / g.width - 0.5, c.cy / g.height - 0.5) / 0.5);
    out.push({ ...c, score, rank: score * contrast * (1 - 0.35 * offCentre) });
  }
  return out;
}

interface Found {
  cx: number;
  cy: number;
  r: number;
  /** Circumference support. */
  score: number;
  /** Support weighed by the inside/outside contrast: the order candidates are offered in. */
  rank: number;
}

/** Circles in `image`, best first. */
export function detectCircles(image: RgbaImage, options: CircleOptions = {}): CircleCandidate[] {
  if (image.width < 8 || image.height < 8) return [];
  const shrunk = shrinkLuma(image, WORK_EDGE);
  const gray = blur3(shrunk);
  const edges = sobelEdges(gray);
  if (edges.list.length === 0) return [];
  const h = gray.height;
  const rMin = Math.max(3, Math.round((options.minRadius ?? 0.04) * h));
  const rMax = Math.max(rMin, Math.round((options.maxRadius ?? 0.6) * h));
  const acc = voteCentres(edges, rMin, rMax);
  const limit = options.limit ?? 5;
  const circles: Found[] = [];
  for (const [x, y] of peaks(acc, edges.width, edges.height, Math.max(24, limit * 6), Math.max(2, rMin / 2))) {
    for (const c of circlesAt(gray, edges, x, y, rMin, rMax)) {
      // The same circle seen from a neighbouring peak.
      const same = circles.findIndex((o) => Math.hypot(o.cx - c.cx, o.cy - c.cy) < Math.max(3, c.r * 0.25) && Math.abs(o.r - c.r) < Math.max(3, c.r * 0.25));
      if (same < 0) circles.push(c);
      else if (c.rank > circles[same]!.rank) circles[same] = c;
    }
  }
  // Rings around one centre (iris and pupil, record and label): the outer one is the
  // silhouette, so a well-supported one ranks first unless it is much weaker.
  const concentric = (a: Found, b: Found) => Math.hypot(a.cx - b.cx, a.cy - b.cy) < Math.min(a.r, b.r) * 0.3;
  const rank = (c: Found) => c.rank + (c.score >= 0.6 && circles.some((o) => o !== c && o.r < c.r * 0.85 && o.score >= 0.6 && concentric(o, c)) ? OUTER_BONUS : 0);
  circles.sort((a, b) => rank(b) - rank(a) || b.r - a.r);
  // Work pixel x covers source pixels [x·f, (x+1)·f): its centre is at (x + 0.5)·f.
  const f = shrunk.factor;
  return circles.slice(0, limit).map((c) => {
    const cx = ((c.cx + 0.5) * f) / image.width;
    const cy = ((c.cy + 0.5) * f) / image.height;
    const rw = (c.r * f) / image.width;
    const rh = (c.r * f) / image.height;
    return {
      cx,
      cy,
      r: rh,
      score: Math.round(c.score * 1000) / 1000,
      box: { x: cx - rw, y: cy - rh, w: 2 * rw, h: 2 * rh },
    };
  });
}
