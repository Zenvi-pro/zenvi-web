/**
 * Reel typography as SVG title images: the hook over the opening, a label on
 * a shot, the end card, and the white flash frame. Generated rather than
 * templated so the text fits the frame and follows the style. Only what Qt's
 * SVG renderer (the desktop), resvg (Zenvi Cloud) and browsers all draw the
 * same: full-frame <rect>s and centred <text> with a font stack that ends in
 * sans-serif; the shadow is a second, offset copy of the text.
 */

import type { ReelTypography } from "./styles.js";

export type CardRole = "hook" | "label" | "end";

export interface CardInput {
  width: number;
  height: number;
  text: string;
  role: CardRole;
  typography: ReelTypography;
  /** A smaller second line (end card). */
  subtitle?: string;
}

const FONT = "Inter, 'Helvetica Neue', Helvetica, Arial, 'DejaVu Sans', sans-serif";
/** Average advance of a bold sans glyph, in em (capitals run wider). */
const GLYPH = { upper: 0.68, mixed: 0.58 } as const;

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function cased(text: string, typography: ReelTypography): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return typography.case === "upper" ? clean.toUpperCase() : clean;
}

/** Break `words` into `lines` lines of balanced length. */
function balance(words: string[], lines: number): string[] {
  if (lines <= 1 || words.length <= 1) return [words.join(" ")];
  const total = words.join(" ").length;
  const target = total / lines;
  const out: string[] = [];
  let line: string[] = [];
  for (const word of words) {
    const next = [...line, word].join(" ");
    if (line.length > 0 && next.length > target && out.length < lines - 1) {
      out.push(line.join(" "));
      line = [word];
    } else {
      line.push(word);
    }
  }
  if (line.length > 0) out.push(line.join(" "));
  return out;
}

interface Fitted {
  lines: string[];
  size: number;
}

/** The largest font size (and line breaks) that keeps the text inside `maxWidth` x `maxHeight`. */
export function fitText(text: string, typography: ReelTypography, maxWidth: number, maxHeight: number, maxSize: number): Fitted {
  const words = text.split(" ").filter(Boolean);
  const glyph = (typography.case === "upper" ? GLYPH.upper : GLYPH.mixed) + Math.max(0, typography.tracking);
  let best: Fitted = { lines: [text], size: 1 };
  for (let n = 1; n <= Math.min(3, Math.max(1, words.length)); n += 1) {
    const lines = balance(words, n);
    const longest = Math.max(...lines.map((l) => l.length), 1);
    const byWidth = maxWidth / (longest * glyph);
    const byHeight = maxHeight / (lines.length * 1.08);
    const size = Math.floor(Math.min(byWidth, byHeight, maxSize));
    // A line more is only worth it for clearly bigger type.
    if (size > best.size * 1.12) best = { lines, size };
  }
  return best;
}

function textBlock(lines: string[], x: number, firstBaseline: number, size: number, lineHeight: number, typography: ReelTypography, fill: string, anchor: "middle" | "start"): string {
  const shadow = Math.max(2, Math.round(size * 0.045));
  const attrs = `font-family="${FONT}" font-size="${size}" font-weight="${typography.weight}" letter-spacing="${(typography.tracking * size).toFixed(1)}" text-anchor="${anchor}"`;
  const spans = (dx: number, dy: number, color: string, opacity: number) =>
    lines
      .map((line, i) => `<text x="${x + dx}" y="${Math.round(firstBaseline + i * lineHeight + dy)}" ${attrs} fill="${color}" fill-opacity="${opacity}">${escapeXml(line)}</text>`)
      .join("");
  return spans(shadow, shadow, "#000000", 0.42) + spans(0, 0, fill, 1);
}

/** A title card as SVG text, the size of the project frame, transparent around the type. */
export function cardSvg(input: CardInput): string {
  const { width: w, height: h, typography } = input;
  const portrait = h > w;
  const short = Math.min(w, h);
  const body = cased(input.text, typography);
  const parts: string[] = [];

  if (input.role === "label") {
    const size = Math.round(short * 0.034);
    const label = { ...typography, tracking: Math.max(typography.tracking, 0.22), weight: 600 as const };
    const x = Math.round(w * 0.07);
    const y = Math.round(h * (portrait ? 0.085 : 0.11));
    parts.push(`<rect x="${x}" y="${y - Math.round(size * 1.45)}" width="${Math.round(size * 1.6)}" height="${Math.max(2, Math.round(size * 0.14))}" fill="#ffffff"/>`);
    parts.push(textBlock([cased(input.text, { ...label, case: "upper" })], x, y, size, size, label, "#ffffff", "start"));
  } else {
    const end = input.role === "end";
    if (end && typography.endPlate) parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="#000000" fill-opacity="0.5"/>`);
    const maxSize = Math.round(short * (end ? 0.12 : 0.135));
    const fitted = fitText(body, typography, w * 0.84, h * (portrait ? 0.26 : 0.36), maxSize);
    const lineHeight = Math.round(fitted.size * 1.04);
    const centre = h * (end ? 0.5 : portrait ? 0.4 : 0.5);
    const subtitle = input.subtitle ? cased(input.subtitle, { ...typography, case: "as_is" }) : "";
    const subSize = Math.round(fitted.size * 0.34);
    const blockHeight = fitted.lines.length * lineHeight + (subtitle ? subSize * 1.8 : 0);
    const firstBaseline = centre - blockHeight / 2 + fitted.size * 0.82;
    parts.push(textBlock(fitted.lines, Math.round(w / 2), firstBaseline, fitted.size, lineHeight, typography, "#ffffff", "middle"));
    if (subtitle) {
      const subType = { ...typography, weight: 400 as const, tracking: Math.max(0.04, typography.tracking / 2) };
      const y = firstBaseline + (fitted.lines.length - 1) * lineHeight + subSize * 2.2;
      parts.push(textBlock([subtitle], Math.round(w / 2), y, subSize, subSize, subType, "#ffffff", "middle"));
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>\n`;
}

/** A full-frame white image: the flash on a cut (its alpha is keyframed down over a few frames). */
export function flashSvg(width: number, height: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/></svg>\n`;
}
