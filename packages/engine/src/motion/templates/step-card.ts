/**
 * step_card: one step of a tutorial. The footage rises into a rounded card
 * with an ink border and a hard offset shadow (a darker copy under it); on
 * the next beat the step caption pops in under the card (a numbered badge
 * and the text in a bordered label); on the one after, a small label box
 * appears beside the card and an arrow draws from it to a point in the
 * footage (`tag`, `points[0]`).
 */

import { arrowhead } from "../shapes.js";
import { cropToAspect, cued, drawing, enter, key, mediaCard, Motion, pose, textBox, textElement, type TextBlock } from "../elements.js";
import { clampText, fitBlock, fitSize, ROOMY, textWidth } from "../text.js";
import { refuse, type TemplateInput, type TemplateOutput, type TemplateSpec } from "../template.js";
import type { Element, MotionMedia } from "../types.js";

/** Card aspects the footage is cropped into: no taller than 4:5, no wider than 16:9. */
const TALLEST = 4 / 5;
const WIDEST = 16 / 9;

export const stepCard: TemplateSpec = {
  id: "step_card",
  summary:
    "A tutorial step: the footage rises into a rounded card with an ink border and a hard shadow, a numbered caption pops in under it, then a small label box appears and an arrow draws from it to a point in the footage.",
  reads: "file_ids (the step's footage: the first file), text (the caption), step (its number, default 1), tag (the label box's text), points (where the arrow points in the footage, 0-1; default the upper right), subtitle (a still header at the top, e.g. the video's hook)",
  media: "required",
  beats: (content) => (content.tag ? 8 : 6),
  build(input: TemplateInput): TemplateOutput {
    const { content, palette, layout, frames, beats, media, frame } = input;
    const { W, H, u, m, portrait } = layout;
    const file = content.fileIds?.[0];
    if (!file) refuse("step_card needs file_ids: the step's footage");
    const caption = (content.text ?? "").replace(/\s+/g, " ").trim();
    if (!caption) refuse("step_card needs text: the step's caption");
    const step = content.step ?? 1;
    const m0 = media.get(file) as MotionMedia;
    const own = m0.width / m0.height;
    // A portrait frame crops wide footage to 4:3: a bigger card on a phone screen.
    const aspect = Math.max(TALLEST, Math.min(portrait ? 4 / 3 : WIDEST, own));
    const crop = cropToAspect(m0, aspect);

    // The card: portrait centred under the hook area; landscape on the left two thirds.
    const maxW = portrait ? W * 0.86 : W * 0.5;
    const maxH = portrait ? H * 0.42 : H * 0.62;
    const cw = Math.min(maxW, maxH * aspect);
    const ch = cw / aspect;
    const cx = portrait ? W / 2 : W * 0.37;
    const cy = portrait ? H * (ch > H * 0.3 ? 0.47 : 0.45) : H * 0.52;
    const radius = 26 * u;
    const border = 5 * u;
    const off = 14 * u;
    const e0 = beats.frame(0);
    const [e1, e2] = [beats.frame(beats.step), beats.frame(2 * beats.step)];
    const rise = enter(pose(cx, cy), e0, { dy: H * 0.3, s: 0.94, rotation: 3, alpha: 1, frames: 14, ease: "out_back" });
    const elements: Element[] = [];

    // A hard shadow (the card's shape in ink, offset), the footage, the border.
    elements.push(
      drawing("step-shadow", 0, e0, frames, { width: cw + 2 * off, height: ch + 2 * off }, (d) => d.rect(2 * off, 2 * off, cw - border, ch - border, { fill: palette.shadow, fillOpacity: palette.shadowOpacity, rx: radius }), rise),
    );
    const card = mediaCard("step-media", 1, e0, frames, m0, frame.fps, { width: cw, radius, crop }, rise);
    elements.push(card);
    elements.push(
      drawing("step-border", 2, e0, card.to, { width: cw + 2 * border, height: ch + 2 * border }, (d) => d.rect(border * 1.5, border * 1.5, cw - border, ch - border, { stroke: palette.ink, strokeWidth: border, rx: radius - border / 2 }), rise),
    );

    // The caption: a numbered badge and the text in a bordered label.
    const capSize = Math.round((portrait ? 56 : 46) * u);
    const badge = capSize * 1.5;
    const labelMax = portrait ? W - 2 * m : W - cx - cw / 2 - 2 * m;
    const textMax = labelMax - badge - capSize * 1.6;
    const size = fitSize([caption], { font: "sans", bold: true }, textMax / ROOMY, capSize, 22 * u);
    const shown = clampText(caption, { size, font: "sans", bold: true }, textMax / ROOMY);
    const tw = textWidth(shown, { size, font: "sans", bold: true }) * ROOMY;
    const lw = badge + tw + capSize * 1.4;
    const lh = Math.max(badge + capSize * 0.5, size * 1.9);
    const lx = portrait ? W / 2 : cx + cw / 2 + m * 0.6 + lw / 2;
    const ly = portrait ? cy + ch / 2 + 54 * u + lh / 2 : cy - ch * 0.12;
    const capIn = new Motion(enter(pose(lx, ly), e1, { dy: 34 * u, s: 0.9, frames: 10, ease: "out_back" }));
    elements.push(
      drawing("step-caption", 3, e1, frames, { width: lw + 2 * off, height: lh + 2 * off }, (d) => {
        d.rect(off + 8 * u, off + 8 * u, lw, lh, { fill: palette.ink, rx: 18 * u });
        d.rect(off, off, lw, lh, { fill: palette.surface, stroke: palette.ink, strokeWidth: 4 * u, rx: 18 * u });
        const bx = off + capSize * 0.45 + badge / 2;
        const by = off + lh / 2;
        d.circle(bx, by, badge / 2, { fill: palette.accent });
        d.text(bx, by + capSize * 0.36, String(step), { size: capSize, font: "sans", bold: true, fill: palette.accentInk, anchor: "middle" });
        d.text(bx + badge / 2 + capSize * 0.45, by + size * 0.36, shown, { size, font: "sans", bold: true, fill: palette.ink });
      }, capIn.keys),
    );

    // A header (the video's hook) at the top: still, so it carries across steps.
    const header = content.subtitle?.replace(/\s+/g, " ").trim();
    if (header) {
      const fitted = fitBlock(header, { font: "sans", bold: true, tracking: -0.02 }, (W - 2 * m) / ROOMY, H * (portrait ? 0.11 : 0.14), Math.round((portrait ? 66 : 54) * u), 2, 1.04);
      const block: TextBlock = { lines: fitted.lines, size: fitted.size, font: "sans", bold: true, tracking: -0.02, fill: palette.ink, anchor: portrait ? "middle" : "start", leading: 1.04 };
      const box = textBox(block, portrait ? W / 2 : m * 1.2, H * (portrait ? 0.075 : 0.1) + fitted.size * 0.8);
      elements.push(textElement("step-header", 7, 0, frames, block, box));
    }

    // The label box and its arrow.
    const cues = [e0, e1];
    const tag = content.tag?.replace(/\s+/g, " ").trim();
    if (tag && e2 + 12 <= frames) {
      const target = content.points?.[0] ?? { x: 0.7, y: 0.32 };
      const tx = cx - cw / 2 + target.x * cw;
      const ty = cy - ch / 2 + target.y * ch;
      const tagSize = Math.round((portrait ? 38 : 32) * u);
      const text = clampText(tag, { size: tagSize, font: "sans", bold: true }, W * 0.6);
      const bw = textWidth(text, { size: tagSize, font: "sans", bold: true }) * ROOMY + tagSize * 1.4;
      const bh = tagSize * 2;
      // Above the card (portrait), above-right of the target (landscape), kept in frame.
      const bx = Math.max(m + bw / 2, Math.min(W - m - bw / 2, portrait ? tx + (target.x > 0.5 ? -bw * 0.15 : bw * 0.15) : tx + cw * 0.18));
      const by = portrait ? cy - ch / 2 - 96 * u : Math.max(m + bh, cy - ch / 2 - 70 * u);
      elements.push(
        drawing("step-label", 4, e2, frames, { width: bw + 12 * u, height: bh + 12 * u }, (d) => {
          d.rect(8 * u, 8 * u, bw, bh, { fill: palette.ink, rx: 12 * u });
          d.rect(2 * u, 2 * u, bw, bh, { fill: palette.second, stroke: palette.ink, strokeWidth: 3.5 * u, rx: 12 * u });
          d.text(2 * u + bw / 2, 2 * u + bh / 2 + tagSize * 0.36, text, { size: tagSize, font: "sans", bold: true, fill: palette.ink, anchor: "middle" });
        }, enter(pose(bx, by), e2, { s: 0.6, rotation: -6, frames: 9, ease: "out_back" })),
      );
      // The arrow: from under the label to the target, drawn on, then its head.
      const sx = bx;
      const sy = by + bh / 2 + 14 * u;
      const len = Math.hypot(tx - sx, ty - sy) - 12 * u;
      if (len > 20 * u) {
        const angle = Math.atan2(ty - sy, tx - sx);
        const thick = 6 * u;
        const pad = 10 * u;
        const drawAt = e2 + 5;
        const drawEnd = Math.min(frames - 1, drawAt + 9);
        elements.push(
          cued(drawing("step-arrow", 5, drawAt, frames, { width: len + 2 * pad, height: 2 * pad, cx: pad, cy: pad }, (d) => d.line(pad, pad, pad + len, pad, { stroke: palette.accent, strokeWidth: thick, linecap: "round" }), [
            key(drawAt, pose(sx, sy, { rotation: (angle * 180) / Math.PI, sx: 0 })),
            key(drawEnd, pose(sx, sy, { rotation: (angle * 180) / Math.PI }), "out"),
          ]), e2),
        );
        const hx = sx + Math.cos(angle) * len;
        const hy = sy + Math.sin(angle) * len;
        const head = 30 * u;
        elements.push(
          cued(drawing("step-arrowhead", 6, drawEnd, frames, { width: 2 * head, height: 2 * head }, (d) => arrowhead(d, head + Math.cos(angle) * head * 0.45, head + Math.sin(angle) * head * 0.45, angle, head, palette.accent), enter(pose(hx, hy), drawEnd, { s: 0.3, frames: 6, ease: "out_back" })), e2),
        );
      }
      cues.push(e2);
    }
    return { elements, cues };
  },
};
