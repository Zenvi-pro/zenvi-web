/**
 * ECMAScript 3 syntax check for host scripts (ExtendScript is ES3): acorn
 * with `ecmaVersion: 3` rejects let/const, arrow functions, template
 * strings, getters/setters and trailing commas in object literals;
 * `allowReserved: "never"` also rejects reserved words as identifiers and
 * as property names (`obj.default`, `{class: 1}`). Trailing commas in array
 * literals parse in ES3 (as an elision), so they are checked separately.
 */

import { parse, type Token } from "acorn";

export interface Es3Problem {
  message: string;
  /** 1-based. */
  line: number;
  column: number;
}

export function checkEs3(source: string): Es3Problem | undefined {
  const tokens: Token[] = [];
  try {
    parse(source, { ecmaVersion: 3, allowReserved: "never", sourceType: "script", locations: true, onToken: tokens });
  } catch (error) {
    const loc = (error as { loc?: { line: number; column: number } }).loc;
    return { message: (error as Error).message, line: loc?.line ?? 0, column: loc?.column ?? 0 };
  }
  for (let i = 1; i < tokens.length; i += 1) {
    const prev = tokens[i - 1] as Token;
    const token = tokens[i] as Token;
    if (prev.type.label === "," && token.type.label === "]") {
      return { message: "Trailing comma in an array literal", line: prev.loc?.start.line ?? 0, column: prev.loc?.start.column ?? 0 };
    }
  }
  return undefined;
}
