/**
 * Title SVG substitution: the desktop title editor's text, color and font
 * edits as a pure function (zenvi-core src/windows/title_editor.py:
 * `txtLine_changed`, `set_font_color_elements`, `set_bg_style`,
 * `set_font_attributes`).
 */

export interface TitleFields {
  /**
   * Replacement text for each `<tspan>` that has text, in document order (the
   * editor's "Line 1", "Line 2", …). Lines not given keep the template text.
   */
  lines?: readonly string[];
  /** Text fill for every `<text>` and `<tspan>` (`#rrggbb`). */
  textColor?: string;
  /** Text opacity 0..1 (default 1 when `textColor` is given). */
  textOpacity?: number;
  /** Fill of the first `<rect>` (the background). */
  backgroundColor?: string;
  /** Background opacity 0..1 (default 1 when `backgroundColor` is given). */
  backgroundOpacity?: number;
  /** Font family for every `<text>` and `<tspan>`. */
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  /** Multiply every font-size by this ratio. */
  fontSizeRatio?: number;
}

/** Apply `fields` to an SVG title template and return the new SVG text. */
export function buildTitleSvg(template: string, fields: TitleFields): string {
  void template;
  void fields;
  throw new Error("not implemented: buildTitleSvg");
}
