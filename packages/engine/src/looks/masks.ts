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

export type MaskShape = "rectangle" | "ellipse";

export interface ShapeSpec {
  shape: MaskShape;
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
