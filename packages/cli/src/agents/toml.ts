/**
 * Just enough TOML to edit one table in `~/.codex/config.toml` without
 * touching anything else: a scanner that finds table headers (skipping
 * strings, comments and multi-line arrays), plus value formatting.
 */

export interface TomlHeader {
  /** Dotted name with quotes removed, e.g. `mcp_servers.zenvi.env`. */
  name: string;
  /** Offset of the header line's first character. */
  start: number;
  arrayTable: boolean;
}

function parseHeaderName(raw: string): string {
  const parts: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of raw) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ".") {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  parts.push(cur.trim());
  return parts.join(".");
}

/** Every `[table]` / `[[array]]` header, in order. Throws on unterminated strings. */
export function scanHeaders(text: string): TomlHeader[] {
  const headers: TomlHeader[] = [];
  let i = 0;
  let depth = 0;
  let lineStart = true;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if (lineStart && depth === 0) {
      let j = i;
      while (j < n && (text[j] === " " || text[j] === "\t")) j += 1;
      if (text[j] === "[") {
        const arrayTable = text[j + 1] === "[";
        const close = text.indexOf(arrayTable ? "]]" : "]", j);
        const eol = text.indexOf("\n", j);
        if (close > 0 && (eol < 0 || close < eol)) {
          headers.push({ name: parseHeaderName(text.slice(j + (arrayTable ? 2 : 1), close)), start: i, arrayTable });
          i = close + (arrayTable ? 2 : 1);
          lineStart = false;
          continue;
        }
      }
    }
    lineStart = false;
    if (ch === "\n") {
      lineStart = true;
      i += 1;
    } else if (ch === "#") {
      while (i < n && text[i] !== "\n") i += 1;
    } else if (text.startsWith('"""', i) || text.startsWith("'''", i)) {
      const delim = text.slice(i, i + 3);
      const end = text.indexOf(delim, i + 3);
      if (end < 0) throw new Error("Unterminated multi-line string in TOML.");
      i = end + 3;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && text[j] !== ch && text[j] !== "\n") j += ch === '"' && text[j] === "\\" ? 2 : 1;
      if (text[j] !== ch) throw new Error("Unterminated string in TOML.");
      i = j + 1;
    } else if (ch === "[" || ch === "{") {
      depth += 1;
      i += 1;
    } else if (ch === "]" || ch === "}") {
      depth = Math.max(0, depth - 1);
      i += 1;
    } else i += 1;
  }
  return headers;
}

/** `name` and its sub-tables (`name.*`) as [start, end) text ranges. */
export function tableRanges(text: string, name: string): Array<[number, number]> {
  const headers = scanHeaders(text);
  const ranges: Array<[number, number]> = [];
  headers.forEach((h, idx) => {
    if (h.name === name || h.name.startsWith(`${name}.`)) {
      const end = idx + 1 < headers.length ? headers[idx + 1]!.start : text.length;
      ranges.push([h.start, end]);
    }
  });
  return ranges;
}

/** Current text of `name` and its sub-tables, or undefined. */
export function readTable(text: string, name: string): string | undefined {
  const ranges = tableRanges(text, name);
  return ranges.length ? ranges.map(([a, b]) => text.slice(a, b)).join("").trim() : undefined;
}

/** Replace `name` (and sub-tables) with `section`, or append it. */
export function upsertTable(text: string, name: string, section: string): string {
  const ranges = tableRanges(text, name);
  const body = `${section.trim()}\n`;
  if (ranges.length === 0) {
    const base = text.length === 0 ? "" : text.endsWith("\n") ? text : `${text}\n`;
    return base ? `${base}\n${body}` : body;
  }
  let out = "";
  let last = 0;
  ranges.forEach(([a, b], idx) => {
    out += text.slice(last, a);
    if (idx === 0) out += `${body}${b < text.length ? "\n" : ""}`;
    last = b;
  });
  out += text.slice(last);
  return out.replace(/\n{3,}/g, "\n\n");
}

/** A TOML basic string (JSON string escapes are valid TOML). */
export function tomlString(value: string): string {
  return JSON.stringify(value);
}

export function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}
