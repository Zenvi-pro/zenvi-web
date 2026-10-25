/**
 * Palettes of the motion templates. Each is a small, fixed set of colours so
 * a whole video reads as one design: ui_light / ui_dark (product UI promos),
 * editorial (paper, ink, signal red, one blue), callout (a dark field with
 * one hot accent), tutorial (grid paper, ink, a highlighter yellow).
 */

import type { Palette, PaletteId } from "./types.js";

export const PALETTES: Readonly<Record<PaletteId, Palette>> = {
  ui_light: {
    name: "ui_light",
    background: "#eef0f4",
    surface: "#ffffff",
    ink: "#14161c",
    muted: "#6b7180",
    line: "#d6dae3",
    accent: "#4f46e5",
    accentInk: "#ffffff",
    second: "#f2b950",
    shadow: "#1b2140",
    shadowOpacity: 0.14,
    dark: false,
  },
  ui_dark: {
    name: "ui_dark",
    background: "#0d0e12",
    surface: "#1a1c23",
    ink: "#f4f5f8",
    muted: "#8a8f9c",
    line: "#2c2f39",
    accent: "#7c74ff",
    accentInk: "#ffffff",
    second: "#f2b950",
    shadow: "#000000",
    shadowOpacity: 0.45,
    dark: true,
  },
  editorial: {
    name: "editorial",
    background: "#f3f1ec",
    surface: "#ffffff",
    ink: "#111111",
    muted: "#6e6a63",
    line: "#d9d5cc",
    accent: "#e2231a",
    accentInk: "#ffffff",
    second: "#1f4dff",
    shadow: "#111111",
    shadowOpacity: 0.18,
    dark: false,
  },
  callout: {
    name: "callout",
    background: "#09090b",
    surface: "#141418",
    ink: "#f2f2f2",
    muted: "#7d7f88",
    line: "#2a2b31",
    accent: "#ff5b1f",
    accentInk: "#09090b",
    second: "#c8ff2e",
    shadow: "#000000",
    shadowOpacity: 0.6,
    dark: true,
  },
  tutorial: {
    name: "tutorial",
    background: "#fbfaf6",
    surface: "#ffffff",
    ink: "#141414",
    muted: "#5f6168",
    line: "#dde3ea",
    accent: "#ff5a36",
    accentInk: "#ffffff",
    second: "#ffd84a",
    shadow: "#141414",
    shadowOpacity: 1,
    dark: false,
  },
};

/** A palette with its accent replaced (a brand colour). */
export function withAccent(palette: Palette, accent: string | undefined): Palette {
  if (!accent) return palette;
  const hex = accent.replace(/^#/, "");
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  // Text on the accent: dark on light accents (relative luminance), white otherwise.
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return { ...palette, accent: `#${hex.slice(0, 6).toLowerCase()}`, accentInk: lum > 0.6 ? "#111111" : "#ffffff" };
}
