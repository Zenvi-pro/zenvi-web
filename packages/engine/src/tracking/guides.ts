/**
 * Guide graphics registered to a subject (golden spiral, thirds, reticle,
 * brackets, ring, guide lines) and tracked callouts, as canvas-sized SVG
 * titles: transparent everywhere but the strokes, so they play as ordinary
 * title clips on every surface and the desktop.
 *
 * Each graphic is drawn about a centre in canvas pixels; a tracked overlay
 * is drawn about the canvas centre and moved by its keyframes.
 */

import { MONO, SANS, escapeXml, num } from "../motion/svg.js";

export const GUIDE_KINDS = ["golden_spiral", "thirds", "crosshair", "brackets", "ring", "lines"] as const;
export type GuideKind = (typeof GUIDE_KINDS)[number];

export interface GuidePlacement {
  /** Centre, canvas pixels. */
  cx: number;
  cy: number;
  /** The subject's width and height, canvas pixels. */
  w: number;
  h: number;
  /** Degrees clockwise. */
  angle: number;
}

export interface GuideStyle {
  color: string;
  /** Stroke width, canvas pixels. */
  stroke: number;
  /** golden_spiral: mirror left-right / top-bottom (which way the spiral turns in). */
  flipX?: boolean;
  flipY?: boolean;
  /** golden_spiral: height of the golden rectangle, canvas pixels (default: the canvas height). */
  spiralHeight?: number;
}

const PHI = (1 + Math.sqrt(5)) / 2;

interface SpiralGeometry {
  arcs: string;
  squares: string;
  /** Where the spiral converges, in its unit rectangle (φ × 1). */
  eye: { x: number; y: number };
}

/**
 * The golden spiral in a φ × 1 rectangle: squares cut from the left, top,
 * right and bottom in turn, a quarter arc in each about the corner that
 * touches what is left.
 */
function spiralGeometry(steps = 12): SpiralGeometry {
  let x = 0;
  let y = 0;
  let w = PHI;
  let h = 1;
  let arcs = "M 0 1";
  let squares = "";
  for (let i = 0; i < steps; i += 1) {
    const side = i % 4;
    let s: number;
    let end: [number, number];
    if (side === 0) {
      s = h;
      squares += `M ${num4(x)} ${num4(y)} h ${num4(s)} v ${num4(s)} h ${num4(-s)} Z `;
      end = [x + s, y];
      x += s;
      w -= s;
    } else if (side === 1) {
      s = w;
      squares += `M ${num4(x)} ${num4(y)} h ${num4(s)} v ${num4(s)} h ${num4(-s)} Z `;
      end = [x + s, y + s];
      y += s;
      h -= s;
    } else if (side === 2) {
      s = h;
      squares += `M ${num4(x + w - s)} ${num4(y)} h ${num4(s)} v ${num4(s)} h ${num4(-s)} Z `;
      end = [x + w - s, y + s];
      w -= s;
    } else {
      s = w;
      squares += `M ${num4(x)} ${num4(y + h - s)} h ${num4(s)} v ${num4(s)} h ${num4(-s)} Z `;
      end = [x, y + h - s];
      h -= s;
    }
    arcs += ` A ${num4(s)} ${num4(s)} 0 0 1 ${num4(end[0])} ${num4(end[1])}`;
  }
  return { arcs, squares: squares.trim(), eye: { x: x + w / 2, y: y + h / 2 } };
}

function num4(v: number): string {
  return String(Math.round(v * 1e4) / 1e4);
}

function svg(width: number, height: number, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>\n`;
}

function strokeAttrs(style: GuideStyle, width = style.stroke, opacity = 1): string {
  // Four significant digits: the spiral's group is scaled by the canvas height, so its strokes are tiny numbers.
  return `fill="none" stroke="${escapeXml(style.color)}" stroke-width="${String(Number(width.toPrecision(4)))}" stroke-linecap="round" stroke-linejoin="round"${opacity < 1 ? ` stroke-opacity="${num(opacity)}"` : ""}`;
}

/** The body of one guide graphic, in canvas pixels. */
function guideBody(kind: GuideKind, p: GuidePlacement, style: GuideStyle, canvas: { width: number; height: number }): string {
  const rot = `transform="translate(${num(p.cx)} ${num(p.cy)}) rotate(${num(p.angle)})"`;
  const hw = p.w / 2;
  const hh = p.h / 2;
  switch (kind) {
    case "golden_spiral": {
      const g = spiralGeometry();
      const k = style.spiralHeight ?? canvas.height;
      const fx = style.flipX ? -1 : 1;
      const fy = style.flipY ? -1 : 1;
      // Unit stroke: the group is scaled by k.
      const unit = style.stroke / k;
      return (
        `<g transform="translate(${num(p.cx)} ${num(p.cy)}) rotate(${num(p.angle)}) scale(${num(fx * k)} ${num(fy * k)}) translate(${num4(-g.eye.x)} ${num4(-g.eye.y)})">` +
        `<path d="${g.squares}" ${strokeAttrs(style, unit * 0.6, 0.55)}/>` +
        `<path d="${g.arcs}" ${strokeAttrs(style, unit)}/>` +
        `</g>`
      );
    }
    case "thirds": {
      const lines: string[] = [];
      for (const f of [-1 / 6, 1 / 6]) {
        lines.push(`M ${num(f * p.w)} ${num(-hh)} V ${num(hh)}`, `M ${num(-hw)} ${num(f * p.h)} H ${num(hw)}`);
      }
      return `<g ${rot}><rect x="${num(-hw)}" y="${num(-hh)}" width="${num(p.w)}" height="${num(p.h)}" ${strokeAttrs(style)}/><path d="${lines.join(" ")}" ${strokeAttrs(style, style.stroke * 0.6, 0.7)}/></g>`;
    }
    case "crosshair": {
      const r = Math.max(hw, hh);
      const gap = r * 0.35;
      const reach = r * 1.35;
      const d = [`M ${num(-reach)} 0 H ${num(-gap)}`, `M ${num(gap)} 0 H ${num(reach)}`, `M 0 ${num(-reach)} V ${num(-gap)}`, `M 0 ${num(gap)} V ${num(reach)}`].join(" ");
      return `<g ${rot}><circle cx="0" cy="0" r="${num(r)}" ${strokeAttrs(style)}/><path d="${d}" ${strokeAttrs(style)}/><circle cx="0" cy="0" r="${num(Math.max(1, style.stroke))}" fill="${escapeXml(style.color)}"/></g>`;
    }
    case "brackets": {
      const arm = Math.min(p.w, p.h) * 0.22;
      const d = [
        `M ${num(-hw)} ${num(-hh + arm)} V ${num(-hh)} H ${num(-hw + arm)}`,
        `M ${num(hw - arm)} ${num(-hh)} H ${num(hw)} V ${num(-hh + arm)}`,
        `M ${num(hw)} ${num(hh - arm)} V ${num(hh)} H ${num(hw - arm)}`,
        `M ${num(-hw + arm)} ${num(hh)} H ${num(-hw)} V ${num(hh - arm)}`,
      ].join(" ");
      return `<g ${rot}><path d="${d}" ${strokeAttrs(style)}/></g>`;
    }
    case "ring":
      return `<g ${rot}><ellipse cx="0" cy="0" rx="${num(hw)}" ry="${num(hh)}" ${strokeAttrs(style)}/></g>`;
    case "lines": {
      const far = Math.hypot(canvas.width, canvas.height);
      return `<g ${rot}><path d="M ${num(-far)} 0 H ${num(far)} M 0 ${num(-far)} V ${num(far)}" ${strokeAttrs(style, style.stroke, 0.8)}/></g>`;
    }
  }
}

/** A canvas-sized SVG with one guide graphic. */
export function guideSvg(kind: GuideKind, width: number, height: number, placement: GuidePlacement, style: GuideStyle): string {
  return svg(width, height, guideBody(kind, placement, style, { width, height }));
}

export interface CalloutStyle {
  color: string;
  /** Label text colour (default: the line colour). */
  textColor?: string;
  stroke: number;
  /** Label height, canvas pixels. */
  fontSize: number;
  /** Monospace label (HUD), else sans. */
  mono?: boolean;
}

/**
 * A callout drawn about the canvas centre: a dot on the subject, a leader
 * line to (dx, dy) canvas pixels away with an elbow, and the label on the
 * shelf beyond it. The dot is the anchor its keyframes move.
 */
export function calloutSvg(width: number, height: number, label: string, dx: number, dy: number, style: CalloutStyle): string {
  const cx = width / 2;
  const cy = height / 2;
  const ex = cx + dx;
  const ey = cy + dy;
  const right = dx >= 0;
  const shelf = Math.max(style.fontSize * 0.6 * Math.max(4, label.length) * 0.62, style.fontSize * 3);
  const sx = ex + (right ? shelf : -shelf);
  const color = escapeXml(style.color);
  const font = style.mono ? MONO : SANS;
  const text =
    label.trim() === ""
      ? ""
      : `<text x="${num(right ? ex + style.fontSize * 0.2 : ex - style.fontSize * 0.2)}" y="${num(ey - style.fontSize * 0.35)}" font-family="${font}" font-size="${num(style.fontSize)}" font-weight="600" fill="${escapeXml(style.textColor ?? style.color)}" text-anchor="${right ? "start" : "end"}">${escapeXml(label)}</text>`;
  return svg(
    width,
    height,
    `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(style.stroke * 2.2)}" fill="${color}"/>` +
      `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(style.stroke * 5)}" fill="none" stroke="${color}" stroke-width="${num(style.stroke * 0.6)}" stroke-opacity="0.6"/>` +
      `<path d="M ${num(cx)} ${num(cy)} L ${num(ex)} ${num(ey)} H ${num(sx)}" fill="none" stroke="${color}" stroke-width="${num(style.stroke)}" stroke-linecap="round" stroke-linejoin="round"/>` +
      text,
  );
}
