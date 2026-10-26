/// <reference path="./opentype.d.ts" />
// opentype.js through one module, so every package that compiles the engine sees its declarations.
export { parse } from "opentype.js/dist/opentype.mjs";
export type { Font, Glyph, PathCommand } from "opentype.js/dist/opentype.mjs";
