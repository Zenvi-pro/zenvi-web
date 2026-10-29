/**
 * Generated SVG mask images for effect masks (EffectBase `mask_reader`,
 * kernels/effect-mask.ts) and the Mask effect (kernels/mask.ts): a
 * vignette's falloff, and feathered rectangles and ellipses.
 *
 * A shape is drawn as a signed distance field, not a hard shape: grey 128 on
 * its edge, brighter inside, darker outside, linear over `range` pixels each
 * way. The Mask effect's contrast then sets the feather and its brightness
 * moves the edge (Mask.cpp:77-91), so both keyframe without a new image:
 * an iris that opens, a box that grows. Pure.
 */

export type MaskShape = "rectangle" | "ellipse" | "polygon";

/** A point on the frame, 0..1 from the top left. */
export interface MaskPoint {
  x: number;
  y: number;
}

export interface ShapeSpec {
  shape: MaskShape;
  /** polygon: its corners in order (either winding), 0..1 of the frame; x, y, width and height are ignored. */
  points?: readonly MaskPoint[];
  /** Centre, 0..1 of the frame. */
  x: number;
  y: number;
  /** Size, 0..1 of the frame. */
  width: number;
  height: number;
}

const f = (v: number) => (Math.round(v * 100) / 100).toString();
const gray = (v: number) => {
  const g = Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${g},${g},${g})`;
};

/** Distance a shape mask's field spans each side of the edge: half the frame's short side. */
export function maskRange(w: number, h: number): number {
  return 0.5 * Math.min(w, h);
}

function svg(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>\n`;
}

/**
 * A vignette's mask: black (untouched) in the middle, white (the darkening
 * fully on) in the corners, an ellipse of the frame's shape. `feather` 0
 * keeps the middle clean and falls off late and fast; 1 starts near the
 * centre and falls off gently.
 */
export function vignetteSvg(w: number, h: number, feather: number): string {
  const k = Math.min(1, Math.max(0, feather));
  // Radii in units of the half frame (1 = the frame's edge midpoints, √2 = its corners).
  const corner = Math.SQRT2;
  const inner = 1.2 - 0.8 * k;
  const outer = Math.min(corner, inner + 0.2 + 0.5 * k);
  const o = (rho: number) => f(Math.min(1, rho / corner));
  const stops =
    `<stop offset="${o(inner)}" stop-color="${gray(0)}"/>` +
    `<stop offset="${o((inner + outer) / 2)}" stop-color="${gray(0.3)}"/>` +
    `<stop offset="${o(outer)}" stop-color="${gray(1)}"/>`;
  return svg(
    w,
    h,
    `<defs><radialGradient id="v" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${f(corner)}" gradientTransform="translate(${f(w / 2)} ${f(h / 2)}) scale(${f(w / 2)} ${f(h / 2)})">${stops}</radialGradient></defs>` +
      `<rect width="${w}" height="${h}" fill="url(#v)"/>`,
  );
}

/** A shape's distance field, `range` pixels each side of its edge (maskRange). */
export function shapeMaskSvg(w: number, h: number, spec: ShapeSpec): string {
  const range = maskRange(w, h);
  const cx = spec.x * w;
  const cy = spec.y * h;
  const hw = Math.max(0.5, (spec.width * w) / 2);
  const hh = Math.max(0.5, (spec.height * h) / 2);
  if (spec.shape === "polygon") return polygonMaskSvg(w, h, (spec.points ?? []).map((p) => [p.x * w, p.y * h]));
  if (spec.shape === "ellipse") {
    // Distance from the edge is (1 - ρ)·min(a, b) in the ellipse's own units: exact for a circle, close for an ellipse.
    const m = Math.min(hw, hh);
    const out = 1 + range / m;
    const inn = 1 - range / m;
    const stops =
      `<stop offset="0" stop-color="${gray(0.5 + (0.5 * m) / range)}"/>` +
      (inn > 0 ? `<stop offset="${f(inn / out)}" stop-color="${gray(1)}"/>` : "") +
      `<stop offset="1" stop-color="${gray(0)}"/>`;
    return svg(
      w,
      h,
      `<defs><radialGradient id="e" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${f(out)}" gradientTransform="translate(${f(cx)} ${f(cy)}) scale(${f(hw)} ${f(hh)})">${stops}</radialGradient></defs>` +
        `<rect width="${w}" height="${h}" fill="url(#e)"/>`,
    );
  }
  // A rectangle: four regions split along the diagonals from its corners to its medial ridge, each a linear ramp from its own edge.
  const far = 2 * (w + h);
  const ridge = Math.abs(hw - hh);
  const a: [number, number] = hw >= hh ? [cx - ridge, cy] : [cx, cy - ridge];
  const b: [number, number] = hw >= hh ? [cx + ridge, cy] : [cx, cy + ridge];
  const tl: [number, number] = [cx - hw, cy - hh];
  const tr: [number, number] = [cx + hw, cy - hh];
  const br: [number, number] = [cx + hw, cy + hh];
  const bl: [number, number] = [cx - hw, cy + hh];
  const anchor = (c: [number, number]) => (hw >= hh ? (c[0] < cx ? a : b) : c[1] < cy ? a : b);
  const out = (c: [number, number]): [number, number] => {
    const [ax, ay] = anchor(c);
    const dx = c[0] - ax;
    const dy = c[1] - ay;
    const len = Math.hypot(dx, dy) || 1;
    return [c[0] + (dx / len) * far, c[1] + (dy / len) * far];
  };
  const poly = (pts: [number, number][]) => pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" ");
  const ramp = (id: string, x1: number, y1: number, x2: number, y2: number) =>
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"><stop offset="0" stop-color="${gray(0)}"/><stop offset="1" stop-color="${gray(1)}"/></linearGradient>`;
  const top = cy - hh;
  const bottom = cy + hh;
  const left = cx - hw;
  const right = cx + hw;
  const defs =
    ramp("t", 0, top - range, 0, top + range) +
    ramp("b", 0, bottom + range, 0, bottom - range) +
    ramp("l", left - range, 0, left + range, 0) +
    ramp("r", right + range, 0, right - range, 0);
  // Each region is stroked with its own ramp too, so no hairline shows where two meet.
  const region = (id: string, pts: [number, number][]) => `<polygon points="${poly(pts)}" fill="url(#${id})" stroke="url(#${id})" stroke-width="1.5"/>`;
  return svg(
    w,
    h,
    `<defs>${defs}</defs>` +
      region("t", [anchor(tl), tl, out(tl), out(tr), tr, anchor(tr)]) +
      region("b", [anchor(bl), bl, out(bl), out(br), br, anchor(br)]) +
      region("l", [anchor(tl), tl, out(tl), out(bl), bl, anchor(bl)]) +
      region("r", [anchor(tr), tr, out(tr), out(br), br, anchor(br)]),
  );
}

type Vec = readonly [number, number];

/** Twice the signed area (positive: clockwise on screen, y down). */
function area2(pts: readonly Vec[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a;
}

/**
 * Why `pts` (px) cannot be a polygon mask, or null: at least 3 corners, no
 * zero-length side, convex (each turn the same way, no straight-through
 * corner), not self-intersecting.
 */
export function polygonProblem(pts: readonly Vec[]): string | null {
  if (pts.length < 3) return "a polygon needs at least 3 points";
  const n = pts.length;
  let sign = 0;
  for (let i = 0; i < n; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const c = pts[(i + 2) % n]!;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.5) return `points ${i + 1} and ${((i + 1) % n) + 1} are the same`;
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-6) return `point ${((i + 1) % n) + 1} lies on the line through its neighbours`;
    if (sign !== 0 && Math.sign(cross) !== sign) return `the polygon is not convex at point ${((i + 1) % n) + 1}`;
    sign = Math.sign(cross);
  }
  // Every turn the same way can still wind twice round (a pentagram): its turns then add up past 360°.
  let turn = 0;
  for (let i = 0; i < n; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const c = pts[(i + 2) % n]!;
    const t = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
    turn += Math.atan2(Math.sin(t), Math.cos(t));
  }
  return Math.abs(Math.abs(turn) - 2 * Math.PI) > 1e-3 ? "the polygon crosses itself" : null;
}

/** `poly` clipped to the half-plane n·p <= c (Sutherland-Hodgman, one edge). */
function clipHalf(poly: readonly Vec[], n: Vec, c: number): Vec[] {
  const out: Vec[] = [];
  const side = (p: Vec) => n[0] * p[0] + n[1] * p[1] - c;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const sp = side(p);
    const sq = side(q);
    if (sp <= 0) out.push(p);
    if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return out;
}

/** One side's share of a polygon's distance field: where that side is the nearest, and its ramp (grey 0 at `from`, 1 at `to`). */
export interface PolygonRegion {
  region: Vec[];
  from: Vec;
  to: Vec;
}

/**
 * A convex polygon's distance field (px) as one linear ramp per side: the
 * field is the smallest signed distance to any side's line (positive
 * inside), exact inside and mitred outside, so the edge stays straight as
 * the Mask effect's brightness grows or shrinks it. Side i owns the part of
 * the canvas (overscanned by `range`) where its distance is the smallest:
 * the box clipped by d_i <= d_j for every other side j, each a half-plane
 * because the distances are linear.
 */
export function polygonRegions(w: number, h: number, pts: readonly Vec[], range: number): PolygonRegion[] {
  const ccw = area2(pts) < 0;
  const n = pts.length;
  const sides = pts.map((a, i) => {
    const b = pts[(i + 1) % n]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // Inward normal: clockwise on screen (y down) the inside is to the right of a → b.
    const s = ccw ? 1 : -1;
    const normal: Vec = [(s * (b[1] - a[1])) / len, (-s * (b[0] - a[0])) / len];
    return { a, normal, offset: normal[0] * a[0] + normal[1] * a[1] };
  });
  const pad = range + 2;
  const box: Vec[] = [
    [-pad, -pad],
    [w + pad, -pad],
    [w + pad, h + pad],
    [-pad, h + pad],
  ];
  return sides.map((si, i) => {
    let region: Vec[] = box;
    sides.forEach((sj, j) => {
      if (j === i || region.length === 0) return;
      // d_i(p) <= d_j(p)  ⇔  (n_i - n_j)·p <= c_i - c_j
      region = clipHalf(region, [si.normal[0] - sj.normal[0], si.normal[1] - sj.normal[1]], si.offset - sj.offset);
    });
    const from: Vec = [si.a[0] - si.normal[0] * range, si.a[1] - si.normal[1] * range];
    const to: Vec = [si.a[0] + si.normal[0] * range, si.a[1] + si.normal[1] * range];
    return { region, from, to };
  });
}

function polygonMaskSvg(w: number, h: number, pts: readonly Vec[]): string {
  const problem = polygonProblem(pts);
  if (problem) throw new Error(`polygon mask: ${problem}`);
  const regions = polygonRegions(w, h, pts, maskRange(w, h));
  const poly = (ps: readonly Vec[]) => ps.map(([x, y]) => `${f(x)},${f(y)}`).join(" ");
  const defs = regions
    .map(
      (r, i) =>
        `<linearGradient id="p${i}" gradientUnits="userSpaceOnUse" x1="${f(r.from[0])}" y1="${f(r.from[1])}" x2="${f(r.to[0])}" y2="${f(r.to[1])}"><stop offset="0" stop-color="${gray(0)}"/><stop offset="1" stop-color="${gray(1)}"/></linearGradient>`,
    )
    .join("");
  // Two passes: stroked regions under (no anti-aliased seam between neighbours), then plain fills over,
  // so a stroke's bleed into its neighbour (a brighter ramp there: hairlines off the corners) is covered.
  const shapes = regions.filter((r) => r.region.length >= 3);
  const pass = (stroke: boolean) =>
    regions.map((r, i) => (r.region.length < 3 ? "" : `<polygon points="${poly(r.region)}" fill="url(#p${i})"${stroke ? ` stroke="url(#p${i})" stroke-width="1.5"` : ""}/>`)).join("");
  return svg(w, h, `<defs>${defs}</defs>${shapes.length > 0 ? pass(true) + pass(false) : ""}`);
}

/**
 * Mask effect settings for a shape mask (mask_invert on, so the inside
 * shows): `feather` and `grow` as fractions of the frame's short side.
 * With the field's slope 127/range per pixel, an edge `feather` wide needs
 * contrast factor 255·range/(127·feather), and brightness b moves the edge
 * out by 255·b·range/127 pixels.
 */
export function shapeMaskSettings(feather: number, grow: number): { contrast: number; brightness: number } {
  const range = 0.5;
  const factor = Math.min(40, Math.max(1, (255 * range) / (127 * Math.max(1e-3, feather))));
  return { contrast: Math.round((20 - 20 / factor) * 1e4) / 1e4, brightness: Math.round(Math.max(-1, Math.min(1, (grow * 127) / (255 * range))) * 1e4) / 1e4 };
}

/** The feather narrowest and widest a shape mask can draw, fractions of the short side (contrast factor 40 and 1). */
export const SHAPE_FEATHER_RANGE: readonly [number, number] = [(255 * 0.5) / (127 * 40), (255 * 0.5) / 127];
