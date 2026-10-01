/**
 * Title SVG substitution: the desktop title editor's text, color and font
 * edits, and the agent's headless text replacement, as pure string → string
 * functions (no DOM, so the engine stays platform-free).
 *
 * Ported from zenvi-core src/windows/title_editor.py (`txtLine_changed`,
 * `set_font_attributes`, `set_font_color_elements`, `set_bg_style`, and the
 * readers `detect_font`, `get_font`, `update_font_color_button`,
 * `get_ref_color`, `update_background_color_button`, `best_contrast`),
 * src/classes/style_tools.py (`style_to_dict` / `dict_to_style`) and
 * src/classes/agent_tools/titles.py (`_set_svg_text`). Edits are made in
 * place, so everything else in the template stays byte for byte.
 */

import { qcolorName, qcolorRgbF } from "../model/qcolor.js";

export interface TitleFields {
  /**
   * New text for the `<tspan>` elements: `lines[i]` replaces the text of the
   * i-th `<tspan>` in document order, counting every tspan as the desktop
   * title editor does; tspans without content are skipped. Lines not given
   * keep the template text.
   */
  lines?: readonly string[];
  /** Text fill for every `<text>` and `<tspan>` (`#rrggbb`). */
  textColor?: string;
  /** Text opacity 0..1 (default 1 when `textColor` is given). */
  textOpacity?: number;
  /** Fill of the first `<rect>` (the template background). */
  backgroundColor?: string;
  /** Background opacity 0..1 (default 1 when `backgroundColor` is given). */
  backgroundOpacity?: number;
  /** Font family for every `<text>` and `<tspan>`. */
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  /** Multiply every existing font-size by this ratio. */
  fontSizeRatio?: number;
}

// ---------------------------------------------------------------------------
// A tiny XML scanner: element spans in document order.
// ---------------------------------------------------------------------------

interface ElementSpan {
  name: string;
  /** Offset of `<`. */
  start: number;
  /** Offset just past the start tag's `>`. */
  openEnd: number;
  /** Offset of the end tag `</…>` (= openEnd for self-closing elements). */
  closeStart: number;
  /** Offset just past the element. */
  end: number;
  selfClosing: boolean;
  parent: ElementSpan | null;
  children: ElementSpan[];
}

function findTagEnd(xml: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < xml.length; i += 1) {
    const ch = xml[i]!;
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  throw new Error("Malformed SVG: unterminated tag.");
}

function scan(xml: string): ElementSpan[] {
  const all: ElementSpan[] = [];
  const stack: ElementSpan[] = [];
  let i = 0;
  while ((i = xml.indexOf("<", i)) >= 0) {
    if (xml.startsWith("<!--", i)) {
      const close = xml.indexOf("-->", i + 4);
      if (close < 0) throw new Error("Malformed SVG: unterminated comment.");
      i = close + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", i)) {
      const close = xml.indexOf("]]>", i + 9);
      if (close < 0) throw new Error("Malformed SVG: unterminated CDATA.");
      i = close + 3;
      continue;
    }
    if (xml.startsWith("<?", i) || xml.startsWith("<!", i)) {
      i = findTagEnd(xml, i + 2) + 1;
      continue;
    }
    const tagEnd = findTagEnd(xml, i + 1);
    if (xml[i + 1] === "/") {
      const name = xml.slice(i + 2, tagEnd).trim();
      while (stack.length > 0) {
        const open = stack.pop()!;
        open.closeStart = i;
        open.end = tagEnd + 1;
        if (open.name === name) break;
      }
      i = tagEnd + 1;
      continue;
    }
    const nameMatch = /^[^\s/>]+/.exec(xml.slice(i + 1, tagEnd));
    const name = nameMatch ? nameMatch[0] : "";
    const selfClosing = xml[tagEnd - 1] === "/";
    const parent = stack[stack.length - 1] ?? null;
    const span: ElementSpan = {
      name,
      start: i,
      openEnd: tagEnd + 1,
      closeStart: tagEnd + 1,
      end: tagEnd + 1,
      selfClosing,
      parent,
      children: [],
    };
    parent?.children.push(span);
    all.push(span);
    if (!selfClosing) stack.push(span);
    i = tagEnd + 1;
  }
  return all;
}

function byName(spans: readonly ElementSpan[], name: string): ElementSpan[] {
  return spans.filter((s) => s.name === name);
}

// ---------------------------------------------------------------------------
// Styles (style_tools.py)
// ---------------------------------------------------------------------------

/** `style_to_dict`: split on ';', then on the first ':' (order kept). */
export function styleToDict(style: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of style.split(";")) {
    if (!part) continue;
    const at = part.indexOf(":");
    if (at < 0) continue;
    out.set(part.slice(0, at), part.slice(at + 1));
  }
  return out;
}

/** `dict_to_style`: `k:v` joined by ';' plus a trailing ';'. */
export function dictToStyle(style: Map<string, string>): string {
  return [...style.entries()].map(([k, v]) => `${k}:${v}`).join(";") + ";";
}

/** Python `str(float)`: integral values keep one decimal ("1.0"). */
function pyFloat(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

function xmlEscapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function xmlEscapeAttr(text: string): string {
  return xmlEscapeText(text).replace(/"/g, "&quot;");
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Decode the predefined entities and character references (other entity references stay as written). */
function xmlUnescape(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (whole, ref: string) => {
    if (!ref.startsWith("#")) return NAMED_ENTITIES[ref]!;
    const code = ref[1] === "x" || ref[1] === "X" ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/**
 * An attribute value as the XML parser hands it to minidom: line ends
 * normalized, literal tabs and newlines turned into spaces, then references
 * decoded (XML 1.0 §3.3.3; a `&#10;` reference stays a newline).
 */
function attributeValue(raw: string): string {
  return xmlUnescape(raw.replace(/\r\n?/g, "\n").replace(/[\t\n]/g, " "));
}

const STYLE_ATTR = /(\sstyle\s*=\s*)("([^"]*)"|'([^']*)')/;

function tagStyle(tag: string): Map<string, string> {
  const m = STYLE_ATTR.exec(tag);
  return styleToDict(m ? attributeValue(m[3] ?? m[4] ?? "") : "");
}

/** Every attribute of a start tag (`getAttribute` values), by qualified name. */
function tagAttributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  const nameEnd = /^<[^\s/>]*/.exec(tag)![0].length;
  const attr = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  attr.lastIndex = nameEnd;
  for (let m = attr.exec(tag); m; m = attr.exec(tag)) {
    if (!out.has(m[1]!)) out.set(m[1]!, attributeValue(m[3] ?? m[4] ?? ""));
  }
  return out;
}

/** Rewrite a start tag with a new style attribute (added before the tag close when missing). */
function withTagStyle(tag: string, style: Map<string, string>): string {
  const value = `"${xmlEscapeAttr(dictToStyle(style))}"`;
  if (STYLE_ATTR.test(tag)) return tag.replace(STYLE_ATTR, (_m, prefix: string) => `${prefix}${value}`);
  const close = tag.endsWith("/>") ? tag.length - 2 : tag.length - 1;
  return `${tag.slice(0, close)} style=${value}${tag.slice(close)}`;
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

interface Edit {
  from: number;
  to: number;
  text: string;
}

function apply(xml: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.from - a.from);
  let out = xml;
  let limit = Infinity;
  for (const edit of sorted) {
    if (edit.to > limit) throw new Error("Overlapping SVG edits.");
    out = out.slice(0, edit.from) + edit.text + out.slice(edit.to);
    limit = edit.from;
  }
  return out;
}

/** Content (between the tags) of an element that has children. */
function hasContent(xml: string, span: ElementSpan): boolean {
  return !span.selfClosing && span.closeStart > span.openEnd && xml.slice(span.openEnd, span.closeStart).length > 0;
}

/**
 * The desktop's text replacement for one tspan (`txtLine_changed`): remove
 * the first child node and append the new text node.
 */
function replaceFirstChild(xml: string, span: ElementSpan, text: string): Edit[] {
  const content = xml.slice(span.openEnd, span.closeStart);
  const firstChild = span.children[0];
  const textBeforeChild = firstChild ? firstChild.start - span.openEnd : content.length;
  const escaped = xmlEscapeText(text);
  if (textBeforeChild > 0) {
    // First child is a text node: drop it, append the new text at the end.
    if (!firstChild) return [{ from: span.openEnd, to: span.closeStart, text: escaped }];
    return [
      { from: span.openEnd, to: firstChild.start, text: "" },
      { from: span.closeStart, to: span.closeStart, text: escaped },
    ];
  }
  // First child is an element.
  return [
    { from: firstChild!.start, to: firstChild!.end, text: "" },
    { from: span.closeStart, to: span.closeStart, text: escaped },
  ];
}

function markRemoved(span: ElementSpan, removed: Set<ElementSpan>): void {
  removed.add(span);
  for (const child of span.children) markRemoved(child, removed);
}

function styleEdit(xml: string, span: ElementSpan, update: (style: Map<string, string>) => void): Edit {
  const tag = xml.slice(span.start, span.openEnd);
  const style = tagStyle(tag);
  update(style);
  return { from: span.start, to: span.openEnd, text: withTagStyle(tag, style) };
}

function requireOpacity(value: number | undefined, what: string): number {
  const v = value ?? 1;
  if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error(`${what} must be between 0 and 1.`);
  return v;
}

/**
 * Apply `fields` to an SVG title template and return the new SVG text, like
 * saving from the desktop title editor. Throws on malformed SVG or invalid
 * values.
 */
export function buildTitleSvg(template: string, fields: TitleFields): string {
  const spans = scan(template);
  const tspans = byName(spans, "tspan");
  const texts = byName(spans, "text");
  const rect = byName(spans, "rect")[0];
  const edits: Edit[] = [];

  // Start-tag style edits per element (merged so each tag is rewritten once).
  const styleUpdates = new Map<ElementSpan, ((s: Map<string, string>) => void)[]>();
  const addStyle = (span: ElementSpan, fn: (s: Map<string, string>) => void): void => {
    const list = styleUpdates.get(span) ?? [];
    list.push(fn);
    styleUpdates.set(span, list);
  };

  const textNodes = [...texts, ...tspans];
  if (fields.fontFamily !== undefined || fields.bold !== undefined || fields.italic !== undefined || fields.fontSizeRatio !== undefined) {
    const ratio = fields.fontSizeRatio ?? 1;
    if (!Number.isFinite(ratio) || ratio <= 0) throw new Error("fontSizeRatio must be > 0.");
    for (const node of textNodes) {
      addStyle(node, (style) => {
        if (fields.fontFamily !== undefined) style.set("font-family", `'${fields.fontFamily}'`);
        if (fields.italic !== undefined) style.set("font-style", fields.italic ? "italic" : "normal");
        if (fields.bold !== undefined) style.set("font-weight", fields.bold ? "bold" : "normal");
        if (ratio !== 1 && style.has("font-size")) {
          const size = Number.parseFloat(style.get("font-size")!.slice(0, -2));
          if (Number.isFinite(size)) style.set("font-size", `${pyFloat(ratio * size)}px`);
        }
      });
    }
  }
  if (fields.textColor !== undefined) {
    const opacity = requireOpacity(fields.textOpacity, "textOpacity");
    for (const node of textNodes) {
      addStyle(node, (style) => {
        style.set("fill", fields.textColor!);
        style.set("opacity", pyFloat(opacity));
      });
    }
  }
  if (fields.backgroundColor !== undefined && rect) {
    const opacity = requireOpacity(fields.backgroundOpacity, "backgroundOpacity");
    addStyle(rect, (style) => {
      style.set("fill", fields.backgroundColor!);
      style.set("opacity", pyFloat(opacity));
    });
  }
  // Line edits first: they may remove a child element, whose own style edit is then dropped.
  const removed = new Set<ElementSpan>();
  if (fields.lines) {
    fields.lines.forEach((line, i) => {
      const span = tspans[i];
      if (!span || !hasContent(template, span) || removed.has(span)) return;
      const first = span.children[0];
      const textFirst = first ? first.start > span.openEnd : true;
      if (!textFirst) markRemoved(first!, removed);
      edits.push(...replaceFirstChild(template, span, String(line)));
    });
  }
  for (const [span, fns] of styleUpdates) {
    if (removed.has(span)) continue;
    edits.push(styleEdit(template, span, (s) => fns.forEach((fn) => fn(s))));
  }
  return apply(template, edits);
}

/**
 * The agent's headless text replacement (agent_tools/titles.py
 * `_set_svg_text`): the first `<tspan>` (or `<text>` when there are no
 * tspans) gets `text` as its only content; every other one is emptied so
 * template placeholders disappear.
 *
 * Divergence from the desktop: every target whose placeholder text equals the
 * first target's also gets `text`. Reflection templates (Bar_1, the default)
 * draw the title twice — a mirrored copy (`scale(1,-1)`) first, then the real
 * line — and the desktop's first-only rule writes the text into the
 * reflection and blanks the real line, so the title comes out upside down.
 */
export function setSvgText(template: string, text: string): string {
  const spans = scan(template);
  const tspans = byName(spans, "tspan");
  const targets = tspans.length > 0 ? tspans : byName(spans, "text");
  if (targets.length === 0) return template;
  const edits: Edit[] = [];
  const setContent = (span: ElementSpan, content: string): void => {
    if (span.selfClosing) {
      const tag = template.slice(span.start, span.openEnd);
      edits.push({ from: span.start, to: span.end, text: `${tag.slice(0, -2).trimEnd()}>${content}</${span.name}>` });
    } else {
      edits.push({ from: span.openEnd, to: span.closeStart, text: content });
    }
  };
  // Nested targets (a tspan inside another tspan) are covered by their parent's edit.
  const covered = (span: ElementSpan): boolean => {
    for (let p = span.parent; p; p = p.parent) if (targets.includes(p)) return true;
    return false;
  };
  const placeholder = (span: ElementSpan): string =>
    span.selfClosing ? "" : xmlUnescape(template.slice(span.openEnd, span.closeStart).replace(/<[^>]*>/g, "")).trim();
  const first = placeholder(targets[0]!);
  targets.forEach((span, i) => {
    if (covered(span)) return;
    const same = i === 0 || (first !== "" && placeholder(span) === first);
    setContent(span, same ? xmlEscapeText(text) : "");
  });
  return apply(template, edits);
}

export interface TitleSvgNode {
  tag: "text" | "tspan";
  /** Text content (entities decoded, nested elements included). */
  text: string;
  /** Parsed `style` attribute. */
  style: Record<string, string>;
}

/** Every `<text>` then every `<tspan>` (document order) and the first `<rect>`'s style. */
export function inspectTitleSvg(svg: string): { nodes: TitleSvgNode[]; rect: Record<string, string> | null } {
  const spans = scan(svg);
  const textOf = (span: ElementSpan): string =>
    span.selfClosing ? "" : xmlUnescape(svg.slice(span.openEnd, span.closeStart).replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, ""));
  const nodes: TitleSvgNode[] = [];
  for (const tag of ["text", "tspan"] as const) {
    for (const span of byName(spans, tag)) {
      nodes.push({ tag, text: textOf(span), style: Object.fromEntries(tagStyle(svg.slice(span.start, span.openEnd))) });
    }
  }
  const rect = byName(spans, "rect")[0];
  return { nodes, rect: rect ? Object.fromEntries(tagStyle(svg.slice(rect.start, rect.openEnd))) : null };
}

/** Text of every `<tspan>` with content, in order (the editor's "Line N" fields). */
export function titleLines(template: string): string[] {
  const spans = scan(template);
  return byName(spans, "tspan")
    .filter((span) => hasContent(template, span))
    .map((span) => xmlUnescape(template.slice(span.openEnd, span.closeStart).replace(/<[^>]*>/g, "")));
}

// ---------------------------------------------------------------------------
// Readers: what the title editor shows for a template
// ---------------------------------------------------------------------------

/** A color as the title editor's color buttons hold it. */
export interface TitleColor {
  /** `QColor(fill).name()`: lowercase `#rrggbb`; `#000000` when Qt cannot parse the fill. */
  color: string;
  /** The `opacity` style value clamped to 0..1 like `QColor.setAlphaF` (NaN → 0). */
  opacity: number;
}

function spanStyle(xml: string, span: ElementSpan): Map<string, string> {
  return tagStyle(xml.slice(span.start, span.openEnd));
}

/**
 * Python `float(text)`: surrounding whitespace, `_` digit separators,
 * `inf` / `nan`. Undefined where Python raises ValueError.
 */
function parsePyFloat(text: string): number | undefined {
  const t = text.trim();
  if (/^[+-]?(inf|infinity)$/i.test(t)) return t.startsWith("-") ? -Infinity : Infinity;
  if (/^[+-]?nan$/i.test(t)) return Number.NaN;
  if (!/^[+-]?(?:(?:\d(?:_?\d)*)?\.\d(?:_?\d)*|\d(?:_?\d)*\.?)(?:[eE][+-]?\d(?:_?\d)*)?$/.test(t)) return undefined;
  return Number(t.replace(/_/g, ""));
}

/**
 * `float(ard.get("opacity", 1.0))` then `QColor.setAlphaF`. One deliberate
 * difference: an unparseable value reads as 1 (the desktop raises ValueError
 * and the editor fails to open the template).
 */
function styleOpacity(style: Map<string, string>): number {
  const raw = style.get("opacity");
  const value = raw === undefined ? 1 : parsePyFloat(raw) ?? 1;
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * `get_ref_color`: the first `stop-color` (from a `style` attribute) of the
 * `<defs>` child with this id, following `xlink:href` / `href` references.
 * "" when there is none. A reference cycle also reads as "" (the desktop
 * recurses until Python's recursion limit).
 */
function refColor(xml: string, defs: ElementSpan, id: string, seen: Set<string>): string {
  if (seen.has(id)) return "";
  seen.add(id);
  for (const node of defs.children) {
    const attrs = tagAttributes(xml.slice(node.start, node.openEnd));
    if (attrs.get("id") !== id) continue;
    const href = attrs.get("xlink:href") ?? attrs.get("href");
    if (href !== undefined) return refColor(xml, defs, href.slice(1), seen);
    for (const stop of node.children) {
      if (stop.name !== "stop") continue;
      const stopColor = spanStyle(xml, stop).get("stop-color");
      if (stopColor !== undefined) return stopColor;
    }
  }
  return "";
}

/**
 * The text color the title editor's font-color button shows
 * (`update_font_color_button`): the `fill` and `opacity` of the last
 * `<tspan>` (else the last `<text>`); `fill` defaults to white and
 * `url(#id)` resolves through the gradient's first stop when the SVG has
 * exactly one `<defs>`. White, opaque when the SVG has no text (the editor's
 * initial color).
 */
export function readTitleTextColor(svg: string): TitleColor {
  const spans = scan(svg);
  const defs = byName(spans, "defs");
  let result: TitleColor = { color: "#ffffff", opacity: 1 };
  for (const node of [...byName(spans, "text"), ...byName(spans, "tspan")]) {
    const style = spanStyle(svg, node);
    let fill = style.get("fill") ?? "#FFF";
    if (fill.startsWith("url(#") && defs.length === 1) {
      const ref = refColor(svg, defs[0]!, fill.slice(5, -1), new Set());
      if (ref) fill = ref;
    }
    result = { color: qcolorName(fill), opacity: styleOpacity(style) };
  }
  return result;
}

/**
 * The background color the title editor's background button shows
 * (`update_background_color_button`): the first `<rect>`'s `fill` (default
 * black) and `opacity`. Null when the SVG has no `<rect>` (the desktop keeps
 * its initial opaque black, and background edits do nothing).
 */
export function readTitleBackgroundColor(svg: string): TitleColor | null {
  const rect = byName(scan(svg), "rect")[0];
  if (!rect) return null;
  const style = spanStyle(svg, rect);
  return { color: qcolorName(style.get("fill") ?? "#000"), opacity: styleOpacity(style) };
}

/**
 * `best_contrast`: white or black text for a color swatch, by perceived
 * luminance (white below 0.5). An unparseable color gets white.
 */
export function bestContrastColor(color: string): "#ffffff" | "#000000" {
  const rgb = qcolorRgbF(color);
  if (!rgb) return "#ffffff";
  const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return lum < 0.5 ? "#ffffff" : "#000000";
}

/** The title editor's font when a template names none (`default_font_family`). */
export const DEFAULT_TITLE_FONT_FAMILY = "DejaVu Sans";

/** Families `get_font` falls back to, in order, when the requested one is not installed. */
export const TITLE_FALLBACK_FONT_FAMILIES: readonly string[] = [
  "DejaVu Sans",
  "Liberation Sans",
  "Noto Sans",
  "FreeSans",
  "Ubuntu",
  "Cantarell",
  "Open Sans",
  "Sans-serif",
  "Arial",
];

/** The font settings the title editor reads from a template. */
export interface TitleFont {
  /** `font-family` with surrounding quotes removed. */
  family: string;
  italic: boolean;
  bold: boolean;
  /** From a `px` font-size (truncated to an integer; absent when not > 0). */
  pixelSize?: number;
  /** From a `pt` font-size (absent when not > 0). */
  pointSize?: number;
}

/**
 * `detect_font`: the font of the first `<tspan>` whose style names a
 * family; italic only for `font-style:italic`, bold only for
 * `font-weight:bold`; sizes only in `px` or `pt`. Null when no tspan names
 * a family (the editor then uses `DEFAULT_TITLE_FONT_FAMILY`).
 *
 * The desktop also requires `QFont(get_font(family)).exactMatch()`; since
 * `get_font` falls back to common installed families, that holds on any
 * system with one of them, so it is left to the host: map `family` to an
 * available one with `pickFontFamily`.
 */
export function detectTitleFont(svg: string): TitleFont | null {
  for (const node of byName(scan(svg), "tspan")) {
    const style = spanStyle(svg, node);
    if (style.size === 0) continue;
    const family = (style.get("font-family") ?? "").replace(/^['"]+|['"]+$/g, "");
    if (!family) continue;
    const font: TitleFont = {
      family,
      italic: style.get("font-style") === "italic",
      bold: style.get("font-weight") === "bold",
    };
    const size = style.get("font-size");
    if (size?.endsWith("px")) {
      const value = parsePyFloat(size.slice(0, -2));
      const pixels = value !== undefined && Number.isFinite(value) ? Math.trunc(value) : 0;
      if (pixels > 0) font.pixelSize = pixels;
    } else if (size?.endsWith("pt")) {
      const value = parsePyFloat(size.slice(0, -2));
      if (value !== undefined && value > 0 && Number.isFinite(value)) font.pointSize = value;
    }
    return font;
  }
  return null;
}

/**
 * `get_font`: the first available family containing `requested`, else the
 * first containing a fallback family (in `TITLE_FALLBACK_FONT_FAMILIES`
 * order). Undefined when nothing matches (the desktop uses Qt's default font).
 */
export function pickFontFamily(requested: string, available: readonly string[]): string | undefined {
  for (const name of [requested, ...TITLE_FALLBACK_FONT_FAMILIES]) {
    const match = available.find((family) => family.includes(name));
    if (match !== undefined) return match;
  }
  return undefined;
}
