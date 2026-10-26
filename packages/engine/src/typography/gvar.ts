/**
 * Repairs opentype.js 2.0's reading of gvar tuples that vary every point.
 *
 * Packed point numbers with a count of 0 mean "all points" (OpenType spec,
 * gvar, "Packed point numbers"). opentype.js reads them as an empty list,
 * then treats an empty private list as "use the shared points"
 * (`applyTupleVariationStore`): a tuple that moves all of a glyph's points
 * moves only the shared ones, and its deltas are parsed short. Inter's D and
 * J lose their stems at every weight but 400. For a composite glyph, whose
 * points are its components' offsets, opentype.js applies an all-points tuple
 * to no component at all.
 *
 * `readAllPointTuples` finds those tuples in the font's bytes once;
 * `repairGlyph` hands opentype.js the full point list before a glyph's
 * deltas are first read (they are parsed lazily, sized by that list).
 */

import type { Font, Glyph } from "./opentype.js";
import { reader, tableOffset, type Reader } from "./sfnt.js";

/** Per glyph id: the tuples that vary every point, and whether the glyph has shared point numbers. */
export type AllPointTuples = ReadonlyMap<number, { tuples: readonly number[]; shared: boolean }>;

const SHARED_POINT_NUMBERS = 0x8000;
const COUNT_MASK = 0x0fff;
const EMBEDDED_PEAK_TUPLE = 0x8000;
const INTERMEDIATE_REGION = 0x4000;
const PRIVATE_POINT_NUMBERS = 0x2000;

/** A packed point-number list at `at`: its point count and its length in bytes. */
function packedPoints(r: Reader, at: number): { count: number; bytes: number } {
  const first = r.u8(at);
  const count = first & 0x80 ? ((first & 0x7f) << 8) | r.u8(at + 1) : first;
  let p = at + (first & 0x80 ? 2 : 1);
  for (let read = 0; read < count; ) {
    const control = r.u8(p);
    const run = (control & 0x7f) + 1;
    p += 1 + run * (control & 0x80 ? 2 : 1);
    read += run;
  }
  return { count, bytes: p - at };
}

/** The all-points tuples of every glyph opentype.js misreads (an empty map for a font without gvar). */
export function readAllPointTuples(bytes: Uint8Array): AllPointTuples {
  const out = new Map<number, { tuples: number[]; shared: boolean }>();
  const r = reader(bytes);
  const gvar = tableOffset(r, "gvar");
  if (gvar < 0) return out;
  const axisCount = r.u16(gvar + 4);
  const glyphCount = r.u16(gvar + 12);
  const long = (r.u16(gvar + 14) & 1) === 1;
  const array = gvar + r.u32(gvar + 16);
  const offset = (g: number): number => (long ? r.u32(gvar + 20 + g * 4) : r.u16(gvar + 20 + g * 2) * 2);
  for (let g = 0; g < glyphCount; g += 1) {
    const start = offset(g);
    if (offset(g + 1) === start) continue;
    const at = array + start;
    const header = r.u16(at);
    const count = header & COUNT_MASK;
    let data = at + r.u16(at + 2);
    let sharedCount = 0;
    if (header & SHARED_POINT_NUMBERS) {
      const shared = packedPoints(r, data);
      sharedCount = shared.count;
      data += shared.bytes;
    }
    const tuples: number[] = [];
    let h = at + 4;
    for (let i = 0; i < count; i += 1) {
      const size = r.u16(h);
      const index = r.u16(h + 2);
      h += 4 + (index & EMBEDDED_PEAK_TUPLE ? axisCount * 2 : 0) + (index & INTERMEDIATE_REGION ? axisCount * 4 : 0);
      const points = index & PRIVATE_POINT_NUMBERS ? packedPoints(r, data).count : sharedCount;
      if (points === 0) tuples.push(i);
      data += size;
    }
    if (tuples.length > 0) out.set(g, { tuples, shared: sharedCount > 0 });
  }
  return out;
}

interface VariationHeader {
  privatePoints: number[];
}

/** Give `glyph`'s (and its components') all-points tuples their full point list. Idempotent; call before `getTransform`. */
export function repairGlyph(font: Font, glyph: Glyph, allPoints: AllPointTuples, done: Set<number>): void {
  if (done.has(glyph.index)) return;
  done.add(glyph.index);
  // Reading the path loads the outline: its points and components.
  if (!glyph.path) return;
  const components = glyph.isComposite ? (glyph.components ?? []) : [];
  for (const c of components) repairGlyph(font, font.glyphs.get(c.glyphIndex), allPoints, done);
  const entry = allPoints.get(glyph.index);
  // A simple glyph without shared points is read right: an empty list is "all points" there.
  if (!entry || (!glyph.isComposite && !entry.shared)) return;
  const gvar = font.tables.gvar as { glyphVariations?: Record<number, { headers: VariationHeader[] } | undefined> } | undefined;
  const headers = gvar?.glyphVariations?.[glyph.index]?.headers;
  if (!headers) return;
  // Every point plus the four phantom points (OpenType spec, gvar, "Point numbers and processing for composite glyphs").
  const total = (glyph.isComposite ? components.length : (glyph.points?.length ?? 0)) + 4;
  const all = Array.from({ length: total }, (_, i) => i);
  for (const t of entry.tuples) {
    const header = headers[t];
    if (header) header.privatePoints = all;
  }
}
