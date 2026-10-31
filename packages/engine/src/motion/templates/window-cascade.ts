/**
 * window_cascade: two to six clips in skewed parallelogram windows (T045's
 * staccato burst framed as slanted panes), the panes arriving a few frames
 * apart on one beat, alternately from above and below, then one pane
 * snapping to full bleed on a later beat.
 *
 * Each pane is the clip drawn to cover the frame, centred on its pane, seen
 * through a polygon window (a Mask effect reading the pane's distance field,
 * looks/masks.ts): a clean slanted edge, the picture itself not sheared.
 * Across a wide frame the panes are columns leaning right; down a tall one,
 * rows leaning up. The full-bleed pane (the middle one, or `highlight`)
 * slides to the centre and punches in (1.3×) while its window grows, the
 * last two frames filling the rest of the frame, then settles back to the
 * frame's size.
 */

import { backdrop, enter, mediaCard, Motion, pose } from "../elements.js";
import { refuse, type TemplateInput, type TemplateOutput, type TemplateSpec } from "../template.js";
import type { Element, MediaSource, MotionMedia, WindowKey } from "../types.js";
import { BLEED, coverWidth, fullBleed, onPicture } from "./layout-parts.js";

const MAX_PANES = 6;
/** Frames between one pane's arrival and the next's. */
const STAGGER = 3;
/** Frames a pane takes to arrive. */
const TRAVEL = 9;
/** How far a pane's edge leans, degrees from upright. */
const LEAN = 14;

export const windowCascade: TemplateSpec = {
  id: "window_cascade",
  summary:
    "Two to six clips in skewed parallelogram windows (clean slanted edges, pictures not sheared) arriving a few frames apart on one beat from alternate sides, then one pane slides to the centre and fills the frame (full bleed) on a later beat.",
  reads: "file_ids (the panes, left to right or top to bottom), highlight (0-based pane that goes full bleed; default the middle one)",
  media: "required",
  beats: () => 4,
  build(input: TemplateInput): TemplateOutput {
    const { content, palette, layout, frames, beats, media, frame } = input;
    const { W, H, u, m, portrait } = layout;
    const files = (content.fileIds ?? []).map((id) => media.get(id) as MotionMedia);
    if (files.length < 2 || files.length > MAX_PANES) refuse(`window_cascade takes 2 to ${MAX_PANES} file_ids (got ${files.length})`);
    const count = files.length;
    const hero = content.highlight ?? Math.floor((count - 1) / 2);
    if (hero < 0 || hero >= count) refuse(`window_cascade highlight is a pane index, 0 to ${count - 1}`);
    const fps = frame.fps;
    const first = beats.frame(0);
    const arrivals = Array.from({ length: count }, (_, i) => first + i * STAGGER);
    const landed = arrivals[count - 1]! + TRAVEL;
    if (landed + 2 > frames) refuse(`window_cascade needs at least ${((landed + 2) / fps).toFixed(1)} s for ${count} panes`);
    // Full bleed on the second beat after the panes land (a beat of hold), when it fits.
    const bleedAt = beats.frame(beats.beatAfter(landed) + 1);
    const bleeds = bleedAt + BLEED + 2 <= frames;
    const warnings = bleeds ? [] : [`window_cascade: no time for the full-bleed move after the panes land; give a longer duration (about ${((bleedAt + BLEED + 2) / fps).toFixed(1)} s) for it`];

    // Panes along the long axis: `across` is the axis they are laid along, `along` the one they span.
    const across = portrait ? H : W;
    const span = (portrait ? W : H) - 2 * m;
    const lean = Math.tan((LEAN * Math.PI) / 180) * span;
    const gap = Math.round(22 * u);
    const pane = (across - 2 * m - lean - (count - 1) * gap) / count;
    if (pane < 40 * u) refuse(`window_cascade: ${count} panes are too narrow on this frame; give fewer file_ids`);

    const elements: Element[] = [backdrop("window-bg", 0, 0, frames, layout, (d) => d.rect(0, 0, W, H, { fill: palette.background }))];
    for (let i = 0; i < count; i += 1) {
      const mid = m + lean / 2 + pane / 2 + i * (pane + gap);
      // Corners in frame px: wide frames lean right going up, tall ones lean up going right.
      const quad: [number, number][] = portrait
        ? [
            [m, mid - pane / 2 + lean / 2],
            [W - m, mid - pane / 2 - lean / 2],
            [W - m, mid + pane / 2 - lean / 2],
            [m, mid + pane / 2 + lean / 2],
          ]
        : [
            [mid - pane / 2 + lean / 2, m],
            [mid + pane / 2 + lean / 2, m],
            [mid + pane / 2 - lean / 2, H - m],
            [mid - pane / 2 - lean / 2, H - m],
          ];
      const cx = portrait ? W / 2 : mid;
      const cy = portrait ? mid : H / 2;
      const f = files[i]!;
      const width = coverWidth(f, layout);
      const points = quad.map(([x, y]) => onPicture(f, width, cx, cy, x, y));
      const side = i % 2 === 0 ? -1 : 1;
      const rest = pose(cx, cy);
      const motion = new Motion(enter(rest, arrivals[i]!, { ...(portrait ? { dx: side * W } : { dy: side * H }), alpha: 1, frames: TRAVEL, ease: "out_strong" }));
      const grows = bleeds && i === hero;
      const windowKeys: WindowKey[] = [{ frame: arrivals[i]!, grow: 0, ease: "out" }];
      if (grows) windowKeys.push(...fullBleed(motion, bleedAt, frames, layout));
      const to = bleeds && !grows ? bleedAt + BLEED : frames;
      // The full-bleed pane goes on top: every other pane is under it when it fills the frame.
      const track = grows ? 1 + count : 1 + i;
      const card = mediaCard(`pane-${i + 1}`, track, arrivals[i]!, to, f, fps, { width, radius: 0 }, motion.keys);
      elements.push({ ...card, source: { ...(card.source as MediaSource), window: { points, feather: 0.003, keys: windowKeys } }, cue: first });
    }
    return { elements, cues: bleeds ? [first, bleedAt] : [first], ...(warnings.length > 0 ? { warnings } : {}) };
  },
};
