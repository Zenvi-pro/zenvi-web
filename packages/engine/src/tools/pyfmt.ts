/**
 * Python formatting for desktop-identical tool text.
 *
 * zenvi-core builds its tool results with f-strings (`{name!r}`,
 * `{dur:.2f}`, `{position}`), and the backend parses some of that text back
 * (core/chat/context_compactor.py), so the web tools format values the way
 * CPython does:
 *
 * - `pyRepr(str)`: `repr()` quoting and escapes (unicode_repr);
 * - `pyFixed(x, n)`: `format(x, ".nf")`, correctly rounded with ties to even
 *   on the exact binary value (JS `toFixed` rounds ties up);
 * - `pyFloat(x)`: `str(float)` / `repr(float)` ("12.0", "1e-05");
 * - `pySlice(s, a, b)`: slicing by code point, not UTF-16 unit.
 */

// Python's str.isprintable(): everything except Other (Cc Cf Cs Co Cn) and
// Separator (Zl Zp Zs) categories, with ASCII space allowed.
const NON_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

function hex(code: number, width: number): string {
  return code.toString(16).padStart(width, "0");
}

/** CPython `repr(str)`. */
export function pyReprString(value: string): string {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (ch === quote || ch === "\\") out += "\\" + ch;
    else if (ch === "\t") out += "\\t";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (code < 0x20 || code === 0x7f) out += "\\x" + hex(code, 2);
    else if (code < 0x7f) out += ch;
    else if (ch !== " " && NON_PRINTABLE.test(ch)) {
      if (code <= 0xff) out += "\\x" + hex(code, 2);
      else if (code <= 0xffff) out += "\\u" + hex(code, 4);
      else out += "\\U" + hex(code, 8);
    } else out += ch;
  }
  return out + quote;
}

/** Exact value of a finite double as mant * 2^exp, mant a BigInt. */
function decompose(x: number): { negative: boolean; mant: bigint; exp: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const negative = hi >>> 31 === 1;
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let exp: number;
  if (expBits === 0) exp = -1074;
  else {
    mant |= 1n << 52n;
    exp = expBits - 1075;
  }
  return { negative, mant, exp };
}

/** CPython `format(x, f".{digits}f")`. */
export function pyFixed(x: number, digits: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  const { negative, mant, exp } = decompose(x);
  let num = mant * 10n ** BigInt(digits);
  let den = 1n;
  if (exp >= 0) num <<= BigInt(exp);
  else den <<= BigInt(-exp);
  let q = num / den;
  const twice = (num % den) * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) q += 1n;
  const s = q.toString().padStart(digits + 1, "0");
  const body = digits > 0 ? `${s.slice(0, s.length - digits)}.${s.slice(s.length - digits)}` : s;
  return (negative ? "-" : "") + body;
}

/** CPython `repr(float)` (also `str(float)`): shortest round-trip digits, Python layout. */
export function pyFloat(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const [mantissa, expText] = x.toExponential().split("e") as [string, string];
  const exp = Number(expText);
  const negative = mantissa.startsWith("-");
  const digits = mantissa.replace("-", "").replace(".", "");
  let body: string;
  if (exp >= -4 && exp < 16) {
    if (exp >= 0) {
      const intLen = exp + 1;
      const intPart = digits.slice(0, intLen).padEnd(intLen, "0");
      const frac = digits.slice(intLen);
      body = `${intPart}.${frac || "0"}`;
    } else {
      body = `0.${"0".repeat(-exp - 1)}${digits}`;
    }
  } else {
    const lead = digits.slice(0, 1);
    const rest = digits.slice(1);
    const e = Math.abs(exp).toString().padStart(2, "0");
    body = `${lead}${rest ? "." + rest : ""}e${exp < 0 ? "-" : "+"}${e}`;
  }
  return (negative ? "-" : "") + body;
}

/**
 * `str()` of a JSON number read from project data. Python keeps int vs
 * float from the JSON text; JavaScript cannot, so integral values print as
 * ints unless the field is known to be a float (`asFloat`).
 */
export function pyNumber(x: number, asFloat = false): string {
  if (Number.isInteger(x) && !asFloat && Math.abs(x) < 1e16) return String(x);
  return pyFloat(x);
}

/** `repr()` of a JSON value in desktop text. */
export function pyRepr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "string") return pyReprString(value);
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return pyNumber(value);
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return `{${entries.map(([k, v]) => `${pyReprString(k)}: ${pyRepr(v)}`).join(", ")}}`;
  }
  return String(value);
}

/** `str(bool)`. */
export function pyBool(value: boolean): string {
  return value ? "True" : "False";
}

/** `s[start:end]` by code point. */
export function pySlice(value: string, start: number, end?: number): string {
  return Array.from(value).slice(start, end).join("");
}

/** `len(s)` in code points. */
export function pyLen(value: string): number {
  let n = 0;
  for (const _ of value) n += 1;
  return n;
}
