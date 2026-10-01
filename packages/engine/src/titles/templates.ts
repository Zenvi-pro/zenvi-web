/**
 * The built-in SVG title templates (zenvi-core src/titles/*.svg), shipped
 * unchanged in `@zenvi/engine/assets/titles/`. Text, font and color edits
 * on a template are `titles/svg.ts` (`setSvgText`, `buildTitleSvg`).
 *
 * Names follow the desktop titles list (src/windows/models/titles_model.py);
 * the default and the name lookup follow the agent's add_title_tool
 * (src/classes/agent_tools/titles.py `_default_template`, `add_title`).
 */

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

/**
 * The built-in template add_title_tool means by `template`: empty → the
 * default; otherwise the file name, its stem or the display name, compared
 * case-insensitively, after dropping any folder (`"titles/Footer_1.svg"`).
 * The desktop matches the file name only (case-insensitively on macOS and
 * Windows). An absolute path names a user's own SVG, not a built-in
 * template, so it returns undefined; hosts read such files themselves.
 */
export function getTitleTemplate(template?: string | null): TitleTemplate | undefined {
  const ref = (template ?? "").trim();
  if (!ref) return DEFAULT_TITLE_TEMPLATE;
  if (isAbsolutePath(ref)) return undefined;
  const base = (ref.split(/[\\/]/).pop() ?? "").toLowerCase();
  const stem = base.endsWith(".svg") ? base.slice(0, -4) : base;
  return TITLE_TEMPLATES.find((t) => t.id.toLowerCase() === stem || t.name.toLowerCase() === base);
}
