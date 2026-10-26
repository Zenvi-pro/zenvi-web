/**
 * A motion template in a bundled typeface (`font_family`): the plan is laid
 * out as always (Helvetica metrics, text.ts), then every sans `<text>` of its
 * drawings is redrawn as outlines in the family (typography/outline.ts), so
 * the face is the same on every renderer. Two rules keep the layout valid:
 * the family's cap height is set to Helvetica's (0.718 em), so line heights
 * and the boxes around words keep their proportions, and a line never runs
 * wider than the Helvetica estimate the layout measured (it shrinks about
 * its anchor). A mono family replaces the templates' monospace labels
 * instead, and the other families their sans type.
 * Without a family the plan is untouched: defaults and goldens do not move.
 */

import { FONT_FAMILIES, type FontFamilyId } from "../typography/families.js";
import type { FontLibrary } from "../typography/library.js";
import { outlineSvgText } from "../typography/outline.js";
import { MONO, SANS } from "./svg.js";
import { textWidth } from "./text.js";
import type { MotionPlan } from "./types.js";

/** Helvetica's cap height, em (the core font metrics: 718 / 1000). */
export const HELVETICA_CAP_HEIGHT = 0.718;

const first = (stack: string): string => (stack.split(",")[0] ?? "").trim().replace(/^['"]|['"]$/g, "");

/** `plan` with its drawings' type redrawn in `family`, and the characters the family could not draw. */
export function planInTypeface(plan: MotionPlan, lib: FontLibrary, family: FontFamilyId): { plan: MotionPlan; missing: string[] } {
  const isMono = FONT_FAMILIES[family].category === "mono";
  const target = first(isMono ? MONO : SANS);
  const missing = new Set<string>();
  const layers = plan.layers.map((layer) => {
    if (layer.source.kind !== "svg") return layer;
    const out = outlineSvgText(layer.source.svg, lib, {
      family: (css) => (css === target ? family : null),
      capHeight: HELVETICA_CAP_HEIGHT,
      maxWidth: (chunk) => textWidth(chunk.text, { size: chunk.size, font: isMono ? "mono" : "sans", bold: chunk.weight >= 600, tracking: chunk.tracking }),
    });
    for (const m of out.missing) missing.add(m);
    return out.outlined > 0 ? { ...layer, source: { ...layer.source, svg: out.svg } } : layer;
  });
  return { plan: { ...plan, layers }, missing: [...missing] };
}
