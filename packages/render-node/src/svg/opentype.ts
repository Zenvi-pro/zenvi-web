/**
 * The font metrics text layout needs, read straight from OpenType tables:
 * head (unitsPerEm), hhea (ascender, descender, lineGap), hmtx (advances),
 * cmap formats 4/12 (character → glyph), kern format 0 (pair kerning) and,
 * for TrueType outlines, glyf/loca glyph boxes. CFF fonts have no glyph boxes
 * here; callers measure their ink by rasterizing.
 */

export interface GlyphBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface OpenTypeFont {
  /** Family names as written in the font (nameID 16, then 1). */
  families: string[];
  unitsPerEm: number;
  ascender: number;
  /** Negative below the baseline (hhea convention). */
  descender: number;
  lineGap: number;
  glyphIndex(codePoint: number): number;
  advanceWidth(glyph: number): number;
  kerning(left: number, right: number): number;
  /** TrueType glyph box in font units, or undefined (CFF, empty glyph). */
  glyphBox(glyph: number): GlyphBox | undefined;
  hasGlyphBoxes: boolean;
}

interface Tables {
  [tag: string]: { offset: number; length: number };
}

function tableDirectory(view: DataView, faceOffset: number): Tables {
  const numTables = view.getUint16(faceOffset + 4);
  const tables: Tables = {};
  for (let i = 0; i < numTables; i += 1) {
    const rec = faceOffset + 12 + i * 16;
    const tag = String.fromCharCode(view.getUint8(rec), view.getUint8(rec + 1), view.getUint8(rec + 2), view.getUint8(rec + 3));
    tables[tag] = { offset: view.getUint32(rec + 8), length: view.getUint32(rec + 12) };
  }
  return tables;
}

/** Offsets of each face (1 for plain fonts, n for .ttc collections). */
export function faceOffsets(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (tag !== "ttcf") return [0];
  const n = view.getUint32(8);
  return Array.from({ length: n }, (_, i) => view.getUint32(12 + i * 4));
}

function names(view: DataView, t: Tables): string[] {
  const name = t.name;
  if (!name) return [];
  const count = view.getUint16(name.offset + 2);
  const strings = name.offset + view.getUint16(name.offset + 4);
  const out = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    const rec = name.offset + 6 + i * 12;
    const platform = view.getUint16(rec);
    const id = view.getUint16(rec + 6);
    if (id !== 1 && id !== 16) continue;
    const len = view.getUint16(rec + 8);
    const off = strings + view.getUint16(rec + 10);
    let s = "";
    if (platform === 0 || platform === 3) for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(view.getUint16(off + j));
    else for (let j = 0; j < len; j += 1) s += String.fromCharCode(view.getUint8(off + j));
    if (s.trim()) out.add(s.trim());
  }
  return [...out];
}

function cmapLookup(view: DataView, t: Tables): (cp: number) => number {
  const cmap = t.cmap;
  if (!cmap) return () => 0;
  const n = view.getUint16(cmap.offset + 2);
  let best: { format: number; offset: number; score: number } | undefined;
  for (let i = 0; i < n; i += 1) {
    const rec = cmap.offset + 4 + i * 8;
    const platform = view.getUint16(rec);
    const encoding = view.getUint16(rec + 2);
    const offset = cmap.offset + view.getUint32(rec + 4);
    const format = view.getUint16(offset);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode || (format !== 4 && format !== 12)) continue;
    const score = format === 12 ? 2 : 1;
    if (!best || score > best.score) best = { format, offset, score };
  }
  if (!best) return () => 0;
  const { format, offset } = best;
  if (format === 12) {
    const groups = view.getUint32(offset + 12);
    return (cp) => {
      let lo = 0;
      let hi = groups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const g = offset + 16 + mid * 12;
        const start = view.getUint32(g);
        const end = view.getUint32(g + 4);
        if (cp < start) hi = mid - 1;
        else if (cp > end) lo = mid + 1;
        else return view.getUint32(g + 8) + (cp - start);
      }
      return 0;
    };
  }
  const segX2 = view.getUint16(offset + 6);
  const ends = offset + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  return (cp) => {
    if (cp > 0xffff) return 0;
    for (let i = 0; i < segX2; i += 2) {
      const end = view.getUint16(ends + i);
      if (cp > end) continue;
      const start = view.getUint16(starts + i);
      if (cp < start) return 0;
      const delta = view.getInt16(deltas + i);
      const rangeOffset = view.getUint16(ranges + i);
      if (rangeOffset === 0) return (cp + delta) & 0xffff;
      const addr = ranges + i + rangeOffset + (cp - start) * 2;
      const glyph = view.getUint16(addr);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
}

function kernTable(view: DataView, t: Tables): Map<number, number> {
  const pairs = new Map<number, number>();
  const kern = t.kern;
  if (!kern) return pairs;
  const version = view.getUint16(kern.offset);
  if (version !== 0) return pairs;
  const nTables = view.getUint16(kern.offset + 2);
  let sub = kern.offset + 4;
  for (let i = 0; i < nTables; i += 1) {
    const length = view.getUint16(sub + 2);
    const coverage = view.getUint16(sub + 4);
    const format = coverage >> 8;
    const horizontal = (coverage & 1) === 1;
    if (format === 0 && horizontal) {
      const n = view.getUint16(sub + 6);
      for (let j = 0; j < n; j += 1) {
        const p = sub + 14 + j * 6;
        pairs.set(view.getUint16(p) * 65536 + view.getUint16(p + 2), view.getInt16(p + 4));
      }
    }
    sub += length;
  }
  return pairs;
}

export function parseOpenType(bytes: Uint8Array, faceOffset = 0): OpenTypeFont {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const t = tableDirectory(view, faceOffset);
  if (!t.head || !t.hhea || !t.hmtx || !t.maxp) throw new Error("Not an OpenType font (missing head/hhea/hmtx/maxp).");
  const unitsPerEm = view.getUint16(t.head.offset + 18) || 1000;
  const indexToLocFormat = view.getInt16(t.head.offset + 50);
  let ascender = view.getInt16(t.hhea.offset + 4);
  let descender = view.getInt16(t.hhea.offset + 6);
  let lineGap = view.getInt16(t.hhea.offset + 8);
  const numberOfHMetrics = view.getUint16(t.hhea.offset + 34);
  const numGlyphs = view.getUint16(t.maxp.offset + 4);
  if (ascender === 0 && descender === 0 && t["OS/2"]) {
    const os2 = t["OS/2"].offset;
    ascender = view.getInt16(os2 + 68);
    descender = view.getInt16(os2 + 70);
    lineGap = view.getInt16(os2 + 72);
  }
  const lookup = cmapLookup(view, t);
  const kern = kernTable(view, t);
  const hmtx = t.hmtx.offset;
  const lastAdvance = numberOfHMetrics > 0 ? view.getUint16(hmtx + (numberOfHMetrics - 1) * 4) : 0;
  const glyf = t.glyf;
  const loca = t.loca;
  const glyphOffset = (g: number): [number, number] | undefined => {
    if (!glyf || !loca || g < 0 || g >= numGlyphs) return undefined;
    const a = indexToLocFormat === 0 ? view.getUint16(loca.offset + g * 2) * 2 : view.getUint32(loca.offset + g * 4);
    const b = indexToLocFormat === 0 ? view.getUint16(loca.offset + (g + 1) * 2) * 2 : view.getUint32(loca.offset + (g + 1) * 4);
    return [a, b];
  };
  return {
    families: names(view, t),
    unitsPerEm,
    ascender,
    descender,
    lineGap,
    glyphIndex: lookup,
    advanceWidth: (g) => (g < numberOfHMetrics ? view.getUint16(hmtx + g * 4) : lastAdvance),
    kerning: (l, r) => kern.get(l * 65536 + r) ?? 0,
    glyphBox: (g) => {
      const range = glyphOffset(g);
      if (!range || range[1] <= range[0]) return undefined;
      const at = glyf!.offset + range[0];
      return { xMin: view.getInt16(at + 2), yMin: view.getInt16(at + 4), xMax: view.getInt16(at + 6), yMax: view.getInt16(at + 8) };
    },
    hasGlyphBoxes: Boolean(glyf && loca),
  };
}
