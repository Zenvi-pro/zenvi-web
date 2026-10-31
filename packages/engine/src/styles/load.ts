/**
 * The library for the catalog's tools, loaded on first use: library.gen.ts
 * is ~1.6 MB of markdown, and the web editor's bundle (which lists every
 * catalog tool) must not carry it until a style tool runs. Node surfaces
 * bundle it with the rest.
 */

import type { StyleFile } from "./recipe.js";

let library: Promise<readonly StyleFile[]> | undefined;

export function styleLibrary(): Promise<readonly StyleFile[]> {
  library ??= import("./library.gen.js").then((m) => m.STYLE_FILES);
  return library;
}
