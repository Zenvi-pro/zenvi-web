/**
 * A title template on a frame of another shape. The templates are drawn on
 * a 16:9 artboard; Best Fit puts that artboard in a 4:3, 1:1, 4:5, 9:16 or
 * 21:9 frame with bars around it, which shows as black bars on a title card
 * with a background. Here the artboard grows to the frame's aspect around
 * the template's drawing, so a card fills the frame:
 *
 * - the drawing stays where Best Fit, the clip's gravity and its vertical
 *   lift (titles.ts VERTICAL_SAFE_OFFSET) put it, 4 % smaller so the lines a
 *   template sets near its edge come inside title-safe, and an edge-anchored
 *   drawing 3 % in from its edge where the frame has room (a footer sits
 *   low on 9:16, 15 % up with the lift: clear of the platform UI); the text
 *   keeps its size otherwise and stays inside the area it was fitted to;
 * - a background rectangle that covered the old artboard is grown to the new
 *   one (the template's other shapes are left as drawn);
 * - width, height and viewBox are the same whole numbers of user units, of
 *   exactly the frame's aspect, so Qt (the desktop's QtImageReader) and resvg
 *   size the picture alike and Best Fit fills the frame with no sub-pixel bar.
 *
 * A frame of the template's own aspect leaves the SVG untouched.
 */

import { getAttr, setAttr, type XmlElement } from "./xml.js";
import { artboardSize, rectNodes, type TitleDoc } from "./title-svg.js";
import { parsePythonFloat } from "../tools/coerce.js";

export interface ArtboardPlacement {
  /** Where the old artboard sat across the frame (the clip's gravity). */
  h: "left" | "center" | "right";
  v: "top" | "center" | "bottom";
  /** libopenshot location_y it was lifted by: a share of the frame height. */
  lift: number;
}

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

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Up to 4 decimals, no trailing zeros. */
function num(value: number): string {
  return String(Math.round(value * 1e4) / 1e4);
}

/** How much larger than the old artboard the new one is on the side that binds. */
const SAFE_ROOM = 1.04;
/** How far in from its edge an edge-anchored drawing sits, as a share of the frame (when the frame has the room). */
const EDGE_INSET = 0.03;

const TRANSLATE = /^\s*translate\(\s*([-+\d.eE]+)(?:[\s,]+([-+\d.eE]+))?\s*\)\s*$/;

/** The rectangle's y axis is flipped by its own `scale(1,-1)`; null when a transform would move it otherwise. */
function rectFlip(rect: XmlElement): boolean | null {
  for (let el: XmlElement | null = rect.parent; el; el = el.parent) {
    const t = getAttr(el, "transform");
    if (!t) continue;
    // Inkscape's hairline translates (a few thousandths of a unit) do not move a background.
    const m = TRANSLATE.exec(t);
    if (!m || Math.abs(Number(m[1])) > 2 || Math.abs(Number(m[2] ?? 0)) > 2) return null;
  }
  const own = getAttr(rect, "transform").replace(/\s+/g, "");
  if (!own) return false;
  return own === "scale(1,-1)" ? true : null;
}

/** Grow the first rectangle to `box` when it covered the old artboard `old` (within 1 %). */
function growBackground(doc: TitleDoc, old: { x: number; y: number; width: number; height: number }, box: { x: number; y: number; width: number; height: number }): boolean {
  const rect = rectNodes(doc)[0];
  if (!rect) return false;
  const flip = rectFlip(rect);
  if (flip === null) return false;
  const value = (name: string): number => parsePythonFloat(getAttr(rect, name) || "0") ?? Number.NaN;
  const [x, y, w, h] = [value("x"), value("y"), value("width"), value("height")];
  const top = flip ? -(y + h) : y;
  const near = (a: number, b: number, size: number) => Math.abs(a - b) <= size * 0.01;
  if (!(near(x, old.x, old.width) && near(top, old.y, old.height) && near(w, old.width, old.width) && near(h, old.height, old.height))) return false;
  // A unit past every edge: Best Fit's resampling never lets the bars' edge show through.
  const grown = { x: box.x - 1, y: box.y - 1, width: box.width + 2, height: box.height + 2 };
  setAttr(rect, "x", num(grown.x));
  setAttr(rect, "y", num(flip ? -(grown.y + grown.height) : grown.y));
  setAttr(rect, "width", num(grown.width));
  setAttr(rect, "height", num(grown.height));
  return true;
}

/**
 * Give the title the frame's aspect (see the module comment). Returns false
 * (and changes nothing) when it already has it.
 */
export function fitArtboardToFrame(doc: TitleDoc, frame: { width: number; height: number }, place: ArtboardPlacement): boolean {
  const old = artboardBox(doc);
  const fw = Math.max(1, Math.round(frame.width));
  const fh = Math.max(1, Math.round(frame.height));
  if (Math.abs(fw / fh / (old.width / old.height) - 1) < 0.005) return false;
  // The smallest whole-unit artboard of the frame's exact aspect that holds the old one with room to spare,
  // so a line the template sets near its edge (Footer_1: 3 % in) lands inside title-safe (5 %).
  const g = gcd(fw, fh);
  const [a, b] = [fw / g, fh / g];
  const m = Math.ceil(Math.max(old.width / a, old.height / b) * SAFE_ROOM - 1e-9);
  const [w, h] = [a * m, b * m];
  // An edge anchor keeps the drawing a little in from that edge where the frame has room for it.
  const insetX = Math.min((w - old.width) / 2, EDGE_INSET * w);
  const insetY = Math.min((h - old.height) / 2, EDGE_INSET * h);
  const x0 = place.h === "left" ? insetX : place.h === "right" ? w - old.width - insetX : (w - old.width) / 2;
  const y0 = (place.v === "top" ? insetY : place.v === "bottom" ? h - old.height - insetY : (h - old.height) / 2) + place.lift * h;
  const box = { x: old.x - x0, y: old.y - y0, width: w, height: h };
  setAttr(doc.root, "width", String(w));
  setAttr(doc.root, "height", String(h));
  setAttr(doc.root, "viewBox", `${num(box.x)} ${num(box.y)} ${w} ${h}`);
  growBackground(doc, old, box);
  return true;
}
