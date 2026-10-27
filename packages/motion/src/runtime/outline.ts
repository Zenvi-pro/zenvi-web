/**
 * Outlines of text set in the bundled faces, for morphing letters. The
 * page has the fonts but no glyph-path API, so the text is drawn into a
 * canvas and its coverage traced back into rings (marching squares,
 * sub-pixel edges from the antialiased alpha). Same Chrome, same fonts:
 * the same rings every render.
 */

import { toOutline, type Outline, type Point } from "./morph.js";

/**
 * Closed contours of `values` (row-major, w × h) at `threshold`; the grid
 * is padded with 0 so every contour closes. Rings smaller than `minArea`
 * px² (antialiasing specks) are dropped.
 */
export function traceContours(values: ArrayLike<number>, w: number, h: number, threshold = 128, minArea = 4): Point[][] {
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : values[y * w + x]!);
  // Crossing points keyed by edge: horizontal edge (x,y)-(x+1,y) is 2·id, vertical (x,y)-(x,y+1) is 2·id+1.
  const stride = w + 2;
  const key = (x: number, y: number, vertical: boolean): number => ((y + 1) * stride + (x + 1)) * 2 + (vertical ? 1 : 0);
  const points = new Map<number, Point>();
  const links = new Map<number, number[]>();
  const point = (x: number, y: number, vertical: boolean): number => {
    const k = key(x, y, vertical);
    if (!points.has(k)) {
      const a = at(x, y);
      const b = vertical ? at(x, y + 1) : at(x + 1, y);
      const u = a === b ? 0.5 : (threshold - a) / (b - a);
      points.set(k, vertical ? { x, y: y + u } : { x: x + u, y });
    }
    return k;
  };
  const link = (p: number, q: number): void => {
    (links.get(p) ?? links.set(p, []).get(p)!).push(q);
    (links.get(q) ?? links.set(q, []).get(q)!).push(p);
  };
  for (let y = -1; y < h; y += 1) {
    for (let x = -1; x < w; x += 1) {
      const tl = at(x, y) >= threshold;
      const tr = at(x + 1, y) >= threshold;
      const br = at(x + 1, y + 1) >= threshold;
      const bl = at(x, y + 1) >= threshold;
      const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = (): number => point(x, y, false);
      const bottom = (): number => point(x, y + 1, false);
      const left = (): number => point(x, y, true);
      const right = (): number => point(x + 1, y, true);
      switch (code) {
        case 1: case 14: link(left(), bottom()); break;
        case 2: case 13: link(bottom(), right()); break;
        case 3: case 12: link(left(), right()); break;
        case 4: case 11: link(top(), right()); break;
        case 6: case 9: link(top(), bottom()); break;
        case 7: case 8: link(left(), top()); break;
        case 5: case 10: {
          // Saddle: the centre's average decides whether the two inside corners join.
          const centre = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4 >= threshold;
          if ((code === 5) === centre) {
            link(left(), top());
            link(bottom(), right());
          } else {
            link(left(), bottom());
            link(top(), right());
          }
        }
      }
    }
  }
  const rings: Point[][] = [];
  const used = new Set<number>();
  for (const start of links.keys()) {
    if (used.has(start)) continue;
    const ring: Point[] = [];
    let prev = -1;
    let cur = start;
    while (!used.has(cur)) {
      used.add(cur);
      ring.push(points.get(cur)!);
      const next = links.get(cur)!.find((n) => n !== prev && !used.has(n));
      if (next === undefined) break;
      prev = cur;
      cur = next;
    }
    let area = 0;
    for (let i = 0; i < ring.length; i += 1) area += ring[i]!.x * ring[(i + 1) % ring.length]!.y - ring[(i + 1) % ring.length]!.x * ring[i]!.y;
    if (Math.abs(area / 2) >= minArea) rings.push(ring);
  }
  return rings;
}

export interface TextOutline {
  outline: Outline;
  /** The text's advance width and line box (ascent + descent), px; the outline's origin is the box's top left. */
  width: number;
  height: number;
}

/**
 * The outline of `text` in CSS font `font` (e.g. `800 300px Inter`), or null
 * where there is no 2D canvas (jsdom).
 */
export function textOutline(doc: Document, text: string, font: string, letterSpacing = 0): TextOutline | null {
  const canvas = doc.createElement("canvas");
  let g: CanvasRenderingContext2D | null = null;
  try {
    g = canvas.getContext("2d");
  } catch {
    g = null;
  }
  if (!g) return null;
  g.font = font;
  if (letterSpacing) g.letterSpacing = `${letterSpacing}px`;
  const m = g.measureText(text);
  const ascent = m.fontBoundingBoxAscent || m.actualBoundingBoxAscent;
  const descent = m.fontBoundingBoxDescent || m.actualBoundingBoxDescent;
  // Glyphs can overhang their advance (italics, round letters): pad the canvas.
  const pad = Math.ceil((ascent + descent) * 0.25);
  const w = Math.ceil(m.width + pad * 2);
  const h = Math.ceil(ascent + descent + pad * 2);
  canvas.width = w;
  canvas.height = h;
  g.font = font;
  if (letterSpacing) g.letterSpacing = `${letterSpacing}px`;
  g.fillStyle = "#000";
  g.textBaseline = "alphabetic";
  g.fillText(text, pad, pad + ascent);
  const data = g.getImageData(0, 0, w, h).data;
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = data[i * 4 + 3]!;
  const rings = traceContours(alpha, w, h).map((r) => r.map((p) => ({ x: p.x - pad, y: p.y - pad })));
  return { outline: toOutline(rings), width: m.width, height: ascent + descent };
}
