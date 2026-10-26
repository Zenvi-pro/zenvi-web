/**
 * Design tokens every block takes: a palette, an accent, the headline face
 * and a corner radius. Defaults follow docs/TASTE.md §4-5 (one accent +
 * neutrals, at most two type families).
 */

export interface Palette {
  /** Background. */
  paper: string;
  /** Text and strokes. */
  ink: string;
  /** Cards and panels. */
  surface: string;
  /** Secondary text, labels. */
  muted: string;
  /** Hairlines, borders. */
  line: string;
  accent: string;
  secondary: string;
  /** Glass panel fill (over photos). */
  glass: string;
  dark: boolean;
}

export const PALETTES = {
  light: { paper: "#F7F7F5", ink: "#0B0B0F", surface: "#FFFFFF", muted: "#6E6E78", line: "rgba(11,11,15,0.10)", accent: "#FF5A36", secondary: "#2F6BFF", glass: "rgba(255,255,255,0.55)", dark: false },
  dark: { paper: "#0B0B0F", ink: "#F7F7F5", surface: "#17171D", muted: "#9696A2", line: "rgba(247,247,245,0.14)", accent: "#FF5A36", secondary: "#2F6BFF", glass: "rgba(23,23,29,0.55)", dark: true },
  cream: { paper: "#F2ECE1", ink: "#1C1915", surface: "#FBF8F2", muted: "#7A7166", line: "rgba(28,25,21,0.12)", accent: "#FF6A1A", secondary: "#2E5E4E", glass: "rgba(251,248,242,0.6)", dark: false },
  forest: { paper: "#0D2620", ink: "#ECF3EF", surface: "#143229", muted: "#8FB3A5", line: "rgba(236,243,239,0.14)", accent: "#6BE39B", secondary: "#F2C14E", glass: "rgba(20,50,41,0.5)", dark: true },
  mono: { paper: "#050506", ink: "#FFFFFF", surface: "#111114", muted: "#8A8A93", line: "rgba(255,255,255,0.22)", accent: "#D7FF3A", secondary: "#FFFFFF", glass: "rgba(17,17,20,0.6)", dark: true },
  sky: { paper: "#EAF1FB", ink: "#0E1726", surface: "#FFFFFF", muted: "#5D6B80", line: "rgba(14,23,38,0.10)", accent: "#3D7BFF", secondary: "#FF7AB6", glass: "rgba(255,255,255,0.45)", dark: false },
  ember: { paper: "#140D09", ink: "#FFF3E6", surface: "#22160F", muted: "#B39883", line: "rgba(255,243,230,0.14)", accent: "#FF8A1F", secondary: "#FFD25E", glass: "rgba(34,22,15,0.55)", dark: true },
  night: { paper: "#06061A", ink: "#EEF0FF", surface: "#12122E", muted: "#8E90B8", line: "rgba(238,240,255,0.14)", accent: "#6C5CFF", secondary: "#FFC23D", glass: "rgba(18,18,46,0.5)", dark: true },
  tide: { paper: "#0A2A33", ink: "#E8F6F5", surface: "#113A45", muted: "#86B5B4", line: "rgba(232,246,245,0.14)", accent: "#FF6A4D", secondary: "#7FE0D2", glass: "rgba(17,58,69,0.5)", dark: true },
  cherry: { paper: "#1A0507", ink: "#FFF1F0", surface: "#2A0A0E", muted: "#C79A9E", line: "rgba(255,241,240,0.16)", accent: "#F2364A", secondary: "#FFB4BC", glass: "rgba(42,10,14,0.5)", dark: true },
  porcelain: { paper: "#E7EBEF", ink: "#101820", surface: "#FFFFFF", muted: "#5F6B78", line: "rgba(16,24,32,0.10)", accent: "#E5484D", secondary: "#2F6BFF", glass: "rgba(255,255,255,0.5)", dark: false },
  lilac: { paper: "#ECE8F6", ink: "#17132A", surface: "#FFFFFF", muted: "#6B6585", line: "rgba(23,19,42,0.10)", accent: "#7A5CFF", secondary: "#FF8FB1", glass: "rgba(255,255,255,0.5)", dark: false },
} as const satisfies Record<string, Palette>;

export type PaletteName = keyof typeof PALETTES;
export const PALETTE_NAMES = Object.keys(PALETTES) as PaletteName[];

/** Type roles to bundled faces (fonts/, all SIL OFL 1.1). */
export const FONT_STACKS = {
  sans: "'Inter', 'Helvetica Neue', Arial, sans-serif",
  serif: "'Instrument Serif', Georgia, serif",
  mono: "'JetBrains Mono', ui-monospace, Menlo, monospace",
  display: "'Anton', 'Inter', Impact, sans-serif",
} as const;

export type FontRole = keyof typeof FONT_STACKS;
export const FONT_ROLES = Object.keys(FONT_STACKS) as FontRole[];

/** The bundled font files: family, file under fonts/, weight range, style. */
export const FONT_FACES = [
  { family: "Inter", file: "Inter-Variable.woff2", weight: "100 900", style: "normal" },
  { family: "Inter", file: "Inter-Variable-Italic.woff2", weight: "100 900", style: "italic" },
  { family: "Instrument Serif", file: "InstrumentSerif-Regular.woff2", weight: "400", style: "normal" },
  { family: "Instrument Serif", file: "InstrumentSerif-Italic.woff2", weight: "400", style: "italic" },
  { family: "JetBrains Mono", file: "JetBrainsMono-Variable.woff2", weight: "100 800", style: "normal" },
  { family: "Anton", file: "Anton-Regular.woff2", weight: "400", style: "normal" },
] as const;

export interface Tokens {
  palette: Palette;
  /** The headline face. */
  display: FontRole;
  radius: number;
}

/** The palette with the accent replaced (a brand colour). */
export function withAccent(palette: Palette, accent: string | undefined): Palette {
  return accent ? { ...palette, accent } : palette;
}
