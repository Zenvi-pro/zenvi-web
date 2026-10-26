/**
 * The type families bundled with the engine (`assets/fonts/<id>/`, each with
 * its SIL Open Font License next to it). Text set in them is drawn as SVG
 * outlines (typeset.ts), so Qt's SVG renderer (Zenvi desktop), resvg (CLI,
 * Zenvi Cloud) and the browser's `<img>` (web editor) draw the same letters
 * without the font installed: none of them can load a font an SVG names.
 *
 * Picked to cover the reference reels: a neutral grotesk for UI and body
 * type, condensed display faces for creator captions' emphasis words, a heavy
 * display face, an editorial serif with its italic, a mono for technical
 * labels, a rounded face, a marker hand and a pixel face.
 */

export const FONT_FAMILY_IDS = [
  "inter",
  "anton",
  "bebas-neue",
  "archivo-black",
  "instrument-serif",
  "space-mono",
  "varela-round",
  "caveat-brush",
  "silkscreen",
] as const;
export type FontFamilyId = (typeof FONT_FAMILY_IDS)[number];

export type FontCategory = "grotesk" | "condensed" | "display" | "serif" | "mono" | "rounded" | "hand" | "pixel";

/** One font file of a family. */
export interface FontFile {
  /** Path under the engine's `assets/` folder. */
  path: string;
  /** Weight of a static face; a variable face covers `axes.wght` instead. */
  weight: number;
  italic: boolean;
}

export interface FontFamily {
  id: FontFamilyId;
  /** The family name a person types ("Bebas Neue"). */
  name: string;
  category: FontCategory;
  files: readonly FontFile[];
  /** Variation axes of a variable face, [min, max]: weight, and optical size in px. */
  axes?: { wght?: readonly [number, number]; opsz?: readonly [number, number] };
  /** Only capitals are drawn (lowercase letters map to small or full capitals). */
  caps?: boolean;
  /** Where the font comes from. */
  source: string;
}

const file = (id: string, name: string, weight = 400, italic = false): FontFile => ({ path: `fonts/${id}/${name}`, weight, italic });
const GOOGLE = "https://github.com/google/fonts/tree/main/ofl/";

export const FONT_FAMILIES: Readonly<Record<FontFamilyId, FontFamily>> = {
  inter: {
    id: "inter",
    name: "Inter",
    category: "grotesk",
    files: [file("inter", "Inter[opsz,wght].ttf")],
    axes: { wght: [100, 900], opsz: [14, 32] },
    source: `${GOOGLE}inter`,
  },
  anton: { id: "anton", name: "Anton", category: "condensed", files: [file("anton", "Anton-Regular.ttf")], source: `${GOOGLE}anton` },
  "bebas-neue": {
    id: "bebas-neue",
    name: "Bebas Neue",
    category: "condensed",
    files: [file("bebas-neue", "BebasNeue-Regular.ttf")],
    caps: true,
    source: `${GOOGLE}bebasneue`,
  },
  "archivo-black": {
    id: "archivo-black",
    name: "Archivo Black",
    category: "display",
    files: [file("archivo-black", "ArchivoBlack-Regular.ttf", 900)],
    source: `${GOOGLE}archivoblack`,
  },
  "instrument-serif": {
    id: "instrument-serif",
    name: "Instrument Serif",
    category: "serif",
    files: [file("instrument-serif", "InstrumentSerif-Regular.ttf"), file("instrument-serif", "InstrumentSerif-Italic.ttf", 400, true)],
    source: `${GOOGLE}instrumentserif`,
  },
  "space-mono": {
    id: "space-mono",
    name: "Space Mono",
    category: "mono",
    files: [file("space-mono", "SpaceMono-Regular.ttf"), file("space-mono", "SpaceMono-Bold.ttf", 700)],
    source: `${GOOGLE}spacemono`,
  },
  "varela-round": {
    id: "varela-round",
    name: "Varela Round",
    category: "rounded",
    files: [file("varela-round", "VarelaRound-Regular.ttf")],
    source: `${GOOGLE}varelaround`,
  },
  "caveat-brush": {
    id: "caveat-brush",
    name: "Caveat Brush",
    category: "hand",
    files: [file("caveat-brush", "CaveatBrush-Regular.ttf")],
    source: `${GOOGLE}caveatbrush`,
  },
  silkscreen: {
    id: "silkscreen",
    name: "Silkscreen",
    category: "pixel",
    files: [file("silkscreen", "Silkscreen-Regular.ttf"), file("silkscreen", "Silkscreen-Bold.ttf", 700)],
    caps: true,
    source: `${GOOGLE}silkscreen`,
  },
};

const squash = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const BY_NAME = new Map(FONT_FAMILY_IDS.flatMap((id) => [[squash(id), id] as const, [squash(FONT_FAMILIES[id].name), id] as const]));

/** The bundled family a name or id means ("Bebas Neue", "bebas-neue", "BebasNeue"), or null. */
export function bundledFamily(name: string | null | undefined): FontFamilyId | null {
  if (!name) return null;
  return BY_NAME.get(squash(name)) ?? null;
}

/**
 * The file of `family` for a weight and slant: the variable face, else the
 * static face of the same slant nearest in weight (an upright face when the
 * family has no italic: the typesetter slants it).
 */
export function fontFileFor(family: FontFamilyId, weight: number, italic: boolean): FontFile {
  const files = FONT_FAMILIES[family].files;
  const slanted = files.filter((f) => f.italic === italic);
  const pool = slanted.length > 0 ? slanted : files.filter((f) => !f.italic);
  return pool.reduce((best, f) => (Math.abs(f.weight - weight) < Math.abs(best.weight - weight) ? f : best));
}
