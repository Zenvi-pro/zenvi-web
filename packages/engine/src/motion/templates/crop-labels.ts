/**
 * crop_labels: a shot fills the frame and pushes in slowly; labelled crop
 * boxes snap onto it one per beat (a thin box with corner ticks and a tag:
 * DETAIL 01, DETAIL 02…). Given time, on the next beat a paper scrim covers
 * the shot and the crops lift out of it, each the picture under its box (the
 * same moment of the same file, cropped with libopenshot's Crop), gliding
 * into labelled tiles: a row across a landscape frame, a column of big tiles
 * with their labels beside them in portrait. Boxes and tags stay inside the
 * safe area (layout.ts).
 */

import { backdrop, cued, drawing, enter, key, mediaCard, mediaFill, pose } from "../elements.js";
import { typeSize, type Layout } from "../layout.js";
import type { Drawing } from "../svg.js";
import { clampText, fitSize, textWidth } from "../text.js";
import { refuse, type NormBox, type TemplateInput, type TemplateOutput, type TemplateSpec } from "../template.js";
import type { CropWindow, Element, MotionMedia } from "../types.js";

const MAX_BOXES = 5;
/** The shot's push-in over the template. */
const PUSH = 1.06;

/** A spread of boxes that keeps clear of the safe area's edges and of each other (`tag`: room a box's tag takes above it). */
function defaultBoxes(layout: Layout, count: number, tag: number): NormBox[] {
  const { W, H, portrait, safe } = layout;
  const side = Math.min(W, H) * (portrait ? 0.34 : 0.3);
  const w = side / W;
  const h = side / H;
  if (portrait) {
    // Down the safe area, alternating sides.
    const first = (safe.top + tag + side / 2) / H;
    const last = (safe.bottom - side / 2) / H;
    return Array.from({ length: count }, (_, k) => ({ x: k % 2 === 0 ? 0.32 : 0.68, y: count === 1 ? (first + last) / 2 : first + (k * (last - first)) / (count - 1), w, h }));
  }
  const spots = [
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
    "A shot fills the frame and pushes in; labelled crop boxes snap onto it one per beat; then a paper scrim covers it and the crops lift out of the shot into labelled tiles: a row, or a column of big tiles on vertical video.",
  reads: "file_ids (the shot: the first file), boxes (frame boxes, 0-1; default a spread), labels (one per box; default DETAIL 01…), tag (the default labels' prefix), variant (boxes: no row)",
  media: "required",
  beats: (content) => (content.boxes?.length ?? Math.max(3, content.labels?.length ?? 3)) + (content.variant === "boxes" ? 2 : 5),
  build(input: TemplateInput): TemplateOutput {
    const { content, palette, layout, frames, beats, media, frame } = input;
    const { W, H, u, portrait, safe } = layout;
    const file = content.fileIds?.[0];
    if (!file) refuse("crop_labels needs file_ids: the shot to label");
    if (content.variant !== undefined && content.variant !== "boxes" && content.variant !== "row") refuse("crop_labels variant is boxes or row");
    const shot = media.get(file) as MotionMedia;
    const count = content.boxes?.length ?? Math.min(MAX_BOXES, Math.max(3, content.labels?.length ?? 3));
    if (count > MAX_BOXES) refuse(`crop_labels draws at most ${MAX_BOXES} boxes`);
    const stroke = Math.max(2, 3 * u);
    const tagSize = typeSize(layout, "label", (portrait ? 38 : 34) * u);
    const tagH = tagSize * 1.7;
    const tagRoom = tagH + stroke * 2;
    // Boxes inside the safe area, their tags too.
    const boxes = (content.boxes ?? defaultBoxes(layout, count, tagRoom)).map((b) => {
      const w = Math.min(b.w * W, safe.right - safe.left);
      const h = Math.min(b.h * H, safe.bottom - safe.top - tagRoom);
      const x0 = Math.max(safe.left, Math.min(safe.right - w, b.x * W - w / 2));
      const y0 = Math.max(safe.top + tagRoom, Math.min(safe.bottom - h, b.y * H - h / 2));
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

    // The boxes: a hairline of contrast, the accent box, corner ticks, a tag (cut to the box when it is narrow).
    boxes.forEach((b, i) => {
      const from = enters[i]!;
      if (from >= frames) return;
      const to = row ? Math.min(frames, rowAt + 5) : frames;
      const tagStyle = { size: tagSize, font: "mono" as const, bold: true, tracking: 0.04 };
      const tag = clampText(labels[i]!, tagStyle, Math.max(b.w, safe.right - b.x0) - tagSize * 1.2);
      const tagW = textWidth(tag, tagStyle) + tagSize * 1.2;
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
          d.text(ox - stroke + tagSize * 0.6, oy - stroke * 2 - tagH / 2 + tagSize * 0.36, tag, { ...tagStyle, fill: palette.accentInk });
        }, keys),
      );
    });

    const cues = [...enters];
    if (row) {
      // The scrim, then each crop lifting out of the shot into its tile.
      elements.push(backdrop("crops-scrim", 1, rowAt, frames, layout, (d) => d.rect(0, 0, W, H, { fill: palette.background, fillOpacity: 0.94 }), enter(pose(W / 2, H / 2), rowAt, { frames: 8, ease: "out" })));
      const aspects = boxes.map((b) => b.w / b.h);
      const mono = (size: number, bold = false) => ({ size, font: "mono" as const, bold, tracking: 0.02 });
      const indexes = boxes.map((_, i) => String(i + 1).padStart(2, "0"));
      /** Each tile's centre and size on the frame. */
      let slots: { x: number; y: number; w: number; h: number }[];
      let indexSize: number;
      let nameSize: number;
      let labelsDrawing: { width: number; height: number; x: number; y: number; paint: (d: Drawing) => void };
      if (portrait) {
        // A column of tiles down the safe area, each label beside its tile, set as big as the room beside the tiles allows.
        const gap = 36 * u;
        const sideGap = 40 * u;
        const safeW = safe.right - safe.left;
        const tileH = Math.min((safe.bottom - safe.top - 80 * u - gap * (boxes.length - 1)) / boxes.length, ...aspects.map((a) => (safeW * 0.6) / a));
        const widest = Math.max(...aspects) * tileH;
        const room = safeW - widest - sideGap;
        nameSize = typeSize(layout, "body", Math.min(60 * u, fitSize(labels, mono(1), room / 1.02, 60 * u)));
        indexSize = Math.round(nameSize * 1.35);
        const shownW = Math.min(room, Math.max(...labels.map((l) => textWidth(l, mono(nameSize))), ...indexes.map((x) => textWidth(x, mono(indexSize, true)))) * 1.02);
        const left = safe.left + (safeW - (widest + sideGap + shownW)) / 2;
        const columnH = boxes.length * tileH + gap * (boxes.length - 1);
        const top = (safe.top + safe.bottom) / 2 - columnH / 2;
        slots = boxes.map((_, i) => ({ x: left + (aspects[i]! * tileH) / 2, y: top + i * (tileH + gap) + tileH / 2, w: aspects[i]! * tileH, h: tileH }));
        const lx = left + widest + sideGap;
        labelsDrawing = {
          width: shownW + 8 * u,
          height: columnH,
          x: lx + (shownW + 8 * u) / 2,
          y: top + columnH / 2,
          paint: (d) => {
            slots.forEach((slot, i) => {
              const y0 = slot.y - slot.h / 2 - top;
              d.line(0, y0 + 2 * u, shownW, y0 + 2 * u, { stroke: palette.ink, strokeWidth: 2 * u });
              d.text(0, y0 + 2 * u + 18 * u + indexSize * 0.75, indexes[i]!, { ...mono(indexSize, true), fill: palette.accent });
              d.text(0, y0 + 2 * u + 18 * u + indexSize * 0.75 + nameSize * 1.35, clampText(labels[i]!, mono(nameSize), shownW), { ...mono(nameSize), fill: palette.ink });
            });
          },
        };
      } else {
        // A row across the frame, labels under the tiles: index left, name right.
        indexSize = typeSize(layout, "body", 34 * u);
        nameSize = typeSize(layout, "label", 30 * u);
        const gap = W * 0.03;
        const m = safe.left;
        const sum = aspects.reduce((a, b) => a + b, 0);
        const tileH = Math.min((W - 2 * m - gap * (boxes.length - 1)) / sum, H * 0.36, W * 0.24);
        const rowW = sum * tileH + gap * (boxes.length - 1);
        const rowY = H * 0.46;
        let x = (W - rowW) / 2;
        slots = boxes.map((_, i) => {
          const tw = aspects[i]! * tileH;
          const slot = { x: x + tw / 2, y: rowY, w: tw, h: tileH };
          x += tw + gap;
          return slot;
        });
        const labelTop = rowY + tileH / 2 + 22 * u;
        labelsDrawing = {
          width: W,
          height: indexSize * 2.4,
          x: W / 2,
          y: labelTop + indexSize * 1.2,
          paint: (d) => {
            slots.forEach((slot, i) => {
              const index = indexes[i]!;
              d.line(slot.x - slot.w / 2, 2 * u, slot.x + slot.w / 2, 2 * u, { stroke: palette.ink, strokeWidth: 2 * u });
              d.text(slot.x - slot.w / 2, indexSize * 1.4, index, { ...mono(indexSize, true), fill: palette.accent });
              const room = slot.w - textWidth(index, mono(indexSize, true)) - indexSize * 0.6;
              d.text(slot.x + slot.w / 2, indexSize * 1.4, clampText(labels[i]!, mono(nameSize), room), { ...mono(nameSize), fill: palette.ink, anchor: "end" });
            });
          },
        };
      }
      const z = zoomAt(rowAt);
      const shotStart = shotEl.source.kind === "media" ? shotEl.source.start + (rowAt / frame.fps) * shotEl.source.speed : 0;
      boxes.forEach((b, i) => {
        const slot = slots[i]!;
        const crop = windowUnder(shot, layout, b, z);
        const rest = pose(b.x0 + b.w / 2, b.y0 + b.h / 2);
        const moved = pose(slot.x, slot.y, { s: slot.w / b.w });
        elements.push(
          mediaCard(`crops-tile-${i + 1}`, 2 + boxes.length + i, rowAt, frames, shot, frame.fps, { width: b.w, radius: 0, crop, start: shotStart }, [
            key(rowAt, rest),
            key(Math.min(frames - 1, rowAt + lift), moved, "in_out"),
          ]),
        );
      });
      // The labels: index and name.
      const labelsAt = Math.min(frames - 1, rowAt + lift);
      const ld = labelsDrawing;
      elements.push(
        cued(drawing("crops-row-labels", 2 + 2 * boxes.length, labelsAt, frames, { width: ld.width, height: ld.height }, ld.paint, enter(pose(ld.x, ld.y), labelsAt, portrait ? { dx: 18 * u, frames: 8 } : { dy: 14 * u, frames: 8 })), rowAt),
      );
      cues.push(rowAt);
    }
    return { elements, cues };
  },
};
