/**
 * callout: a product shot on a dark field, a soft halo behind it (stacked
 * translucent discs, no gradient), a heading "EXPERIMENTAL: <NAME>" in mono
 * with a rule drawing on under it (and the engine's Glow on the heading).
 * Then one callout per beat: a dot pops on the product, a leader line draws
 * out from it (an elbow: a diagonal, then a level run) and a label slides in
 * (index, name, value). Landscape labels sit left and right of the product;
 * portrait labels above and below it.
 *
 * A leader segment is a line drawing whose centre is its start point: it is
 * turned to its angle and drawn on with a horizontal stretch from 0 to 1.
 */

import { defaultEffectJson } from "../../effects/registry.js";
import { makeKeyframePoint } from "../../keyframe/edit.js";
import type { Effect, Keyframe } from "../../model/types.js";
import { cropToAspect, cued, drawing, enter, key, mediaCard, pose, type Layout } from "../elements.js";
import { fittedSize } from "../keyframes.js";
import { textWidth } from "../text.js";
import { refuse, type NormPoint, type TemplateInput, type TemplateOutput, type TemplateSpec } from "../template.js";
import type { CropWindow, Element, MotionMedia, Palette } from "../types.js";

const MAX_CALLOUTS = 4;
const DEFAULT_POINTS: readonly NormPoint[] = [
  { x: 0.3, y: 0.3 },
  { x: 0.72, y: 0.34 },
  { x: 0.68, y: 0.72 },
  { x: 0.3, y: 0.7 },
];

function glow(palette: Palette): Omit<Effect, "id"> {
  const { id: _id, ...json } = defaultEffectJson("Glow", "TEMPLATE00");
  const constant = (v: number): Keyframe => ({ Points: [makeKeyframePoint(1, v)] });
  const c = (i: number) => Number.parseInt(palette.accent.slice(1 + 2 * i, 3 + 2 * i), 16);
  return { ...json, color: { red: constant(c(0)), green: constant(c(1)), blue: constant(c(2)), alpha: constant(255) }, blur_radius: constant(16), spread: constant(0.04), opacity: constant(0.55) } as Omit<Effect, "id">;
}

/** A leader segment from (x1, y1) to (x2, y2): a drawing to draw on. */
function segment(name: string, track: number, from: number, to: number, x1: number, y1: number, x2: number, y2: number, at: number, frames: number, palette: Palette, u: number): Element {
  const len = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const thick = 3 * u;
  const halo = 12 * u;
  const pad = halo;
  return drawing(name, track, from, to, { width: len + 2 * pad, height: 2 * pad, cx: pad, cy: pad }, (d) => {
    d.line(pad, pad, pad + len, pad, { stroke: palette.accent, strokeWidth: halo, strokeOpacity: 0.16, linecap: "round" });
    d.line(pad, pad, pad + len, pad, { stroke: palette.accent, strokeWidth: thick, linecap: "round" });
  }, [key(at, pose(x1, y1, { rotation: angle, sx: 0 })), key(Math.min(frames - 1, at + Math.max(3, Math.round(len / (40 * u)))), pose(x1, y1, { rotation: angle }), "out")]);
}

/** Where the product sits, and the crop that gives a portrait frame a squarer product (landscape footage). */
function productBox(layout: Layout, media: MotionMedia): { cx: number; cy: number; w: number; h: number; crop?: CropWindow } {
  const { W, H, portrait } = layout;
  const maxW = W * (portrait ? 0.84 : 0.46);
  const maxH = H * (portrait ? 0.44 : 0.62);
  const crop = portrait && media.width / media.height > 1.2 ? cropToAspect(media, 1.1) : undefined;
  const w0 = crop ? media.width * (1 - crop.left - crop.right) : media.width;
  const h0 = crop ? media.height * (1 - crop.top - crop.bottom) : media.height;
  const fit = fittedSize(w0, h0, { width: maxW, height: maxH, fps: 30 });
  return { cx: W / 2, cy: H * (portrait ? 0.5 : 0.56), w: fit.width, h: fit.height, ...(crop ? { crop } : {}) };
}

export const callout: TemplateSpec = {
  id: "callout",
  summary:
    "A product shot on a dark field with a soft halo and a glowing 'EXPERIMENTAL: NAME' heading over a rule that draws on; then one callout per beat: a dot pops on the product, a leader line draws out and a label (index, name, value) slides in.",
  reads: "file_ids (the product: the first file), text (the product name), tag (the heading's prefix, default EXPERIMENTAL), labels (callout names, 1-4), values (their second lines), points (anchors on the product picture, 0-1)",
  media: "required",
  beats: (content) => Math.max(1, content.labels?.length ?? 3) + 3,
  build(input: TemplateInput): TemplateOutput {
    const { content, palette, layout, frames, beats, media, frame } = input;
    const { W, H, u, m, portrait } = layout;
    const file = content.fileIds?.[0];
    if (!file) refuse("callout needs file_ids: the product shot");
    const labels = (content.labels ?? []).map((l) => l.replace(/\s+/g, " ").trim().toUpperCase()).filter(Boolean);
    if (labels.length === 0) refuse("callout needs labels: 1 to 4 callout names");
    if (labels.length > MAX_CALLOUTS) refuse(`callout draws at most ${MAX_CALLOUTS} callouts`);
    const points = content.points && content.points.length > 0 ? content.points : DEFAULT_POINTS;
    if (points.length < labels.length) refuse("callout needs a point for every label (or no points, for the default spread)");
    const product = media.get(file) as MotionMedia;
    const box = productBox(layout, product);
    const left = box.cx - box.w / 2;
    const top = box.cy - box.h / 2;
    const e0 = beats.frame(0);
    const elements: Element[] = [];

    // The halo: discs of the accent, each faint, together a soft glow.
    const R = Math.max(box.w, box.h) * 0.78;
    elements.push(
      drawing("callout-halo", 0, e0, frames, { width: 2 * R, height: 2 * R }, (d) => {
        for (let i = 0; i < 9; i += 1) d.circle(R, R, R * (1 - i * 0.1), { fill: palette.accent, fillOpacity: 0.035 });
      }, enter(pose(box.cx, box.cy), e0, { s: 0.75, frames: 16, ease: "out" })),
    );
    elements.push(mediaCard("callout-product", 1, e0, frames, product, frame.fps, { width: box.w, radius: 6 * u, ...(box.crop ? { crop: box.crop } : {}) }, enter(pose(box.cx, box.cy), e0, { s: 1.06, frames: 14, ease: "out" })));
    // A technical frame: hairline box and corner ticks.
    const tick = 22 * u;
    const fpad = 16 * u;
    elements.push(
      drawing("callout-frame", 2, e0, frames, { width: box.w + 2 * fpad + 2 * tick, height: box.h + 2 * fpad + 2 * tick }, (d) => {
        const x0 = tick;
        const y0 = tick;
        const w = box.w + 2 * fpad;
        const h = box.h + 2 * fpad;
        d.rect(x0, y0, w, h, { stroke: palette.line, strokeWidth: 1.5 * u });
        for (const [cx, cy, sx, sy] of [
          [x0, y0, 1, 1],
          [x0 + w, y0, -1, 1],
          [x0, y0 + h, 1, -1],
          [x0 + w, y0 + h, -1, -1],
        ] as const) {
          d.polyline(
            [
              [cx, cy + sy * tick],
              [cx, cy],
              [cx + sx * tick, cy],
            ],
            { stroke: palette.ink, strokeWidth: 2.5 * u },
          );
        }
      }, enter(pose(box.cx, box.cy), e0 + 4, { s: 1.03, frames: 10, ease: "out" })),
    );

    // The heading and its rule.
    const name = (content.text ?? "").replace(/\s+/g, " ").trim().toUpperCase();
    const prefix = (content.tag?.trim() || "EXPERIMENTAL").toUpperCase().replace(/:$/, "");
    const headSize = Math.round((portrait ? 46 : 42) * u);
    const head = name ? `${prefix}: ${name}` : prefix;
    const headW = textWidth(head, { size: headSize, font: "mono", bold: true, tracking: 0.04 });
    const hx = m * 1.2;
    const hy = m * 1.2 + headSize;
    const headEl = drawing("callout-heading", 3, e0, frames, { width: headW + 40 * u, height: headSize * 1.8, cx: 20 * u, cy: headSize * 0.9 }, (d) => {
      d.text(20 * u, headSize * 0.9 + headSize * 0.36, [{ text: `${prefix}:`, fill: palette.accent }, ...(name ? [{ text: ` ${name}`, fill: palette.ink }] : [])], {
        size: headSize,
        font: "mono",
        bold: true,
        fill: palette.ink,
        tracking: 0.04,
      });
    }, enter(pose(hx, hy - headSize * 0.36), e0 + 2, { dx: -26 * u, frames: 12, ease: "out_strong" }));
    headEl.effects = [glow(palette)];
    elements.push(headEl);
    const ruleW = W - 2 * hx;
    const ruleAt = e0 + 6;
    elements.push(
      cued(drawing("callout-rule", 4, ruleAt, frames, { width: ruleW, height: 6 * u, cx: 0, cy: 3 * u }, (d) => d.line(0, 3 * u, ruleW, 3 * u, { stroke: palette.line, strokeWidth: 2 * u }), [
        key(ruleAt, pose(hx, hy + 24 * u, { sx: 0 })),
        key(Math.min(frames - 1, ruleAt + 16), pose(hx, hy + 24 * u), "out"),
      ]), e0),
    );

    // Callouts: anchors on the product, labels outside it.
    const nameSize = Math.round((portrait ? 32 : 30) * u);
    const valueSize = Math.round((portrait ? 26 : 24) * u);
    const lineH = nameSize * 1.25 + valueSize * 1.3;
    const anchors = labels.map((_, i) => ({ x: left + points[i]!.x * box.w, y: top + points[i]!.y * box.h, i }));
    // Where each label sits: landscape left/right of the product, portrait above/below; spread so none overlap.
    const place = anchors.map((a) => {
      if (portrait) {
        const above = points[a.i]!.y < 0.5;
        const leftSide = points[a.i]!.x < 0.5;
        return { a, leftSide, y: above ? top - 70 * u : box.cy + box.h / 2 + 70 * u, above };
      }
      const leftSide = points[a.i]!.x < 0.5;
      return { a, leftSide, y: a.y, above: false };
    });
    if (portrait) {
      // Two labels on one side of the same edge stack outward.
      for (const above of [true, false]) {
        for (const leftSide of [true, false]) {
          place.filter((p) => p.above === above && p.leftSide === leftSide).forEach((p, k) => (p.y += (above ? -1 : 1) * k * lineH * 1.25));
        }
      }
    } else {
      // Labels on fixed slots down each side (in anchor order, so leaders never cross): the leaders angle out.
      const slots: Record<number, number[]> = { 1: [0.18], 2: [0.12, 0.88], 3: [0.06, 0.5, 0.94], 4: [0.04, 0.36, 0.68, 0.98] };
      for (const leftSide of [true, false]) {
        const side = place.filter((p) => p.leftSide === leftSide).sort((p, q) => p.a.y - q.a.y);
        const at = slots[side.length] ?? [];
        side.forEach((p, k) => (p.y = Math.max(H * 0.22, Math.min(H * 0.9, top + at[k]! * box.h))));
      }
    }
    const enters = beats.entrances(labels.length, frames, 18, 1);
    const cues = [e0, ...enters];
    place.forEach((p, i) => {
      const at = enters[i]!;
      if (at >= frames) return;
      const side = p.leftSide ? -1 : 1;
      const values = content.values ?? [];
      const value = values[p.a.i]?.replace(/\s+/g, " ").trim().toUpperCase() ?? "";
      const index = String(p.a.i + 1).padStart(2, "0");
      const labelW = Math.max(textWidth(`${index}  ${labels[p.a.i]}`, { size: nameSize, font: "mono", bold: true }), value ? textWidth(value, { size: valueSize, font: "mono" }) : 0);
      // The elbow: just outside the product, level with the label; the label beyond it.
      let elbow: { x: number; y: number };
      let labelX: number;
      let labelY: number;
      if (portrait) {
        labelY = p.y;
        elbow = { x: p.a.x, y: labelY };
        labelX = p.leftSide ? Math.max(m, p.a.x - labelW - 60 * u) : Math.min(W - m - labelW, p.a.x + 60 * u);
      } else {
        labelY = p.y;
        const edge = side < 0 ? left - 0.03 * W : left + box.w + 0.03 * W;
        elbow = { x: edge, y: labelY };
        labelX = side < 0 ? edge - 24 * u - labelW : edge + 24 * u;
      }
      const runEnd = portrait ? (p.leftSide ? labelX + labelW + 16 * u : labelX - 16 * u) : side < 0 ? labelX + labelW + 14 * u : labelX - 14 * u;
      const r = 8 * u;
      elements.push(
        drawing(`callout-dot-${i + 1}`, 5 + i * 4, at, frames, { width: 56 * u, height: 56 * u }, (d) => {
          d.circle(28 * u, 28 * u, 24 * u, { fill: palette.accent, fillOpacity: 0.18 });
          d.circle(28 * u, 28 * u, 15 * u, { stroke: palette.accent, strokeWidth: 2.5 * u });
          d.circle(28 * u, 28 * u, r, { fill: palette.ink });
        }, enter(pose(p.a.x, p.a.y), at, { s: 0.2, frames: 7, ease: "out_back" })),
      );
      elements.push(cued(segment(`callout-lead-${i + 1}`, 6 + i * 4, at + 2, frames, p.a.x, p.a.y, elbow.x, elbow.y, at + 2, frames, palette, u), at));
      const runAt = at + 2 + Math.max(3, Math.round(Math.hypot(elbow.x - p.a.x, elbow.y - p.a.y) / (40 * u)));
      if (runAt < frames) elements.push(cued(segment(`callout-run-${i + 1}`, 7 + i * 4, runAt, frames, elbow.x, elbow.y, runEnd, elbow.y, runAt, frames, palette, u), at));
      const labelAt = Math.min(frames - 2, runAt + 3);
      const lw = labelW + 30 * u;
      const lh = lineH + 20 * u;
      const anchorRight = portrait ? p.leftSide : side < 0;
      elements.push(
        cued(drawing(`callout-label-${i + 1}`, 8 + i * 4, labelAt, frames, { width: lw, height: lh }, (d) => {
          const x = anchorRight ? lw - 10 * u : 10 * u;
          const anchor = anchorRight ? "end" : "start";
          d.text(x, 10 * u + nameSize * 0.95, [{ text: `${index}  `, fill: palette.accent }, { text: labels[p.a.i]!, fill: palette.ink }], { size: nameSize, font: "mono", bold: true, fill: palette.ink, anchor });
          if (value) d.text(x, 10 * u + nameSize * 1.25 + valueSize * 1.05, value, { size: valueSize, font: "mono", fill: palette.muted, anchor });
        }, enter(pose(labelX + labelW / 2, labelY + (portrait ? (p.above ? -lineH / 2 + nameSize * 0.4 : lineH / 2 - nameSize * 0.2) : lineH / 2 - nameSize * 0.6)), labelAt, { dx: side * 18 * u, frames: 8, ease: "out_strong" })), at),
      );
    });
    return { elements, cues };
  },
};
