/** A small, forgiving highlighter for code_card: enough tokens to colour a snippet the way an editor would. */

export type TokenKind = "keyword" | "string" | "number" | "comment" | "function" | "type" | "punct" | "plain";

export interface Token {
  kind: TokenKind;
  text: string;
}

export type Language = "ts" | "python" | "shell" | "json";

const KEYWORDS: Record<Language, ReadonlySet<string>> = {
  ts: new Set("import export from const let var function return await async if else for while of in new class extends interface type true false null undefined this try catch throw default as".split(" ")),
  python: new Set("import from as def return await async if elif else for while in not and or class with try except raise True False None self lambda yield pass".split(" ")),
  shell: new Set("if then else fi for do done in case esac export echo cd sudo".split(" ")),
  json: new Set("true false null".split(" ")),
};

const COMMENT: Record<Language, RegExp> = {
  ts: /^\/\/.*/,
  python: /^#.*/,
  shell: /^#.*/,
  json: /^$a/,
};

/**
 * The snippet to show: tabs as two spaces, and a one-line argument's literal
 * `\n` read as line breaks (agents often send code that way). Code that
 * already has line breaks keeps its `\n` escapes, e.g. `split("\n")`.
 */
export function codeText(raw: string): string {
  const text = raw.includes("\n") ? raw : raw.replace(/\\n/g, "\n");
  return text.replace(/\t/g, "  ");
}

/** One line's tokens (strings and comments do not span lines in the snippets this shows). */
export function tokenizeLine(line: string, lang: Language): Token[] {
  const out: Token[] = [];
  const push = (kind: TokenKind, text: string): void => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    const comment = COMMENT[lang].exec(rest);
    if (comment) {
      push("comment", comment[0]);
      break;
    }
    const str = /^(["'`])(?:\\.|(?!\1).)*\1?/.exec(rest);
    if (str) {
      push("string", str[0]);
      i += str[0].length;
      continue;
    }
    const num = /^\d[\d_]*(?:\.\d+)?/.exec(rest);
    if (num && !/[\w$]/.test(line[i - 1] ?? "")) {
      push("number", num[0]);
      i += num[0].length;
      continue;
    }
    const word = /^[A-Za-z_$@][\w$-]*/.exec(rest);
    if (word) {
      let w = word[0];
      // Hyphens belong to shell words and flags only.
      if (lang !== "shell") w = /^[A-Za-z_$@][\w$]*/.exec(rest)![0];
      const next = line.slice(i + w.length).trimStart()[0];
      const kind: TokenKind = KEYWORDS[lang].has(w) ? "keyword" : next === "(" ? "function" : /^[A-Z]/.test(w) ? "type" : lang === "shell" && out.length === 0 ? "function" : "plain";
      push(kind, w);
      i += w.length;
      continue;
    }
    const ch = line[i]!;
    push(/\s/.test(ch) ? "plain" : /[{}()[\];,.:=<>+\-*/!?&|]/.test(ch) ? "punct" : "plain", ch);
    i += 1;
  }
  return out;
}

/**
 * When each character of `code` appears, typed at `cps`: leading
 * indentation lands at once (the editor indents), a newline adds a short
 * pause, as a person finishing a line would.
 */
export function typeTimes(code: string, cps: number, at: number): number[] {
  const times: number[] = [];
  let t = at;
  let lineStart = true;
  for (const ch of Array.from(code)) {
    if (ch === "\n") {
      t += 0.1;
      times.push(t);
      lineStart = true;
      continue;
    }
    if (lineStart && ch === " ") {
      times.push(t);
      continue;
    }
    lineStart = false;
    t += 1 / cps;
    times.push(t);
  }
  return times;
}

/** Seconds typing `code` takes at `cps` (with typeTimes' pauses). */
export function typeSeconds(code: string, cps: number): number {
  const times = typeTimes(code, cps, 0);
  return times[times.length - 1] ?? 0;
}
