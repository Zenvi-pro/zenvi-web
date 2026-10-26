/**
 * The block catalog: every block's manifest (`blocks/<id>/block.json`).
 * Adding a block = a folder with block.json, block.ts (exporting
 * `build(ctx)`) and optionally block.css, plus one line here.
 */

import type { BlockManifest } from "./params.js";
import counter from "./blocks/counter/block.json" with { type: "json" };
import glassCards from "./blocks/glass_cards/block.json" with { type: "json" };
import gradientField from "./blocks/gradient_field/block.json" with { type: "json" };
import hudCallouts from "./blocks/hud_callouts/block.json" with { type: "json" };
import kineticHeadline from "./blocks/kinetic_headline/block.json" with { type: "json" };
import particleBurst from "./blocks/particle_burst/block.json" with { type: "json" };
import shapeMorph from "./blocks/shape_morph/block.json" with { type: "json" };
import typeMorph from "./blocks/type_morph/block.json" with { type: "json" };
import lineTrails from "./blocks/line_trails/block.json" with { type: "json" };
import logoBuild from "./blocks/logo_build/block.json" with { type: "json" };
import promptBar from "./blocks/prompt_bar/block.json" with { type: "json" };
import textScramble from "./blocks/text_scramble/block.json" with { type: "json" };
import wordRotator from "./blocks/word_rotator/block.json" with { type: "json" };

export const BLOCKS: readonly BlockManifest[] = [promptBar, kineticHeadline, wordRotator, counter, textScramble, hudCallouts, gradientField, glassCards, particleBurst, shapeMorph, typeMorph, lineTrails, logoBuild] as BlockManifest[];

export function getBlock(id: string): BlockManifest | undefined {
  return BLOCKS.find((b) => b.id === id);
}
