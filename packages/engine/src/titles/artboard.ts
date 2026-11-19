/**
 * The artboard of a title SVG, and the span its text is fitted to. Titles
 * zenvi-web reshaped to a frame of another aspect (before #407 titles became
 * animated styles) keep a viewBox of that aspect; their text is fitted to
 * title-safe.
 */

import { getAttr } from "./xml.js";
import { artboardSize, type TitleDoc } from "./title-svg.js";
import { parsePythonFloat } from "../tools/coerce.js";

/** The artboard in user units: the viewBox when there is one, else (0, 0, width, height). */
export function artboardBox(doc: TitleDoc): { x: number; y: number; width: number; height: number } {
  const [width, height] = artboardSize(doc);
  const box = getAttr(doc.root, "viewBox").trim().split(/[\s,]+/).filter(Boolean).map((v) => parsePythonFloat(v));
  if (box.length === 4 && box.every((v) => v !== null)) return { x: box[0]!, y: box[1]!, width: box[2]!, height: box[3]! };
  return { x: 0, y: 0, width, height };
}

/** Title-safe inset of a reshaped title: text is fitted 5 % in from each side. */
const TITLE_SAFE = 0.05;

/**
 * The span text is fitted to (user units): the artboard of a 16:9 title (the
 * desktop's rule), title-safe of any other (a title fitted to its frame).
 */
export function textSpan(doc: TitleDoc): { left: number; width: number } {
  const box = artboardBox(doc);
  if (Math.abs(box.width / box.height / (16 / 9) - 1) < 0.005) return { left: box.x, width: box.width };
  return { left: box.x + box.width * TITLE_SAFE, width: box.width * (1 - 2 * TITLE_SAFE) };
}
