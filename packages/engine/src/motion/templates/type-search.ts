/**
 * type_search: a search field rises in on beat 0, the phrase types letter by
 * letter from beat 1 (a clip per prefix, a few frames each, the caret drawn
 * after the last letter), finishing on a beat; the caret blinks on the half
 * beats; on the next beat the button presses and a focus ring lights up.
 *
 * Layout: the brand row, the prompt, the field and its button stack as one
 * group centred in the safe area (layout.ts). When suggestions drop open
 * under the field the group glides up on that beat, so the field and its
 * list end up centred together. The phrase fills the field like a text box:
 * one line, or more (two in landscape, three in portrait) when that sets it
 * clearly bigger or keeps it at body size; the caret follows the typing onto
 * the next line.
 *
 * The caret is a "|" in the same text as the prefix, so it sits after the
 * last letter in whatever font the host draws: no width estimate decides
 * where it goes.
 */

import { backdrop, cued, drawing, enter, glide, key, pose, textBox, textElement, type TextBlock } from "../elements.js";
import { centredWidth, fitType, fitWrapped, opticalCentre, typeSize } from "../layout.js";
import { searchGlass } from "../shapes.js";
import type { Drawing, TextRun } from "../svg.js";
import { clampText, ROOMY, textWidth } from "../text.js";
import { refuse, type TemplateInput, type TemplateOutput, type TemplateSpec } from "../template.js";
import type { Element, Key } from "../types.js";

/** Typing speed, characters per second (brisk, still readable). */
const TYPE_RATE = 15;
/** A prefix stays on screen at least this many frames. */
const MIN_PREFIX_FRAMES = 2;
const MAX_CHARS = 64;
/** The group's glide when the suggestions open, seconds. */
const GLIDE = 0.3;

function typingBeats(chars: number, bpm: number): number {
  const seconds = chars / TYPE_RATE;
  return Math.max(1, Math.ceil(seconds / (60 / bpm) - 0.15));
}

export const typeSearch: TemplateSpec = {
  id: "type_search",
  summary:
    "A search field rises in, the phrase types letter by letter with a blinking caret and lands on a beat; suggestions drop open under it a row per half beat while the field glides up to make room; then the button presses (or the first suggestion is selected) and a focus ring lights up.",
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

    // The button: inside the field's right end (landscape), under the field (portrait, where the
    // phrase needs the field's whole width; left out there when suggestions open under the field).
    const rows = (content.labels ?? []).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 4);
    const button = portrait && rows.length > 0 ? "" : (content.button?.replace(/\s+/g, " ").trim() ?? "");
    /** Height of a one-line field. */
    const unit = Math.round((portrait ? 168 : 150) * u);
    const fw = Math.round(portrait ? centredWidth(layout) : Math.min(W - 4 * m, 1400 * u));
    const cx = W / 2;
    const left = cx - fw / 2;
    const bh = Math.round(portrait ? unit * 0.72 : unit - 22 * u);
    const bSize = typeSize(layout, "body", bh * 0.4);
    const bw = button ? textWidth(button, { size: bSize, font: "sans", bold: true }) * ROOMY + bh * (portrait ? 1.6 : 0.9) : 0;

    // The phrase, wrapped like a text box (never under the body floor). Room for wider fallback
    // fonts: the drawing clips what runs past the field.
    const textLeft = left + unit * 0.92;
    const textRight = button && !portrait ? left + fw - 11 * u - bw - 26 * u : left + fw - unit * 0.45;
    const fit = fitWrapped(layout, "body", `${text}|`, { font: "sans" }, { width: (textRight - textLeft) / 1.12, max: portrait ? 84 * u : unit * 0.38, maxLines: portrait ? 3 : 2 });
    if (!fit) refuse("type_search's phrase does not fit the field: shorten it");
    const size = fit.size;
    const lines = fit.lines.map((line, i) => (i === fit.lines.length - 1 ? line.slice(0, -1) : line));
    const lead = Math.round(size * 1.2);
    const fh = unit + (lines.length - 1) * lead;
    const radius = unit / 2;

    // The group, top to bottom: brand row, prompt, field, its button or its suggestions.
    const brand = content.tag?.replace(/\s+/g, " ").trim() ?? "";
    const S = Math.round((portrait ? 124 : 76) * u);
    const subtitle = content.subtitle?.replace(/\s+/g, " ").trim() ?? "";
    const promptStyle = { font: "sans" as const, bold: true, tracking: -0.015 };
    const promptFit = subtitle ? fitType(layout, "heading", subtitle, promptStyle, { width: (portrait ? centredWidth(layout) : W - 2 * m) / 1.1, max: (portrait ? 96 : 84) * u, maxLines: 2, leading: 1.04 }) : null;
    const promptBlock: TextBlock | null = promptFit ? { lines: promptFit.lines, size: promptFit.size, ...promptStyle, fill: palette.ink, anchor: "middle", leading: 1.04 } : null;
    const promptH = promptBlock ? textBox(promptBlock, 0, 0).height : 0;
    const gap = Math.round((portrait ? 72 : 52) * u);
    const buttonBelow = portrait && button ? 34 * u + bh : 0;
    const before = (brand ? S + gap : 0) + (promptBlock ? promptH + gap * 0.75 : 0) + fh + buttonBelow;
    const inset = 14 * u;
    const panelGap = 18 * u;
    // Suggestion rows as tall as the safe area leaves them (never too short for body-size text).
    const rowSize = typeSize(layout, "body", portrait ? 58 * u : unit * 0.74 * 0.405);
    const rh = rows.length > 0 ? Math.round(Math.max(rowSize * 1.6, Math.min(portrait ? 148 * u : unit * 0.74, (layout.safe.bottom - layout.safe.top - before - panelGap - 2 * inset) / rows.length))) : 0;
    const panelH = rows.length * rh + 2 * inset;

    const n = [...text].length;
    const typeFrom = beats.frame(1);
    const typeBeats = typingBeats(n, beats.grid.bpm);
    const typeEnd = beats.frame(1 + typeBeats);
    // With suggestions the press waits for the list to open.
    const listBeats = rows.length > 0 ? Math.ceil(rows.length / 2) + 1 : 1;
    const pressAt = beats.frame(1 + typeBeats + listBeats);
    const pressing = pressAt + 10 <= frames;
    const listing = rows.length > 0 && typeEnd + 4 < frames;

    const after = before + (listing ? panelGap + panelH : 0);
    const centre = opticalCentre(layout);
    const top = Math.max(layout.safe.top, centre - after / 2);
    /** How much lower the group sits until the list opens. */
    const lift = Math.max(layout.safe.top, centre - before / 2) - top;
    const glideFrames = Math.max(4, Math.round(GLIDE * input.frame.fps));
    let y = top;
    const brandCy = y + S / 2;
    if (brand) y += S + gap;
    const promptTop = y;
    if (promptBlock) y += promptH + gap * 0.75;
    const fieldTop = y;
    const cy = fieldTop + fh / 2;
    const panelTop = fieldTop + fh + panelGap;

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
          d.rect(pad - e, pad - e + shadow.offset, fw + 2 * e, fh + 2 * e, { fill: palette.shadow, fillOpacity: palette.shadowOpacity * alpha * 0.8, rx: radius + e });
        }
        d.rect(pad, pad, fw, fh, { fill: palette.surface, rx: radius, stroke: palette.line, strokeWidth: 2 * u });
        searchGlass(d, pad + unit * 0.52, pad + unit / 2, unit * 0.34, palette.muted);
      }, enter(pose(cx, cy), e0, fieldIn)),
    );

    if (button) {
      const bx = portrait ? cx : left + fw - 11 * u - bw / 2;
      const by = portrait ? fieldTop + fh + 34 * u + bh / 2 : cy;
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

    // The typed text: one clip per prefix (or per few letters), the caret drawn after it, on the line it has reached.
    const chars = [...text];
    /** Index in `chars` of each line's first letter (a line break takes a word space). */
    const starts = lines.map((_, i) => lines.slice(0, i).reduce((at, line) => at + [...line].length + 1, 0));
    const area = { width: textRight - textLeft + 2, height: fh };
    const baseline = unit / 2 + size * 0.35;
    const textAt = pose(textLeft + area.width / 2, cy);
    const typed = (name: string, from: number, to: number, shown: number, caret: "on" | "off" | "only", keys?: Key[]): Element =>
      drawing(name, 3, from, to, area, (d: Drawing) => {
        const last = starts.reduce((k, s, i) => (s <= shown ? i : k), 0);
        for (let i = caret === "only" ? last : 0; i <= last; i += 1) {
          const visible = chars.slice(starts[i]!, Math.min(starts[i]! + [...lines[i]!].length, shown)).join("");
          const runs: TextRun[] = [{ text: visible, ...(caret === "only" ? { opacity: 0 } : {}) }, ...(i === last && caret !== "off" ? [{ text: "|", fill: palette.accent, bold: false }] : [])];
          if (runs.every((r) => r.text === "")) continue;
          d.text(0, baseline + i * lead, runs, { size, font: "sans", fill: palette.ink, anchor: "start" });
        }
      }, keys ?? [key(from, textAt)]);

    const span = Math.max(1, typeEnd - typeFrom);
    const group = Math.max(1, Math.ceil((MIN_PREFIX_FRAMES * n) / span));
    const clips = Math.ceil(n / group);
    if (typeFrom > e0 + settle) elements.push(cued(typed("search-caret-0", e0 + settle, typeFrom, 0, "on"), e0));
    for (let j = 0; j < clips; j += 1) {
      const from = typeFrom + Math.round((j * span) / clips);
      const to = typeFrom + Math.round(((j + 1) * span) / clips);
      if (to <= from || from >= frames) continue;
      // Keystrokes belong to the beat the typing starts on.
      elements.push(cued(typed(`search-type-${j + 1}`, from, Math.min(to, frames), Math.min(n, (j + 1) * group), "on"), typeFrom));
    }
    if (typeEnd < frames) {
      elements.push(typed("search-text", typeEnd, frames, n, "off"));
      // The caret rides the glide, then blinks on the half beats: on, off, on…
      const blinkFrom = typeEnd + (listing && lift > 0.5 ? glideFrames : 0);
      const blink: Key[] = [key(typeEnd, textAt, "hold")];
      for (let k = 1; ; k += 1) {
        const at = beats.frame(1 + typeBeats + k / 2);
        if (at >= frames) break;
        if (at > blinkFrom) blink.push(key(at, { ...textAt, alpha: k % 2 === 0 ? 1 : 0 }, "hold"));
      }
      const caret = typed("search-caret", typeEnd, frames, n, "only", blink);
      caret.track = 4;
      elements.push(caret);
    }

    // The focus ring lights up on the press.
    if (pressing) {
      const ringPad = Math.ceil(16 * u);
      elements.push(
        drawing("search-ring", 5, pressAt, frames, { width: fw + 2 * ringPad, height: fh + 2 * ringPad }, (d) => {
          d.rect(ringPad - 9 * u, ringPad - 9 * u, fw + 18 * u, fh + 18 * u, { stroke: palette.accent, strokeWidth: 9 * u, strokeOpacity: 0.18, rx: radius + 9 * u });
          d.rect(ringPad - 4 * u, ringPad - 4 * u, fw + 8 * u, fh + 8 * u, { stroke: palette.accent, strokeWidth: 3.5 * u, rx: radius + 4 * u });
        }, enter(pose(cx, cy), pressAt, { s: 1.03, frames: 8, ease: "out" })),
      );
    }

    // A prompt above the field.
    if (promptBlock) {
      const box = textBox(promptBlock, cx, promptTop - textBox(promptBlock, 0, 0).top);
      elements.push(textElement("search-prompt", 6, e0, frames, promptBlock, box, enter(pose(box.x, box.y), e0 + 2, { dy: 20 * u, frames: 12, ease: "out_strong" })));
    }

    // A brand row (tag) over it all: the app's mark and name.
    if (brand) {
      const nameSize = typeSize(layout, "body", S * 0.62);
      const nameW = textWidth(brand, { size: nameSize, font: "sans", bold: true, tracking: -0.02 }) * ROOMY;
      const brandGap = S * 0.3;
      const rowW = S + brandGap + nameW;
      const letter = (brand.match(/[\p{L}\p{N}]/u)?.[0] ?? brand[0]!).toUpperCase();
      elements.push(
        drawing("search-brand", 13, e0, frames, { width: rowW, height: S }, (d) => {
          d.rect(0, 0, S, S, { fill: palette.accent, rx: S * 0.28 });
          d.text(S / 2, S / 2 + 0.6 * S * 0.36, letter, { size: 0.6 * S, font: "sans", bold: true, fill: palette.accentInk, anchor: "middle" });
          d.text(S + brandGap, S / 2 + nameSize * 0.36, brand, { size: nameSize, font: "sans", bold: true, fill: palette.ink, tracking: -0.02 });
        }, enter(pose(cx, brandCy), e0, { dy: -18 * u, frames: 12, ease: "out_strong" })),
      );
    }

    // Suggestions (labels): an autocomplete list drops open under the field once the phrase is typed,
    // a row per half beat, riding the group's glide; on the press the first row is selected.
    const cues = [e0, typeFrom, typeEnd, ...(pressing ? [pressAt] : [])];
    if (listing) {
      const rowW = fw - 2 * inset;
      const rowText = (label: string) => clampText(label, { size: rowSize, font: "sans", bold: true }, (rowW - unit * 0.78 - rh * 0.7) / ROOMY);
      elements.push(
        drawing("search-panel", 7, typeEnd, frames, { width: fw + 2 * pad, height: panelH + 2 * pad }, (d) => {
          for (const [spread, alpha] of [
            [0.6, 0.5],
            [1.3, 0.3],
            [2.2, 0.2],
          ] as const) {
            const e = shadow.offset * spread;
            d.rect(pad - e, pad - e + shadow.offset, fw + 2 * e, panelH + 2 * e, { fill: palette.shadow, fillOpacity: palette.shadowOpacity * alpha * 0.8, rx: 28 * u + e });
          }
          d.rect(pad, pad, fw, panelH, { fill: palette.surface, stroke: palette.line, strokeWidth: 2 * u, rx: 28 * u });
          for (let i = 1; i < rows.length; i += 1) d.line(pad + unit * 0.4, pad + inset + i * rh, pad + fw - unit * 0.4, pad + inset + i * rh, { stroke: palette.line, strokeWidth: 1.5 * u });
        }, enter(pose(cx, panelTop + panelH / 2), typeEnd, { dy: -14 * u, frames: glideFrames, ease: "in_out" })),
      );
      const rowY = (i: number) => panelTop + inset + i * rh + rh / 2;
      const paintRow = (label: string, selected: boolean) => (d: Drawing) => {
        if (selected) d.rect(0, 0, rowW, rh, { fill: palette.accent, rx: 18 * u });
        searchGlass(d, unit * 0.42, rh / 2, Math.min(rh, unit) * 0.36, selected ? palette.accentInk : palette.muted);
        d.text(unit * 0.78, rh / 2 + rowSize * 0.36, rowText(label), { size: rowSize, font: "sans", bold: true, fill: selected ? palette.accentInk : palette.ink });
        if (selected) d.polyline([[rowW - rh * 0.55, rh * 0.36], [rowW - rh * 0.4, rh / 2], [rowW - rh * 0.55, rh * 0.64]], { stroke: palette.accentInk, strokeWidth: 4 * u, linecap: "round", linejoin: "round" });
      };
      rows.forEach((label, i) => {
        const at = beats.frame(1 + typeBeats + i * 0.5);
        if (at + 4 >= frames) return;
        // The first row opens with the panel, in the glide.
        const entrance = at === typeEnd ? { dy: -12 * u, frames: glideFrames, ease: "in_out" as const } : { dy: -12 * u, frames: 6, ease: "out" as const };
        elements.push(drawing(`search-row-${i + 1}`, 8 + i, at, frames, { width: rowW, height: rh }, paintRow(label, false), enter(pose(cx, rowY(i)), at, entrance)));
        cues.push(at);
      });
      if (pressing) elements.push(drawing("search-row-selected", 12, pressAt, frames, { width: rowW, height: rh }, paintRow(rows[0]!, true), enter(pose(cx, rowY(0)), pressAt, { s: 0.97, frames: 5, ease: "out" })));
    }

    // Until the list opens the group sits lower, centred on its own; then it glides up.
    const placed = listing ? elements.map((el) => (el.name === "search-backdrop" ? el : glide(el, typeEnd, glideFrames, lift))) : elements;
    return { elements: placed, cues: cues.filter((f) => f < frames) };
  },
};
