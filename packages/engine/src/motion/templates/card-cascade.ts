/**
 * card_cascade: two to nine rounded video cards dropping onto a field one
 * after another (T030: four cards 6-8 frames apart, a click each), laid out
 * in a staggered grid (odd columns sit lower: a cascade, not a spreadsheet;
 * where that would be one column, a zig-zag of overlapping cards),
 * each with a soft shadow, a white edge and a slight tilt, then a slow push
 * in until the end.
 *
 *   timing    one card per half beat (7-8 frames at 120 BPM), each landing
 *             in 7 frames (scale 1.25 → 1, out_strong: it drops onto the
 *             table); the receipt's cues are the landings, for clicks
 *   field     variant paper (the palette's background, default), blur (a
 *             blurred, dimmed copy of the first clip: T033's raw clip over
 *             its own blur) or none (over the video below)
 *   sound     with `sound`, each card plays its own sound until the next one
 *             lands (the last to the end): the newest card is the one heard
 */

import { cropToAspect, drawing, enter, mediaCard, Motion, pose, zoomed } from "../elements.js";
import type { Layout } from "../layout.js";
import { cardFrame, cardFramePad, type CardFrameStyle } from "../shapes.js";
import { refuse, type TemplateInput, type TemplateOutput, type TemplateSpec } from "../template.js";
import type { Element, MediaSource, MotionMedia, Pose } from "../types.js";
import { backdrop } from "../elements.js";
import { blurredBackdrop, chipSize } from "./layout-parts.js";

const MAX_CARDS = 9;
/** Frames a card takes to land. */
const LAND = 7;
/** Odd columns sit this share of a card's height lower. */
const STAGGER = 0.2;
/** Camera push over the hold. */
const PUSH = 1.04;
const TILTS = [-2.5, 1.8, -1.2, 2.6, -1.8, 1.2, -2.2, 2, -1.5];
export const CASCADE_VARIANTS = ["paper", "blur", "none"] as const;

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

function regionOf(layout: Layout): Region {
  const { safe } = layout;
  return { x: safe.left, y: safe.top, w: safe.right - safe.left, h: safe.bottom - safe.top };
}

/** The card aspect: the middle of the clips' aspects, between 9:16 and 16:9. */
function cardAspect(media: readonly MotionMedia[]): number {
  const sorted = media.map((m) => m.width / m.height).sort((a, b) => a - b);
  return Math.min(16 / 9, Math.max(9 / 16, sorted[Math.floor(sorted.length / 2)]!));
}

/** Columns, rows and card size that make the cards largest in `region`. */
export function cascadeGrid(count: number, aspect: number, region: Region, gap: number): { cols: number; rows: number; w: number; h: number } {
  let best = { cols: 1, rows: count, w: 0, h: 0 };
  for (let cols = 1; cols <= count; cols += 1) {
    const rows = Math.ceil(count / cols);
    const lift = cols > 1 ? STAGGER : 0;
    const h = Math.min((region.h - (rows - 1) * gap) / (rows + lift), (region.w - (cols - 1) * gap) / cols / aspect);
    if (h * aspect * h > best.w * best.h + 1e-6) best = { cols, rows, w: h * aspect, h };
  }
  return best;
}

/** Each card's resting pose, in landing order (reading order; an incomplete last row is centred). */
function places(count: number, grid: ReturnType<typeof cascadeGrid>, region: Region, gap: number): Pose[] {
  const { cols, rows, w, h } = grid;
  const lift = cols > 1 ? STAGGER * h : 0;
  const totalW = cols * w + (cols - 1) * gap;
  const totalH = rows * h + (rows - 1) * gap + lift;
  const x0 = region.x + (region.w - totalW) / 2;
  const y0 = region.y + (region.h - totalH) / 2;
  return Array.from({ length: count }, (_, i) => {
    const r = Math.floor(i / cols);
    const inRow = r === rows - 1 ? count - r * cols : cols;
    const c = i % cols;
    const shift = ((cols - inRow) * (w + gap)) / 2;
    return pose(x0 + shift + c * (w + gap) + w / 2, y0 + r * (h + gap) + h / 2 + (c % 2) * lift, { rotation: TILTS[i % TILTS.length]! });
  });
}

/**
 * A zig-zag cascade where a grid would be one column (a tall frame, wide
 * clips): cards overlap down the frame, alternately left and right, each
 * landing over the one before.
 */
function zigzag(count: number, aspect: number, region: Region): { size: { w: number; h: number }; rests: Pose[] } {
  const w = Math.min(region.w * 0.7, region.h * 0.42 * aspect);
  const h = w / aspect;
  const step = Math.min(h * 0.82, (region.h - h) / (count - 1));
  const top = region.y + (region.h - h - step * (count - 1)) / 2 + h / 2;
  const swing = (region.w - w) / 2;
  return { size: { w, h }, rests: Array.from({ length: count }, (_, i) => pose(region.x + region.w / 2 + (i % 2 === 0 ? -swing : swing), top + i * step, { rotation: TILTS[i % TILTS.length]! })) };
}

export const cardCascade: TemplateSpec = {
  id: "card_cascade",
  summary:
    "Two to nine rounded video cards (shadow, white edge, a slight tilt) drop onto a field one per half beat in a staggered grid, then the camera pushes in slowly; the field is paper, a blurred copy of the first clip, or the video below.",
  reads: "file_ids (the cards, in landing order), labels (a chip on each card), variant (paper | blur | none: the field), sound (each card heard until the next one lands)",
  media: "required",
  beats: (content) => {
    const n = Math.max(2, Math.min(MAX_CARDS, content.fileIds?.length ?? 2));
    const total = Math.ceil(n / 2) + 3;
    return total + (total % 2);
  },
  build(input: TemplateInput): TemplateOutput {
    const { content, palette, layout, frames, beats, media, frame } = input;
    const { W, H, u } = layout;
    const files = (content.fileIds ?? []).map((id) => media.get(id) as MotionMedia);
    if (files.length < 2) refuse("card_cascade needs 2 to 9 file_ids (the cards); for one card use ui_cards");
    if (files.length > MAX_CARDS) refuse(`card_cascade shows at most ${MAX_CARDS} cards`);
    const variant = content.variant ?? (content.backdrop === false ? "none" : "paper");
    if (!(CASCADE_VARIANTS as readonly string[]).includes(variant)) refuse(`card_cascade variant is ${CASCADE_VARIANTS.join(", ")} (got ${variant})`);
    const count = files.length;
    const region = regionOf(layout);
    const gap = Math.round(36 * u);
    const aspect = cardAspect(files);
    const fitted = cascadeGrid(count, aspect, region, gap);
    const zig = fitted.cols === 1 && count >= 3 ? zigzag(count, aspect, region) : null;
    const grid = zig ? zig.size : fitted;
    const rests = zig ? zig.rests : places(count, fitted, region, gap);
    const radius = Math.round(Math.min(grid.w, grid.h) * 0.06);
    const style: CardFrameStyle = {
      radius,
      border: { color: "#ffffff", width: Math.max(2, 4 * u) },
      shadow: { color: palette.shadow, opacity: palette.shadowOpacity * 1.6, offset: 12 * u },
    };
    const pad = cardFramePad(style);

    // One card per half beat; when that runs past the end, the beat grid's own spacing.
    const halves = Array.from({ length: count }, (_, i) => beats.frame(i * 0.5));
    const enters = halves[count - 1]! + LAND <= frames ? halves : beats.entrances(count, frames, LAND);
    const pushFrom = enters[count - 1]! + LAND + 2;

    const elements: Element[] = [];
    if (variant === "paper") elements.push(backdrop("cascade-bg", 0, 0, frames, layout, (d) => d.rect(0, 0, W, H, { fill: palette.background })));
    else if (variant === "blur") elements.push(blurredBackdrop("cascade-bg", 0, 0, frames, files[0]!, frame.fps, layout));
    const labels = content.labels ?? [];
    for (let i = 0; i < count; i += 1) {
      const rest = rests[i]!;
      const at = enters[i]!;
      const motion = new Motion(enter(rest, at, { s: 1.25, alpha: 0, rotation: -rest.rotation, frames: LAND, ease: "out_strong" }));
      if (pushFrom < frames - 2) motion.stay(pushFrom).to(frames - 1, zoomed(motion.pose, PUSH, layout), "smooth");
      const keys = motion.keys;
      const m = files[i]!;
      const crop = cropToAspect(m, grid.w / grid.h);
      let card = mediaCard(`card-${i + 1}`, 1 + 2 * i, at, frames, m, frame.fps, { width: grid.w, radius, ...(crop ? { crop } : {}) }, keys);
      if (content.sound && m.kind === "video") {
        const next = enters[i + 1];
        card = { ...card, source: { ...(card.source as MediaSource), sound: true, ...(next !== undefined && next > at ? { soundTo: next } : {}) } };
      }
      elements.push({ ...card, cue: at });
      const label = labels[i]?.trim() ?? "";
      const chip = label ? chipSize(layout, label, grid.w * 0.8) : null;
      elements.push({
        ...drawing(`card-${i + 1}-frame`, 2 + 2 * i, at, card.to, { width: grid.w + 2 * pad, height: grid.h + 2 * pad }, (d) => {
          cardFrame(d, pad, pad, grid.w, grid.h, style);
          if (!chip) return;
          const inset = 18 * u;
          d.rect(pad + inset, pad + inset, chip.w, chip.h, { fill: "#ffffff", fillOpacity: 0.94, rx: chip.h / 2 });
          d.text(pad + inset + chip.w / 2, pad + inset + chip.h / 2 + chip.size * 0.36, chip.text, { size: chip.size, font: "sans", bold: true, fill: "#14161c", anchor: "middle" });
        }, keys),
        cue: at,
      });
    }
    return { elements, cues: [...enters] };
  },
};
