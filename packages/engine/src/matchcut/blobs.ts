/**
 * Shapes that are not circles, for match cuts on a silhouette, a window, a
 * phone, a sun behind haze: the regions that stand out from the frame by
 * brightness, with their centre, box and how sure the split is.
 *
 *   1. luma, shrunk so the longest edge is at most WORK_EDGE pixels, blurred;
 *   2. one threshold between the frame's two tone groups (Otsu's method);
 *   3. the connected regions on each side of it (4-neighbour);
 *   4. regions that are specks, most of the frame or the background (they
 *      touch two or more edges) are dropped; the rest are scored by their
 *      contrast with a ring around them, how much of their box they fill and
 *      their size, and returned best first.
 *
 * Coordinates are normalised to the frame (0-1), like circles.ts.
 */

import type { RgbaImage } from "../render/types.js";
import { blur3, shrinkLuma, type Gray } from "./circles.js";
import type { SubjectBox } from "./fit.js";

export interface BlobCandidate {
  /** Centroid, 0-1 of the frame width / height. */
  cx: number;
  cy: number;
  /** Radius of a disc of the same area, as a fraction of the frame height. */
  r: number;
  /** 0..1: contrast with the surroundings, box fill and size together. */
  score: number;
  /** Bounding box on the frame, 0-1. */
  box: SubjectBox;
  /** Brighter or darker than what is around it. */
  tone: "bright" | "dark";
}

export interface BlobOptions {
  /** Smallest region kept, as a fraction of the frame's area (default 0.002). */
  minArea?: number;
  /** How many regions to return at most (default 5). */
  limit?: number;
}

const WORK_EDGE = 200;
/** Regions larger than this share of the frame are the background. */
const MAX_AREA = 0.6;
/** Contrast (0..1 of full scale) at which a region scores fully. */
const FULL_CONTRAST = 0.3;
/** Region size (sqrt of its area share) at which it scores fully. */
const FULL_SIZE = 0.2;

/** Otsu's threshold: the luma that best splits the histogram into two groups. */
function otsu(g: Gray): number {
  const hist = new Float64Array(256);
  for (const v of g.data) hist[Math.max(0, Math.min(255, Math.round(v)))]! += 1;
  const total = g.data.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i += 1) sumAll += i * hist[i]!;
  let below = 0;
  let sumBelow = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t += 1) {
    below += hist[t]!;
    if (below === 0 || below === total) continue;
    sumBelow += t * hist[t]!;
    const meanBelow = sumBelow / below;
    const meanAbove = (sumAll - sumBelow) / (total - below);
    const between = below * (total - below) * (meanBelow - meanAbove) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold + 0.5;
}

interface Region {
  bright: boolean;
  area: number;
  sumX: number;
  sumY: number;
  sumLuma: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function regions(g: Gray, threshold: number): Region[] {
  const { width, height, data } = g;
  const label = new Int32Array(width * height).fill(-1);
  const out: Region[] = [];
  const stack: number[] = [];
  for (let start = 0; start < data.length; start += 1) {
    if (label[start] !== -1) continue;
    const bright = data[start]! > threshold;
    const region: Region = { bright, area: 0, sumX: 0, sumY: 0, sumLuma: 0, x0: width, y0: height, x1: -1, y1: -1 };
    const id = out.length;
    label[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      region.area += 1;
      region.sumX += x;
      region.sumY += y;
      region.sumLuma += data[i]!;
      region.x0 = Math.min(region.x0, x);
      region.x1 = Math.max(region.x1, x);
      region.y0 = Math.min(region.y0, y);
      region.y1 = Math.max(region.y1, y);
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) {
        if (j < 0 || label[j] !== -1 || data[j]! > threshold !== bright) continue;
        label[j] = id;
        stack.push(j);
      }
    }
    out.push(region);
  }
  return out;
}

/** Mean luma of the ring of pixels just outside a box (a quarter of its size wide). */
function ringMean(g: Gray, r: Region): number {
  const padX = Math.max(1, Math.round((r.x1 - r.x0 + 1) / 4));
  const padY = Math.max(1, Math.round((r.y1 - r.y0 + 1) / 4));
  const X0 = Math.max(0, r.x0 - padX);
  const X1 = Math.min(g.width - 1, r.x1 + padX);
  const Y0 = Math.max(0, r.y0 - padY);
  const Y1 = Math.min(g.height - 1, r.y1 + padY);
  let sum = 0;
  let n = 0;
  for (let y = Y0; y <= Y1; y += 1) {
    for (let x = X0; x <= X1; x += 1) {
      if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) continue;
      sum += g.data[y * g.width + x]!;
      n += 1;
    }
  }
  return n > 0 ? sum / n : NaN;
}

/** Regions that stand out from `image` by brightness, best first. */
export function detectBlobs(image: RgbaImage, options: BlobOptions = {}): BlobCandidate[] {
  if (image.width < 8 || image.height < 8) return [];
  const shrunk = shrinkLuma(image, WORK_EDGE);
  const gray = blur3(blur3(shrunk));
  const total = gray.width * gray.height;
  const threshold = otsu(gray);
  const minArea = Math.max(4, (options.minArea ?? 0.002) * total);
  const found: BlobCandidate[] = [];
  for (const r of regions(gray, threshold)) {
    if (r.area < minArea || r.area > MAX_AREA * total) continue;
    const edges = Number(r.x0 === 0) + Number(r.y0 === 0) + Number(r.x1 === gray.width - 1) + Number(r.y1 === gray.height - 1);
    if (edges >= 2) continue;
    const ring = ringMean(gray, r);
    if (!Number.isFinite(ring)) continue;
    const contrast = Math.abs(r.sumLuma / r.area - ring) / 255;
    const boxArea = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    const fill = r.area / boxArea;
    const size = Math.sqrt(r.area / total);
    const score = Math.min(1, contrast / FULL_CONTRAST) * (0.5 + 0.5 * fill) * Math.min(1, size / FULL_SIZE) ** 0.5 * (edges === 1 ? 0.7 : 1);
    // Work pixel x covers source pixels [x·f, (x+1)·f).
    const f = shrunk.factor;
    const W = image.width;
    const H = image.height;
    found.push({
      cx: ((r.sumX / r.area + 0.5) * f) / W,
      cy: ((r.sumY / r.area + 0.5) * f) / H,
      r: (Math.sqrt(r.area / Math.PI) * f) / H,
      score: Math.round(score * 1000) / 1000,
      box: { x: (r.x0 * f) / W, y: (r.y0 * f) / H, w: ((r.x1 - r.x0 + 1) * f) / W, h: ((r.y1 - r.y0 + 1) * f) / H },
      tone: r.bright ? "bright" : "dark",
    });
  }
  found.sort((a, b) => b.score - a.score);
  return found.slice(0, options.limit ?? 5);
}
