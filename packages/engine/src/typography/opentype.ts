// opentype.js through one module, so every package that compiles the engine sees its declarations
// (an ambient module: a reference, not an import, brings it in).
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./opentype.d.ts" />
export { parse } from "opentype.js/dist/opentype.mjs";
export type { Font, Glyph, PathCommand } from "opentype.js/dist/opentype.mjs";
