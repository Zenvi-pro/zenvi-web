/**
 * make_transition_mask_tool: a generated luma mask for the native wipe
 * transition (transitions/tile-masks.ts): square tiles in a chosen order
 * (random, diagonal, rows, columns, from the centre, a spiral), concentric
 * rings or staggered bars, at the project's size, added to the media bin so
 * update_transition_tool mask_file_id puts it on any transition. The
 * desktop's transitions read the same SVG.
 */

import { z } from "zod";
import { addFile } from "../../ops/files.js";
import { MASK_PATTERNS, TILE_ORDERS, tileMaskSvg } from "../../transitions/tile-masks.js";
import { directTool, unavailable, type CatalogTool } from "../define.js";
import { generatedSvg } from "../mattes.js";
import { applied } from "../receipt.js";
import { projectSize } from "../titles-text.js";

const TOOL = "make_transition_mask_tool";

const input = z.strictObject({
  pattern: z.enum(MASK_PATTERNS).optional().describe("tiles (default: a square-tile dissolve), rings (concentric, from the centre out) or bars (staggered strips across the frame)."),
  order: z.enum(TILE_ORDERS).optional().describe("tiles: the order they flip in: random (default), diagonal (a corner sweep, slightly ragged), rows, columns, centre (outward), spiral (from the edge in)."),
  count: z.number().int().min(2).max(24).optional().describe("tiles: tiles across the frame's short side (default 6: big blocks; 12 a fine mosaic); rings: how many (default 6); bars: how many (default 8)."),
  horizontal: z.boolean().optional().describe("bars: horizontal strips top to bottom instead of vertical ones left to right."),
  reverse: z.boolean().optional().describe("Run the order backwards (rings inward, bars from the right or bottom)."),
  seed: z.number().int().min(0).max(1_000_000).optional().describe("random/diagonal/centre: a different shuffle (default 1)."),
});

type Input = z.infer<typeof input>;

export const transitionMaskTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Make a transition mask",
    description:
      "Generate a luma wipe mask and add it to the media bin: square tiles that flip in a chosen order (a block/mosaic dissolve), concentric rings, or staggered bars, at the project's size. " +
      "Put it on a transition with update_transition_tool mask_file_id=<file_id> (contrast 10-20 keeps the edges hard: each tile switches at once); add_transition_tool first when the cut has none. " +
      "Plays the same on the desktop (a native mask transition). One undo step (the bin file).",
    input,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["media"],
    run: async (call, args: Input) => {
      if (!call.host.media?.writeGenerated) return unavailable(TOOL, "it cannot store the generated mask image.");
      const pattern = args.pattern ?? "tiles";
      const order = args.order ?? "random";
      const count = args.count ?? (pattern === "bars" ? 8 : 6);
      const [w, h] = projectSize(call.doc.project);
      const mask = tileMaskSvg(w, h, { pattern, order, count, horizontal: args.horizontal ?? false, reverse: args.reverse ?? false, seed: args.seed ?? 1 });
      const stem = pattern === "tiles" ? `mask-tiles-${order}-${count}` : `mask-${pattern}-${count}`;
      const asset = await generatedSvg(call, stem, mask.svg);
      const file = call.commit((tx) => addFile(tx, asset.media, { mediaType: "image" }), `Transition mask (${pattern})`);
      const what = pattern === "tiles" ? `${count}-across tiles flipping ${order === "centre" ? "from the centre" : order}` : pattern === "rings" ? `${count} rings` : `${count} ${args.horizontal ? "horizontal" : "vertical"} bars`;
      return applied(TOOL, `Made a ${w}×${h} transition mask of ${what} (${mask.steps} steps): file ${file.id}. Pass it to update_transition_tool as mask_file_id.`, {
        data: { file_id: file.id, name: asset.media.name, pattern, ...(pattern === "tiles" ? { order } : {}), count, steps: mask.steps, width: w, height: h },
      });
    },
  }),
];
