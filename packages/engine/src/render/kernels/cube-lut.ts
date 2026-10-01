/**
 * `.cube` LUT loading, exactly like libopenshot 1.0
 * `ColorMap::load_cube_file` (src/effects/ColorMap.cpp:21-137), including
 * its quirks:
 *
 * - `LUT_3D_SIZE` is tried first, then `LUT_1D_SIZE`, each pass rereading
 *   the file from the top. `DOMAIN_MIN`/`DOMAIN_MAX` values persist across
 *   the passes, so a failed 3D pass that scanned the whole file leaves the
 *   domain of a line anywhere in it (even after the 1D data) in effect.
 * - Every data-section line with at least three tokens is a triple, tokens
 *   parsed with `QString::toFloat` (0 when not a number): a
 *   `LUT_3D_INPUT_RANGE 0 1` line after the size line becomes (0, 0, 1).
 * - Reading stops after exactly N³ (3D) or N (1D) triples; fewer fails.
 *
 * Text handling follows `QFile` (Text mode drops every `\r`), `QTextStream::
 * readLine`, `QString::trimmed` and `QString::split(QRegularExpression("\\s+"))`.
 */

export interface CubeLut {
  /** "3d": `size`³ entries, index `((b*N + g)*N + r)*3` (red fastest); "1d": `size` entries. */
  readonly kind: "1d" | "3d";
  readonly size: number;
  /** RGB triples, float32 like the C++ `std::vector<float>`. */
  readonly data: Float32Array;
  /** Per-channel input domain (float32), default 0..1. */
  readonly domainMin: readonly [number, number, number];
  readonly domainMax: readonly [number, number, number];
}

/** `QChar::isSpace` (qchar.cpp): ASCII 9-13 and 32, U+0085, and Unicode Zs/Zl/Zp. */
function isQtSpace(code: number): boolean {
  if (code === 0x20 || (code >= 0x09 && code <= 0x0d)) return true;
  if (code < 0x85) return false;
  return (
    code === 0x85 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

/** `QString::trimmed()`. */
function qtTrimmed(line: string): string {
  let start = 0;
  let end = line.length;
  while (start < end && isQtSpace(line.charCodeAt(start))) start += 1;
  while (end > start && isQtSpace(line.charCodeAt(end - 1))) end -= 1;
  return line.slice(start, end);
}

/**
 * `line.split(QRegularExpression("\\s+"))`: Qt compiles without
 * PCRE2_UCP, so `\s` is ASCII whitespace only. Lines are already trimmed.
 */
const WHITESPACE_RUN = /[\t\n\v\f\r ]+/;

function splitTokens(line: string): string[] {
  return line.split(WHITESPACE_RUN);
}

/**
 * `QLocaleData::numberToCLocale` for the C locale: surrounding whitespace
 * is skipped, U+2212 is a minus sign, ASCII letters are lowercased, `,`
 * (group separator) is rejected.
 */
function toCLocale(token: string): string | null {
  let out = "";
  for (const ch of qtTrimmed(token)) {
    if (ch === "−") out += "-";
    else if (ch === ",") return null;
    else if (ch >= "A" && ch <= "Z") out += ch.toLowerCase();
    else out += ch;
  }
  return out;
}

const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/;
const FLOAT_MAX = 3.4028234663852886e38;

/** `QString::toFloat()`: C-locale double (0 on failure), then `convertDoubleToFloat`. */
export function qtToFloat(token: string): number {
  const s = toCLocale(token);
  if (s === null) return 0;
  let d: number;
  if (s === "nan") d = NaN;
  else if (s === "inf" || s === "+inf") d = Infinity;
  else if (s === "-inf") d = -Infinity;
  else if (DECIMAL.test(s)) d = Number(s);
  else return 0;
  if (!Number.isFinite(d)) return d;
  if (Math.abs(d) > FLOAT_MAX) return d < 0 ? -Infinity : Infinity;
  return Math.fround(d);
}

/** `QString::toInt()`: base-10 integer in int range, else 0. */
export function qtToInt(token: string): number {
  const s = toCLocale(token);
  if (s === null || !/^[+-]?\d+$/.test(s)) return 0;
  const v = Number(s);
  return v >= -2147483648 && v <= 2147483647 ? v : 0;
}

/** Lines as `QTextStream::readLine()` returns them from a Text-mode `QFile`, trimmed. */
function readLines(text: string): string[] {
  let body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  body = body.replace(/\r/g, "");
  const lines = body.split("\n");
  // After a final newline QTextStream is at end: there is no extra empty line.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.map(qtTrimmed);
}

/** Entries beyond int range make the C++ `reserve()` throw; treat them as a failed load. */
const MAX_VALUES = 2147483647;

interface Attempt {
  size: number;
  data: Float32Array;
}

/** Parse `.cube` text; null when libopenshot would load no LUT (the effect then does nothing). */
export function parseCubeLut(text: string): CubeLut | null {
  const lines = readLines(text);
  // parsed_domain_min/max are shared by both passes (ColorMap.cpp:34-35, 45-60).
  const domainMin: [number, number, number] = [0, 0, 0];
  const domainMax: [number, number, number] = [1, 1, 1];

  const parseDomainLine = (line: string): void => {
    const isMin = line.startsWith("DOMAIN_MIN");
    if (!isMin && !line.startsWith("DOMAIN_MAX")) return;
    const parts = splitTokens(line);
    if (parts.length < 4) return;
    const target = isMin ? domainMin : domainMax;
    target[0] = qtToFloat(parts[1]!);
    target[1] = qtToFloat(parts[2]!);
    target[2] = qtToFloat(parts[3]!);
  };

  // try_parse (ColorMap.cpp:62-115).
  const tryParse = (keyword: string, want3d: boolean): Attempt | null => {
    let i = 0;
    let detected = 0;
    while (i < lines.length) {
      const line = lines[i++]!;
      parseDomainLine(line);
      if (line.startsWith(keyword)) {
        const parts = splitTokens(line);
        if (parts.length >= 2) detected = qtToInt(parts[1]!);
        break;
      }
    }
    if (detected <= 0) return null;
    const entries = want3d ? detected * detected * detected : detected;
    const need = entries * 3;
    if (need > MAX_VALUES) return null;
    // Each remaining line holds at most one triple: when they cannot add up,
    // the C++ fails too. Checking first keeps a bogus size from allocating.
    if (need > (lines.length - i) * 3) return null;
    const data = new Float32Array(need);
    let count = 0;
    while (i < lines.length && count < need) {
      const line = lines[i++]!;
      if (line === "" || line.startsWith("#") || line.startsWith("TITLE")) continue;
      if (line.startsWith("DOMAIN_MIN") || line.startsWith("DOMAIN_MAX")) {
        parseDomainLine(line);
        continue;
      }
      const vals = splitTokens(line);
      if (vals.length >= 3) {
        data[count] = qtToFloat(vals[0]!);
        data[count + 1] = qtToFloat(vals[1]!);
        data[count + 2] = qtToFloat(vals[2]!);
        count += 3;
      }
    }
    if (count !== need) return null;
    return { size: detected, data };
  };

  const lut3d = tryParse("LUT_3D_SIZE", true);
  const found = lut3d ?? tryParse("LUT_1D_SIZE", false);
  if (!found) return null;
  return { kind: lut3d ? "3d" : "1d", size: found.size, data: found.data, domainMin, domainMax };
}

/** Parsed LUTs by file text, most recently used last. */
const CACHE = new Map<string, CubeLut | null>();
const CACHE_LIMIT = 8;

/**
 * `parseCubeLut` with a small LRU cache keyed by the file text, so a 33³
 * LUT is parsed once per file content rather than once per frame.
 */
export function cachedCubeLut(text: string): CubeLut | null {
  if (CACHE.has(text)) {
    const hit = CACHE.get(text)!;
    CACHE.delete(text);
    CACHE.set(text, hit);
    return hit;
  }
  const lut = parseCubeLut(text);
  CACHE.set(text, lut);
  if (CACHE.size > CACHE_LIMIT) CACHE.delete(CACHE.keys().next().value!);
  return lut;
}
