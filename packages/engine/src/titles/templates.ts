/**
 * The built-in SVG title templates (zenvi-core src/titles/*.svg), shipped
 * unchanged in `@zenvi/engine/assets/titles/`. Text, font and color edits
 * on a template are `titles/svg.ts` (`setSvgText`, `buildTitleSvg`).
 *
 * Names follow the desktop titles list (src/windows/models/titles_model.py);
 * the default and the name lookup follow the agent's add_title_tool
 * (src/classes/agent_tools/titles.py `_default_template`, `add_title`).
 */

import { getCloseMatches } from "../tools/difflib.js";
import { transitionDisplayName } from "../transitions/catalog.js";
import { TITLE_TEMPLATE_FILES } from "./templates.data.js";

export interface TitleTemplate {
  /** File name without extension, e.g. `"Bar_1"`. */
  id: string;
  /** Desktop display name, e.g. `"Bar 1"`. */
  name: string;
  /** File name, e.g. `"Bar_1.svg"`. */
  file: string;
  /** The bundled SVG, relative to `@zenvi/engine/assets/`: `"titles/Bar_1.svg"`. */
  assetPath: string;
  /** The template add_title_tool uses when none is named. */
  default: boolean;
}

/** add_title_tool's preference order for the default template. */
const DEFAULT_PREFERENCE = ["Bar_1.svg", "Standard_1.svg", "Footer_1.svg"];

const defaultFile =
  DEFAULT_PREFERENCE.find((file) => TITLE_TEMPLATE_FILES.includes(file)) ??
  TITLE_TEMPLATE_FILES.find((file) => file.toLowerCase().endsWith(".svg"));

/** Every built-in template, sorted by file name like the desktop list. */
export const TITLE_TEMPLATES: readonly TitleTemplate[] = TITLE_TEMPLATE_FILES.map((file) =>
  Object.freeze({
    id: file.replace(/\.svg$/i, ""),
    // titles_model.py names templates with the same rule as transition_model.py.
    name: transitionDisplayName(file),
    file,
    assetPath: `titles/${file}`,
    default: file === defaultFile,
  }),
);

/** The template used when none is named (`_default_template`: Bar_1.svg). */
export const DEFAULT_TITLE_TEMPLATE: TitleTemplate = TITLE_TEMPLATES.find((t) => t.default)!;

function isAbsolutePath(ref: string): boolean {
  return ref.startsWith("/") || ref.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(ref);
}

/** title_svg.find_template's `norm`: no extension, lower case, runs of space, _ and - as one "_". */
function templateKey(name: string): string {
  const base = name.trim();
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.trim().toLowerCase().replace(/[\s_-]+/g, "_");
}

/**
 * The built-in template add_title_tool means by `template`
 * (title_svg.find_template): empty → the default; otherwise the file name,
 * its stem or the display name, ignoring case, extension and whether words
 * are joined by spaces, "_" or "-" ("gray box 4", "Gray_Box_4.svg"), after
 * dropping any folder (`"titles/Footer_1.svg"`). An absolute path names a
 * user's own SVG, not a built-in template, so it returns undefined; hosts
 * read such files themselves.
 */
export function getTitleTemplate(template?: string | null): TitleTemplate | undefined {
  const ref = (template ?? "").trim();
  if (!ref) return DEFAULT_TITLE_TEMPLATE;
  if (isAbsolutePath(ref)) return undefined;
  const wanted = templateKey(ref.split(/[\\/]/).pop() ?? "");
  return TITLE_TEMPLATES.find((t) => templateKey(t.file) === wanted || templateKey(t.name) === wanted);
}

/** title_svg.suggest_templates: template names that look like `name`, for "did you mean" refusals. */
export function suggestTitleTemplates(name: string, limit = 6): string[] {
  const names = TITLE_TEMPLATES.map((t) => t.id);
  const raw = String(name ?? "").trim();
  const close = getCloseMatches(raw, names, limit, 0.4);
  if (close.length > 0) return close;
  const low = raw.toLowerCase().split("_")[0] ?? "";
  return names.filter((n) => low && n.toLowerCase().includes(low)).slice(0, limit);
}
