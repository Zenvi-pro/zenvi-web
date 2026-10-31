/**
 * Pyramidal Lucas-Kanade point tracking (Bouguet, "Pyramidal implementation
 * of the Lucas Kanade feature tracker", 2001; the algorithm behind OpenCV's
 * calcOpticalFlowPyrLK, which zenvi-core's desktop Tracker builds on) and
 * Shi-Tomasi corners to seed it.
 */

import { gradients, pyramid, sample, type GrayImage } from "./gray.js";

export interface Point {
  x: number;
  y: number;
}

/** A frame ready to track from or to: its pyramid and the gradients of every level. */
export interface PreparedFrame {
  levels: GrayImage[];
  gx: GrayImage[];
  gy: GrayImage[];
}

const LEVELS = 4;
/** Half the integration window, pixels (a 15×15 window). */
const RADIUS = 7;
const ITERATIONS = 20;
/** Stop iterating when the update is smaller than this, pixels. */
const EPSILON = 0.01;
/**
 * Windows flatter than this cannot be tracked: the smallest eigenvalue of the
 * structure tensor per pixel, grey levels² (about a 1-level-per-pixel ramp).
 */
const MIN_EIGEN = 0.5;

export function prepareFrame(gray: GrayImage): PreparedFrame {
  const levels = pyramid(gray, LEVELS);
  const grads = levels.map(gradients);
  return { levels, gx: grads.map((g) => g.gx), gy: grads.map((g) => g.gy) };
}

function minEigen(gxx: number, gxy: number, gyy: number): number {
  return (gxx + gyy - Math.sqrt((gxx - gyy) ** 2 + 4 * gxy * gxy)) / 2;
}

/** Where each of `points` (pixels of `from`) went in `to`; null where it was lost. */
export function trackPoints(from: PreparedFrame, to: PreparedFrame, points: readonly Point[], guesses?: readonly Point[]): (Point | null)[] {
  const top = Math.min(from.levels.length, to.levels.length) - 1;
  const n = (2 * RADIUS + 1) ** 2;
  const ix = new Float32Array(n);
  const iy = new Float32Array(n);
  const iv = new Float32Array(n);
  const w0 = from.levels[0]!.width;
  const h0 = from.levels[0]!.height;
  return points.map((pt, index) => {
    const guess = guesses?.[index];
    let gx = guess ? (guess.x - pt.x) / 2 ** top : 0;
    let gy = guess ? (guess.y - pt.y) / 2 ** top : 0;
    for (let level = top; level >= 0; level -= 1) {
      const scale = 2 ** level;
      const px = pt.x / scale;
      const py = pt.y / scale;
      const I = from.levels[level]!;
      const J = to.levels[level]!;
      let gxx = 0;
      let gxy = 0;
      let gyy = 0;
      let k = 0;
      for (let dy = -RADIUS; dy <= RADIUS; dy += 1) {
        for (let dx = -RADIUS; dx <= RADIUS; dx += 1, k += 1) {
          const a = sample(from.gx[level]!, px + dx, py + dy);
          const b = sample(from.gy[level]!, px + dx, py + dy);
          ix[k] = a;
          iy[k] = b;
          iv[k] = sample(I, px + dx, py + dy);
          gxx += a * a;
          gxy += a * b;
          gyy += b * b;
        }
      }
      if (minEigen(gxx, gxy, gyy) / n < MIN_EIGEN) return null;
      const det = gxx * gyy - gxy * gxy;
      let vx = 0;
      let vy = 0;
      for (let it = 0; it < ITERATIONS; it += 1) {
        let bx = 0;
        let by = 0;
        k = 0;
        const qx = px + gx + vx;
        const qy = py + gy + vy;
        for (let dy = -RADIUS; dy <= RADIUS; dy += 1) {
          for (let dx = -RADIUS; dx <= RADIUS; dx += 1, k += 1) {
            const diff = iv[k]! - sample(J, qx + dx, qy + dy);
            bx += diff * ix[k]!;
            by += diff * iy[k]!;
          }
        }
        const ux = (gyy * bx - gxy * by) / det;
        const uy = (gxx * by - gxy * bx) / det;
        vx += ux;
        vy += uy;
        if (ux * ux + uy * uy < EPSILON * EPSILON) break;
      }
      if (level > 0) {
        gx = 2 * (gx + vx);
        gy = 2 * (gy + vy);
      } else {
        gx += vx;
        gy += vy;
      }
    }
    const x = pt.x + gx;
    const y = pt.y + gy;
    if (!(Number.isFinite(x) && Number.isFinite(y)) || x < 0 || y < 0 || x > w0 - 1 || y > h0 - 1) return null;
    return { x, y };
  });
}

/**
 * Up to `max` Shi-Tomasi corners inside the polygon `region` (pixels of
 * level 0), strongest first, at least `spacing` pixels apart. Flat regions
 * give few or none.
 */
export function goodFeatures(frame: PreparedFrame, region: readonly Point[], max: number, spacing: number): Point[] {
  const img = frame.levels[0]!;
  const gx = frame.gx[0]!.data;
  const gy = frame.gy[0]!.data;
  const w = img.width;
  const xs = region.map((p) => p.x);
  const ys = region.map((p) => p.y);
  const block = 2;
  const x0 = Math.max(block + 1, Math.floor(Math.min(...xs)));
  const x1 = Math.min(w - block - 2, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(block + 1, Math.floor(Math.min(...ys)));
  const y1 = Math.min(img.height - block - 2, Math.ceil(Math.max(...ys)));
  if (x1 < x0 || y1 < y0) return [];
  const step = Math.max(1, Math.floor(spacing / 3));
  const candidates: { x: number; y: number; score: number }[] = [];
  let best = 0;
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      if (!inside(region, x, y)) continue;
      let gxx = 0;
      let gxy = 0;
      let gyy = 0;
      for (let dy = -block; dy <= block; dy += 1) {
        for (let dx = -block; dx <= block; dx += 1) {
          const i = (y + dy) * w + x + dx;
          gxx += gx[i]! * gx[i]!;
          gxy += gx[i]! * gy[i]!;
          gyy += gy[i]! * gy[i]!;
        }
      }
      const score = minEigen(gxx, gxy, gyy);
      if (score > best) best = score;
      candidates.push({ x, y, score });
    }
  }
  const floor = Math.max(best * 0.02, (2 * block + 1) ** 2 * MIN_EIGEN * 4);
  candidates.sort((a, b) => b.score - a.score);
  const out: Point[] = [];
  const s2 = spacing * spacing;
  for (const c of candidates) {
    if (c.score < floor || out.length >= max) break;
    if (out.some((p) => (p.x - c.x) ** 2 + (p.y - c.y) ** 2 < s2)) continue;
    out.push({ x: c.x, y: c.y });
  }
  return out;
}

/** Point in polygon (even-odd). */
export function inside(polygon: readonly Point[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
