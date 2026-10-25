/**
 * A small XML document model for title SVGs: what zenvi-core's title rules
 * (src/classes/title_svg.py) do with `xml.dom.minidom`, in pure TypeScript.
 * Elements keep their attributes in order; text, CDATA, comments and
 * processing instructions survive a round trip; the prolog and anything after
 * the root element are kept verbatim. Serializing writes the same document
 * minidom's `toxml()` would read back (attribute values and text escaped,
 * empty elements self-closed); it is not byte-identical to the input.
 */

export interface XmlElement {
  kind: "element";
  name: string;
  /** Attributes in document order, values decoded. */
  attrs: [string, string][];
  children: XmlNode[];
  parent: XmlElement | null;
}

export interface XmlText {
  kind: "text";
  /** Decoded character data. */
  data: string;
  /** Written back as `<![CDATA[…]]>` (minidom's CDATA_SECTION_NODE: not a text node for the title rules). */
  cdata: boolean;
  parent: XmlElement | null;
}

/** A comment or processing instruction, kept as written. */
export interface XmlOther {
  kind: "other";
  raw: string;
  parent: XmlElement | null;
}

export type XmlNode = XmlElement | XmlText | XmlOther;

export interface XmlDocument {
  /** Everything before the root element (declaration, comments, doctype), verbatim. */
  prolog: string;
  root: XmlElement;
  /** Everything after the root element, verbatim. */
  epilog: string;
}

const NAMED: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Decode the predefined entities and character references; other references stay as written. */
function decode(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (whole, ref: string) => {
    if (!ref.startsWith("#")) return NAMED[ref]!;
    const code = ref[1] === "x" || ref[1] === "X" ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/** An attribute value as an XML parser reports it: line ends normalized, tabs and newlines as spaces, then references decoded. */
function attributeValue(raw: string): string {
  return decode(raw.replace(/\r\n?/g, "\n").replace(/[\t\n]/g, " "));
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, "&quot;").replace(/\n/g, "&#10;").replace(/\r/g, "&#13;").replace(/\t/g, "&#9;");
}

function tagEnd(xml: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < xml.length; i += 1) {
    const ch = xml[i]!;
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ">") return i;
  }
  throw new Error("Malformed SVG: unterminated tag.");
}

function parseAttrs(tag: string): [string, string][] {
  const out: [string, string][] = [];
  const re = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (let m = re.exec(tag); m; m = re.exec(tag)) out.push([m[1]!, attributeValue(m[2] ?? m[3] ?? "")]);
  return out;
}

/** Parse an SVG/XML document. Throws on malformed markup. */
export function parseXml(xml: string): XmlDocument {
  let root: XmlElement | null = null;
  let rootStart = -1;
  let rootEnd = -1;
  const stack: XmlElement[] = [];
  const append = (node: XmlNode): void => {
    const parent = stack[stack.length - 1];
    if (!parent) return;
    node.parent = parent;
    parent.children.push(node);
  };
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    const textEnd = lt < 0 ? xml.length : lt;
    if (textEnd > i && stack.length > 0) append({ kind: "text", data: decode(xml.slice(i, textEnd)), cdata: false, parent: null });
    if (lt < 0) break;
    if (xml.startsWith("<!--", lt)) {
      const close = xml.indexOf("-->", lt + 4);
      if (close < 0) throw new Error("Malformed SVG: unterminated comment.");
      if (stack.length > 0) append({ kind: "other", raw: xml.slice(lt, close + 3), parent: null });
      i = close + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const close = xml.indexOf("]]>", lt + 9);
      if (close < 0) throw new Error("Malformed SVG: unterminated CDATA.");
      if (stack.length > 0) append({ kind: "text", data: xml.slice(lt + 9, close), cdata: true, parent: null });
      i = close + 3;
      continue;
    }
    if (xml.startsWith("<?", lt)) {
      const close = xml.indexOf("?>", lt + 2);
      if (close < 0) throw new Error("Malformed SVG: unterminated processing instruction.");
      if (stack.length > 0) append({ kind: "other", raw: xml.slice(lt, close + 2), parent: null });
      i = close + 2;
      continue;
    }
    if (xml.startsWith("<!", lt)) {
      // DOCTYPE (with an internal subset in brackets) in the prolog.
      let j = lt + 2;
      let depth = 0;
      for (; j < xml.length; j += 1) {
        if (xml[j] === "[") depth += 1;
        else if (xml[j] === "]") depth -= 1;
        else if (xml[j] === ">" && depth <= 0) break;
      }
      i = j + 1;
      continue;
    }
    const end = tagEnd(xml, lt + 1);
    if (xml[lt + 1] === "/") {
      const name = xml.slice(lt + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name) throw new Error(`Malformed SVG: </${name}> does not close <${open?.name ?? ""}>.`);
      if (stack.length === 0) rootEnd = end + 1;
      i = end + 1;
      continue;
    }
    const tag = xml.slice(lt, end + 1);
    const name = /^<([^\s/>]+)/.exec(tag)?.[1] ?? "";
    const selfClosing = xml[end - 1] === "/";
    const element: XmlElement = { kind: "element", name, attrs: parseAttrs(tag.slice(name.length + 1, selfClosing ? -2 : -1)), children: [], parent: null };
    if (stack.length === 0) {
      if (root) throw new Error("Malformed SVG: more than one root element.");
      root = element;
      rootStart = lt;
      if (selfClosing) rootEnd = end + 1;
    } else append(element);
    if (!selfClosing) stack.push(element);
    i = end + 1;
  }
  if (stack.length > 0) throw new Error(`Malformed SVG: <${stack[stack.length - 1]!.name}> is not closed.`);
  if (!root) throw new Error("Malformed SVG: no root element.");
  return { prolog: xml.slice(0, rootStart), root, epilog: xml.slice(rootEnd) };
}

function serializeNode(node: XmlNode, out: string[]): void {
  if (node.kind === "text") {
    out.push(node.cdata ? `<![CDATA[${node.data}]]>` : escapeText(node.data));
    return;
  }
  if (node.kind === "other") {
    out.push(node.raw);
    return;
  }
  out.push(`<${node.name}`);
  for (const [key, value] of node.attrs) out.push(` ${key}="${escapeAttr(value)}"`);
  if (node.children.length === 0) {
    out.push("/>");
    return;
  }
  out.push(">");
  for (const child of node.children) serializeNode(child, out);
  out.push(`</${node.name}>`);
}

/** The document as text (prolog and epilog as they were). */
export function serializeXml(doc: XmlDocument): string {
  const out: string[] = [doc.prolog];
  serializeNode(doc.root, out);
  out.push(doc.epilog);
  return out.join("");
}

/** minidom `getAttribute`: "" when missing. */
export function getAttr(el: XmlElement, name: string): string {
  return el.attrs.find(([key]) => key === name)?.[1] ?? "";
}

export function hasAttr(el: XmlElement, name: string): boolean {
  return el.attrs.some(([key]) => key === name);
}

/** Set an attribute, in place when present, else appended. */
export function setAttr(el: XmlElement, name: string, value: string): void {
  const at = el.attrs.findIndex(([key]) => key === name);
  if (at >= 0) el.attrs[at] = [name, value];
  else el.attrs.push([name, value]);
}

/** minidom `getElementsByTagName`: descendants named `name`, in document order. */
export function elementsByTagName(from: XmlDocument | XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const visit = (el: XmlElement): void => {
    for (const child of el.children) {
      if (child.kind !== "element") continue;
      if (child.name === name) out.push(child);
      visit(child);
    }
  };
  if ("root" in from) {
    if (from.root.name === name) out.push(from.root);
    visit(from.root);
  } else visit(from);
  return out;
}
