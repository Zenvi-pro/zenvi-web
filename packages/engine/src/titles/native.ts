/**
 * A title drawn with the engine's own keyframed layers (motion/elements.ts),
 * for surfaces with no motion host (the browser editor): the six styles of
 * titles/styles.ts, the same layout rules and entrances as the `title`
 * motion block, as SVG drawings on a few tracks. A pure function of the spec
 * and the frame; `planOf` turns it into timeline layers.
 */

import { backdrop, drawing, enter, key, pose, textBox, textElement, type TextBlock } from "../motion/elements.js";
import { planOf } from "../motion/keyframes.js";
import { centredWidth, fitType, layoutOf, opticalCentre, typeSize, type Layout } from "../motion/layout.js";
import { textWidth } from "../motion/text.js";
import type { Element, Key, MotionFrame, MotionPlan, Pose } from "../motion/types.js";
import { ROLL_LINES, titleBackground, type TitleSpec } from "./styles.js";

export const NATIVE_TITLE_TEMPLATE = "title";

/** '#rrggbb[aa]' → ['#rrggbb', opacity]. */
function split(colour: string): [string, number] {
  return colour.length === 9 ? [colour.slice(0, 7), parseInt(colour.slice(7), 16) / 255] : [colour, 1];
}

interface Ctx {
  L: Layout;
  frames: number;
  /** Exit starts here (frames). */
  out: number;
  ink: string;
  inkAlpha: number;
  accent: string;
  accentAlpha: number;
  scale: number;
  elements: Element[];
}

/** An entrance into `rest`, then a fade out over the last frames. */
function life(c: Ctx, rest: Pose, at: number, e: Parameters<typeof enter>[2]): Key[] {
  const keys = enter(rest, at, e);
  const last = keys[keys.length - 1]!.frame;
  if (c.out > last && c.frames - 1 > c.out) keys.push(key(c.out, rest, "smooth"), key(c.frames - 1, { ...rest, alpha: 0 }, "in"));
  return keys;
}

function textAt(c: Ctx, name: string, block: TextBlock, x: number, baseline: number, at: number, e: Parameters<typeof enter>[2]): { box: ReturnType<typeof textBox> } {
  const box = textBox(block, x, baseline);
  c.elements.push(textElement(name, c.elements.length, at, c.frames, block, box, life(c, pose(box.x, box.y), at, e)));
  return { box };
}

/** Top of a group `height` tall in the spec's zone. */
function groupTop(c: Ctx, zone: TitleSpec["zone"], height: number): number {
  const { safe } = c.L;
  if (zone === "top") return safe.top;
  if (zone === "bottom") return safe.bottom - height;
  return opticalCentre(c.L) - height / 2;
}

export function buildNativeTitle(s: TitleSpec, frame: MotionFrame, seconds: number): MotionPlan {
  const L = layoutOf(frame);
  const frames = Math.max(2, Math.round(seconds * frame.fps));
  const f = (t: number): number => Math.min(frames - 1, Math.round(t * frame.fps));
  const [ink, inkAlpha] = split(s.text_color || (s.style === "bold_box" ? "#111111" : "#ffffff"));
  const [accent, accentAlpha] = split(s.accent_color || (s.style === "bold_box" ? "#ffffff" : "#ffd166"));
  const c: Ctx = { L, frames, out: frames - Math.max(1, f(Math.min(0.5, seconds * 0.2))), ink, inkAlpha, accent, accentAlpha, scale: s.font_scale, elements: [] };
  const { W, H, u } = L;
  const k = s.font_scale;
  const bg = titleBackground(s);
  if (bg) {
    const [fill, alpha] = split(bg);
    c.elements.push(backdrop("title-background", 0, 0, frames, L, (d) => d.rect(0, 0, W, H, { fill, fillOpacity: alpha })));
  }
  const room = L.tall ? centredWidth(L) : W - 2 * L.m;
  const block = (lines: string[], size: number, extra: Partial<TextBlock> = {}): TextBlock => ({ lines, size, font: "sans", bold: true, fill: ink, opacity: inkAlpha, anchor: "middle", leading: 1.04, ...extra });

  if (s.style === "headline" || s.style === "end_card") {
    const big = s.style === "end_card";
    const T = s.title ? fitType(L, "heading", s.title, { font: "sans", bold: true, tracking: -0.03 }, { width: room / 1.05, max: Math.round((big ? 112 : 124) * u * k), maxLines: 3, leading: 1.02 }) : null;
    const subText = big ? s.subtitle.toUpperCase() : s.subtitle;
    const S = s.subtitle ? fitType(L, "body", subText, { font: "sans", tracking: big ? 0.24 : 0 }, { width: room / 1.1, max: Math.round((big ? 32 : 46) * u * k), maxLines: 2 }) : null;
    const ruleH = big ? 0 : 7 * u;
    const gap = 30 * u;
    const titleH = T ? T.lines.length * 1.02 * T.size : 0;
    const height = titleH + (T && !big ? gap + ruleH : 0) + (S ? gap + S.lines.length * 1.3 * S.size : 0);
    let y = groupTop(c, s.zone, height);
    if (T) {
      textAt(c, "title-text", block(T.lines, T.size, { tracking: -0.03, leading: 1.02 }), W / 2, y + 0.8 * T.size, f(0.05), big ? { s: 0.92, frames: f(1.1), ease: "out_strong" } : { dy: 46 * u, frames: f(0.75), ease: "out_strong" });
      y += titleH;
      if (!big) {
        const rw = 150 * u;
        y += gap;
        c.elements.push(drawing("title-rule", c.elements.length, f(0.3), frames, { width: rw, height: ruleH }, (d) => d.rect(0, 0, rw, ruleH, { fill: accent, fillOpacity: accentAlpha, rx: ruleH / 2 }), life(c, pose(W / 2, y + ruleH / 2), f(0.3), { sx: 0, alpha: 1, frames: f(0.7), ease: "out_strong" })));
        y += ruleH;
      }
    }
    if (S) {
      y += gap;
      textAt(c, "title-subtitle", block(S.lines, S.size, { bold: big, tracking: big ? 0.24 : 0, leading: 1.3, opacity: inkAlpha * (big ? 0.8 : 0.9) }), W / 2, y + 0.9 * S.size, f(big ? 0.45 : 0.5), { dy: 24 * u, frames: f(0.6) });
    }
  } else if (s.style === "lower_third") {
    const nameSize = typeSize(L, "body", 56 * u * k);
    const roleSize = typeSize(L, "label", 32 * u * k);
    const nameW = s.title ? textWidth(s.title, { size: nameSize, font: "sans", bold: true }) : 0;
    const roleW = s.subtitle ? textWidth(s.subtitle, { size: roleSize, font: "sans" }) : 0;
    const padX = 34 * u;
    const plateW = Math.min(W * 0.78, Math.max(nameW, roleW) * 1.08 + 2 * padX);
    const plateH = 44 * u + (s.title ? 1.1 * nameSize : 0) + (s.subtitle ? 1.2 * roleSize + 6 * u : 0);
    const barW = 10 * u;
    const left = L.safe.left;
    const top = groupTop(c, s.zone, plateH);
    c.elements.push(drawing("title-bar", c.elements.length, 0, frames, { width: barW, height: plateH }, (d) => d.rect(0, 0, barW, plateH, { fill: accent, fillOpacity: accentAlpha }), life(c, pose(left + barW / 2, top + plateH / 2), 0, { s: 0.2, alpha: 1, frames: f(0.45), ease: "out_strong" })));
    // The plate draws on from its left edge (its centre is that edge: cx 0).
    c.elements.push(drawing("title-plate", c.elements.length, f(0.15), frames, { width: plateW, height: plateH, cx: 0, cy: plateH / 2 }, (d) => d.rect(0, 0, plateW, plateH, { fill: "#0c0c10", fillOpacity: 0.82 }), life(c, pose(left + barW, top + plateH / 2), f(0.15), { sx: 0, alpha: 1, frames: f(0.7), ease: "in_out" })));
    let y = top + 22 * u;
    if (s.title) {
      textAt(c, "title-name", block([s.title], nameSize, { anchor: "start", tracking: -0.01 }), left + barW + padX, y + 0.88 * nameSize, f(0.45), { dx: -30 * u, frames: f(0.6), ease: "out_strong" });
      y += 1.1 * nameSize + 6 * u;
    }
    if (s.subtitle) textAt(c, "title-role", block([s.subtitle], roleSize, { anchor: "start", bold: false, opacity: inkAlpha * 0.78 }), left + barW + padX, y + 0.9 * roleSize, f(0.58), { dx: -30 * u, frames: f(0.6), ease: "out_strong" });
  } else if (s.style === "bold_box") {
    const rows = [...s.title.split("\n").map((r) => r.trim()).filter(Boolean), ...(s.subtitle ? [s.subtitle] : [])];
    const longest = Math.max(...rows.map((r) => r.length), 1);
    const base = 76 * u * k * (longest <= 20 ? 1 : Math.max(0.5, Math.sqrt(20 / longest)));
    const sizes = rows.map((_, i) => typeSize(L, "body", base * (s.subtitle && i === rows.length - 1 ? 0.72 : 1)));
    const heights = sizes.map((z) => z * 1.15 + 20 * u);
    const gap = 12 * u;
    let y = groupTop(c, s.zone, heights.reduce((a, b) => a + b, 0) + gap * (rows.length - 1));
    rows.forEach((row, i) => {
      const z = sizes[i]!;
      const w = Math.min(room, textWidth(row, { size: z, font: "sans", bold: true }) * 1.06 + 52 * u);
      const h = heights[i]!;
      const at = f(0.05 + 0.12 * i);
      c.elements.push(
        drawing(`title-box-${i}`, c.elements.length, at, frames, { width: w, height: h }, (d) => {
          d.rect(0, 0, w, h, { fill: accent, fillOpacity: accentAlpha, rx: 8 * u });
          d.text(w / 2, h / 2 + 0.36 * z, row, { size: z, font: "sans", bold: true, fill: ink, opacity: inkAlpha, anchor: "middle" });
        }, life(c, pose(W / 2, y + h / 2), at, { s: 0.9, frames: f(0.5), ease: "out_back" })),
      );
      y += h + gap;
    });
  } else if (s.style === "kicker") {
    const z = typeSize(L, "label", 30 * u * k);
    const label = s.title.toUpperCase();
    const lineW = 90 * u;
    const textW = label ? textWidth(label, { size: z, font: "sans", bold: true, tracking: 0.32 }) : 0;
    const w = textW + 2 * (lineW + 22 * u);
    const h = z * 1.6;
    const subZ = s.subtitle ? typeSize(L, "label", 26 * u * k) : 0;
    let y = groupTop(c, s.zone, h + (s.subtitle ? 14 * u + 1.3 * subZ : 0));
    if (label) {
      c.elements.push(
        drawing("title-kicker", c.elements.length, f(0.05), frames, { width: w, height: h }, (d) => {
          d.rect(0, h / 2 - u, lineW, Math.max(2 * u, 1), { fill: accent, fillOpacity: accentAlpha });
          d.rect(w - lineW, h / 2 - u, lineW, Math.max(2 * u, 1), { fill: accent, fillOpacity: accentAlpha });
          d.text(w / 2, h / 2 + 0.36 * z, label, { size: z, font: "sans", bold: true, fill: ink, opacity: inkAlpha, anchor: "middle", tracking: 0.32 });
        }, life(c, pose(W / 2, y + h / 2), f(0.05), { sx: 0.6, frames: f(0.9), ease: "out_strong" })),
      );
      y += h;
    }
    if (s.subtitle) textAt(c, "title-subtitle", block([s.subtitle], subZ, { bold: false, opacity: inkAlpha * 0.75 }), W / 2, y + 14 * u + 0.9 * subZ, f(0.5), { frames: f(0.6) });
  } else {
    // credits
    const z = typeSize(L, "body", 46 * u * k * (Math.max(...s.lines.map((l) => l.length), 1) <= 34 ? 1 : 0.8));
    const lead = 1.64;
    const blockText = block(s.lines, z, { bold: false, leading: lead });
    if (s.lines.length > ROLL_LINES) {
      const box = textBox(blockText, W / 2, 0);
      // Rolls from below the frame to above it, linear over the whole title.
      c.elements.push(textElement("title-credits", 0 + c.elements.length, 0, frames, blockText, box, [key(0, pose(W / 2, H + box.height / 2)), key(frames - 1, pose(W / 2, -box.height / 2), "linear")]));
    } else {
      let y = groupTop(c, s.zone, s.lines.length * lead * z);
      s.lines.forEach((line, i) => {
        textAt(c, `title-line-${i}`, block([line], z, { bold: false }), W / 2, y + 0.9 * z, f(0.1 + 0.18 * i), { dy: 20 * u, frames: f(0.6) });
        y += lead * z;
      });
    }
  }
  return planOf(NATIVE_TITLE_TEMPLATE, frames, c.elements, [0], frame);
}
