/**
 * The built-in colour LUTs (`.cube`) that ColorMap and Color Grade apply.
 *
 * zenvi-core ships 50 LUTs in src/colors/<category>/<name>.cube (CC0, from
 * freshluts.com; colors/AUTHORS.md). They are bundled byte for byte as engine
 * assets (`assets/colors/…`) and a project names them by the portable path
 * `@colors/<category>/<name>.cube`, which every renderer resolves to the
 * bundled file (the desktop stores the same alias on save). The engine's
 * ColorMap kernel is a port of libopenshot's LUT stage, so a built-in LUT
 * renders the same on every surface.
 *
 * `listLuts` ports src/classes/effect_ops.py `list_luts` (the lut_path
 * dropdown). The desktop also lists a user LUT folder
 * (~/.openshot_qt/colors); the web surfaces have none, so it is the
 * built-ins only. Name resolution for the tools is tools/luts.ts.
 */

/** Categories and LUT names in the order the desktop lists them (folder, then file, case-insensitive). */
export const BUILTIN_LUTS: readonly (readonly [category: string, names: readonly string[]])[] = [
  [
    "cinematic_&_blockbuster",
    [
      "bold_red_cinema",
      "city_neon_cinema",
      "cool_cinema",
      "dreamy_cinema",
      "elegant_dark_cinema",
      "heroic_cinema",
      "romantic_cinema",
      "sunlit_cinema",
      "teal_&_orange_cinema",
      "teal_cinema",
      "warm_cinema",
    ],
  ],
  [
    "dark_&_moody",
    [
      "city_night_film",
      "cold_shadows",
      "cool_haze",
      "dramatic_warmth",
      "icy_drama",
      "mystic_emerald_drama",
      "night_glow",
      "noir_era",
      "retro_red_shadows",
      "spy_night",
      "teal_horror",
      "woodland_drama",
    ],
  ],
  [
    "film_stock_&_vintage",
    [
      "classic_film",
      "dark_orange_film",
      "emerald_film",
      "faded_memories",
      "golden_wood_film",
      "golden_years_film",
      "green_film_pop",
      "low_key_film",
      "red_film",
      "standard_film",
      "vintage_400_film",
      "vintage_green_film",
      "warm_roast_film",
    ],
  ],
  ["teal_&_orange_vibes", ["moonlight_orange", "signature_teal_&_orange", "sunset_orange", "teal_punch", "tropical_teal", "western_sunset"]],
  ["utility_&_correction", ["clean_&_denoise", "protect_highlights", "warm_correction"]],
  ["vibrant_&_colorful", ["color_pop", "photo_contrast", "valentine_pop", "warm_pop", "warm_to_cool"]],
];

/** The portable path prefix of the built-in LUTs (desktop json_data.py `@colors/`). */
export const LUT_ALIAS = "@colors/";

export interface LutEntry {
  /** `category/name`, what list_luts_tool and color_grade_clip_tool take. */
  id: string;
  /** `Teal Cinema`. */
  name: string;
  /** `Cinematic & Blockbuster`. */
  category: string;
  /** Folder name, `cinematic_&_blockbuster`. */
  folder: string;
  /** `@colors/cinematic_&_blockbuster/teal_cinema.cube`, what effects store in `lut_path`. */
  path: string;
  /** Path under the engine's `assets/` folder. */
  assetPath: string;
  builtin: true;
}

/** Python `str.title()`: a cased character after an uncased one is upper case, the rest lower. */
function pyTitle(text: string): string {
  let out = "";
  let previousCased = false;
  for (const ch of text) {
    const cased = ch.toLowerCase() !== ch.toUpperCase();
    out += cased ? (previousCased ? ch.toLowerCase() : ch.toUpperCase()) : ch;
    previousCased = cased;
  }
  return out;
}

/** effect_ops._pretty: file or folder name → display name. */
function pretty(name: string): string {
  return pyTitle(name.replace(/\.cube$/i, "").replaceAll("_", " "));
}

const LUTS: readonly LutEntry[] = BUILTIN_LUTS.flatMap(([folder, names]) =>
  names.map((stem) => ({
    id: `${folder}/${stem}`,
    name: pretty(stem),
    category: pretty(folder),
    folder,
    path: `${LUT_ALIAS}${folder}/${stem}.cube`,
    assetPath: `colors/${folder}/${stem}.cube`,
    builtin: true as const,
  })),
);

/** effect_ops.list_luts: every LUT the lut_path dropdown offers (here: the built-ins). */
export function listLuts(): readonly LutEntry[] {
  return LUTS;
}

const BY_RELATIVE = new Map(LUTS.map((lut) => [`${lut.folder}/${lut.id.split("/")[1]}.cube`.toLowerCase(), lut]));

/** The built-in LUT at `<category>/<name>.cube` (case-insensitive, either slash). */
export function builtinLutByRelativePath(relative: string): LutEntry | undefined {
  return BY_RELATIVE.get(relative.replaceAll("\\", "/").replace(/^\/+/, "").toLowerCase());
}

/**
 * The built-in LUT a stored path points at: `@colors/<category>/<file>`, or a
 * desktop install's `…/colors/<category>/<file>` (projects saved before the
 * alias, or paths a desktop agent passes).
 */
export function builtinLutForPath(path: string): LutEntry | undefined {
  const normalized = String(path ?? "").trim().replaceAll("\\", "/");
  if (normalized.startsWith(LUT_ALIAS)) return builtinLutByRelativePath(normalized.slice(LUT_ALIAS.length));
  const at = normalized.toLowerCase().lastIndexOf("/colors/");
  return at >= 0 ? builtinLutByRelativePath(normalized.slice(at + "/colors/".length)) : undefined;
}

/** An absolute file path on any desktop OS (POSIX, `C:\…`, UNC). */
export function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}
