/**
 * step_card: one step of a tutorial. The footage rises into a rounded card
 * with an ink border and a hard offset shadow (a darker copy under it); on
 * the next beat the step caption pops in under the card (a numbered badge
 * and the text in a bordered label); on the one after, a small label box
 * appears beside the card and an arrow draws from it to a point in the
 * footage (`tag`, `points[0]`).
 *
 *   landscape  the card on the left two thirds, the caption beside it, the
 *              header (hook) along the top
 *   portrait   a vertical stack filling the safe area: the header on its top
 *              line, the footage in a tall 4:5 card with the label box on its
 *              top edge, the caption on the bottom third
 */

import { arrowhead } from "../shapes.js";
import { cropToAspect, cued, drawing, enter, inWindow, key, mediaCard, Motion, pose, textBox, textElement, type TextBlock } from "../elements.js";
import { centredWidth, fitType, typeSize } from "../layout.js";
import { clampText, ROOMY, textWidth } from "../text.js";
import { refuse, type TemplateInput, type TemplateOutput, type TemplateSpec } from "../template.js";
import type { Element, MotionMedia } from "../types.js";

/** Card aspects the footage is cropped into: no taller than 4:5, no wider than 16:9; portrait cards are 4:5. */
const TALLEST = 4 / 5;
const WIDEST = 16 / 9;

export const stepCard: TemplateSpec = {
  id: "step_card",
  summary:
    "A tutorial step: the footage rises into a rounded card with an ink border and a hard shadow, a numbered caption pops in under it, then a small label box appears and an arrow draws from it to a point in the footage.",
  reads: "file_ids (the step's footage: the first file), text (the caption), step (its number, default 1), tag (the label box's text), points (where the arrow points in the footage, 0-1; the card's crop keeps it in view; default the card's upper right), subtitle (a still header at the top, e.g. the video's hook)",
  media: "required",
  beats: (content) => (content.tag ? 8 : 6),
  build(input: TemplateInput): TemplateOutput {
    const { content, palette, layout, frames, beats, media, frame } = input;
    const { W, H, u, m, portrait, safe } = layout;
    const file = content.fileIds?.[0];
    if (!file) refuse("step_card needs file_ids: the step's footage");
    const caption = (content.text ?? "").replace(/\s+/g, " ").trim();
    if (!caption) refuse("step_card needs text: the step's caption");
    const step = content.step ?? 1;
    const m0 = media.get(file) as MotionMedia;
    const own = m0.width / m0.height;
    const aspect = portrait ? TALLEST : Math.max(TALLEST, Math.min(WIDEST, own));
    // A point given on the footage keeps its subject in the card: the crop centres on it.
    const focus = content.points?.[0];
    const crop = cropToAspect(m0, aspect, focus);
    const e0 = beats.frame(0);
    const [e1, e2] = [beats.frame(beats.step), beats.frame(2 * beats.step)];
    const radius = 26 * u;
    const border = 5 * u;
    const off = 14 * u;
    const elements: Element[] = [];

    // A header (the video's hook) on the top line: still, so it carries across steps.
    const header = content.subtitle?.replace(/\s+/g, " ").trim();
    let headerBottom = portrait ? safe.top - 40 * u : m;
    if (header) {
      const style = { font: "sans" as const, bold: true, tracking: -0.02 };
      const fitted = fitType(layout, "heading", header, style, { width: (portrait ? centredWidth(layout) : W - 2.4 * m) / ROOMY, max: (portrait ? 92 : 84) * u, maxLines: 2, leading: 1.04 });
      const block: TextBlock = { lines: fitted.lines, size: fitted.size, ...style, fill: palette.ink, anchor: portrait ? "middle" : "start", leading: 1.04 };
      const capTop = portrait ? safe.top : m * 1.2;
      const box = textBox(block, portrait ? W / 2 : m * 1.2, capTop + 0.75 * fitted.size);
      elements.push(textElement("step-header", 7, 0, frames, block, box));
      headerBottom = capTop + 0.75 * fitted.size + (fitted.lines.length - 1) * 1.04 * fitted.size + 0.28 * fitted.size;
    }

    // The caption's type: a numbered badge and the text (a second line when it is long).
    const capStyle = { font: "sans" as const, bold: true };
    const capMax = (portrait ? 64 : 46) * u;
    const badge = typeSize(layout, "body", capMax) * 1.5;
    const tag = content.tag?.replace(/\s+/g, " ").trim() ?? "";
    const tagSize = typeSize(layout, "body", (portrait ? 48 : 34) * u);
    const tagH = tagSize * 2;

    // The card: portrait as big as the stack allows (label, card, caption), centred under the header; landscape on the left two thirds.
    let cw: number;
    let cx: number;
    let cy: number;
    let capW: number;
    if (portrait) {
      capW = centredWidth(layout);
      const capFit = fitType(layout, "body", caption, capStyle, { width: (capW - badge - capMax * 1.6) / ROOMY, max: capMax, maxLines: 2 });
      const capH = Math.max(badge + capFit.size * 0.5, capFit.lines.length * capFit.size * 1.15 + capFit.size * 0.8) + 8 * u;
      // The label box sits on the card's top edge, a third of it over the footage.
      const tagRow = tag ? tagH * 0.67 + 24 * u : 0;
      const stageTop = headerBottom + 40 * u;
      const room = safe.bottom - stageTop - tagRow - 44 * u - capH;
      const ch = Math.min(room, (W * 0.84) / aspect);
      cw = ch * aspect;
      cx = W / 2;
      cy = stageTop + (safe.bottom - stageTop - (tagRow + ch + 44 * u + capH)) / 2 + tagRow + ch / 2;
    } else {
      const tagRow = tag ? tagH + 40 * u : 0;
      const cardTop = headerBottom + 30 * u + tagRow;
      const ch = Math.min(H * 0.62, H - m - cardTop, (W * 0.5) / aspect);
      cw = ch * aspect;
      cx = W * 0.37;
      cy = Math.max(H * 0.52, cardTop + ch / 2);
      capW = W - cx - cw / 2 - 2 * m;
    }
    const ch = cw / aspect;
    const rise = enter(pose(cx, cy), e0, { dy: H * 0.3, s: 0.94, rotation: 3, alpha: 1, frames: 14, ease: "out_back" });

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
    const textMax = capW - badge - capMax * 1.6;
    const fitted = fitType(layout, "body", caption, capStyle, { width: textMax / ROOMY, max: capMax, maxLines: portrait ? 2 : 1 });
    const size = fitted.size;
    const shown = fitted.lines.map((line) => clampText(line, { ...capStyle, size }, textMax / ROOMY));
    const tw = Math.max(...shown.map((line) => textWidth(line, { ...capStyle, size }))) * ROOMY;
    const capLead = size * 1.15;
    const lw = badge + tw + capMax * 1.4;
    const lh = Math.max(badge + size * 0.5, shown.length * capLead + size * 0.8);
    const lx = portrait ? W / 2 : cx + cw / 2 + m * 0.6 + lw / 2;
    const ly = portrait ? cy + ch / 2 + 44 * u + lh / 2 : cy - ch * 0.12;
    const capIn = new Motion(enter(pose(lx, ly), e1, { dy: 34 * u, s: 0.9, frames: 10, ease: "out_back" }));
    elements.push(
      drawing("step-caption", 3, e1, frames, { width: lw + 2 * off, height: lh + 2 * off }, (d) => {
        d.rect(off + 8 * u, off + 8 * u, lw, lh, { fill: palette.ink, rx: 18 * u });
        d.rect(off, off, lw, lh, { fill: palette.surface, stroke: palette.ink, strokeWidth: 4 * u, rx: 18 * u });
        const bx = off + capMax * 0.45 + badge / 2;
        const by = off + lh / 2;
        const badgeSize = badge / 1.5;
        d.circle(bx, by, badge / 2, { fill: palette.accent });
        d.text(bx, by + badgeSize * 0.36, String(step), { size: badgeSize, font: "sans", bold: true, fill: palette.accentInk, anchor: "middle" });
        const first = by - ((shown.length - 1) * capLead) / 2 + size * 0.36;
        shown.forEach((line, k) => d.text(bx + badge / 2 + capMax * 0.45, first + k * capLead, line, { size, ...capStyle, fill: palette.ink }));
      }, capIn.keys),
    );

    // The label box and its arrow.
    const cues = [e0, e1];
    if (tag && e2 + 12 <= frames) {
      const target = focus ? inWindow(focus, crop) : { x: 0.7, y: 0.32 };
      const tx = cx - cw / 2 + target.x * cw;
      const ty = cy - ch / 2 + target.y * ch;
      const text = clampText(tag, { size: tagSize, font: "sans", bold: true }, (safe.right - safe.left) * 0.8 - tagSize * 1.4);
      const bw = textWidth(text, { size: tagSize, font: "sans", bold: true }) * ROOMY + tagSize * 1.4;
      const bh = tagH;
      // On the card's top edge toward the target (portrait), above-right of the target (landscape), inside the safe area.
      const bx = Math.max(safe.left + bw / 2, Math.min(safe.right - bw / 2, portrait ? tx + (target.x > 0.5 ? -bw * 0.15 : bw * 0.15) : tx + cw * 0.18));
      const by = portrait ? cy - ch / 2 - bh * 0.17 : Math.max(headerBottom + 30 * u + bh / 2, cy - ch / 2 - 70 * u);
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
