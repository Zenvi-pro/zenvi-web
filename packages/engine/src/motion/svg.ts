/**
 * SVG drawings for motion templates, limited to what Qt's SVG Tiny 1.2
 * renderer (Zenvi desktop), resvg (CLI and Zenvi Cloud) and browsers (web
 * editor) draw alike: `rect` (rx), `line`, `polyline`, `path`, `circle` and
 * `text`/`tspan` with `text-anchor`, solid fills and strokes, `fill-opacity`,
 * `fill-rule`. No CSS, filters, gradients, clip paths, masks, images or
 * external fonts: a shadow is an offset darker copy, a glow is wider strokes
 * at low opacity.
 *
 * A drawing is authored in frame pixels at its rest size and rendered at `k`
 * times that size (`Drawing.k`), its largest pose (see keyframes.ts).
 */

/** Grotesk stack. Helvetica / Arial metrics (text.ts) size every layout; Liberation Sans shares them. */
export const SANS = "'Helvetica Neue', Helvetica, Arial, 'Liberation Sans', 'DejaVu Sans', sans-serif";
/** Monospace stack: every face here advances 0.6 em, so mono text is measured exactly. */
export const MONO = "Menlo, 'DejaVu Sans Mono', 'Liberation Mono', 'Courier New', monospace";

export function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** A number for an attribute: at most two decimals, no trailing zeros. */
export function num(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`not a finite number: ${value}`);
  const fixed = (Math.round(value * 100) / 100).toFixed(2);
  return fixed.replace(/\.?0+$/, "") || "0";
}

export interface Paint {
  fill?: string;
  fillOpacity?: number;
  fillRule?: "evenodd";
  stroke?: string;
  strokeWidth?: number;
  strokeOpacity?: number;
  linecap?: "round" | "butt" | "square";
  linejoin?: "round" | "miter";
}

export interface TextRun {
  text: string;
  fill?: string;
  /** 0 hides the run but keeps its place in the line (kinetic type reveals one word at a time). */
  opacity?: number;
  bold?: boolean;
}

export interface TextOptions {
  size: number;
  font: "sans" | "mono";
  bold?: boolean;
  anchor?: "start" | "middle" | "end";
  fill: string;
  opacity?: number;
  /** Letter spacing, em. */
  tracking?: number;
}

/** A drawing of `width` × `height` frame px, rendered at `k` times that size. */
export class Drawing {
  private readonly parts: string[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
    readonly k = 1,
  ) {
    if (!(width > 0 && height > 0 && k > 0)) throw new Error(`bad drawing size ${width}x${height} at ${k}`);
  }

  /** Pixel size of the SVG document (whole pixels: every host reads the size from these attributes). */
  get pixelWidth(): number {
    return Math.max(1, Math.ceil(this.width * this.k - 1e-6));
  }

  get pixelHeight(): number {
    return Math.max(1, Math.ceil(this.height * this.k - 1e-6));
  }

  private n(value: number): string {
    return num(value * this.k);
  }

  private paint(p: Paint): string {
    const out: string[] = [];
    out.push(`fill="${p.fill ?? "none"}"`);
    if (p.fill && p.fill !== "none" && p.fillOpacity !== undefined && p.fillOpacity < 1) out.push(`fill-opacity="${num(Math.max(0, p.fillOpacity))}"`);
    if (p.fillRule) out.push(`fill-rule="${p.fillRule}"`);
    if (p.stroke) {
      out.push(`stroke="${p.stroke}"`, `stroke-width="${this.n(p.strokeWidth ?? 1)}"`);
      if (p.strokeOpacity !== undefined && p.strokeOpacity < 1) out.push(`stroke-opacity="${num(Math.max(0, p.strokeOpacity))}"`);
      if (p.linecap) out.push(`stroke-linecap="${p.linecap}"`);
      if (p.linejoin) out.push(`stroke-linejoin="${p.linejoin}"`);
    }
    return out.join(" ");
  }

  rect(x: number, y: number, w: number, h: number, p: Paint & { rx?: number }): this {
    if (w <= 0 || h <= 0) return this;
    const rx = p.rx ? ` rx="${this.n(Math.min(p.rx, w / 2, h / 2))}"` : "";
    this.parts.push(`<rect x="${this.n(x)}" y="${this.n(y)}" width="${this.n(w)}" height="${this.n(h)}"${rx} ${this.paint(p)}/>`);
    return this;
  }

  line(x1: number, y1: number, x2: number, y2: number, p: Paint): this {
    this.parts.push(`<line x1="${this.n(x1)}" y1="${this.n(y1)}" x2="${this.n(x2)}" y2="${this.n(y2)}" ${this.paint({ ...p, fill: undefined })}/>`);
    return this;
  }

  polyline(points: readonly (readonly [number, number])[], p: Paint): this {
    const pts = points.map(([x, y]) => `${this.n(x)},${this.n(y)}`).join(" ");
    this.parts.push(`<polyline points="${pts}" ${this.paint(p)}/>`);
    return this;
  }

  circle(cx: number, cy: number, r: number, p: Paint): this {
    if (r <= 0) return this;
    this.parts.push(`<circle cx="${this.n(cx)}" cy="${this.n(cy)}" r="${this.n(r)}" ${this.paint(p)}/>`);
    return this;
  }

  /** A path from commands in frame px: numbers are scaled, letters kept (arcs: use `arc`). */
  path(commands: readonly (string | number)[], p: Paint): this {
    const d = commands.map((c) => (typeof c === "number" ? this.n(c) : c)).join(" ");
    this.parts.push(`<path d="${d}" ${this.paint(p)}/>`);
    return this;
  }

  /** Commands of a rounded rectangle (clockwise), for paths with several shapes. */
  static roundedRect(x: number, y: number, w: number, h: number, r: number): (string | number)[] {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    if (rr <= 0) return ["M", x, y, "H", x + w, "V", y + h, "H", x, "Z"].map((c) => c);
    // Corners as cubic Béziers (k = 0.5523): arcs are drawn alike everywhere too, but these need no flags.
    const c = rr * 0.4477;
    return [
      "M", x + rr, y,
      "H", x + w - rr,
      "C", x + w - c, y, x + w, y + c, x + w, y + rr,
      "V", y + h - rr,
      "C", x + w, y + h - c, x + w - c, y + h, x + w - rr, y + h,
      "H", x + rr,
      "C", x + c, y + h, x, y + h - c, x, y + h - rr,
      "V", y + rr,
      "C", x, y + c, x + c, y, x + rr, y,
      "Z",
    ];
  }

  text(x: number, y: number, content: string | readonly TextRun[], o: TextOptions): this {
    const runs: readonly TextRun[] = typeof content === "string" ? [{ text: content }] : content;
    const attrs = [
      `x="${this.n(x)}"`,
      `y="${this.n(y)}"`,
      `font-family="${o.font === "mono" ? MONO : SANS}"`,
      `font-size="${this.n(o.size)}"`,
      `font-weight="${o.bold ? "bold" : "normal"}"`,
      `text-anchor="${o.anchor ?? "start"}"`,
      o.tracking ? `letter-spacing="${this.n(o.tracking * o.size)}"` : "",
      `fill="${o.fill}"`,
      o.opacity !== undefined && o.opacity < 1 ? `fill-opacity="${num(o.opacity)}"` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const body = runs
      .map((run) => {
        const own = [
          run.fill ? `fill="${run.fill}"` : "",
          run.opacity !== undefined ? `fill-opacity="${num(run.opacity)}"` : "",
          run.bold !== undefined ? `font-weight="${run.bold ? "bold" : "normal"}"` : "",
        ]
          .filter(Boolean)
          .join(" ");
        return own ? `<tspan ${own}>${escapeXml(run.text)}</tspan>` : escapeXml(run.text);
      })
      .join("");
    this.parts.push(`<text ${attrs}>${body}</text>`);
    return this;
  }

  /** The SVG document. */
  svg(): string {
    const w = this.pixelWidth;
    const h = this.pixelHeight;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${this.parts.join("")}</svg>\n`;
  }
}
