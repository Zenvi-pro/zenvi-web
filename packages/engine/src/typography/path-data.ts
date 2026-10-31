/**
 * Outline geometry the type blocks share: SVG path data (`d`) read into the
 * glyph commands opentype.js gives (absolute M, L, Q, C, Z), commands moved
 * by an affine map, and contours flattened to polylines with their arc
 * lengths (a write-on's time map, a stencil's inscribed circle).
 */

import type { PathCommand } from "./opentype.js";

/** A flattened contour: x, y pairs in order; `closed` when it ended with Z. */
export interface Polyline {
  points: number[];
  closed: boolean;
}

const ARGS: Readonly<Record<string, number>> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/**
 * SVG path data as absolute commands (H, V, S, T and arcs rewritten as
 * lines, cubics and quadratics). Throws on malformed data, with the reason.
 */
export function parsePathData(d: string): PathCommand[] {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  if (d.replace(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[\s,]/g, "").length > 0) throw new Error("path data has characters that are not path commands or numbers");
  const out: PathCommand[] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  // The last control point (S and T reflect it).
  let cx = 0;
  let cy = 0;
  let prev = "";
  let i = 0;
  let cmd = "";
  const take = (): number => {
    const t = tokens[i++];
    if (t === undefined || /[a-z]/i.test(t)) throw new Error(`path command ${cmd} is missing a number`);
    return Number(t);
  };
  // An arc's flags are one character each and need no separator ("a5 5 0 0110 0" is flags 0, 1 then x 10): svgo writes them so.
  const flag = (): boolean => {
    const t = tokens[i];
    if (t === undefined || (t[0] !== "0" && t[0] !== "1")) throw new Error(`path command ${cmd} needs flags of 0 or 1`);
    if (t.length === 1) i += 1;
    else if (/^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(t.slice(1))) tokens[i] = t.slice(1);
    else throw new Error(`path command ${cmd} needs flags of 0 or 1`);
    return t[0] === "1";
  };
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (/[a-z]/i.test(t)) {
      cmd = t;
      i += 1;
    } else if (!cmd) throw new Error("path data must start with M");
    else if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";
    const up = cmd.toUpperCase();
    if (out.length === 0 && up !== "M") throw new Error("path data must start with M");
    const rel = cmd !== up;
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (up) {
      case "M":
        x = ox + take();
        y = oy + take();
        sx = x;
        sy = y;
        out.push({ type: "M", x, y });
        break;
      case "L":
        x = ox + take();
        y = oy + take();
        out.push({ type: "L", x, y });
        break;
      case "H":
        x = ox + take();
        out.push({ type: "L", x, y });
        break;
      case "V":
        y = oy + take();
        out.push({ type: "L", x, y });
        break;
      case "C": {
        const x1 = ox + take();
        const y1 = oy + take();
        cx = ox + take();
        cy = oy + take();
        x = ox + take();
        y = oy + take();
        out.push({ type: "C", x1, y1, x2: cx, y2: cy, x, y });
        break;
      }
      case "S": {
        const x1 = prev === "C" || prev === "S" ? 2 * x - cx : x;
        const y1 = prev === "C" || prev === "S" ? 2 * y - cy : y;
        cx = ox + take();
        cy = oy + take();
        x = ox + take();
        y = oy + take();
        out.push({ type: "C", x1, y1, x2: cx, y2: cy, x, y });
        break;
      }
      case "Q":
        cx = ox + take();
        cy = oy + take();
        x = ox + take();
        y = oy + take();
        out.push({ type: "Q", x1: cx, y1: cy, x, y });
        break;
      case "T":
        cx = prev === "Q" || prev === "T" ? 2 * x - cx : x;
        cy = prev === "Q" || prev === "T" ? 2 * y - cy : y;
        x = ox + take();
        y = oy + take();
        out.push({ type: "Q", x1: cx, y1: cy, x, y });
        break;
      case "A": {
        const rx = Math.abs(take());
        const ry = Math.abs(take());
        const phi = take();
        const large = flag();
        const sweep = flag();
        const x2 = ox + take();
        const y2 = oy + take();
        out.push(...arcCubics(x, y, rx, ry, phi, large, sweep, x2, y2));
        x = x2;
        y = y2;
        break;
      }
      case "Z":
        out.push({ type: "Z" });
        x = sx;
        y = sy;
        break;
      default:
        throw new Error(`unknown path command ${cmd}`);
    }
    prev = up;
    // A command letter with no numbers after it repeats nothing; Z takes none.
    if (ARGS[up] === 0 && i < tokens.length && !/[a-z]/i.test(tokens[i]!)) throw new Error("numbers after Z");
  }
  return out;
}

/** An elliptical arc as cubics (SVG implementation notes F.6.5-F.6.6), at most 90° each. */
function arcCubics(x1: number, y1: number, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean, x2: number, y2: number): PathCommand[] {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [{ type: "L", x: x2, y: y2 }];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * yp) / ry;
  const cyp = (-coef * ry * xp) / rx;
  const ccx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const ccy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const step = dt / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const point = (t: number): [number, number] => [ccx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, ccy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const deriv = (t: number): [number, number] => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  const out: PathCommand[] = [];
  for (let j = 0; j < n; j += 1) {
    const a = t1 + j * step;
    const b = a + step;
    const [ax, ay] = point(a);
    const [bx, by] = j === n - 1 ? [x2, y2] : point(b);
    const [dax, day] = deriv(a);
    const [dbx, dby] = deriv(b);
    out.push({ type: "C", x1: ax + k * dax, y1: ay + k * day, x2: bx - k * dbx, y2: by - k * dby, x: bx, y: by });
  }
  return out;
}

/** An affine map: x' = a·x + c·y + e, y' = b·x + d·y + f (the SVG matrix order). */
export type Affine = readonly [number, number, number, number, number, number];

export function mapCommands(commands: readonly PathCommand[], m: Affine): PathCommand[] {
  const px = (x: number, y: number) => m[0] * x + m[2] * y + m[4];
  const py = (x: number, y: number) => m[1] * x + m[3] * y + m[5];
  return commands.map((c): PathCommand => {
    switch (c.type) {
      case "Z":
        return c;
      case "M":
      case "L":
        return { type: c.type, x: px(c.x, c.y), y: py(c.x, c.y) };
      case "Q":
        return { type: "Q", x1: px(c.x1, c.y1), y1: py(c.x1, c.y1), x: px(c.x, c.y), y: py(c.x, c.y) };
      case "C":
        return { type: "C", x1: px(c.x1, c.y1), y1: py(c.x1, c.y1), x2: px(c.x2, c.y2), y2: py(c.x2, c.y2), x: px(c.x, c.y), y: py(c.x, c.y) };
    }
  });
}

/** Rotation by `deg` (clockwise on screen, y down) about the origin, then a move. */
export function rotation(deg: number, tx = 0, ty = 0): Affine {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), tx, ty];
}

/** Commands as `Drawing.path` arguments. */
export function commandList(commands: readonly PathCommand[]): (string | number)[] {
  const out: (string | number)[] = [];
  for (const c of commands) {
    if (c.type === "Z") out.push("Z");
    else if (c.type === "Q") out.push("Q", c.x1, c.y1, c.x, c.y);
    else if (c.type === "C") out.push("C", c.x1, c.y1, c.x2, c.y2, c.x, c.y);
    else out.push(c.type, c.x, c.y);
  }
  return out;
}

/** Contours as polylines, curves cut into pieces of at most `step` px along their control polygon. */
export function flatten(commands: readonly PathCommand[], step = 2): Polyline[] {
  const out: Polyline[] = [];
  let cur: number[] = [];
  let x = 0;
  let y = 0;
  const end = (closed: boolean) => {
    if (cur.length >= 4) out.push({ points: cur, closed });
    cur = [];
  };
  for (const c of commands) {
    switch (c.type) {
      case "M":
        end(false);
        cur = [c.x, c.y];
        break;
      case "Z":
        if (cur.length >= 2) {
          if (cur[0] !== x || cur[1] !== y) cur.push(cur[0]!, cur[1]!);
          [x, y] = [cur[0]!, cur[1]!];
        }
        end(true);
        continue;
      case "L":
        if (cur.length === 0) cur = [x, y];
        cur.push(c.x, c.y);
        break;
      case "Q":
      case "C": {
        if (cur.length === 0) cur = [x, y];
        const pts = c.type === "Q" ? [x, y, c.x1, c.y1, c.x, c.y] : [x, y, c.x1, c.y1, c.x2, c.y2, c.x, c.y];
        let poly = 0;
        for (let i = 2; i < pts.length; i += 2) poly += Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!);
        const n = Math.max(2, Math.ceil(poly / step));
        for (let k = 1; k <= n; k += 1) cur.push(...bezierAt(pts, k / n));
        break;
      }
    }
    x = c.x;
    y = c.y;
  }
  end(false);
  return out;
}

function bezierAt(p: readonly number[], t: number): [number, number] {
  const u = 1 - t;
  if (p.length === 6) return [u * u * p[0]! + 2 * u * t * p[2]! + t * t * p[4]!, u * u * p[1]! + 2 * u * t * p[3]! + t * t * p[5]!];
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p[0]! + b * p[2]! + c * p[4]! + d * p[6]!, a * p[1]! + b * p[3]! + c * p[5]! + d * p[7]!];
}

/** Length of a polyline, px. */
export function polylineLength(line: Polyline): number {
  let total = 0;
  const p = line.points;
  for (let i = 2; i < p.length; i += 2) total += Math.hypot(p[i]! - p[i - 2]!, p[i + 1]! - p[i - 1]!);
  return total;
}

/** Bounds of the polylines' points, or null when there are none. */
export function linesBounds(lines: readonly Polyline[]): { x: number; y: number; width: number; height: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const line of lines) {
    const p = line.points;
    for (let i = 0; i < p.length; i += 2) {
      x0 = Math.min(x0, p[i]!);
      x1 = Math.max(x1, p[i]!);
      y0 = Math.min(y0, p[i + 1]!);
      y1 = Math.max(y1, p[i + 1]!);
    }
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** Inside the closed contours by the even-odd rule. */
export function insideEvenOdd(lines: readonly Polyline[], x: number, y: number): boolean {
  let inside = false;
  for (const line of lines) {
    const p = line.points;
    const n = p.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
      const xi = p[2 * i]!;
      const yi = p[2 * i + 1]!;
      const xj = p[2 * j]!;
      const yj = p[2 * j + 1]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Distance from (x, y) to the nearest edge of the contours. */
export function edgeDistance(lines: readonly Polyline[], x: number, y: number): number {
  let best = Infinity;
  for (const line of lines) {
    const p = line.points;
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2]!;
      const ay = p[i - 1]!;
      const dx = p[i]! - ax;
      const dy = p[i + 1]! - ay;
      const len = dx * dx + dy * dy;
      const t = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
      best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
  }
  return best;
}
