/**
 * end_card: the closing card, on its own backdrop unless `backdrop` is false.
 *
 *   logo   a brand mark (a rounded square in the accent with the name's first
 *          letter) pops in with a small turn, the name slides out from behind
 *          it on the next beat, the subtitle rises on the one after
 *   save   a bookmark drops in, "Save this" (or the text) lands on the next
 *          beat while a highlighter swipes behind it, the subtitle rises
 *   plain  an optional tag pops, the title rises, the subtitle follows
 *
 * On 9:16 each group is centred on the safe area's optical centre and kept
 * inside it (layout.ts); titles are headings, subtitles body text.
 */

import { backdrop, cued, drawing, enter, key, pose, textBox, textElement, type TextBlock } from "../elements.js";
import { bookmark } from "../shapes.js";
import { centredWidth, fitType, opticalCentre, typeSize } from "../layout.js";
import { clampText, fitSize, textWidth } from "../text.js";
import { refuse, type TemplateInput, type TemplateOutput, type TemplateSpec } from "../template.js";
import type { Element, Key, Pose } from "../types.js";

export const END_VARIANTS = ["logo", "save", "plain"] as const;

/** A pill with mono text, its centre at (x, y): returns the element. */
export function tagElement(name: string, track: number, from: number, to: number, text: string, x: number, y: number, size: number, fill: string, ink: string, keys: (rest: Pose) => Key[]): Element {
  const label = text.toUpperCase();
  const w = textWidth(label, { size, font: "mono", tracking: 0.06 }) + size * 1.5;
  const h = size * 1.9;
  const rest = pose(x, y);
  return drawing(
    name,
    track,
    from,
    to,
    { width: w, height: h },
    (d) => {
      d.rect(0, 0, w, h, { fill, rx: h * 0.18 });
      d.text(w / 2, h / 2 + size * 0.36, label, { size, font: "mono", bold: true, fill: ink, anchor: "middle", tracking: 0.06 });
    },
    keys(rest),
  );
}

export const endCard: TemplateSpec = {
  id: "end_card",
  summary:
    "The closing card. logo: a brand mark pops in, the name slides out beside it, the subtitle rises; save: a bookmark drops in and 'Save this' lands with a highlighter swipe; plain: a tag, the title and the subtitle rise in turn. Draws its own backdrop.",
  reads: "text (title or brand name; save defaults to 'Save this'), subtitle, tag (plain), variant (logo | save | plain), align (plain), backdrop",
  media: "none",
  beats: () => 8,
  build(input: TemplateInput): TemplateOutput {
    const { content, palette, layout, frames, beats } = input;
    const { W, H, u, m, portrait, tall, safe } = layout;
    const variant = content.variant ?? (palette.name === "tutorial" ? "save" : palette.name.startsWith("ui") ? "logo" : "plain");
    if (!(END_VARIANTS as readonly string[]).includes(variant)) refuse(`end_card variant must be one of ${END_VARIANTS.join(", ")} (got ${variant})`);
    const title = (content.text ?? (variant === "save" ? "Save this" : "")).replace(/\s+/g, " ").trim();
    if (!title) refuse("end_card needs text: the title (the brand name for variant logo)");
    const subtitle = content.subtitle?.replace(/\s+/g, " ").trim() ?? "";
    const elements: Element[] = [];
    if (content.backdrop !== false) elements.push(backdrop("end-backdrop", 0, 0, frames, layout, (d) => d.rect(0, 0, W, H, { fill: palette.background })));
    const [e0, e1, e2] = beats.entrances(3, frames, 14) as [number, number, number];
    const centredW = portrait ? centredWidth(layout) : W - 2 * m;
    const subSize = typeSize(layout, "body", (portrait ? 50 : 42) * u);
    const heading = { font: "sans" as const, bold: true, tracking: -0.02 };
    /** The subtitle, its first baseline at `y`, rising in at `at`. */
    const addSubtitle = (at: number, y: number, x = W / 2, anchor: TextBlock["anchor"] = "middle") => {
      if (!subtitle) return;
      const fitted = fitType(layout, "body", subtitle, { font: "sans" }, { width: (anchor === "middle" ? centredW : safe.right - x) / 1.1, max: subSize });
      const block: TextBlock = { lines: fitted.lines, size: fitted.size, font: "sans", fill: palette.muted, anchor };
      const box = textBox(block, x, y);
      elements.push(textElement("end-subtitle", 4, at, frames, block, box, enter(pose(box.x, box.y), at, { dy: 22 * u, frames: 12 })));
    };
    /** Where a group spanning `top`..`bottom` around a reference point goes: centred in the safe area on 9:16, else at `fallback`. */
    const place = (fallback: number, top: number, bottom: number) => (tall ? opticalCentre(layout) - (top + bottom) / 2 : fallback);

    if (variant === "logo") {
      const S = Math.round((portrait ? 250 : 184) * u);
      const letter = (title.match(/[\p{L}\p{N}]/u)?.[0] ?? title[0]!).toUpperCase();
      const gap = Math.round(46 * u);
      const maxT = Math.round((portrait ? 176 : 156) * u);
      const room = portrait ? centredW : W - 4 * m - S - gap;
      const T = typeSize(layout, "heading", fitSize([title], heading, room, maxT));
      const name = clampText(title, { ...heading, size: T }, room);
      const word: TextBlock = { lines: [name], size: T, ...heading, fill: palette.ink, anchor: portrait ? "middle" : "start" };
      const textW = textWidth(name, word);
      const below = S / 2 + 56 * u + 0.72 * T;
      const cy = portrait ? place(H * 0.4, -S / 2, below + (subtitle ? 96 * u + 0.28 * subSize : 0.28 * T)) : H * 0.46;
      const markX = portrait ? W / 2 : (W - (S + gap + textW)) / 2 + S / 2;
      const markY = cy;
      elements.push(
        drawing(
          "end-mark",
          1,
          e0,
          frames,
          { width: S, height: S },
          (d) => {
            d.rect(0, 0, S, S, { fill: palette.accent, rx: S * 0.28 });
            d.text(S / 2, S / 2 + 0.6 * S * 0.36, letter, { size: 0.6 * S, font: "sans", bold: true, fill: palette.accentInk, anchor: "middle" });
          },
          enter(pose(markX, markY), e0, { s: 0.35, rotation: -16, frames: 12, ease: "out_back" }),
        ),
      );
      const wordBox = portrait ? textBox(word, W / 2, cy + below) : textBox(word, markX + S / 2 + gap, cy + 0.36 * T);
      const wordIn = portrait ? { dy: 34 * u, frames: 14, ease: "out_strong" as const } : { dx: -44 * u, frames: 14, ease: "out_strong" as const };
      elements.push(textElement("end-name", 2, e1, frames, word, wordBox, enter(pose(wordBox.x, wordBox.y), e1, wordIn)));
      addSubtitle(e2, portrait ? cy + below + 96 * u : cy + S / 2 + 84 * u);
    } else if (variant === "save") {
      const bw = Math.round((portrait ? 116 : 96) * u);
      const bh = Math.round(bw * 1.3);
      const fitted = fitType(layout, "heading", title, heading, { width: W - 2.4 * m, height: H * 0.24, max: Math.round((portrait ? 150 : 132) * u), maxLines: 2, leading: 1.02 });
      const T = fitted.size;
      const below = bh / 2 + 70 * u + 0.72 * T + (fitted.lines.length - 1) * 1.02 * T;
      const iconY = place(H * (portrait ? 0.35 : 0.3), -bh / 2, below + (subtitle ? 96 * u + 0.28 * subSize : 0.28 * T));
      elements.push(
        drawing("end-bookmark", 1, e0, frames, { width: bw + 8 * u, height: bh + 8 * u }, (d) => bookmark(d, 4 * u, 4 * u, bw, bh, { fill: palette.accent, stroke: palette.ink, strokeWidth: 5 * u }), [
          ...enter(pose(W / 2, iconY, { rotation: -6 }), e0, { dy: -80 * u, s: 0.7, rotation: -18, frames: 12, ease: "out_back" }),
        ]),
      );
      const block: TextBlock = { lines: fitted.lines, size: T, ...heading, fill: palette.ink, anchor: "middle", leading: 1.02 };
      const firstBase = iconY + bh / 2 + 70 * u + 0.72 * T;
      const box = textBox(block, W / 2, firstBase);
      const lastBase = firstBase + (fitted.lines.length - 1) * 1.02 * T;
      const lastW = textWidth(fitted.lines[fitted.lines.length - 1]!, block);
      const markW = lastW * 1.06 + 28 * u;
      const markH = 0.46 * T;
      const markLeft = W / 2 - markW / 2;
      elements.push(
        drawing("end-highlight", 2, e1, frames, { width: markW, height: markH, cx: 0, cy: markH / 2 }, (d) => d.rect(0, 0, markW, markH, { fill: palette.second, rx: markH * 0.12 }), [
          key(e1 + 3, pose(markLeft, lastBase - 0.16 * T, { sx: 0 })),
          key(e1 + 13, pose(markLeft, lastBase - 0.16 * T), "out"),
        ]),
      );
      elements.push(textElement("end-title", 3, e1, frames, block, box, enter(pose(box.x, box.y), e1, { s: 0.88, frames: 10, ease: "out_strong" })));
      addSubtitle(e2, lastBase + 96 * u);
    } else {
      const align = content.align ?? (palette.name === "editorial" ? "left" : "center");
      const anchor = align === "left" ? "start" : "middle";
      const x = align === "left" ? m * 1.6 : W / 2;
      const room = tall ? (align === "left" ? safe.right - x : centredW) : W - 3.2 * m;
      const fitted = fitType(layout, "heading", title, { ...heading, tracking: -0.025 }, { width: room / 1.04, height: H * (portrait ? 0.3 : 0.42), max: Math.round((portrait ? 140 : 150) * u), maxLines: 3, leading: 0.98 });
      const T = fitted.size;
      const block: TextBlock = { lines: fitted.lines, size: T, ...heading, tracking: -0.025, fill: palette.ink, anchor, leading: 0.98 };
      const tagSize = typeSize(layout, "label", 30 * u);
      const blockH = (content.tag ? tagSize * 1.9 + 34 * u : 0) + fitted.lines.length * 0.98 * T + (subtitle ? 90 * u : 0);
      let y = (tall ? opticalCentre(layout) : H * (portrait ? 0.45 : 0.5)) - blockH / 2;
      if (content.tag?.trim()) {
        const tag = content.tag.trim();
        const tagW = textWidth(tag.toUpperCase(), { size: tagSize, font: "mono", tracking: 0.06 }) + tagSize * 1.5;
        elements.push(
          tagElement("end-tag", 1, e0, frames, tag, align === "left" ? x + tagW / 2 : W / 2, y + tagSize * 0.95, tagSize, palette.accent, palette.accentInk, (rest) =>
            enter(rest, e0, { s: 0.6, frames: 10, ease: "out_back" }),
          ),
        );
        y += tagSize * 1.9 + 34 * u;
      }
      const titleAt = content.tag ? e0 + 3 : e0;
      const box = textBox(block, x, y + 0.76 * T);
      elements.push(cued(textElement("end-title", 2, titleAt, frames, block, box, enter(pose(box.x, box.y), titleAt, { dy: 46 * u, frames: 14, ease: "out_strong" })), e0));
      addSubtitle(e1, y + 0.76 * T + (fitted.lines.length - 1) * 0.98 * T + 86 * u, x, anchor);
      return { elements, cues: [e0, ...(subtitle ? [e1] : [])] };
    }
    return { elements, cues: [e0, e1, ...(subtitle ? [e2] : [])] };
  },
};
