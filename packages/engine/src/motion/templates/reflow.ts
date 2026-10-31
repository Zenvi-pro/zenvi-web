/**
 * reflow: two to nine footage cells that re-lay themselves between grid
 * states on the beat (T058: bento cells rescale, collapse into one block,
 * reflow into sub-groups with a steep ease-out).
 *
 * Each cell is its clip drawn at one size for the whole template (covering
 * the largest box the cell ever takes), centred on the cell, and cut to the
 * cell by a keyframed Crop (no resize). With the picture's size constant,
 * the crop's sides are linear in the cell's box, so one ease on the pose and
 * the crop moves every edge in a straight line, gutters steady: cells are
 * windows that reflow, the footage keeping its scale.
 *
 *   states   `states`: 1-4 layouts after the first, each a box per cell
 *            (centre x, y and size w, h, 0..1 of the frame); default: the
 *            grid, then a bento (tiles.ts mosaic), then the first cell alone
 *            (the rest collapse into it)
 *   timing   cells fade up together at the start, then one state every
 *            two beats, each move 12 frames, out_strong
 */

import { defaultEffectJson } from "../../effects/registry.js";
import type { Effect } from "../../model/types.js";
import { backdrop, key, mediaCard, pose } from "../elements.js";
import { keyframeThrough } from "../keyframes.js";
import { refuse, type NormBox, type TemplateInput, type TemplateOutput, type TemplateSpec } from "../template.js";
import { tileRects, TILE_COUNTS, type Rect } from "../tiles.js";
import type { Ease, Element, Key, MediaSource, MotionMedia } from "../types.js";
import { lockedStart } from "./layout-parts.js";

const MAX_CELLS = 9;
/** Frames of a move between states. */
const MOVE = 12;
/** Beats between states. */
const PER = 2;

/** The default states: a grid (or bento when the count has no grid), a bento, then the first cell alone. */
function defaultStates(count: number, region: Rect, gap: number): Rect[][] {
  const grid = (TILE_COUNTS.grid as readonly number[]).includes(count) ? tileRects("grid", count, region, gap) : tileRects("mosaic", count, region, gap);
  const bento = count >= 3 ? tileRects("mosaic", count, region, gap) : tileRects("strips_h", count, region, gap);
  const alone = Array.from({ length: count }, () => region);
  return [grid, bento, alone];
}

const fromBox = (b: NormBox, W: number, H: number): Rect => ({ x: (b.x - b.w / 2) * W, y: (b.y - b.h / 2) * H, w: b.w * W, h: b.h * H });

export const reflow: TemplateSpec = {
  id: "reflow",
  summary:
    "Two to nine footage cells re-lay themselves on the beat (grid → bento → one block, or the states you give): each cell is a window on its clip that moves and resizes with a steep ease-out, gutters steady, the footage keeping its scale.",
  reads: "file_ids (the cells, the first on top), states (layouts after the first: a list of box lists, one box per cell, centre x, y and size w, h 0-1)",
  media: "required",
  beats: (content) => 1 + PER * Math.max(2, content.states ? content.states.length : 2) + 2,
  build(input: TemplateInput): TemplateOutput {
    const { content, palette, layout, frames, beats, media, frame } = input;
    const { W, H, u } = layout;
    const files = (content.fileIds ?? []).map((id) => media.get(id) as MotionMedia);
    if (files.length < 2 || files.length > MAX_CELLS) refuse(`reflow takes 2 to ${MAX_CELLS} file_ids, one per cell (got ${files.length})`);
    const count = files.length;
    const gap = Math.round(10 * u);
    const region: Rect = { x: 0, y: 0, w: W, h: H };
    const given = content.states?.map((state, k) => {
      if (state.length !== count) refuse(`reflow state ${k + 1} has ${state.length} boxes; give one per cell (${count})`);
      return state.map((b) => fromBox(b, W, H));
    });
    const states = given ? [defaultStates(count, region, gap)[0]!, ...given] : defaultStates(count, region, gap);
    // State k (after the first) lands on beat 1 + PER·k; the ones that do not fit are dropped with a warning.
    const at = states.map((_, k) => (k === 0 ? 0 : beats.frame(1 + PER * (k - 1))));
    const fit = at.filter((f, k) => k === 0 || f + MOVE + 2 <= frames).length;
    const warnings = fit < states.length ? [`reflow: ${states.length - fit} state(s) did not fit in the duration; give a longer one for every state`] : [];
    const shown = states.slice(0, fit);
    const fps = frame.fps;
    const start = lockedStart(files, frames / fps);

    const elements: Element[] = [backdrop("reflow-bg", 0, 0, frames, layout, (d) => d.rect(0, 0, W, H, { fill: palette.background }))];
    for (let i = 0; i < count; i += 1) {
      const m = files[i]!;
      const aspect = m.width / m.height;
      const boxes = shown.map((s) => s[i]!);
      // One picture size for the whole template: it covers the largest box this cell takes.
      const pw = Math.max(...boxes.map((b) => Math.max(b.w, b.h * aspect)));
      const ph = pw / aspect;
      const centre = (b: Rect) => pose(b.x + b.w / 2, b.y + b.h / 2);
      // The pose keys and the box the crop shows at each, side by side.
      const keys: Key[] = [];
      const shownBox: Rect[] = [];
      const push = (f: number, b: Rect, ease: Ease, alpha = 1) => {
        keys.push(key(f, { ...centre(b), alpha }, ease));
        shownBox.push(b);
      };
      push(0, boxes[0]!, "out", 0);
      push(8, boxes[0]!, "out");
      for (let k = 1; k < boxes.length; k += 1) {
        if (at[k]! > keys[keys.length - 1]!.frame) push(at[k]!, boxes[k - 1]!, "linear");
        push(at[k]! + MOVE, boxes[k]!, "out_strong");
      }
      let el = mediaCard(`cell-${i + 1}`, count - i, 0, frames, m, fps, { width: pw, radius: 0, ...(start !== undefined ? { start } : {}) }, keys);
      const inFrames = Math.round((el.source as MediaSource).start * fps);
      const xs = keys.map((kk) => kk.frame + 1 + inFrames);
      const eases = keys.map((kk) => kk.ease);
      const side = (f: (b: Rect) => number) => keyframeThrough(xs, shownBox.map(f), eases);
      const { id: _id, ...json } = defaultEffectJson("Crop", "TEMPLATE00");
      const crop = {
        ...json,
        left: side((b) => Math.max(0, (pw - b.w) / (2 * pw))),
        right: side((b) => Math.max(0, (pw - b.w) / (2 * pw))),
        top: side((b) => Math.max(0, (ph - b.h) / (2 * ph))),
        bottom: side((b) => Math.max(0, (ph - b.h) / (2 * ph))),
        resize: false,
      } as Omit<Effect, "id">;
      el = { ...el, effects: [crop] };
      elements.push(el);
    }
    return { elements, cues: [0, ...at.slice(1, fit)], ...(warnings.length > 0 ? { warnings } : {}) };
  },
};
