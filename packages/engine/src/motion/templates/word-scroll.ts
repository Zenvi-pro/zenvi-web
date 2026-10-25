/**
 * word_scroll: a column of big words scrolls up one word per beat, each
 * scroll landing on the beat with the word held in a selection box (corner
 * and side handles, a size readout under it, like a design tool). Words
 * outside the box sit under two bands of the background colour, so only the
 * selected word reads at full strength. An optional lead line (`text`) reads
 * into the word: beside it in landscape ("Made to [Begin]"), above it in
 * portrait. The selected line sits on the safe area's optical centre; words
 * are headings, never under the heading floor (layout.ts).
 */

import { backdrop, cued, drawing, enter, Motion, pose, textBox, textElement, type TextBlock } from "../elements.js";
import type { Drawing } from "../svg.js";
import { centredWidth, fitType, opticalCentre, typeSize } from "../layout.js";
import { clampText, fitSize, ROOMY, textWidth } from "../text.js";
import { refuse, type TemplateInput, type TemplateOutput, type TemplateSpec } from "../template.js";
import type { Element } from "../types.js";

const MIN_WORDS = 2;
const MAX_WORDS = 10;
/** How strongly the bands hide the unselected words. */
const BAND_OPACITY = 0.8;

export const wordScroll: TemplateSpec = {
  id: "word_scroll",
  summary:
    "A column of big words scrolls up one word per beat; each scroll lands on the beat with the word held in a selection box (handles and a size readout), the other words dimmed; an optional lead line reads into the word.",
  reads: "words (2-10, in order), text (a lead line: beside the word in landscape, above it in portrait), backdrop",
  media: "none",
  beats: (content) => Math.max(MIN_WORDS, content.words?.length ?? MIN_WORDS) + 2,
  build(input: TemplateInput): TemplateOutput {
    const { content, palette, layout, frames, beats } = input;
    const { W, H, u, m, portrait } = layout;
    const words = (content.words ?? []).map((w) => w.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (words.length < MIN_WORDS) refuse(`word_scroll needs words: ${MIN_WORDS} to ${MAX_WORDS} of them`);
    if (words.length > MAX_WORDS) refuse(`word_scroll scrolls at most ${MAX_WORDS} words`);
    const elements: Element[] = [];
    if (content.backdrop) elements.push(backdrop("scroll-backdrop", 0, 0, frames, layout, (d) => d.rect(0, 0, W, H, { fill: palette.background })));

    const lead = content.text?.replace(/\s+/g, " ").trim() ?? "";
    const style = { font: "sans" as const, bold: true, tracking: -0.02 };
    const width = (text: string, size: number) => textWidth(text, { ...style, size });
    const room = (portrait ? centredWidth(layout) : W - 2.6 * m) / ROOMY;
    const max = Math.round((portrait ? 176 : 150) * u);
    // Beside the word in landscape while that keeps the words heading size, else above it.
    const sideBy = lead !== "" && !portrait ? Math.floor(fitSize([`${lead}  ${words.reduce((a, b) => (width(b, 1) > width(a, 1) ? b : a))}`], style, room, max)) : 0;
    const side = sideBy >= layout.type.heading;
    const S = side ? sideBy : typeSize(layout, "heading", Math.floor(fitSize(words, style, room, max)));
    // A word too long for the frame at the heading floor is cut.
    const shown = words.map((w) => clampText(w, { ...style, size: S }, room));
    const longest = shown.reduce((a, b) => (width(b, 1) > width(a, 1) ? b : a));
    const L = Math.round(S * 1.24);
    const capMid = S * 0.36;
    const gapX = S * 0.36;
    const leadW = side ? width(lead, S) : 0;
    const columnLeft = (W - (leadW + gapX + width(longest, S))) / 2 + leadW + gapX;
    const cy = layout.tall ? opticalCentre(layout) : H * 0.52;
    /** Centre x of word `w` on the frame. */
    const wordX = (w: string) => (side ? columnLeft + width(w, S) / 2 : W / 2);

    // The column: word i's cap centre at firstLine + i × L.
    const pad = S * 0.5;
    const listW = width(longest, S) * ROOMY + 2 * pad;
    const listH = words.length * L + S;
    const firstLine = S * 0.5;
    const listX = side ? columnLeft - pad + listW / 2 : W / 2;
    const at = (k: number) => pose(listX, cy - (firstLine + k * L) + listH / 2);
    const paintList = (d: Drawing) => {
      shown.forEach((w, i) =>
        d.text(side ? pad : listW / 2, firstLine + i * L + capMid, w, { size: S, ...style, fill: palette.ink, anchor: side ? "start" : "middle" }),
      );
    };

    // Words spread over the template (one or two beats each); each scroll lands on its beat.
    const available = beats.countIn(frames);
    const per = Math.max(1, Math.min(2, Math.floor(available / words.length))) * beats.step;
    const landAt = (k: number) => beats.frame(k * per);
    const e0 = landAt(0);
    const list = new Motion(enter(at(0), e0, { dy: L * 0.8, frames: 10, ease: "out_strong" }));
    const landed = [0];
    for (let k = 1; k < words.length; k += 1) {
      const land = landAt(k);
      if (land >= frames) break;
      list.stay(beats.frame(k * per - 0.5 * beats.step)).to(land, at(k), "in_out");
      landed.push(k);
    }
    // The column scrolls through the frame: it runs past it by design.
    elements.push({ ...drawing("scroll-list", 1, e0, frames, { width: listW, height: listH }, paintList, list.keys), bleed: true });

    // The bands: the background colour over everything but the selected line.
    const gap = L * 0.52;
    elements.push(
      backdrop("scroll-bands", 2, e0, frames, layout, (d) => {
        // A lead line above the box needs the words above out of its way.
        d.rect(0, 0, W, cy - gap, { fill: palette.background, fillOpacity: lead && !side ? 1 : BAND_OPACITY });
        d.rect(0, cy + gap, W, H - cy - gap, { fill: palette.background, fillOpacity: BAND_OPACITY });
      }),
    );

    // A selection box per word, from its landing to the next scroll.
    const handle = Math.round(16 * u);
    const stroke = Math.max(2, 4 * u);
    const readout = typeSize(layout, "label", 30 * u);
    const last = landed[landed.length - 1]!;
    for (const k of landed) {
      const word = shown[k]!;
      const bw = width(word, S) * 1.06 + S * 0.5;
      const bh = S * 1.12;
      const label = `${Math.round(bw)} × ${Math.round(bh)}`;
      const tagW = textWidth(label, { size: readout, font: "mono" }) + readout * 1.4;
      const tagH = readout * 1.7;
      const inset = handle + 2;
      const boxW = Math.max(bw + 2 * inset, tagW + 4);
      const boxH = bh + 2 * inset + tagH + 14 * u;
      const left = (boxW - bw) / 2;
      const to = k === last ? frames : Math.min(frames, beats.frame((k + 1) * per - 0.5 * beats.step));
      // The first box waits for the list to settle (when the next scroll leaves time for it).
      const from = k === 0 ? Math.min(landAt(0) + 8, to - 4) : landAt(k);
      if (to - from < 2) continue;
      elements.push(
        cued(drawing(`scroll-box-${k + 1}`, 3, from, to, { width: boxW, height: boxH, cx: boxW / 2, cy: inset + bh / 2 }, (d) => {
          d.rect(left, inset, bw, bh, { stroke: palette.accent, strokeWidth: stroke });
          for (const hx of [left, left + bw / 2, left + bw]) {
            for (const hy of [inset, inset + bh / 2, inset + bh]) {
              if (hx === left + bw / 2 && hy === inset + bh / 2) continue;
              d.rect(hx - handle / 2, hy - handle / 2, handle, handle, { fill: palette.dark ? palette.background : "#ffffff", stroke: palette.accent, strokeWidth: stroke * 0.8 });
            }
          }
          const ty = inset + bh + handle / 2 + 12 * u;
          d.rect(boxW / 2 - tagW / 2, ty, tagW, tagH, { fill: palette.accent, rx: 6 * u });
          d.text(boxW / 2, ty + tagH / 2 + readout * 0.36, label, { size: readout, font: "mono", fill: palette.accentInk, anchor: "middle" });
        }, enter(pose(wordX(word), cy), from, { s: 1.08, alpha: 0.4, frames: 5, ease: "out" })), landAt(k)),
      );
    }

    // The lead line: left of the word (landscape) or above it (portrait).
    if (lead) {
      const fitted = side ? { lines: [lead], size: S } : fitType(layout, "body", lead, style, { width: (portrait ? centredWidth(layout) : W - 2 * m) / ROOMY, max: Math.round(S * 0.56) });
      const size = fitted.size;
      const block: TextBlock = { lines: fitted.lines, size, ...style, fill: palette.muted, anchor: side ? "end" : "middle" };
      const box = side ? textBox(block, columnLeft - gapX, cy + capMid) : textBox(block, W / 2, cy - gap - S * 0.45);
      elements.push(textElement("scroll-lead", 4, e0, frames, block, box, enter(pose(box.x, box.y), e0, side ? { dx: -24 * u, frames: 10 } : { dy: 16 * u, frames: 10 })));
    }
    return { elements, cues: landed.map(landAt) };
  },
};
