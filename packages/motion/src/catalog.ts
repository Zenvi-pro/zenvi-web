/**
 * The block catalog: every block's manifest (`blocks/<id>/block.json`).
 * Adding a block = a folder with block.json, block.ts (exporting
 * `build(ctx)`) and optionally block.css, plus one line here.
 */

import type { BlockManifest } from "./params.js";
import promptBar from "./blocks/prompt_bar/block.json" with { type: "json" };

export const BLOCKS: readonly BlockManifest[] = [promptBar as BlockManifest];

export function getBlock(id: string): BlockManifest | undefined {
  return BLOCKS.find((b) => b.id === id);
}
