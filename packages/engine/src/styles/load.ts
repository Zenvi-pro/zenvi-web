/**
 * The styles library (library.gen.ts: the index, BRIEF.md and every style,
 * technique, family and method, about 2.8 MB) loaded on first use. The tools
 * that read it (find/get_style_tool, get_technique_tool, produce_video_tool,
 * the builders' followStyle) import it through here, so a bundler splits it
 * into a chunk of its own and the web editor downloads it only when one of
 * them runs, not with the editor. Servers that serve it as resources import
 * `@zenvi/engine/styles` directly.
 */

import type { STYLE_FILES } from "./library.gen.js";

export type StyleFiles = typeof STYLE_FILES;

let library: Promise<StyleFiles> | undefined;

/** Every file of the styles library; one load per process, shared by every caller. */
export function loadStyleFiles(): Promise<StyleFiles> {
  library ??= import("./library.gen.js").then((m) => m.STYLE_FILES);
  return library;
}
