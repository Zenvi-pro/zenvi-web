/**
 * Pair kerning from a font's GPOS table, read from the font's bytes.
 *
 * opentype.js 2.0 reads GPOS too, but it cannot parse extension lookups
 * (lookup type 9, how Inter stores its kerning) and stops at the first
 * lookup, so this reads the `kern` feature itself: every pair adjustment
 * lookup (type 2, or type 2 inside an extension) the Latin and default
 * scripts list, each lookup's first subtable that covers the pair, x advance
 * of the first glyph summed over lookups (OpenType spec, GPOS LookupType 2).
 * Variation deltas on the values are not applied (the default instance's
 * kerning is used at every weight).
 */

import { reader, tableOffset, type Reader } from "./sfnt.js";

/** Kerning between two glyph ids, font units. */
export type KerningLookup = (left: number, right: number) => number;

/** Bytes of a value record of `format`. */
const valueSize = (format: number): number => {
  let n = 0;
  for (let bits = format; bits; bits >>= 1) n += bits & 1;
  return n * 2;
};
/** Byte offset of XAdvance inside a value record, or -1 when the record has none. */
const xAdvanceAt = (format: number): number => (format & 0x4 ? valueSize(format & 0x3) : -1);

function coverageIndex(r: Reader, at: number, glyph: number): number {
  const format = r.u16(at);
  const count = r.u16(at + 2);
  if (format === 1) {
    let lo = 0;
    let hi = count - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const g = r.u16(at + 4 + mid * 2);
      if (g === glyph) return mid;
      if (g < glyph) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }
  if (format === 2) {
    for (let i = 0; i < count; i += 1) {
      const rec = at + 4 + i * 6;
      const start = r.u16(rec);
      if (glyph >= start && glyph <= r.u16(rec + 2)) return r.u16(rec + 4) + glyph - start;
    }
  }
  return -1;
}

function glyphClass(r: Reader, at: number, glyph: number): number {
  const format = r.u16(at);
  if (format === 1) {
    const start = r.u16(at + 2);
    const count = r.u16(at + 4);
    return glyph >= start && glyph < start + count ? r.u16(at + 6 + (glyph - start) * 2) : 0;
  }
  if (format === 2) {
    const count = r.u16(at + 2);
    for (let i = 0; i < count; i += 1) {
      const rec = at + 4 + i * 6;
      if (glyph >= r.u16(rec) && glyph <= r.u16(rec + 2)) return r.u16(rec + 4);
    }
  }
  return 0;
}

/** The pair's x advance from one PairPos subtable, or null when the subtable does not apply. */
function pairValue(r: Reader, at: number, left: number, right: number): number | null {
  const format = r.u16(at);
  const covered = coverageIndex(r, at + r.u16(at + 2), left);
  if (covered < 0) return null;
  const vf1 = r.u16(at + 4);
  const vf2 = r.u16(at + 6);
  const x = xAdvanceAt(vf1);
  if (format === 1) {
    const set = at + r.u16(at + 10 + covered * 2);
    const count = r.u16(set);
    const size = 2 + valueSize(vf1) + valueSize(vf2);
    let lo = 0;
    let hi = count - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const rec = set + 2 + mid * size;
      const g = r.u16(rec);
      if (g === right) return x < 0 ? 0 : r.i16(rec + 2 + x);
      if (g < right) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }
  if (format === 2) {
    const c1 = glyphClass(r, at + r.u16(at + 8), left);
    const c2 = glyphClass(r, at + r.u16(at + 10), right);
    const class1Count = r.u16(at + 12);
    const class2Count = r.u16(at + 14);
    if (c1 >= class1Count || c2 >= class2Count) return 0;
    const size = valueSize(vf1) + valueSize(vf2);
    return x < 0 ? 0 : r.i16(at + 16 + (c1 * class2Count + c2) * size + x);
  }
  return null;
}

/** Lookup indices of the `kern` feature of the Latin and default scripts' default language. */
function kernLookups(r: Reader, gpos: number): number[] {
  const scripts = gpos + r.u16(gpos + 4);
  const features = gpos + r.u16(gpos + 6);
  const featureIndices = new Set<number>();
  for (let i = 0; i < r.u16(scripts); i += 1) {
    const rec = scripts + 2 + i * 6;
    if (!["latn", "DFLT"].includes(r.tag(rec))) continue;
    const script = scripts + r.u16(rec + 4);
    const langSys = r.u16(script);
    if (!langSys) continue;
    const ls = script + langSys;
    for (let j = 0; j < r.u16(ls + 4); j += 1) featureIndices.add(r.u16(ls + 6 + j * 2));
  }
  const lookups = new Set<number>();
  for (const index of featureIndices) {
    const rec = features + 2 + index * 6;
    if (r.tag(rec) !== "kern") continue;
    const feature = features + r.u16(rec + 4);
    for (let j = 0; j < r.u16(feature + 2); j += 1) lookups.add(r.u16(feature + 4 + j * 2));
  }
  return [...lookups].sort((a, b) => a - b);
}

/** Absolute offsets of the PairPos subtables of each kerning lookup. */
function pairSubtables(r: Reader, gpos: number): number[][] {
  const list = gpos + r.u16(gpos + 8);
  const out: number[][] = [];
  for (const index of kernLookups(r, gpos)) {
    if (index >= r.u16(list)) continue;
    const lookup = list + r.u16(list + 2 + index * 2);
    const type = r.u16(lookup);
    const subtables: number[] = [];
    for (let i = 0; i < r.u16(lookup + 4); i += 1) {
      const at = lookup + r.u16(lookup + 6 + i * 2);
      if (type === 2) subtables.push(at);
      else if (type === 9 && r.u16(at + 2) === 2) subtables.push(at + r.u32(at + 4));
    }
    if (subtables.length > 0) out.push(subtables);
  }
  return out;
}

/** The font's pair kerning (zero for every pair when it has none). */
export function readKerning(bytes: Uint8Array): KerningLookup {
  const r = reader(bytes);
  let gpos = -1;
  try {
    gpos = tableOffset(r, "GPOS");
  } catch {
    gpos = -1;
  }
  if (gpos < 0) return () => 0;
  const lookups = pairSubtables(r, gpos);
  if (lookups.length === 0) return () => 0;
  const cache = new Map<number, number>();
  return (left, right) => {
    const key = left * 65536 + right;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let value = 0;
    for (const subtables of lookups) {
      for (const at of subtables) {
        const v = pairValue(r, at, left, right);
        if (v !== null) {
          value += v;
          break;
        }
      }
    }
    cache.set(key, value);
    return value;
  };
}
