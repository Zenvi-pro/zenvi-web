/**
 * Text measurement for motion layouts. Hosts render with whatever font they
 * have (Helvetica Neue on macOS, Arial on Windows, Liberation or DejaVu Sans
 * on Linux and in Zenvi Cloud), and none of them report metrics to the
 * engine, so widths are estimated from Helvetica's advance widths (the core
 * PDF font metrics; Arial and Liberation Sans share them). DejaVu Sans runs up
 * to ~10 % wider, so boxes around text are sized with `ROOMY` and layouts
 * never let text from different clips meet (see kinetic type). Monospace
 * stacks (svg.ts MONO) all advance 0.6 em, so mono text is exact.
 */

/** Helvetica advance widths (1/1000 em), ASCII 32-126. */
const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Width factor for boxes drawn around text: wider fallback fonts still fit. */
export const ROOMY = 1.1;
/** Monospace advance, em. */
export const MONO_ADVANCE = 0.6;

export interface TextStyle {
  size: number;
  font: "sans" | "mono";
  bold?: boolean;
  /** Letter spacing, em. */
  tracking?: number;
}

/** Estimated advance width of `text` in px. */
export function textWidth(text: string, style: TextStyle): number {
  const chars = [...text];
  const tracking = (style.tracking ?? 0) * chars.length;
  if (style.font === "mono") return style.size * (chars.length * MONO_ADVANCE + tracking);
  const table = style.bold ? BOLD : REGULAR;
  let units = 0;
  for (const ch of chars) {
    const code = ch.codePointAt(0) ?? 0;
    // Outside ASCII: an average capital (accented letters, symbols).
    units += code >= 32 && code <= 126 ? table[code - 32]! : 700;
  }
  return style.size * (units / 1000 + tracking);
}

/** The largest size ≤ `maxSize` (and ≥ `minSize`) at which every line fits `maxWidth`. */
export function fitSize(lines: readonly string[], style: Omit<TextStyle, "size">, maxWidth: number, maxSize: number, minSize = 1): number {
  const widest = Math.max(...lines.map((line) => textWidth(line, { ...style, size: 1 })), 1e-6);
  return Math.max(minSize, Math.min(maxSize, Math.floor((maxWidth / widest) * 10) / 10));
}

/** Break `text` into at most `maxLines` lines of balanced length (never splitting a word). */
export function balanceLines(text: string, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  if (maxLines <= 1 || words.length === 1) return [words.join(" ")];
  const lines = Math.min(maxLines, words.length);
  const target = words.join(" ").length / lines;
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

/**
 * The line breaks (up to `maxLines`) and size that make `text` biggest inside
 * `maxWidth` × `maxHeight` (line height `leading` × size). An extra line is
 * only taken for clearly bigger type.
 */
export function fitBlock(
  text: string,
  style: Omit<TextStyle, "size">,
  maxWidth: number,
  maxHeight: number,
  maxSize: number,
  maxLines = 3,
  leading = 1.0,
): { lines: string[]; size: number } {
  let best = { lines: [text], size: 0 };
  for (let n = 1; n <= maxLines; n += 1) {
    const lines = balanceLines(text, n);
    if (lines.length < n && n > 1) break;
    const byWidth = fitSize(lines, style, maxWidth, maxSize);
    const byHeight = maxHeight / (lines.length * leading);
    const size = Math.floor(Math.min(byWidth, byHeight, maxSize));
    if (size > best.size * 1.12) best = { lines, size };
  }
  return best;
}

/** `text` cut to fit `maxWidth` with an ellipsis (labels that must stay on one line). */
export function clampText(text: string, style: TextStyle, maxWidth: number): string {
  if (textWidth(text, style) <= maxWidth) return text;
  const chars = [...text];
  while (chars.length > 1 && textWidth(`${chars.join("").trimEnd()}…`, style) > maxWidth) chars.pop();
  return `${chars.join("").trimEnd()}…`;
}
