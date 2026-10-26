/**
 * `<text>` in an SVG redrawn as outlines in a bundled family: how SVG titles
 * and motion-template drawings opt in to a typeface every renderer draws
 * alike.
 *
 * Each `<text>` the resolver gives a family becomes a `<g>` (the text's
 * `transform`, `id` and `opacity`) with one `<path>` per run of text: its
 * fill, fill-opacity and stroke. A run is character data with the
 * computed style of its element (style="" over presentation attributes,
 * inherited from the ancestors): font-size, font-weight, font-style,
 * letter-spacing, fill, stroke. A `<tspan>` with x or y starts a new chunk
 * there (an Inkscape line); `text-anchor` (or Inkscape's `text-align`) of a
 * chunk's first run aligns it. Whitespace collapses unless
 * `xml:space="preserve"`. The original `<text>` stays in the file, hidden
 * (`display="none"`), so the words are still there to read and to edit;
 * `stripOutlines` turns the file back into its text before an edit.
 */

import { getAttr, parseXml, serializeXml, setAttr, type XmlElement, type XmlNode } from "../titles/xml.js";
import { parseStyle } from "../titles/title-svg.js";
import type { FontFamilyId } from "./families.js";
import type { FontLibrary } from "./library.js";
import { outlineCommands, setRun, type SetGlyph, type TypeStyle } from "./typeset.js";

/** Marks the `<g>` that draws an outlined `<text>`: its value is the family. */
export const OUTLINE_ATTR = "data-zenvi-outline";
/** Marks a `<text>` hidden because outlines draw it. */
export const OUTLINED_ATTR = "data-zenvi-outlined";

export interface OutlineChunk {
  /** The chunk's characters. */
  text: string;
  /** Its first run's font size (px), weight and tracking (em). */
  size: number;
  weight: number;
  tracking: number;
}

export interface OutlineOptions {
  /** The bundled family that draws text whose `font-family` is `css`, or null to leave it as text. */
  family(css: string): FontFamilyId | null;
  /**
   * Set every size so the family's cap height is this share of the
   * font-size (a layout measured for another face keeps its line heights).
   */
  capHeight?: number;
  /** Widest a chunk may be, px (wider chunks shrink about their anchor). */
  maxWidth?(chunk: OutlineChunk): number;
}

export interface OutlineResult {
  svg: string;
  /** `<text>` elements redrawn. */
  outlined: number;
  /** Characters no loaded face could draw. */
  missing: string[];
}

interface Computed {
  family: string;
  size: number;
  weight: number;
  italic: boolean;
  letterSpacing: number;
  anchor: "start" | "middle" | "end";
  fill: string;
  fillOpacity: string;
  stroke: string;
  strokeWidth: string;
  strokeOpacity: string;
  preserve: boolean;
}

const INHERITED: Computed = {
  family: "sans-serif",
  size: 16,
  weight: 400,
  italic: false,
  letterSpacing: 0,
  anchor: "start",
  fill: "#000000",
  fillOpacity: "",
  stroke: "",
  strokeWidth: "",
  strokeOpacity: "",
  preserve: false,
};

function prop(el: XmlElement, style: Map<string, string>, name: string): string | undefined {
  const v = style.get(name) ?? (el.attrs.some(([k]) => k === name) ? getAttr(el, name) : undefined);
  return v === undefined || v.trim() === "" || v.trim() === "inherit" ? undefined : v.trim();
}

const px = (value: string): number | undefined => {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return undefined;
  return /pt$/.test(value) ? (n * 4) / 3 : n;
};

function computed(el: XmlElement, parent: Computed): Computed {
  const style = parseStyle(getAttr(el, "style"));
  const out = { ...parent };
  const family = prop(el, style, "font-family");
  if (family) out.family = family;
  const size = prop(el, style, "font-size");
  if (size && px(size) !== undefined) out.size = px(size)!;
  const weight = prop(el, style, "font-weight");
  if (weight) out.weight = weight === "bold" || weight === "bolder" ? 700 : weight === "normal" || weight === "lighter" ? 400 : Number(weight) || out.weight;
  const fontStyle = prop(el, style, "font-style");
  if (fontStyle) out.italic = fontStyle === "italic" || fontStyle === "oblique";
  const spacing = prop(el, style, "letter-spacing");
  if (spacing) out.letterSpacing = spacing === "normal" ? 0 : (px(spacing) ?? 0);
  const anchor = prop(el, style, "text-anchor") ?? { center: "middle", end: "end", right: "end", start: "start", left: "start" }[prop(el, style, "text-align") ?? ""];
  if (anchor === "start" || anchor === "middle" || anchor === "end") out.anchor = anchor;
  for (const [key, name] of [
    ["fill", "fill"],
    ["fillOpacity", "fill-opacity"],
    ["stroke", "stroke"],
    ["strokeWidth", "stroke-width"],
    ["strokeOpacity", "stroke-opacity"],
  ] as const) {
    const v = prop(el, style, name);
    if (v) out[key] = v;
  }
  const space = getAttr(el, "xml:space");
  if (space) out.preserve = space === "preserve";
  return out;
}

/** The first family of a CSS list, unquoted. */
function firstFamily(css: string): string {
  return (css.split(",")[0] ?? "").trim().replace(/^['"]|['"]$/g, "");
}

interface Run {
  text: string;
  style: Computed;
}

interface Chunk {
  x: number;
  y: number;
  runs: Run[];
}

/** Chunks of a `<text>`: positions from x/y attributes (first value of a list), runs in document order. */
function chunksOf(text: XmlElement, base: Computed): Chunk[] {
  const coord = (el: XmlElement, name: string): number | undefined => {
    const v = getAttr(el, name).trim().split(/[\s,]+/)[0];
    return v ? px(v) : undefined;
  };
  const chunks: Chunk[] = [{ x: coord(text, "x") ?? 0, y: coord(text, "y") ?? 0, runs: [] }];
  const visit = (el: XmlElement, style: Computed): void => {
    for (const child of el.children) {
      if (child.kind === "text") {
        if (child.data) chunks[chunks.length - 1]!.runs.push({ text: child.data, style });
      } else if (child.kind === "element" && child.name === "tspan") {
        const own = computed(child, style);
        const x = coord(child, "x");
        const y = coord(child, "y");
        if (x !== undefined || y !== undefined) {
          const last = chunks[chunks.length - 1]!;
          chunks.push({ x: x ?? last.x, y: y ?? last.y, runs: [] });
        }
        visit(child, own);
      }
    }
  };
  visit(text, base);
  for (const chunk of chunks) {
    let lead = true;
    for (const run of chunk.runs) {
      if (run.style.preserve) {
        run.text = run.text.replace(/[\r\n\t]/g, " ");
        lead = false;
        continue;
      }
      run.text = run.text.replace(/\s+/g, " ");
      if (lead) run.text = run.text.replace(/^ /, "");
      if (run.text) lead = run.text.endsWith(" ");
    }
    const last = [...chunk.runs].reverse().find((r) => r.text);
    if (last && !last.style.preserve) last.text = last.text.replace(/ $/, "");
  }
  return chunks.filter((c) => c.runs.some((r) => r.text));
}

function fmt(value: number): string {
  const fixed = (Math.round(value * 100) / 100).toFixed(2);
  return fixed.replace(/\.?0+$/, "") || "0";
}

function pathData(glyphs: readonly SetGlyph[], dx: number, dy: number, scale: number, ox: number, oy: number): string {
  // Scale about (ox, oy), then move: a chunk that shrinks keeps its anchor.
  const parts = outlineCommands(glyphs, 0, 0);
  const out: string[] = [];
  let axis = 0;
  for (const p of parts) {
    if (typeof p === "string") {
      out.push(p);
      axis = 0;
    } else {
      out.push(fmt(axis % 2 === 0 ? ox + (p + dx - ox) * scale : oy + (p + dy - oy) * scale));
      axis += 1;
    }
  }
  return out.join(" ");
}

const element = (name: string, attrs: [string, string][], parent: XmlElement): XmlElement => ({ kind: "element", name, attrs, children: [], parent });

/** Redraw the `<text>` elements of `svg` whose family the options resolve as outlines. */
export function outlineSvgText(svg: string, lib: FontLibrary, options: OutlineOptions): OutlineResult {
  const doc = parseXml(svg);
  const missing = new Set<string>();
  let outlined = 0;
  const visit = (el: XmlElement, inherited: Computed): void => {
    if (el.name === "defs" || el.name === "clipPath" || el.name === "mask") return;
    const style = computed(el, inherited);
    for (const child of [...el.children]) {
      if (child.kind !== "element") continue;
      if (child.name !== "text") {
        visit(child, style);
        continue;
      }
      const own = computed(child, style);
      const family = options.family(firstFamily(own.family));
      if (!family || !lib.has(family) || getAttr(child, "display") === "none") continue;
      const group = element("g", [[OUTLINE_ATTR, family]], el);
      for (const name of ["transform", "opacity", "id"]) {
        const v = getAttr(child, name);
        if (v) group.attrs.push([name === "id" ? "id" : name, name === "id" ? `${v}-outline` : v]);
      }
      for (const chunk of chunksOf(child, own)) {
        const set = chunk.runs
          .filter((r) => r.text)
          .map((run) => {
            const size = options.capHeight ? sizeForCap(lib, family, run.style, options.capHeight) : run.style.size;
            const tracking = run.style.letterSpacing / run.style.size;
            const ts: TypeStyle = { family, size, weight: run.style.weight, italic: run.style.italic, tracking, kerning: true };
            const r = setRun(lib, run.text, ts);
            for (const m of r.missing) missing.add(m);
            return { run, ...r };
          });
        const width = set.reduce((sum, r) => sum + r.width, 0);
        const first = chunk.runs.find((r) => r.text)!.style;
        const cap = options.maxWidth?.({ text: set.map((s) => s.run.text).join(""), size: first.size, weight: first.weight, tracking: first.letterSpacing / first.size });
        const scale = cap !== undefined && width > cap && width > 0 ? cap / width : 1;
        const start = first.anchor === "middle" ? chunk.x - width / 2 : first.anchor === "end" ? chunk.x - width : chunk.x;
        let pen = start;
        for (const r of set) {
          if (r.glyphs.length > 0) {
            const attrs: [string, string][] = [["d", pathData(r.glyphs, pen, chunk.y, scale, chunk.x, chunk.y)]];
            const s = r.run.style;
            attrs.push(["fill", s.fill]);
            if (s.fillOpacity) attrs.push(["fill-opacity", s.fillOpacity]);
            if (s.stroke && s.stroke !== "none") {
              attrs.push(["stroke", s.stroke]);
              if (s.strokeWidth) attrs.push(["stroke-width", s.strokeWidth]);
              if (s.strokeOpacity) attrs.push(["stroke-opacity", s.strokeOpacity]);
            }
            group.children.push(element("path", attrs, group));
          }
          pen += r.width;
        }
      }
      setAttr(child, "display", "none");
      setAttr(child, OUTLINED_ATTR, "1");
      el.children.splice(el.children.indexOf(child as XmlNode) + 1, 0, group);
      outlined += 1;
    }
  };
  visit(doc.root, INHERITED);
  return { svg: outlined > 0 ? serializeXml(doc) : svg, outlined, missing: [...missing] };
}

/** The size at which `family`'s cap height is `share` of the run's font size. */
function sizeForCap(lib: FontLibrary, family: FontFamilyId, style: Computed, share: number): number {
  const face = lib.face(family, { weight: style.weight, italic: style.italic, opticalSize: style.size });
  return (style.size * share * face.unitsPerEm) / face.capHeight;
}

/** `svg` without its outlines: the outline groups removed, the texts they drew shown again. */
export function stripOutlines(svg: string): string {
  if (!svg.includes(OUTLINE_ATTR)) return svg;
  const doc = parseXml(svg);
  const visit = (el: XmlElement): void => {
    el.children = el.children.filter((child) => !(child.kind === "element" && child.name === "g" && child.attrs.some(([k]) => k === OUTLINE_ATTR)));
    for (const child of el.children) {
      if (child.kind !== "element") continue;
      if (child.name === "text" && child.attrs.some(([k]) => k === OUTLINED_ATTR)) child.attrs = child.attrs.filter(([k]) => k !== OUTLINED_ATTR && k !== "display");
      visit(child);
    }
  };
  visit(doc.root);
  return serializeXml(doc);
}

/** The bundled families an SVG's text names (first family of each font-family). */
export function svgBundledFamilies(svg: string, resolve: (css: string) => FontFamilyId | null): FontFamilyId[] {
  const out = new Set<FontFamilyId>();
  for (const m of svg.matchAll(/font-family\s*[:=]\s*"?([^;"]+)/g)) {
    const family = resolve(firstFamily(m[1]!.replace(/&quot;|&apos;/g, "'")));
    if (family) out.add(family);
  }
  return [...out];
}
