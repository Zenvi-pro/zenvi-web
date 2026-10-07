/**
 * Qt 5.15 color-string parsing (`QColor(QString)` / `QColor::setNamedColor`),
 * for desktop code paths that turn SVG style values into colors, such as the
 * title editor's color buttons.
 *
 * Ported from qtbase src/gui/painting/qcolor.cpp (`setColorFromString`,
 * `get_hex_rgb`, `get_named_rgb`): `#RGB`, `#RRGGBB`, `#AARRGGBB`,
 * `#RRRGGGBBB`, `#RRRRGGGGBBBB`, or an SVG color keyword (case-insensitive,
 * spaces and tabs ignored). Anything else, including `rgb(…)`, `none` and
 * `url(#…)`, is an invalid color.
 */

import { QCOLOR_NAMED } from "./qcolor.data.js";

/** A parsed color, 16 bits per component like QColor's internal storage (0..65535). */
export interface QColorRgba64 {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

function hexDigits(text: string, from: number, count: number): number {
  let value = 0;
  for (let i = from; i < from + count; i += 1) {
    const digit = Number.parseInt(text[i]!, 16);
    if (Number.isNaN(digit)) return -1;
    value = value * 16 + digit;
  }
  return value;
}

function hexColor(text: string): QColorRgba64 | null {
  const digits = text.length - 1;
  const parts = (width: number, offset = 0): number[] =>
    [0, 1, 2].map((i) => hexDigits(text, 1 + offset + i * width, width));
  let rgb: number[];
  let alpha = 0xffff;
  if (digits === 3) {
    rgb = parts(1).map((v) => (v < 0 ? -1 : ((v << 4) | v) * 257));
  } else if (digits === 6) {
    rgb = parts(2).map((v) => (v < 0 ? -1 : v * 257));
  } else if (digits === 8) {
    const a = hexDigits(text, 1, 2);
    if (a < 0) return null;
    alpha = a * 257;
    rgb = parts(2, 2).map((v) => (v < 0 ? -1 : v * 257));
  } else if (digits === 9) {
    rgb = parts(3).map((v) => (v < 0 ? -1 : (v << 4) | (v >> 8)));
  } else if (digits === 12) {
    rgb = parts(4);
  } else {
    return null;
  }
  if (rgb.some((v) => v < 0)) return null;
  return { red: rgb[0]!, green: rgb[1]!, blue: rgb[2]!, alpha };
}

/** Parse a color string like `QColor(name)`; null where QColor would be invalid. */
export function parseQColor(name: string): QColorRgba64 | null {
  if (name.startsWith("#")) {
    const hex = hexColor(name);
    if (hex) return hex;
  }
  const key = name.replace(/[ \t]/g, "").toLowerCase();
  const named = Object.prototype.hasOwnProperty.call(QCOLOR_NAMED, key) ? QCOLOR_NAMED[key] : undefined;
  if (!named) return null;
  const [red, green, blue, alpha] = named;
  return { red: red * 257, green: green * 257, blue: blue * 257, alpha: alpha * 257 };
}

/** qcolor.cpp `qt_div_257`: 16-bit component → nearest 8-bit. */
function div257(x: number): number {
  return (x + 128 - ((x + 128) >> 8)) >> 8;
}

/** `QColor(name).name()`: lowercase `#rrggbb`, and `#000000` for an invalid color. */
export function qcolorName(name: string): string {
  const color = parseQColor(name);
  if (!color) return "#000000";
  return `#${[color.red, color.green, color.blue].map((c) => div257(c).toString(16).padStart(2, "0")).join("")}`;
}

/** `QColor(name).getRgbF()` without alpha: components in 0..1, or null for an invalid color. */
export function qcolorRgbF(name: string): [number, number, number] | null {
  const color = parseQColor(name);
  return color ? [color.red / 65535, color.green / 65535, color.blue / 65535] : null;
}
