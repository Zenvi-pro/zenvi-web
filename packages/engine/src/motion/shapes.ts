/**
 * Small original glyphs and frames the templates draw: a pointer, a search
 * glass, a bookmark, registration marks, arrowheads, card frames. All of
 * them are plain paths, circles and lines (svg.ts rules).
 */

import { Drawing, type Paint } from "./svg.js";

/** A mouse pointer with its tip at (x, y), `size` px tall. */
export function pointer(d: Drawing, x: number, y: number, size: number, fill: string, stroke: string): void {
  const k = size / 40;
  const pts: [number, number][] = [
    [0, 0],
    [0, 33],
    [8.5, 25.5],
    [14, 38],
    [20.5, 35],
    [15, 23],
    [26, 23],
  ];
  const cmds: (string | number)[] = [];
  pts.forEach(([px, py], i) => cmds.push(i === 0 ? "M" : "L", x + px * k, y + py * k));
  cmds.push("Z");
  d.path(cmds, { fill, stroke, strokeWidth: 2.4 * k, linejoin: "round" });
}

/** A magnifying glass centred on (x, y), `size` px across. */
export function searchGlass(d: Drawing, x: number, y: number, size: number, stroke: string): void {
  const r = size * 0.34;
  const cx = x - size * 0.08;
  const cy = y - size * 0.08;
  d.circle(cx, cy, r, { stroke, strokeWidth: size * 0.11 });
  const a = Math.SQRT1_2;
  d.line(cx + r * a, cy + r * a, x + size * 0.42, y + size * 0.42, { stroke, strokeWidth: size * 0.12, linecap: "round" });
}

/** A bookmark `w` × `h` with its top left at (x, y). */
export function bookmark(d: Drawing, x: number, y: number, w: number, h: number, p: Paint): void {
  const r = w * 0.16;
  const notch = h * 0.26;
  const c = r * 0.4477;
  d.path(
    ["M", x, y + r, "C", x, y + c, x + c, y, x + r, y, "H", x + w - r, "C", x + w - c, y, x + w, y + c, x + w, y + r, "V", y + h, "L", x + w / 2, y + h - notch, "L", x, y + h, "Z"],
    { ...p, linejoin: "round" },
  );
}

/** A registration mark (circle and cross hair) centred on (x, y). */
export function registrationMark(d: Drawing, x: number, y: number, r: number, stroke: string, width: number): void {
  d.circle(x, y, r, { stroke, strokeWidth: width });
  const arm = r * 1.75;
  d.line(x - arm, y, x + arm, y, { stroke, strokeWidth: width });
  d.line(x, y - arm, x, y + arm, { stroke, strokeWidth: width });
}

/** A filled arrowhead at (x, y) pointing along `angle` (radians), `size` px long. */
export function arrowhead(d: Drawing, x: number, y: number, angle: number, size: number, fill: string): void {
  const back = (da: number): [number, number] => [x - size * Math.cos(angle + da), y - size * Math.sin(angle + da)];
  const [ax, ay] = back(0.45);
  const [bx, by] = back(-0.45);
  d.path(["M", x, y, "L", ax, ay, "L", bx, by, "Z"], { fill, linejoin: "round", stroke: fill, strokeWidth: size * 0.12 });
}

export interface CardFrameStyle {
  radius: number;
  border?: { color: string; width: number };
  /** A soft shadow (rings below the card, never over it). */
  shadow?: { color: string; opacity: number; offset: number };
}

/**
 * The frame drawn over a media card: a soft shadow around it and a border
 * on its edge, the card itself left clear. The card is `w` × `h` with its top
 * left at (x, y); the shadow rings contain the card, so an even-odd path
 * leaves the card's area unpainted.
 */
export function cardFrame(d: Drawing, x: number, y: number, w: number, h: number, s: CardFrameStyle): void {
  if (s.shadow) {
    const rings = [
      { spread: 0.35, alpha: 0.5 },
      { spread: 0.75, alpha: 0.3 },
      { spread: 1.2, alpha: 0.2 },
    ];
    for (const ring of rings) {
      const e = s.shadow.offset * (1 + ring.spread);
      const outer = Drawing.roundedRect(x - e, y - e + s.shadow.offset, w + 2 * e, h + 2 * e, s.radius + e);
      const inner = Drawing.roundedRect(x, y, w, h, s.radius);
      d.path([...outer, ...inner], { fill: s.shadow.color, fillOpacity: s.shadow.opacity * ring.alpha, fillRule: "evenodd" });
    }
  }
  if (s.border) {
    const bw = s.border.width;
    d.path(Drawing.roundedRect(x + bw / 2, y + bw / 2, w - bw, h - bw, Math.max(0, s.radius - bw / 2)), { stroke: s.border.color, strokeWidth: bw });
  }
}

/** Space a card frame needs around the card for its shadow, px. */
export function cardFramePad(s: CardFrameStyle): number {
  return Math.ceil((s.shadow ? s.shadow.offset * 3.3 : 0) + (s.border?.width ?? 0) + 2);
}
