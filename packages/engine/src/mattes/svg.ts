/**
 * Frame-size SVG layers for the matte composites: flat and gradient
 * backgrounds, letterbox bars and a line of big text. Each is one image clip
 * the size of the project, so it needs no transform. Gradients are drawn as
 * overlapping bands of flat rectangles: every SVG renderer Zenvi uses
 * (resvg here, Qt SVG on the desktop) draws those the same.
 */

import { escapeXml, num, SANS } from "../motion/svg.js";
import { balanceLines, fitSize } from "../motion/text.js";
import { hexToRgb01 } from "./luts.js";

function doc(width: number, height: number, body: string): string {
  const w = Math.round(width);
  const h = Math.round(height);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>\n`;
}

function hex(rgb: readonly number[]): string {
  return `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** The whole frame in one colour. */
export function solidSvg(width: number, height: number, color: string): string {
  return doc(width, height, `<rect x="0" y="0" width="${num(width)}" height="${num(height)}" fill="${hex(hexToRgb01(color))}"/>`);
}

/** A top-to-bottom gradient from `top` to `bottom`, in bands of `band` px. */
export function gradientSvg(width: number, height: number, top: string, bottom: string, band = 4): string {
  const a = hexToRgb01(top);
  const b = hexToRgb01(bottom);
  const rows = Math.max(2, Math.ceil(height / band));
  const parts: string[] = [];
  for (let i = 0; i < rows; i += 1) {
    const t = i / (rows - 1);
    // Each band runs to the bottom and the next is drawn over it: band edges that meet
    // inside a pixel (any scaled raster) would otherwise let the layer below show through.
    const y = Math.round((i * height) / rows);
    parts.push(`<rect x="0" y="${y}" width="${num(width)}" height="${num(height - y)}" fill="${hex([0, 1, 2].map((c) => a[c]! + (b[c]! - a[c]!) * t))}"/>`);
  }
  return doc(width, height, parts.join(""));
}

/** Height of each letterbox bar for a picture band of `aspect` (width / height) inside the frame. */
export function letterboxBarHeight(width: number, height: number, aspect: number): number {
  return Math.max(0, (height - width / aspect) / 2);
}

/** Two bars, top and bottom, leaving a band of `aspect` in the middle. */
export function letterboxSvg(width: number, height: number, aspect: number, color: string): string {
  const bar = letterboxBarHeight(width, height, aspect);
  const fill = hex(hexToRgb01(color));
  return doc(
    width,
    height,
    `<rect x="0" y="0" width="${num(width)}" height="${num(bar)}" fill="${fill}"/>` +
      `<rect x="0" y="${num(height - bar)}" width="${num(width)}" height="${num(bar)}" fill="${fill}"/>`,
  );
}

export interface BigTextOptions {
  text: string;
  color: string;
  /** Font family; default the motion sans stack. */
  font?: string;
  /** Font size in frame heights; default as large as fits 92 % of the width (at most 0.45). */
  size?: number;
  /** Vertical centre of the text block, 0 (top) to 1 (bottom). */
  y: number;
  /** At most this many lines (default 2, 3 on vertical frames); words are balanced across them. */
  maxLines?: number;
}

/** Text as large as the frame allows, centred, the way "words behind the head" edits set it. */
export function bigTextSvg(width: number, height: number, o: BigTextOptions): string {
  const words = o.text.trim().replace(/\s+/g, " ");
  const style = { font: "sans", bold: true } as const;
  // As few lines as keep the type big (a fifth of the frame height), balanced, and the block within 80 % of the height.
  const most = Math.max(1, o.maxLines ?? (width < height ? 3 : 2));
  let lines: string[] = [words];
  let fitted = 0;
  for (let n = 1; n <= most; n += 1) {
    lines = balanceLines(words, n);
    fitted = fitSize(lines, style, width * 0.92, Math.min(height * 0.45, (height * 0.8) / (lines.length * 0.92)));
    if (fitted >= height * 0.2) break;
  }
  const size = o.size !== undefined ? o.size * height : fitted;
  const lineHeight = size * 0.92;
  const top = o.y * height - (lineHeight * (lines.length - 1)) / 2;
  const family = o.font ? `'${escapeXml(o.font.replace(/['"]/g, ""))}', ${SANS}` : SANS;
  const spans = lines
    .map((line, i) => `<tspan x="${num(width / 2)}" y="${num(top + i * lineHeight + size * 0.36)}">${escapeXml(line)}</tspan>`)
    .join("");
  return doc(
    width,
    height,
    `<text font-family="${family}" font-size="${num(size)}" font-weight="bold" text-anchor="middle" fill="${hex(hexToRgb01(o.color))}">${spans}</text>`,
  );
}
