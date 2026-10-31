/**
 * The bundled type families for tools: resolving a `font_family` argument
 * and loading the families' files through the host (`AssetHost.readBytes`).
 */

import { FONT_FAMILIES, FONT_FAMILY_IDS, bundledFamily, fallbackFamily, type FontFamilyId } from "../typography/families.js";
import { FontLibrary } from "../typography/library.js";
import { outlineSvgText, stripOutlines, svgBundledFamilies } from "../typography/outline.js";
import type { ToolCall } from "./define.js";
import { installedFontFamilies } from "./titles-text.js";

/** "inter (grotesk), anton (condensed), …" for tool descriptions. */
export const FONT_FAMILY_LIST = FONT_FAMILY_IDS.map((id) => `${id} (${FONT_FAMILIES[id].category})`).join(", ");

/** The bundled family a `font_family` argument means: one by name, else the bundled face of the kind it names ("Arial", "serif", "condensed"). */
export function familyArg(value: string): FontFamilyId | null {
  return bundledFamily(value) ?? fallbackFamily(value);
}

/** The refusal for a `font_family` that names no bundled family. */
export function unknownFamily(value: string): string {
  return `Error: unknown font_family ${JSON.stringify(value)}; bundled families: ${FONT_FAMILY_IDS.join(", ")}.`;
}

/** CSS generic families and the fallback face renderers use: no host "has" them as a choice. */
const GENERIC = new Set(["sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui", "dejavu sans", "dejavu serif", "dejavu sans mono", "dejavu sans condensed"]);

/**
 * The bundled family that draws text set in `css`: the family itself when
 * bundled; else, for a font this host does not have (any generic family, and
 * any font at all where `installed` is known), the bundled face of its kind.
 */
export function titleFamily(css: string, installed: readonly string[] | null): FontFamilyId | null {
  const own = bundledFamily(css);
  if (own) return own;
  const low = css.toLowerCase().replace(/['"]/g, "").trim();
  const missing = GENERIC.has(low) || (installed !== null && !installed.some((f) => f.toLowerCase() === low));
  return missing ? fallbackFamily(low) : null;
}

/** Receipt warnings for an outlined title: faces stood in for, characters no bundled face could draw. */
export function titleFontWarnings(outlined: { missing: readonly string[]; substituted: readonly string[] }): string[] {
  const subs = outlined.substituted.length > 0 ? [`Not installed here, set in a bundled face of the same kind (the same on every surface): ${outlined.substituted.join(", ")}.`] : [];
  return [...subs, ...missingGlyphWarnings(outlined.missing)];
}

/** The receipt warning for characters no bundled face could draw (none when every character was drawn). */
export function missingGlyphWarnings(missing: readonly string[]): string[] {
  return missing.length > 0 ? [`No bundled font has a glyph for ${missing.join(" ")}; those characters are left out.`] : [];
}

/** The families' fonts, or an `Error:` message when the host cannot read them. */
export async function loadFamilies(call: ToolCall, families: Iterable<FontFamilyId>): Promise<FontLibrary | string> {
  const read = call.host.assets?.readBytes;
  if (!read) return "Error: this Zenvi surface cannot read the bundled fonts.";
  try {
    return await FontLibrary.load((path) => read.call(call.host.assets, path), families);
  } catch (error) {
    return `Error: could not load the bundled fonts: ${error instanceof Error ? error.message : String(error)}.`;
  }
}

/**
 * Fonts an SVG title can use: the host's installed fonts plus the bundled
 * families (drawn as outlines, so no host needs them installed), or null
 * where the host cannot list its fonts.
 */
export async function titleFontFamilies(call: ToolCall): Promise<string[] | null> {
  const installed = await installedFontFamilies(call);
  if (installed === null || !call.host.assets?.readBytes) return installed;
  const names = FONT_FAMILY_IDS.map((id) => FONT_FAMILIES[id].name);
  return [...installed.filter((f) => !names.includes(f)), ...names];
}

/**
 * A title SVG ready to write: earlier outlines dropped, and the text set in a
 * bundled family redrawn as outlines (the words stay in the file, hidden).
 * Text in other fonts stays text. Returns an `Error:` message when the
 * fonts cannot be read.
 */
export async function outlineTitle(call: ToolCall, svg: string): Promise<{ svg: string; missing: string[]; substituted: string[] } | string> {
  const plain = stripOutlines(svg);
  const canRead = Boolean(call.host.assets?.readBytes);
  const installed = canRead ? await installedFontFamilies(call) : null;
  const substituted = new Set<string>();
  const resolve = (css: string): FontFamilyId | null => {
    // A surface that cannot read the bundled fonts (Zenvi Cloud) keeps unbundled text as text, as before.
    if (!canRead) return bundledFamily(css);
    const family = titleFamily(css, installed);
    // Generic families and the DejaVu fallback (templates' default) are stood in for silently: nobody chose them.
    if (family && !bundledFamily(css) && !GENERIC.has(css.toLowerCase())) substituted.add(`${css} → ${FONT_FAMILIES[family].name}`);
    return family;
  };
  const families = svgBundledFamilies(plain, resolve);
  if (families.length === 0) return { svg: plain, missing: [], substituted: [] };
  const lib = await loadFamilies(call, families);
  if (typeof lib === "string") return lib;
  const out = outlineSvgText(plain, lib, { family: resolve });
  return { svg: out.svg, missing: out.missing, substituted: [...substituted] };
}
