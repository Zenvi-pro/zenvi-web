/**
 * LUT names → what an effect's `lut_path` stores, for the colour tools.
 *
 * Ports of zenvi-core develop src/classes/effect_ops.py `resolve_lut` (editor
 * tools: color_grade_clip_tool, update_effect_tool) and the older tools'
 * `_resolve_lut_file` / color_agent.py `resolve_lut_filesystem_path`. The
 * built-ins resolve to their portable `@colors/…` path (effects/luts.ts),
 * which every renderer reads from the bundled assets. A `.cube` file outside
 * the built-ins renders only where the renderer can read local files (the
 * CLI): it is accepted there after it is read and parsed like libopenshot
 * would, and refused on the other surfaces.
 */

import { builtinLutByRelativePath, builtinLutForPath, isAbsoluteFilePath, listLuts, LUT_ALIAS, type LutEntry } from "../effects/luts.js";
import { parseCubeLut } from "../render/kernels/cube-lut.js";
import type { ToolCall } from "./define.js";
import { getCloseMatches } from "./difflib.js";
import { pyReprString } from "./pyfmt.js";

export type ResolvedLut =
  /** "", "none", "off", "no": no LUT. */
  | { kind: "none"; path: "" }
  | { kind: "builtin"; path: string; lut: LutEntry }
  /** A `.cube` file outside the built-ins. */
  | { kind: "file"; path: string };

/** A LUT that cannot be used (the desktop's ValueError text). */
export class LutError extends Error {
  override readonly name = "LutError";
}

/** effect_ops._norm: lower case, `&` → "and", letters and digits only. */
function norm(text: string): string {
  return Array.from(String(text).toLowerCase().replaceAll("&", "and"))
    .filter((ch) => /[\p{L}\p{N}]/u.test(ch))
    .join("");
}

const stem = (lut: LutEntry): string => lut.id.slice(lut.id.indexOf("/") + 1);

/**
 * effect_ops.resolve_lut: a LUT id (`category/file`), display name, file
 * name, `@colors/` alias or absolute path. Throws `LutError` with the
 * closest ids when nothing matches.
 */
export function resolveLut(value: unknown): ResolvedLut {
  const text = String(value ?? "").trim();
  if (["", "none", "off", "no"].includes(text.toLowerCase())) return { kind: "none", path: "" };
  if (text.startsWith(LUT_ALIAS) || isAbsoluteFilePath(text)) {
    const lut = builtinLutForPath(text);
    if (lut) return { kind: "builtin", path: lut.path, lut };
    if (text.startsWith(LUT_ALIAS) || !text.toLowerCase().endsWith(".cube")) {
      throw new LutError(`LUT file not found or not a .cube file: ${text}`);
    }
    return { kind: "file", path: text };
  }
  const luts = listLuts();
  const key = norm(text.toLowerCase().endsWith(".cube") ? text.slice(0, -5) : text);
  for (const field of ["id", "name"] as const) {
    for (const lut of luts) {
      if (norm(lut[field]) === key || norm(stem(lut)) === key) return { kind: "builtin", path: lut.path, lut };
    }
  }
  const partial = luts.filter((lut) => key && norm(lut.id).includes(key));
  if (partial.length === 1) return { kind: "builtin", path: partial[0]!.path, lut: partial[0]! };
  const close = getCloseMatches(text, luts.map((lut) => lut.id), 5, 0.3);
  const hints = close.length > 0 ? close : partial.slice(0, 5).map((lut) => lut.id);
  const hint = hints.length > 0 ? `; closest: ${hints.join(", ")}` : "";
  throw new LutError(`no LUT named ${pyReprString(text)}${hint} (list_luts_tool lists them)`);
}

/**
 * color_agent.resolve_lut_filesystem_path for a look's `lut_path`
 * (`category/name.cube`, `@colors/…` or absolute): the stored path, or
 * undefined when it names no built-in LUT (the desktop's "LUT file not found").
 */
export function colorAgentLutPath(lutPath: string): ResolvedLut | undefined {
  let raw = String(lutPath ?? "").trim();
  if (!raw) return { kind: "none", path: "" };
  if (raw.startsWith(LUT_ALIAS)) raw = raw.slice(LUT_ALIAS.length);
  if (isAbsoluteFilePath(raw)) {
    const lut = builtinLutForPath(raw);
    return lut ? { kind: "builtin", path: lut.path, lut } : { kind: "file", path: raw };
  }
  const lut = builtinLutByRelativePath(raw);
  return lut ? { kind: "builtin", path: lut.path, lut } : undefined;
}

/** Why this host cannot use a LUT file outside the built-ins, or null when it can read it. */
export function lutFileUnsupported(call: ToolCall): string | null {
  if (call.host.media?.importPath && call.host.storage?.readText) return null;
  return "a .cube file outside the built-in LUTs needs local file access (Zenvi desktop or the zenvi CLI); use a built-in LUT (list_luts_tool)";
}

/**
 * Check a LUT file outside the built-ins the way libopenshot loads it
 * (ColorMap::load_cube_file): readable and a 1D/3D `.cube` table. Throws
 * `LutError` with the reason.
 */
export async function checkLutFile(call: ToolCall, path: string): Promise<void> {
  const unsupported = lutFileUnsupported(call);
  if (unsupported) throw new LutError(unsupported);
  let text: string;
  try {
    text = await call.host.storage!.readText!(path);
  } catch {
    throw new LutError(`LUT file not found or not a .cube file: ${path}`);
  }
  if (!parseCubeLut(text)) throw new LutError(`${path} is not a LUT libopenshot can load (no LUT_3D_SIZE / LUT_1D_SIZE table)`);
}

/**
 * A LUT argument → what `lut_path` stores: resolved like effect_ops.resolve_lut,
 * and a file outside the built-ins checked through the host. Throws `LutError`.
 */
export async function resolveCheckedLut(call: ToolCall, value: unknown): Promise<string> {
  const resolved = resolveLut(value);
  if (resolved.kind === "file") await checkLutFile(call, resolved.path);
  return resolved.path;
}
