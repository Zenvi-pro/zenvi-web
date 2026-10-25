/**
 * crop_labels: a shot fills the frame and pushes in slowly; labelled crop
 * boxes snap onto it one per beat (a thin box with corner ticks and a tag:
 * DETAIL 01, DETAIL 02…). Given time, on the next beat a paper scrim covers
 * the shot and the crops lift out of it, each the picture under its box (the
 * same moment of the same file, cropped with libopenshot's Crop), gliding
 * into a row of labelled tiles.
 */

import { backdrop, cued, drawing, enter, key, mediaCard, mediaFill, pose, type Layout } from "../elements.js";
import { textWidth } from "../text.js";
import { refuse, type NormBox, type TemplateInput, type TemplateOutput, type TemplateSpec } from "../template.js";
import type { CropWindow, Element, MotionMedia } from "../types.js";

const MAX_BOXES = 5;
/** The shot's push-in over the template. */
const PUSH = 1.06;

/** A spread of boxes that keeps clear of the frame's edges and of each other. */
function defaultBoxes(layout: Layout, count: number): NormBox[] {
  const { W, H, portrait } = layout;
  const side = Math.min(W, H) * (portrait ? 0.34 : 0.3);
  const w = side / W;
  const h = side / H;
  const spots = portrait
    ? [
        [0.3, 0.3],
        [0.68, 0.46],
        [0.34, 0.63],
        [0.7, 0.75],
        [0.5, 0.18],
      ]
    : [
        [0.27, 0.38],
        [0.55, 0.64],
        [0.78, 0.33],
        [0.42, 0.24],
        [0.8, 0.72],
      ];
  return spots.slice(0, count).map(([x, y]) => ({ x: x!, y: y!, w, h }));
}

/** The crop window of `media` under a frame box, with the frame-filling picture zoomed by `z`. */
function windowUnder(media: MotionMedia, layout: Layout, box: { x0: number; y0: number; w: number; h: number }, z: number): CropWindow {
  const { W, H } = layout;
  const scale = Math.max(W / media.width, H / media.height) * z;
  const dw = media.width * scale;
  const dh = media.height * scale;
  const dx = (W - dw) / 2;
  const dy = (H - dh) / 2;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return { left: clamp((box.x0 - dx) / dw), right: clamp(1 - (box.x0 + box.w - dx) / dw), top: clamp((box.y0 - dy) / dh), bottom: clamp(1 - (box.y0 + box.h - dy) / dh) };
}

export const cropLabels: TemplateSpec = {
  id: "crop_labels",
  summary:
    "A shot fills the frame and pushes in; labelled crop boxes snap onto it one per beat; then a paper scrim covers it and the crops lift out of the shot into a row of labelled tiles.",
  reads: "file_ids (the shot: the first file), boxes (frame boxes, 0-1; default a spread), labels (one per box; default DETAIL 01…), tag (the default labels' prefix), variant (boxes: no row)",
  media: "required",
  beats: (content) => (content.boxes?.length ?? Math.max(3, content.labels?.length ?? 3)) + (content.variant === "boxes" ? 2 : 5),
  build(input: TemplateInput): TemplateOutput {
    const { content, palette, layout, frames, beats, media, frame } = input;
    const { W, H, u, m, portrait } = layout;
    const file = content.fileIds?.[0];
    if (!file) refuse("crop_labels needs file_ids: the shot to label");
    if (content.variant !== undefined && content.variant !== "boxes" && content.variant !== "row") refuse("crop_labels variant is boxes or row");
    const shot = media.get(file) as MotionMedia;
    const count = content.boxes?.length ?? Math.min(MAX_BOXES, Math.max(3, content.labels?.length ?? 3));
    if (count > MAX_BOXES) refuse(`crop_labels draws at most ${MAX_BOXES} boxes`);
    const boxes = (content.boxes ?? defaultBoxes(layout, count)).map((b) => {
      const w = Math.min(b.w * W, W - 2 * m);
      const h = Math.min(b.h * H, H - 2 * m);
      const x0 = Math.max(m, Math.min(W - m - w, b.x * W - w / 2));
      const y0 = Math.max(m * 1.6, Math.min(H - m - h, b.y * H - h / 2));
      return { x0, y0, w, h };
    });
    const prefix = (content.tag?.trim() || "DETAIL").toUpperCase().replace(/\s+/g, " ");
    const labels = boxes.map((_, i) => (content.labels?.[i]?.trim() || `${prefix} ${String(i + 1).padStart(2, "0")}`).toUpperCase());

    const elements: Element[] = [];
    const shotKeys = [key(0, pose(W / 2, H / 2)), key(frames - 1, pose(W / 2, H / 2, { s: PUSH }), "linear")];
    const shotEl = mediaFill("crops-shot", 0, 0, frames, shot, frame.fps, layout, shotKeys);
    elements.push(shotEl);
    const zoomAt = (f: number) => 1 + (PUSH - 1) * Math.max(0, Math.min(1, f / Math.max(1, frames - 1)));

    const enters = beats.entrances(boxes.length, frames, 6);
    const rowBeat = beats.beatAfter(enters[enters.length - 1]!) + beats.step;
    const rowAt = beats.frame(rowBeat);
    const lift = Math.max(8, Math.min(16, beats.span(rowBeat, beats.step) - 2));
    const row = content.variant !== "boxes" && rowAt + lift + 10 <= frames;

    // The boxes: a hairline of contrast, the accent box, corner ticks, a tag.
    const stroke = Math.max(2, 3 * u);
    const tagSize = Math.round(24 * u);
    boxes.forEach((b, i) => {
      const from = enters[i]!;
      if (from >= frames) return;
      const to = row ? Math.min(frames, rowAt + 5) : frames;
      const tagW = textWidth(labels[i]!, { size: tagSize, font: "mono", tracking: 0.04 }) + tagSize * 1.2;
      const tagH = tagSize * 1.7;
      const tick = Math.min(b.w, b.h) * 0.14;
      const pad = tagH + 8 * u;
      const dw = Math.max(b.w + 2 * pad, tagW + pad);
      const dh = b.h + 2 * pad;
      const ox = pad;
      const oy = pad;
      const keys = enter(pose(b.x0 - ox + dw / 2, b.y0 - oy + dh / 2), from, { s: 1.12, frames: 5, ease: "out_strong" });
      if (row) keys.push(key(rowAt, keys[keys.length - 1]!.pose, "smooth"), key(Math.min(frames - 1, rowAt + 5), { ...keys[keys.length - 1]!.pose, alpha: 0 }, "out"));
      elements.push(
        drawing(`crops-box-${i + 1}`, 2 + i, from, to, { width: dw, height: dh }, (d) => {
          d.rect(ox - stroke, oy - stroke, b.w + 2 * stroke, b.h + 2 * stroke, { stroke: "#ffffff", strokeWidth: stroke * 0.6, strokeOpacity: 0.7 });
          d.rect(ox, oy, b.w, b.h, { stroke: palette.accent, strokeWidth: stroke });
          for (const [cx, cy, sx, sy] of [
            [ox, oy, 1, 1],
            [ox + b.w, oy, -1, 1],
            [ox, oy + b.h, 1, -1],
            [ox + b.w, oy + b.h, -1, -1],
          ] as const) {
            d.polyline(
              [
                [cx - sx * stroke * 2, cy + sy * tick],
                [cx - sx * stroke * 2, cy - sy * stroke * 2],
                [cx + sx * tick, cy - sy * stroke * 2],
              ],
              { stroke: palette.accent, strokeWidth: stroke * 1.8 },
            );
          }
          d.rect(ox - stroke, oy - tagH - stroke * 2, tagW, tagH, { fill: palette.accent });
          d.text(ox - stroke + tagSize * 0.6, oy - stroke * 2 - tagH / 2 + tagSize * 0.36, labels[i]!, { size: tagSize, font: "mono", bold: true, fill: palette.accentInk, tracking: 0.04 });
        }, keys),
      );
    });

    const cues = [...enters];
    if (row) {
      // The scrim, then each crop lifting out of the shot into the row.
      elements.push(backdrop("crops-scrim", 1, rowAt, frames, layout, (d) => d.rect(0, 0, W, H, { fill: palette.background, fillOpacity: 0.94 }), enter(pose(W / 2, H / 2), rowAt, { frames: 8, ease: "out" })));
      const gap = W * (portrait ? 0.035 : 0.03);
      const aspects = boxes.map((b) => b.w / b.h);
      const sum = aspects.reduce((a, b) => a + b, 0);
      const tileH = Math.min((W - 2 * m - gap * (boxes.length - 1)) / sum, H * (portrait ? 0.24 : 0.36), W * (portrait ? 0.34 : 0.24));
      const rowW = sum * tileH + gap * (boxes.length - 1);
      const rowY = H * (portrait ? 0.46 : 0.46);
      let x = (W - rowW) / 2;
      const z = zoomAt(rowAt);
      const shotStart = shotEl.source.kind === "media" ? shotEl.source.start + (rowAt / frame.fps) * shotEl.source.speed : 0;
      const labelSize = Math.round(27 * u);
      const slots: { x: number; w: number }[] = [];
      boxes.forEach((b, i) => {
        const tw = aspects[i]! * tileH;
        const slotX = x + tw / 2;
        slots.push({ x: slotX, w: tw });
        x += tw + gap;
        const crop = windowUnder(shot, layout, b, z);
        const rest = pose(b.x0 + b.w / 2, b.y0 + b.h / 2);
        const moved = pose(slotX, rowY, { s: tw / b.w });
        elements.push(
          mediaCard(`crops-tile-${i + 1}`, 2 + boxes.length + i, rowAt, frames, shot, frame.fps, { width: b.w, radius: 0, crop, start: shotStart }, [
            key(rowAt, rest),
            key(Math.min(frames - 1, rowAt + lift), moved, "in_out"),
          ]),
        );
      });
      // Labels under the tiles: index and name.
      const labelsAt = Math.min(frames - 1, rowAt + lift);
      const labelTop = rowY + tileH / 2 + 22 * u;
      elements.push(
        cued(drawing("crops-row-labels", 2 + 2 * boxes.length, labelsAt, frames, { width: W, height: labelSize * 4 }, (d) => {
          slots.forEach((slot, i) => {
            d.line(slot.x - slot.w / 2, 2 * u, slot.x + slot.w / 2, 2 * u, { stroke: palette.ink, strokeWidth: 2 * u });
            d.text(slot.x - slot.w / 2, labelSize * 1.6, String(i + 1).padStart(2, "0"), { size: labelSize, font: "mono", bold: true, fill: palette.accent });
            d.text(slot.x + slot.w / 2, labelSize * 1.6, labels[i]!, { size: labelSize * 0.86, font: "mono", fill: palette.ink, anchor: "end", tracking: 0.02 });
          });
        }, enter(pose(W / 2, labelTop + labelSize * 2), labelsAt, { dy: 14 * u, frames: 8 })), rowAt),
      );
      cues.push(rowAt);
    }
    return { elements, cues };
  },
};
