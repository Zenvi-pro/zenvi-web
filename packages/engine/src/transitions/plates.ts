/**
 * Plates for the occluder plate wipe (T103: a blob, a burst, a disc that
 * fills the lens and hides the cut): original shapes drawn as SVG, square,
 * centred, with the share of the half side they surely cover (the radius of
 * the largest circle inside them), so the wipe knows the scale at which a
 * plate covers the frame. Pure.
 */

export const PLATE_SHAPES = ["blob", "burst", "circle"] as const;
export type PlateShape = (typeof PLATE_SHAPES)[number];

export interface PlateDrawing {
  svg: string;
  /** Side of the square drawing, px. */
  size: number;
  /** Radius of the largest circle the shape covers, as a share of half the side. */
  inscribed: number;
}

const f = (v: number) => (Math.round(v * 100) / 100).toString();

/** A closed smooth path through `pts` (Catmull-Rom as cubic beziers). */
function smoothClosed(pts: readonly [number, number][]): string {
  const n = pts.length;
  const at = (i: number) => pts[((i % n) + n) % n]!;
  let d = `M${f(at(0)[0])} ${f(at(0)[1])}`;
  for (let i = 0; i < n; i += 1) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0]!)} ${f(c1[1]!)} ${f(c2[0]!)} ${f(c2[1]!)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d}Z`;
}

/**
 * The plate `shape` in `color` (#rrggbb), `size` px square. The blob's
 * lobes come from two fixed sine harmonics, so the same call draws the same
 * blob (a plate re-applied looks the same).
 */
export function plateSvg(shape: PlateShape, color: string, size: number): PlateDrawing {
  const c = size / 2;
  const R = 0.48 * size;
  let body: string;
  let inscribed: number;
  if (shape === "circle") {
    body = `<circle cx="${f(c)}" cy="${f(c)}" r="${f(R)}" fill="${color}"/>`;
    inscribed = R / c;
  } else if (shape === "burst") {
    const spikes = 14;
    const inner = 0.72 * R;
    const pts: string[] = [];
    for (let i = 0; i < 2 * spikes; i += 1) {
      const a = (Math.PI * i) / spikes - Math.PI / 2;
      const r = i % 2 === 0 ? R : inner;
      pts.push(`${f(c + r * Math.cos(a))},${f(c + r * Math.sin(a))}`);
    }
    body = `<polygon points="${pts.join(" ")}" fill="${color}"/>`;
    // The edges run outward from the inner corners, so those corners are the nearest points to the centre.
    inscribed = inner / c;
  } else {
    const samples = 36;
    const radius = (a: number) => R * (0.86 + 0.08 * Math.sin(5 * a + 0.7) + 0.05 * Math.sin(9 * a + 2.1));
    const pts = Array.from({ length: samples }, (_, i): [number, number] => {
      const a = (2 * Math.PI * i) / samples;
      const r = radius(a);
      return [c + r * Math.cos(a), c + r * Math.sin(a)];
    });
    body = `<path d="${smoothClosed(pts)}" fill="${color}"/>`;
    // Lowest point of the radius (sampled finely), less a little for the curve between samples.
    let low = Infinity;
    for (let i = 0; i < 720; i += 1) low = Math.min(low, radius((2 * Math.PI * i) / 720));
    inscribed = (0.97 * low) / c;
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>\n`, size, inscribed };
}
