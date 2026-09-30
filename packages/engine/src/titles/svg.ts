/**
 * Title SVG substitution: the desktop title editor's text, color and font
 * edits, and the agent's headless text replacement, as pure string → string
 * functions (no DOM, so the engine stays platform-free).
 *
 * Ported from zenvi-core src/windows/title_editor.py (`txtLine_changed`,
 * `set_font_attributes`, `set_font_color_elements`, `set_bg_style`),
 * src/classes/style_tools.py (`style_to_dict` / `dict_to_style`) and
 * src/classes/agent_tools/titles.py (`_set_svg_text`). Edits are made in
 * place, so everything else in the template stays byte for byte.
 */

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

function xmlUnescape(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const STYLE_ATTR = /(\sstyle\s*=\s*)("([^"]*)"|'([^']*)')/;

function tagStyle(tag: string): Map<string, string> {
  const m = STYLE_ATTR.exec(tag);
  return styleToDict(m ? xmlUnescape(m[3] ?? m[4] ?? "") : "");
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
  targets.forEach((span, i) => {
    if (covered(span)) return;
    setContent(span, i === 0 ? xmlEscapeText(text) : "");
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
