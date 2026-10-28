/**
 * The zenvi-styles library as MCP resources (`zenvi mcp` and Zenvi Cloud):
 * the index at zenvi://styles, the brief compiler at zenvi://styles/brief and
 * every style, technique and family at zenvi://styles/<id>. The text comes
 * from library.gen.ts (plugins/zenvi/scripts/gen-styles-index.mjs). A
 * subpath of its own (`@zenvi/engine/styles`) so the web editor's bundle
 * never carries it.
 */

import { STYLE_FILES, STYLES_BRIEF, STYLES_INDEX } from "./library.gen.js";

export { STYLE_FILES, STYLES_BRIEF, STYLES_INDEX };

export interface StyleResource {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: "text/markdown";
  text: string;
}

const KIND_LABEL = { style: "Style", technique: "Technique", family: "Technique family" } as const;

export const STYLE_RESOURCES: readonly StyleResource[] = [
  {
    uri: "zenvi://styles",
    name: "styles",
    title: "Zenvi styles index",
    description: "Read first for any whole video: how to compile the creative brief, then one line per style and technique (pace, aspect, tools, when to use). Each file is zenvi://styles/<id>.",
    mimeType: "text/markdown",
    text: STYLES_INDEX,
  },
  {
    uri: "zenvi://styles/brief",
    name: "styles-brief",
    title: "The brief compiler",
    description: "Step 0 of every edit: turn the first prompt and the media inventory into a creative brief, critique it against the style's checklist, fix it and save it with save_brief_tool.",
    mimeType: "text/markdown",
    text: STYLES_BRIEF,
  },
  ...STYLE_FILES.map((file) => ({
    uri: `zenvi://styles/${file.id}`,
    name: `styles-${file.id}`,
    title: `${KIND_LABEL[file.kind]}: ${file.id}`,
    description: file.summary,
    mimeType: "text/markdown" as const,
    text: file.markdown,
  })),
];

/** The resource at `uri`, if it is one of the library's. */
export function styleResource(uri: string): StyleResource | undefined {
  return STYLE_RESOURCES.find((r) => r.uri === uri);
}
