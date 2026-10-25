/**
 * SVG titles without the Title Editor dialog: a port of zenvi-core develop
 * src/classes/title_svg.py, the rules its Title Editor, title template list
 * and agent title tools share:
 *
 * - the editable text lines are the `<tspan>` elements whose first child is
 *   text, in document order (the dialog's "Line N" boxes);
 * - lines that repeat another line's text (a template's reflection or shadow
 *   copy) join it in one *field*, and each field gets a role (title /
 *   subtitle / line), so "the title" is one value to fill;
 * - fonts, text colour and background colour are written into the `style` of
 *   the text, tspan and first `<rect>` nodes;
 * - text that would run off the artboard is shrunk to fit (templates do not wrap).
 *
 * The older dialog rules (`buildTitleSvg` in ./svg.ts) write text opacity on
 * both a `<text>` and its tspans; here it is written once per line, as on
 * the desktop's develop branch.
 */

import { parsePythonFloat } from "../tools/coerce.js";
import { pyFixed } from "../tools/pyfmt.js";
import { elementsByTagName, getAttr, hasAttr, parseXml, serializeXml, setAttr, type XmlDocument, type XmlElement, type XmlText } from "./xml.js";

/** A blanked line keeps one text node, so the Title Editor still lists it and the placeholder never shows. */
export const BLANK = " ";

export type TitleDoc = XmlDocument;

export function parseTitleSvg(svg: string): TitleDoc {
  return parseXml(svg);
}

export function titleSvgText(doc: TitleDoc): string {
  return serializeXml(doc);
}

// ---------------------------------------------------------------------------
// style="" (tolerant of stray ';' and missing ':')
// ---------------------------------------------------------------------------

/** `parse_style`: key/value pairs, both stripped; parts without ':' or a key are skipped. */
export function parseStyle(style: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of String(style ?? "").split(";")) {
    const at = part.indexOf(":");
    if (at < 0) continue;
    const key = part.slice(0, at).trim();
    if (key) out.set(key, part.slice(at + 1).trim());
  }
  return out;
}

/** `format_style`: "k:v;k:v;". */
export function formatStyle(style: ReadonlyMap<string, string>): string {
  return [...style.entries()].map(([k, v]) => `${k}:${v}`).join(";") + ";";
}

export function nodeStyle(node: XmlElement): Map<string, string> {
  return parseStyle(getAttr(node, "style"));
}

export function setNodeStyle(node: XmlElement, style: ReadonlyMap<string, string>): string {
  const text = formatStyle(style);
  setAttr(node, "style", text);
  return text;
}

/** `node_property`: a presentation property from style="", then the attribute, then (optionally) the parents. */
export function nodeProperty(node: XmlElement, name: string, inherit = true): string | undefined {
  for (let current: XmlElement | null = node; current; current = current.parent) {
    let value = nodeStyle(current).get(name);
    if ((value === undefined || value === "") && hasAttr(current, name)) value = getAttr(current, name);
    if (value !== undefined && value !== "") return value;
    if (!inherit) break;
  }
  return undefined;
}

/** `_px`: '131.25px' / '120' / '12pt' → pixels (pt at 96 dpi). */
export function px(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const m = /^(-?[0-9]*\.?[0-9]+)\s*(px|pt)?$/.exec(value.trim().toLowerCase());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "pt" ? (n * 96) / 72 : n;
}

// ---------------------------------------------------------------------------
// Nodes and lines
// ---------------------------------------------------------------------------

export function textNodes(doc: TitleDoc): XmlElement[] {
  return elementsByTagName(doc, "text");
}

export function tspanNodes(doc: TitleDoc): XmlElement[] {
  return elementsByTagName(doc, "tspan");
}

export function rectNodes(doc: TitleDoc): XmlElement[] {
  return elementsByTagName(doc, "rect");
}

/** `_first_text_child`: the first child when it is a (non-CDATA) text node. */
function firstTextChild(node: XmlElement): XmlText | null {
  const first = node.children[0];
  return first && first.kind === "text" && !first.cdata ? first : null;
}

/** `line_nodes`: tspans whose first child is text, in document order. */
export function lineNodes(doc: TitleDoc): XmlElement[] {
  return tspanNodes(doc).filter((n) => firstTextChild(n) !== null);
}

function lineText(node: XmlElement): string {
  return firstTextChild(node)?.data ?? "";
}

export function lineTexts(doc: TitleDoc): string[] {
  return lineNodes(doc).map(lineText);
}

/** `_replace_text`: the first text child replaced (or a text node put first). */
function replaceText(node: XmlElement, text: string): void {
  const fresh: XmlText = { kind: "text", data: String(text), cdata: false, parent: node };
  const old = firstTextChild(node);
  if (old) node.children[0] = fresh;
  else node.children.unshift(fresh);
}

/** `artboard_size`: width/height in px, else the viewBox, else 1920×1080. */
export function artboardSize(doc: TitleDoc): [number, number] {
  const svg = doc.root;
  let width = px(getAttr(svg, "width"));
  let height = px(getAttr(svg, "height"));
  if (!(width && height)) {
    const box = getAttr(svg, "viewBox").trim().split(/[\s,]+/).filter(Boolean);
    if (box.length === 4) {
      const w = parsePythonFloat(box[2]!);
      const h = parsePythonFloat(box[3]!);
      [width, height] = w === null || h === null ? [null, null] : [w, h];
    }
  }
  return [width || 1920, height || 1080];
}

// ---------------------------------------------------------------------------
// Font and colours (the dialog's Change Font / Text Color / Background Color)
// ---------------------------------------------------------------------------

/** `_fmt`: "%.4f" without trailing zeros. */
function fmt(value: number): string {
  return pyFixed(value, 4).replace(/0+$/, "").replace(/\.$/, "");
}

function opacityText(alpha: number): string {
  return fmt(Math.max(0, Math.min(1, alpha)));
}

export interface FontChange {
  family?: string | null;
  italic?: boolean | null;
  bold?: boolean | null;
  /** Multiply each node's font size (from style, else the font-size attribute). */
  sizeRatio?: number;
}

/** `apply_font`: family, style and weight on every node (null keeps a node's value); sizes scaled. */
export function applyFont(nodes: readonly XmlElement[], change: FontChange): void {
  const ratio = change.sizeRatio ?? 1;
  for (const node of nodes) {
    const style = nodeStyle(node);
    if (change.family) style.set("font-family", `'${String(change.family).replace(/^['"]+|['"]+$/g, "")}'`);
    if (change.italic !== undefined && change.italic !== null) style.set("font-style", change.italic ? "italic" : "normal");
    if (change.bold !== undefined && change.bold !== null) style.set("font-weight", change.bold ? "bold" : "normal");
    if (ratio && Math.abs(ratio - 1) > 1e-9) {
      let size = px(style.get("font-size"));
      if (size === null && hasAttr(node, "font-size")) size = px(getAttr(node, "font-size"));
      if (size !== null) style.set("font-size", `${fmt(size * ratio)}px`);
    }
    setNodeStyle(node, style);
  }
}

/**
 * `set_text_color`: every line filled with `color` at `alpha`. Opacity is
 * written once per line (on the tspan, or on a `<text>` holding its text
 * directly): SVG multiplies nested opacities.
 */
export function setTextColor(doc: TitleDoc, color: string, alpha = 1): void {
  const opacity = opacityText(alpha);
  for (const node of [...textNodes(doc), ...tspanNodes(doc)]) {
    const style = nodeStyle(node);
    style.set("fill", color);
    const textWithTspans = node.name === "text" && elementsByTagName(node, "tspan").length > 0;
    style.set("opacity", textWithTspans ? "1" : opacity);
    setNodeStyle(node, style);
  }
}

/** `set_background`: the first `<rect>` (every template's full-frame background) at `alpha`. False without one. */
export function setBackground(doc: TitleDoc, color: string, alpha = 1): boolean {
  const rect = rectNodes(doc)[0];
  if (!rect) return false;
  const style = nodeStyle(rect);
  style.set("fill", color);
  style.set("opacity", opacityText(alpha));
  setNodeStyle(rect, style);
  return true;
}

/** `ref_color`: the first stop colour of a gradient referenced as url(#id), following xlink:href. */
function refColor(doc: TitleDoc, refId: string): string {
  const defs = elementsByTagName(doc, "defs")[0];
  if (!defs) return "";
  const seen = new Set<string>();
  let id = refId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const target = defs.children.find((n): n is XmlElement => n.kind === "element" && getAttr(n, "id") === id);
    if (!target) return "";
    const href = getAttr(target, "xlink:href") || getAttr(target, "href");
    if (href) {
      id = href.replace(/^#+/, "");
      continue;
    }
    for (const stop of target.children) {
      if (stop.kind !== "element" || stop.name !== "stop") continue;
      const color = parseStyle(getAttr(stop, "style")).get("stop-color") || getAttr(stop, "stop-color");
      if (color) return color;
    }
    return "";
  }
  return "";
}

function resolvePaint(doc: TitleDoc, value: string | undefined, fallback: string): string {
  const v = (value ?? "").trim();
  if (v.startsWith("url(#")) return refColor(doc, v.slice(5).replace(/\)+$/, "")) || fallback;
  if (!v || v === "none") return fallback;
  return v;
}

function pyFloatOr(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  return parsePythonFloat(value);
}

/** `text_color`: (fill, opacity) of a line (default the last line), opacity multiplied over its text ancestors. */
export function textColor(doc: TitleDoc, node?: XmlElement): [string, number] {
  const lines = lineNodes(doc);
  const target = node ?? lines[lines.length - 1];
  if (!target) return ["#ffffff", 1];
  const fill = resolvePaint(doc, nodeProperty(target, "fill"), "#ffffff");
  let opacity = 1;
  for (let current: XmlElement | null = target; current && (current.name === "tspan" || current.name === "text"); current = current.parent) {
    const value = pyFloatOr(nodeProperty(current, "opacity", false), 1);
    if (value !== null) opacity *= value;
  }
  return [fill, opacity];
}

/** `background_color`: (fill, opacity) of the first `<rect>`; ("", 0) without one; opacity 0 for fill:none. */
export function backgroundColor(doc: TitleDoc): [string, number] {
  const rect = rectNodes(doc)[0];
  if (!rect) return ["", 0];
  const raw = nodeProperty(rect, "fill", false);
  const fill = resolvePaint(doc, raw, "#000000");
  let opacity = pyFloatOr(nodeProperty(rect, "opacity", false), 1) ?? 1;
  if ((raw ?? "") === "none") opacity = 0;
  return [fill, opacity];
}

/** `font_family`: the first line's font family, quotes removed. */
export function fontFamily(doc: TitleDoc): string {
  for (const node of lineNodes(doc)) {
    const family = nodeProperty(node, "font-family");
    if (family) return family.replace(/^['"]+|['"]+$/g, "");
  }
  return "";
}

/** `FALLBACK_FONTS`: what the Title Editor falls back to when a template's font is not installed. */
export const FALLBACK_FONTS = ["DejaVu Sans", "Liberation Sans", "Noto Sans", "FreeSans", "Ubuntu", "Cantarell", "Open Sans", "Sans-serif", "Arial"] as const;

/**
 * `editor_font_family`: the installed family the Title Editor uses for
 * `requested` (exact, else the first family containing it), else the first
 * fallback installed under exactly that name, and only then one containing
 * it (so "Arial" wins over "Noto Sans Armenian" on macOS); "" for none.
 */
export function editorFontFamily(requested: string, families: readonly string[]): string {
  if (requested) {
    if (families.includes(requested)) return requested;
    const containing = families.find((font) => font.includes(requested));
    if (containing !== undefined) return containing;
  }
  for (const fallback of FALLBACK_FONTS) if (families.includes(fallback)) return fallback;
  for (const fallback of FALLBACK_FONTS) {
    const containing = families.find((font) => font.includes(fallback));
    if (containing !== undefined) return containing;
  }
  return "";
}

/**
 * `installed_font_for_title`: [template font, installed replacement] when
 * the title's font is not installed, else ["", ""] (also when the host cannot
 * list its fonts: `families` null). Opening such a title in the Title Editor
 * rewrites the font the same way.
 */
export function installedFontForTitle(doc: TitleDoc, families: readonly string[] | null): [string, string] {
  if (families === null) return ["", ""];
  const current = fontFamily(doc);
  if (!current || families.some((f) => current === f || f.includes(current))) return ["", ""];
  const replacement = editorFontFamily(current, families);
  return replacement ? [current, replacement] : ["", ""];
}

// ---------------------------------------------------------------------------
// Fields: the distinct text slots of a title
// ---------------------------------------------------------------------------

export type FieldRole = "title" | "subtitle" | "line";

export interface TextField {
  /** 1-based, document order of the slot's first line. */
  index: number;
  text: string;
  nodes: XmlElement[];
  fontSize: number | null;
  role: FieldRole;
  x: number | null;
  y: number | null;
  anchor: string;
}

function floatAttr(node: XmlElement, name: string): number | null {
  for (let current: XmlElement | null = node; current && (current.name === "tspan" || current.name === "text"); current = current.parent) {
    const raw = getAttr(current, name);
    if (raw) return parsePythonFloat(raw.trim().split(/[\s,]+/)[0] ?? "");
  }
  return null;
}

function isMirrored(node: XmlElement): boolean {
  for (let current: XmlElement | null = node; current && (current.name === "tspan" || current.name === "text"); current = current.parent) {
    if (getAttr(current, "transform").replace(/ /g, "").includes("scale(1,-1)")) return true;
  }
  return false;
}

function assignRoles(slots: TextField[]): void {
  if (slots.length === 0) return;
  const ranked = [...slots].sort((a, b) => (b.fontSize ?? 0) - (a.fontSize ?? 0) || a.index - b.index);
  const main = ranked.find((s) => !s.text.toLowerCase().includes("sub")) ?? ranked[0]!;
  main.role = "title";
  const rest = ranked.filter((s) => s !== main);
  const sub = rest.find((s) => s.text.toLowerCase().includes("sub")) ?? rest[0];
  if (sub) sub.role = "subtitle";
}

/** `fields`: distinct text slots; lines repeating a slot's text (reflections, shadows) join it. */
export function titleFields(doc: TitleDoc): TextField[] {
  const slots: TextField[] = [];
  const byText = new Map<string, TextField>();
  for (const node of lineNodes(doc)) {
    const text = lineText(node);
    const key = text.trim();
    let slot = key ? byText.get(key) : undefined;
    if (!slot) {
      slot = { index: slots.length + 1, text, nodes: [], fontSize: null, role: "line", x: null, y: null, anchor: "start" };
      slots.push(slot);
      if (key) byText.set(key, slot);
    }
    slot.nodes.push(node);
  }
  for (const slot of slots) {
    const primary = slot.nodes.find((n) => !isMirrored(n)) ?? slot.nodes[0]!;
    slot.fontSize = px(nodeProperty(primary, "font-size"));
    slot.x = floatAttr(primary, "x");
    slot.y = floatAttr(primary, "y");
    slot.anchor = nodeProperty(primary, "text-anchor") || "start";
  }
  assignRoles(slots);
  return slots;
}

export function fieldByRole(slots: readonly TextField[], role: FieldRole): TextField | undefined {
  return slots.find((s) => s.role === role);
}

/** `set_field_text`: every node of the slot gets the text on one line ("" becomes `BLANK`). */
export function setFieldText(slot: TextField, text: string): void {
  const value = String(text ?? "").split("\n").join(" ").trim() || BLANK;
  for (const node of slot.nodes) replaceText(node, value);
  slot.text = value;
}

/** `text_zone`: where a title's main text sits on its artboard. */
export function textZone(slots: readonly TextField[], artboardHeight: number): "top" | "center" | "bottom" {
  const main = fieldByRole(slots, "title") ?? slots[0];
  if (!main || main.y === null || !artboardHeight) return "center";
  const y = Math.abs(main.y) / artboardHeight;
  if (y < 0.3) return "top";
  if (y > 0.7) return "bottom";
  return "center";
}

// ---------------------------------------------------------------------------
// Fitting text to the artboard
// ---------------------------------------------------------------------------

/** `estimated_text_width`: a rough sans width (no font metrics here either). */
export function estimatedTextWidth(text: string, fontPx: number, bold = true): number {
  let wide = 0;
  let narrow = 0;
  let total = 0;
  for (const ch of text) {
    total += 1;
    if (/\p{Lu}/u.test(ch) || "MWmw@%".includes(ch)) wide += 1;
    else if (" .,:;'!|il1".includes(ch)) narrow += 1;
  }
  const normal = Math.max(0, total - wide - narrow);
  const per = bold ? 0.62 : 0.56;
  return fontPx * (normal * per + wide * (per + 0.14) + narrow * 0.3);
}

function availableWidth(slot: TextField, artboardWidth: number): number {
  const x = Math.max(0, Math.min(artboardWidth, slot.x ?? artboardWidth / 2));
  if (slot.anchor === "middle") return 2 * Math.min(x, artboardWidth - x) * 0.94;
  if (slot.anchor === "end") return x * 0.96;
  return (artboardWidth - x) * 0.96;
}

/** `fit_field`: shrink a slot's font when its text would run off the artboard; returns the ratio applied. */
export function fitField(slot: TextField, artboardWidth: number, minRatio = 0.35): number {
  if (!slot.text.trim() || !slot.fontSize) return 1;
  const bold = slot.nodes.some((n) => ["bold", "700", "800", "900"].includes(String(nodeProperty(n, "font-weight") ?? "normal").toLowerCase()));
  const width = estimatedTextWidth(slot.text.trim(), slot.fontSize, bold);
  const room = availableWidth(slot, artboardWidth);
  if (width <= room || width <= 0) return 1;
  const ratio = Math.max(minRatio, room / width);
  applyFont(slot.nodes, { sizeRatio: ratio });
  slot.fontSize *= ratio;
  return ratio;
}

// ---------------------------------------------------------------------------
// Names ("Name (2).svg"), the dialog's rule
// ---------------------------------------------------------------------------

/** Characters a file name may not hold (title_svg._BAD_CHARS, plus control characters). */
function withoutBadChars(text: string): string {
  let out = "";
  for (const ch of text) out += ch.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(ch) ? " " : ch;
  return out;
}

/** `safe_base_name`: a file-system safe title name from free text ("Tokyo: Day 1" → "Tokyo Day 1"). */
export function safeBaseName(text: string, fallback = "Title", limit = 60): string {
  let base = withoutBadChars(String(text ?? ""));
  base = base.split(/\s+/).filter(Boolean).join(" ").replace(/^[ .]+|[ .]+$/g, "");
  if (base.toLowerCase().endsWith(".svg")) base = base.slice(0, -4).replace(/^[ .]+|[ .]+$/g, "");
  if ([...base].length > limit) base = [...base].slice(0, limit).join("").replace(/[ .]+$/, "");
  return base || fallback;
}

/**
 * `duplicate_pattern`: where the copy number goes. 'Title.svg' → ['Title (', 0]
 * (copies 'Title (1)', 'Title (2)'…); 'Title (3).svg' → ['Title (', 3].
 */
export function duplicatePattern(fileName: string): [string, number] {
  let name = String(fileName).split(/[\\/]/).pop() ?? "";
  if (!name.toLowerCase().endsWith(".svg")) name += ".svg";
  const m = /^(.+?)(\s*)(\(([0-9]*)\))?\.svg$/i.exec(name);
  if (!m) return [`${name.replace(/\.[^.]*$/, "")} (`, 0];
  if (m[4]) return [`${m[1]}${m[2]}(`, Number(m[4])];
  return [`${m[1]} (`, 0];
}

/** `free_name`: the first `<prefix><offset + i>)` whose .svg name is not taken (case-insensitively). */
export function freeName(prefix: string, offset: number, taken: Iterable<string>, limit = 1000): string | null {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  for (let i = 1; i < limit; i += 1) {
    const name = `${prefix}${offset + i})`;
    if (!used.has(`${name}.svg`.toLowerCase())) return name;
  }
  return null;
}

/** `unique_title_path`'s name: `<base>.svg` when free, else the Duplicate rule. */
export function uniqueTitleName(base: string, taken: Iterable<string>): string {
  const safe = safeBaseName(base);
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(`${safe}.svg`.toLowerCase())) return `${safe}.svg`;
  const [prefix, offset] = duplicatePattern(`${safe}.svg`);
  const name = freeName(prefix, offset, used);
  if (!name) throw new Error(`no free title name for ${safe}`);
  return `${name}.svg`;
}

/** `_version_path`'s name: 'Day 1.svg' → 'Day 1 v2.svg', 'Day 1 v2.svg' → 'Day 1 v3.svg' (first free). */
export function versionName(current: string, taken: Iterable<string>): string | null {
  const stem = (String(current).split(/[\\/]/).pop() ?? "").replace(/\.[^.]*$/, "");
  const m = /^(.*?) v(\d+)$/.exec(stem);
  const [base, n] = m ? [m[1]!, Number(m[2])] : [stem, 1];
  const used = new Set([...taken].map((name) => name.toLowerCase()));
  for (let k = n + 1; k < n + 1000; k += 1) {
    const name = `${base} v${k}.svg`;
    if (!used.has(name.toLowerCase())) return name;
  }
  return null;
}
