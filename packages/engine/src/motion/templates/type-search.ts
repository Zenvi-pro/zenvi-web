/**
 * type_search: a search field rises in on beat 0, the phrase types letter by
 * letter from beat 1 (a clip per prefix, a few frames each, the caret drawn
 * after the last letter), finishing on a beat; the caret blinks on the half
 * beats; on the next beat the button presses and a focus ring lights up.
 *
 * The caret is a "|" in the same text as the prefix, so it sits after the
 * last letter in whatever font the host draws: no width estimate decides
 * where it goes.
 */

import { backdrop, cued, drawing, enter, key, pose, textBox, textElement, type TextBlock } from "../elements.js";
import { searchGlass } from "../shapes.js";
import type { Drawing } from "../svg.js";
import { fitSize, ROOMY, textWidth } from "../text.js";
import { refuse, type TemplateInput, type TemplateOutput, type TemplateSpec } from "../template.js";
import type { Element, Key } from "../types.js";

/** Typing speed, characters per second (brisk, still readable). */
const TYPE_RATE = 15;
/** A prefix stays on screen at least this many frames. */
const MIN_PREFIX_FRAMES = 2;
const MAX_CHARS = 64;

function typingBeats(chars: number, bpm: number): number {
  const seconds = chars / TYPE_RATE;
  return Math.max(1, Math.ceil(seconds / (60 / bpm) - 0.15));
}

export const typeSearch: TemplateSpec = {
  id: "type_search",
  summary:
    "A search field rises in, the phrase types letter by letter with a blinking caret and lands on a beat; suggestions drop open under it a row per half beat; then the button presses (or the first suggestion is selected) and a focus ring lights up.",
  reads: "text (the phrase, one line), button (the button label), subtitle (a prompt above the field), tag (a brand row on top: its mark and name), labels (up to 4 suggestions that drop open under the field; the press selects the first), backdrop",
  media: "none",
  beats: (content, bpm) => {
    const n = [...(content.text ?? "").trim()].length;
    const rows = Math.min(4, content.labels?.length ?? 0);
    const total = 1 + typingBeats(Math.max(1, n), bpm) + (rows > 0 ? Math.ceil(rows / 2) + 1 : 1) + 2;
    return total + (total % 2);
  },
  build(input: TemplateInput): TemplateOutput {
    const { content, palette, layout, frames, beats } = input;
    const { W, H, u, m, portrait } = layout;
    const text = (content.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) refuse("type_search needs text: the phrase to type");
    if ([...text].length > MAX_CHARS) refuse(`type_search types one line: at most ${MAX_CHARS} characters`);
    const elements: Element[] = [];
    if (content.backdrop) elements.push(backdrop("search-backdrop", 0, 0, frames, layout, (d) => d.rect(0, 0, W, H, { fill: palette.background })));

    // The field, a little above the middle (suggestions open under it).
    const fh = Math.round((portrait ? 168 : 150) * u);
    const fw = Math.round(portrait ? W - 2 * m : Math.min(W - 4 * m, 1400 * u));
    const cx = W / 2;
    const cy = H * (portrait ? 0.42 : 0.44);
    const left = cx - fw / 2;
    const shadow = { offset: 12 * u };
    const pad = Math.ceil(shadow.offset * 3.4);
    const e0 = beats.frame(0);
    const settle = 12;
    const fieldIn = { s: 0.94, dy: 26 * u, frames: settle, ease: "out_strong" as const };
    elements.push(
      drawing("search-field", 1, e0, frames, { width: fw + 2 * pad, height: fh + 2 * pad }, (d) => {
        for (const [spread, alpha] of [
          [0.6, 0.5],
          [1.3, 0.3],
          [2.2, 0.2],
        ] as const) {
          const e = shadow.offset * spread;
          d.rect(pad - e, pad - e + shadow.offset, fw + 2 * e, fh + 2 * e, { fill: palette.shadow, fillOpacity: palette.shadowOpacity * alpha * 0.8, rx: fh / 2 + e });
        }
        d.rect(pad, pad, fw, fh, { fill: palette.surface, rx: fh / 2, stroke: palette.line, strokeWidth: 2 * u });
        searchGlass(d, pad + fh * 0.52, pad + fh / 2, fh * 0.34, palette.muted);
      }, enter(pose(cx, cy), e0, fieldIn)),
    );

    // The button: inside the field's right end (landscape), under the field (portrait, where the
    // phrase needs the field's whole width; left out there when suggestions open under the field).
    // It moves with the field while it rises in.
    const rows = (content.labels ?? []).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 4);
    const button = portrait && rows.length > 0 ? "" : (content.button?.replace(/\s+/g, " ").trim() ?? "");
    const bh = portrait ? fh * 0.78 : fh - 22 * u;
    const bSize = Math.round(bh * 0.4);
    const bw = button ? textWidth(button, { size: bSize, font: "sans", bold: true }) * ROOMY + bh * (portrait ? 1.6 : 0.9) : 0;
    const bx = portrait ? cx : left + fw - 11 * u - bw / 2;
    const by = portrait ? cy + fh / 2 + 34 * u + bh / 2 : cy;
    const textLeft = left + fh * 0.92;
    const textRight = button && !portrait ? bx - bw / 2 - 26 * u : left + fw - fh * 0.45;
    // Room for wider fallback fonts: the drawing clips what runs past the field.
    const size = fitSize([`${text}|`], { font: "sans" }, (textRight - textLeft) / 1.12, Math.round(fh * 0.38), fh * 0.22);
    if (textWidth(`${text}|`, { size, font: "sans" }) * 1.12 > textRight - textLeft + 1) refuse("type_search's phrase does not fit the field: shorten it");

    const n = [...text].length;
    const typeFrom = beats.frame(1);
    const typeBeats = typingBeats(n, beats.grid.bpm);
    const typeEnd = beats.frame(1 + typeBeats);
    // With suggestions the press waits for the list to open.
    const listBeats = rows.length > 0 ? Math.ceil(rows.length / 2) + 1 : 1;
    const pressAt = beats.frame(1 + typeBeats + listBeats);
    const pressing = pressAt + 10 <= frames;

    if (button) {
      // Scaled about the field's centre like the field, so it rides along.
      const rel = (s: number, dy: number) => pose(cx + (bx - cx) * s, cy + dy + (by - cy) * s, { s });
      const keys: Key[] = [key(e0, { ...rel(fieldIn.s, fieldIn.dy), alpha: 0 }), key(e0 + settle, rel(1, 0), "out_strong")];
      if (pressing) keys.push(key(pressAt, rel(1, 0), "smooth"), key(pressAt + 4, pose(bx, by, { s: 0.9 }), "out"), key(pressAt + 12, pose(bx, by), "out_back"));
      elements.push(
        drawing("search-button", 2, e0, frames, { width: bw, height: bh }, (d) => {
          d.rect(0, 0, bw, bh, { fill: palette.accent, rx: bh / 2 });
          d.text(bw / 2, bh / 2 + bSize * 0.36, button, { size: bSize, font: "sans", bold: true, fill: palette.accentInk, anchor: "middle" });
        }, keys),
      );
    }

    // The typed text: one clip per prefix (or per few letters), the caret drawn after it.
    const area = { width: textRight - textLeft + 2, height: fh };
    const baseline = fh / 2 + size * 0.35;
    const typed = (name: string, from: number, to: number, shown: string, caret: "on" | "off" | "only"): Element =>
      drawing(name, 3, from, to, area, (d: Drawing) => {
        const runs = [
          { text: shown, ...(caret === "only" ? { opacity: 0 } : {}) },
          ...(caret === "off" ? [] : [{ text: "|", fill: palette.accent, bold: false }]),
        ];
        d.text(0, baseline, runs, { size, font: "sans", fill: palette.ink, anchor: "start" });
      }, [key(from, pose(textLeft + area.width / 2, cy))]);

    const chars = [...text];
    const span = Math.max(1, typeEnd - typeFrom);
    const group = Math.max(1, Math.ceil((MIN_PREFIX_FRAMES * n) / span));
    const clips = Math.ceil(n / group);
    if (typeFrom > e0 + settle) elements.push(cued(typed("search-caret-0", e0 + settle, typeFrom, "", "on"), e0));
    for (let j = 0; j < clips; j += 1) {
      const from = typeFrom + Math.round((j * span) / clips);
      const to = typeFrom + Math.round(((j + 1) * span) / clips);
      if (to <= from || from >= frames) continue;
      // Keystrokes belong to the beat the typing starts on.
      elements.push(cued(typed(`search-type-${j + 1}`, from, Math.min(to, frames), chars.slice(0, Math.min(n, (j + 1) * group)).join(""), "on"), typeFrom));
    }
    if (typeEnd < frames) {
      elements.push(typed("search-text", typeEnd, frames, text, "off"));
      // The caret blinks on the half beats: on, off, on…
      const blink: Key[] = [];
      for (let k = 0; ; k += 1) {
        const at = beats.frame(1 + typeBeats + k / 2);
        if (at >= frames) break;
        blink.push(key(at, pose(textLeft + area.width / 2, cy, { alpha: k % 2 === 0 ? 1 : 0 }), "hold"));
      }
      const caret = typed("search-caret", typeEnd, frames, text, "only");
      caret.track = 4;
      caret.keys = blink.length > 0 ? blink : caret.keys;
      elements.push(caret);
    }

    // The focus ring lights up on the press.
    if (pressing) {
      const ringPad = Math.ceil(16 * u);
      elements.push(
        drawing("search-ring", 5, pressAt, frames, { width: fw + 2 * ringPad, height: fh + 2 * ringPad }, (d) => {
          d.rect(ringPad - 9 * u, ringPad - 9 * u, fw + 18 * u, fh + 18 * u, { stroke: palette.accent, strokeWidth: 9 * u, strokeOpacity: 0.18, rx: fh / 2 + 9 * u });
          d.rect(ringPad - 4 * u, ringPad - 4 * u, fw + 8 * u, fh + 8 * u, { stroke: palette.accent, strokeWidth: 3.5 * u, rx: fh / 2 + 4 * u });
        }, enter(pose(cx, cy), pressAt, { s: 1.03, frames: 8, ease: "out" })),
      );
    }

    // A prompt above the field.
    const subtitle = content.subtitle?.replace(/\s+/g, " ").trim();
    let above = cy - fh / 2 - 64 * u;
    if (subtitle) {
      const subSize = fitSize([subtitle], { font: "sans", bold: true }, (W - 2 * m) / 1.1, Math.round((portrait ? 64 : 56) * u), 24 * u);
      const block: TextBlock = { lines: [subtitle], size: subSize, font: "sans", bold: true, tracking: -0.015, fill: palette.ink, anchor: "middle" };
      const box = textBox(block, cx, above);
      elements.push(textElement("search-prompt", 6, e0, frames, block, box, enter(pose(box.x, box.y), e0 + 2, { dy: 20 * u, frames: 12, ease: "out_strong" })));
      above -= subSize * 1.6;
    }

    // A brand row (tag) over it all: the app's mark and name.
    const brand = content.tag?.replace(/\s+/g, " ").trim();
    if (brand) {
      const S = Math.round((portrait ? 92 : 76) * u);
      const nameSize = Math.round(S * 0.62);
      const nameW = textWidth(brand, { size: nameSize, font: "sans", bold: true, tracking: -0.02 }) * ROOMY;
      const gap = S * 0.3;
      const rowW = S + gap + nameW;
      const letter = (brand.match(/[\p{L}\p{N}]/u)?.[0] ?? brand[0]!).toUpperCase();
      elements.push(
        drawing("search-brand", 11, e0, frames, { width: rowW, height: S }, (d) => {
          d.rect(0, 0, S, S, { fill: palette.accent, rx: S * 0.28 });
          d.text(S / 2, S / 2 + 0.6 * S * 0.36, letter, { size: 0.6 * S, font: "sans", bold: true, fill: palette.accentInk, anchor: "middle" });
          d.text(S + gap, S / 2 + nameSize * 0.36, brand, { size: nameSize, font: "sans", bold: true, fill: palette.ink, tracking: -0.02 });
        }, enter(pose(cx, above - S / 2 - (subtitle ? 10 * u : 30 * u)), e0, { dy: -18 * u, frames: 12, ease: "out_strong" })),
      );
    }

    // Suggestions (labels): an autocomplete list drops open under the field once the phrase is typed,
    // a row per half beat; on the press the first row is selected.
    const cues = [e0, typeFrom, typeEnd, ...(pressing ? [pressAt] : [])];
    if (rows.length > 0) {
      const rh = Math.round(fh * 0.74);
      const rowSize = Math.round(fh * 0.3);
      const inset = 14 * u;
      const panelTop = cy + fh / 2 + 18 * u;
      const panelH = rows.length * rh + 2 * inset;
      const firstRow = beats.frame(1 + typeBeats);
      if (firstRow < frames) {
        elements.push(
          drawing("search-panel", 7, firstRow, frames, { width: fw + 2 * pad, height: panelH + 2 * pad }, (d) => {
            for (const [spread, alpha] of [
              [0.6, 0.5],
              [1.3, 0.3],
              [2.2, 0.2],
            ] as const) {
              const e = shadow.offset * spread;
              d.rect(pad - e, pad - e + shadow.offset, fw + 2 * e, panelH + 2 * e, { fill: palette.shadow, fillOpacity: palette.shadowOpacity * alpha * 0.8, rx: 28 * u + e });
            }
            d.rect(pad, pad, fw, panelH, { fill: palette.surface, stroke: palette.line, strokeWidth: 2 * u, rx: 28 * u });
            for (let i = 1; i < rows.length; i += 1) d.line(pad + fh * 0.4, pad + inset + i * rh, pad + fw - fh * 0.4, pad + inset + i * rh, { stroke: palette.line, strokeWidth: 1.5 * u });
          }, enter(pose(cx, panelTop + panelH / 2), firstRow, { dy: -14 * u, frames: 6, ease: "out" })),
        );
      }
      const rowY = (i: number) => panelTop + inset + i * rh + rh / 2;
      const paintRow = (text: string, selected: boolean) => (d: Drawing) => {
        const w = fw - 2 * inset;
        if (selected) d.rect(0, 0, w, rh, { fill: palette.accent, rx: 18 * u });
        searchGlass(d, fh * 0.42, rh / 2, rh * 0.36, selected ? palette.accentInk : palette.muted);
        d.text(fh * 0.78, rh / 2 + rowSize * 0.36, text, { size: rowSize, font: "sans", bold: true, fill: selected ? palette.accentInk : palette.ink });
        if (selected) d.polyline([[w - rh * 0.55, rh * 0.36], [w - rh * 0.4, rh / 2], [w - rh * 0.55, rh * 0.64]], { stroke: palette.accentInk, strokeWidth: 4 * u, linecap: "round", linejoin: "round" });
      };
      rows.forEach((text, i) => {
        const at = beats.frame(1 + typeBeats + i * 0.5);
        if (at + 4 >= frames) return;
        elements.push(drawing(`search-row-${i + 1}`, 8 + i, at, frames, { width: fw - 2 * inset, height: rh }, paintRow(text, false), enter(pose(cx, rowY(i)), at, { dy: -12 * u, frames: 6, ease: "out" })));
        cues.push(at);
      });
      if (pressing) elements.push(drawing("search-row-selected", 12, pressAt, frames, { width: fw - 2 * inset, height: rh }, paintRow(rows[0]!, true), enter(pose(cx, rowY(0)), pressAt, { s: 0.97, frames: 5, ease: "out" })));
    }

    return { elements, cues: cues.filter((f) => f < frames) };
  },
};
