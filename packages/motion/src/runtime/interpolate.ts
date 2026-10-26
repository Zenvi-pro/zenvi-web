/**
 * Interpolating animated values: numbers, colours, and strings whose numbers
 * line up (`inset(0% 0% 40% 0%)`, `0 12px 40px rgba(0,0,0,.2)`, gradients).
 */

export type Value = number | string;

const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
const HEX = /#([0-9a-f]{3,8})\b/gi;

function hexToRgba(hex: string): string {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  const n = (i: number): number => parseInt(h.slice(i, i + 2), 16);
  const a = h.length === 8 ? n(6) / 255 : 1;
  return `rgba(${n(0)}, ${n(2)}, ${n(4)}, ${a})`;
}

/** Hex colours as `rgba()`, so a colour lines up with any other colour. */
export function normalizeColors(text: string): string {
  return text.replace(HEX, (m) => ([4, 5, 7, 9].includes(m.length) ? hexToRgba(m) : m)).replace(/\brgb\(([^)]*)\)/g, "rgba($1, 1)");
}

interface Parsed {
  parts: string[];
  numbers: number[];
}

function parse(text: string): Parsed {
  const parts: string[] = [];
  const numbers: number[] = [];
  let last = 0;
  for (const m of text.matchAll(NUMBER)) {
    parts.push(text.slice(last, m.index));
    numbers.push(Number(m[0]));
    last = m.index! + m[0].length;
  }
  parts.push(text.slice(last));
  return { parts, numbers };
}

function format(n: number): string {
  return String(Math.round(n * 10000) / 10000);
}

/**
 * The value `p` of the way from `a` to `b` (p may overshoot 0..1 for back
 * and spring eases). Strings with the same shape interpolate number by
 * number (colour channels are rounded and clamped); others switch at the end.
 */
export function interpolate(a: Value, b: Value, p: number): Value {
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * p;
  const sa = normalizeColors(String(a));
  const sb = normalizeColors(String(b));
  const pa = parse(sa);
  const pb = parse(sb);
  const same = pa.numbers.length === pb.numbers.length && pa.parts.every((part, i) => part.replace(/\s+/g, "") === pb.parts[i]!.replace(/\s+/g, ""));
  if (!same) return p >= 1 ? b : a;
  let out = pb.parts[0]!;
  for (let i = 0; i < pa.numbers.length; i += 1) {
    let v = pa.numbers[i]! + (pb.numbers[i]! - pa.numbers[i]!) * p;
    // rgba(r, g, b, a): channels are clamped integers / a 0..1 alpha.
    const inColor = /rgba\($|rgba\([^)]*$/.test(out);
    if (inColor) {
      const channel = (out.slice(out.lastIndexOf("rgba(")).match(/,/g) ?? []).length;
      v = channel < 3 ? Math.round(Math.min(255, Math.max(0, v))) : Math.min(1, Math.max(0, v));
    }
    out += format(v) + pb.parts[i + 1]!;
  }
  return out;
}
