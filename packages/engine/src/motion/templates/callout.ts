/**
 * callout: a product shot on a dark field, a soft halo behind it (stacked
 * translucent discs, no gradient), a heading "ANATOMY: <NAME>" in mono
 * with a rule drawing on under it (and the engine's Glow on the heading).
 * Then one callout per beat: a dot pops on the product, a leader line draws
 * out from it and a label slides in (index and name, value under it).
 *
 *   landscape  the heading on one line; labels in a column each side of
 *              the product (a wide shot is cropped squarer to leave them
 *              room); a leader is an elbow: a diagonal out of the product,
 *              then a level run
 *   portrait   the prefix as a kicker over the name (heading size), the
 *              product as big as the safe area leaves it (4:5, widening to
 *              square), the labels in the four slots above and below it
 *              (left column flush left, right column flush right, one label
 *              a slot): the leader rises or drops straight from its anchor to
 *              a rule that draws out under (or over) its label
 *
 * A leader segment is a line drawing whose centre is its start point: it is
 * turned to its angle and drawn on with a horizontal stretch from 0 to 1.
 */

import { defaultEffectJson } from "../../effects/registry.js";
import { makeKeyframePoint } from "../../keyframe/edit.js";
import type { Effect, Keyframe } from "../../model/types.js";
import { cropToAspect, cued, drawing, enter, inWindow, key, mediaCard, pose } from "../elements.js";
import { fittedSize } from "../keyframes.js";
import { fitType, typeSize, wrapLines, type Layout } from "../layout.js";
import { clampText, fitSize, textWidth } from "../text.js";
import { refuse, type NormPoint, type TemplateInput, type TemplateOutput, type TemplateSpec } from "../template.js";
import type { CropWindow, Element, MotionMedia, Palette } from "../types.js";

const MAX_CALLOUTS = 4;
const DEFAULT_POINTS: readonly NormPoint[] = [
  { x: 0.3, y: 0.3 },
  { x: 0.72, y: 0.34 },
  { x: 0.68, y: 0.72 },
  { x: 0.3, y: 0.7 },
];
/** The tallest portrait product frame, width / height (it widens to square when the room is short). */
const TALLEST_FRAME = 4 / 5;
const HEAD = { font: "mono" as const, bold: true, tracking: 0.04 };
const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const NAME = { font: "mono" as const, bold: true };
const VALUE = { font: "mono" as const };

function glow(palette: Palette): Omit<Effect, "id"> {
  const { id: _id, ...json } = defaultEffectJson("Glow", "TEMPLATE00");
  const constant = (v: number): Keyframe => ({ Points: [makeKeyframePoint(1, v)] });
  const c = (i: number) => Number.parseInt(palette.accent.slice(1 + 2 * i, 3 + 2 * i), 16);
  return { ...json, color: { red: constant(c(0)), green: constant(c(1)), blue: constant(c(2)), alpha: constant(255) }, blur_radius: constant(16), spread: constant(0.04), opacity: constant(0.55) } as Omit<Effect, "id">;
}

/** Frames a leader segment of `len` px takes to draw on. */
const drawFrames = (len: number, u: number) => Math.max(3, Math.round(len / (40 * u)));

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
  }, [key(at, pose(x1, y1, { rotation: angle, sx: 0 })), key(Math.min(frames - 1, at + drawFrames(len, u)), pose(x1, y1, { rotation: angle }), "out")]);
}

/** The product's frame on screen: centre, size and the crop that gives it its shape. */
interface ProductBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
  crop?: CropWindow;
}

/** The product at `aspect` (or its own; cropped around `focus`) fitted into `maxW` × `maxH`, centred on (cx, cy). */
function productBox(media: MotionMedia, maxW: number, maxH: number, cx: number, cy: number, aspect?: number, focus?: NormPoint): ProductBox {
  const crop = aspect !== undefined ? cropToAspect(media, aspect, focus) : undefined;
  const w0 = crop ? media.width * (1 - crop.left - crop.right) : media.width;
  const h0 = crop ? media.height * (1 - crop.top - crop.bottom) : media.height;
  const fit = fittedSize(w0, h0, { width: maxW, height: maxH, fps: 30 });
  return { cx, cy, w: fit.width, h: fit.height, ...(crop ? { crop } : {}) };
}

/** The heading: "PREFIX: NAME" on one line when that fits at heading size, else the prefix as a kicker (body size) over the name. */
interface Heading {
  inline: boolean;
  kicker: string;
  kickerSize: number;
  lines: string[];
  size: number;
}

function headingOf(layout: Layout, prefix: string, name: string, width: number, max: number): Heading {
  const floor = layout.type.heading;
  const one = name ? `${prefix}: ${name}` : prefix;
  const single = Math.floor(fitSize([one], HEAD, width, max));
  const kickerSize = typeSize(layout, "body", 46 * layout.u);
  if (!name || single >= floor) {
    const size = Math.max(floor, single);
    return { inline: true, kicker: "", kickerSize, lines: [clampText(one, { ...HEAD, size }, width)], size };
  }
  const stacked = fitType(layout, "heading", name, HEAD, { width, max, maxLines: 2 });
  return { inline: false, kicker: clampText(`${prefix}:`, { ...HEAD, size: kickerSize }, width), kickerSize, lines: stacked.lines, size: stacked.size };
}

interface CalloutLabel {
  /** Callout number, 0-based. */
  i: number;
  index: string;
  /** The name's lines: the first follows the index, the rest hang under the name. */
  name: string[];
  /** The value's lines (none without a value), under the name. */
  value: string[];
}

/** Name and value sizes shared by every label, and each label's lines, inside `width`. */
function labelType(layout: Layout, labels: readonly string[], values: readonly string[], width: number, maxName: number, maxValue: number): { nameSize: number; valueSize: number; items: CalloutLabel[] } {
  const index = (i: number) => String(i + 1).padStart(2, "0");
  const full = labels.map((l, i) => `${index(i)}  ${l}`);
  const nameSize = Math.max(layout.type.body, Math.min(Math.floor(maxName), Math.floor(fitSize(full, NAME, width, maxName))));
  const indent = textWidth("00  ", { ...NAME, size: nameSize });
  const shown = values.filter(Boolean);
  const valueSize = shown.length > 0 ? Math.max(layout.type.label, Math.min(Math.floor(maxValue), Math.floor(fitSize(shown, VALUE, width - indent, maxValue)))) : layout.type.label;
  const items = labels.map((l, i) => {
    // A name or value too long for the column even at its floor wraps once under itself, then is cut.
    const name = textWidth(full[i]!, { ...NAME, size: nameSize }) <= width ? [l] : wrapLines(l, { ...NAME, size: nameSize }, width - indent, 2);
    const v = values[i] ?? "";
    const value = !v ? [] : textWidth(v, { ...VALUE, size: valueSize }) <= width - indent ? [v] : wrapLines(v, { ...VALUE, size: valueSize }, width - indent, 2);
    return { i, index: index(i), name, value };
  });
  return { nameSize, valueSize, items };
}

export const callout: TemplateSpec = {
  id: "callout",
  summary:
    "A product shot on a dark field with a soft halo and a glowing 'ANATOMY: NAME' heading over a rule that draws on; then one callout per beat: a dot pops on the product, a leader line draws out and a label (index, name, value) slides in. On vertical video the heading stacks over a tall product frame and the labels sit above and below it.",
  reads: "file_ids (the product: the first file), text (the product name), tag (the heading's prefix, default ANATOMY), labels (callout names, 1-4), values (their second lines), points (anchors on the product picture, 0-1; its crop keeps them in view)",
  media: "required",
  beats: (content) => Math.max(1, content.labels?.length ?? 3) + 3,
  build(input: TemplateInput): TemplateOutput {
    const { content, palette, layout, frames, beats, media, frame } = input;
    const { W, H, u, m, portrait, safe } = layout;
    const file = content.fileIds?.[0];
    if (!file) refuse("callout needs file_ids: the product shot");
    const labels = (content.labels ?? []).map((l) => l.replace(/\s+/g, " ").trim().toUpperCase()).filter(Boolean);
    if (labels.length === 0) refuse("callout needs labels: 1 to 4 callout names");
    if (labels.length > MAX_CALLOUTS) refuse(`callout draws at most ${MAX_CALLOUTS} callouts`);
    const given = content.points && content.points.length > 0 ? content.points : null;
    if (given && given.length < labels.length) refuse("callout needs a point for every label (or no points, for the default spread)");
    // Anchors given on the product picture centre its crop and are mapped onto the shown frame; the default spread is on the shown frame.
    const focus = given ? { x: mean(given.slice(0, labels.length).map((p) => p.x)), y: mean(given.slice(0, labels.length).map((p) => p.y)) } : undefined;
    const anchorsOn = (crop: CropWindow | undefined): NormPoint[] => labels.map((_, i) => (given ? inWindow(given[i]!, crop) : DEFAULT_POINTS[i]!));
    const values = labels.map((_, i) => content.values?.[i]?.replace(/\s+/g, " ").trim().toUpperCase() ?? "");
    const product = media.get(file) as MotionMedia;
    const e0 = beats.frame(0);
    const elements: Element[] = [];

    // The heading: flush with the margin, its caps on the safe area's top line (portrait).
    const name = (content.text ?? "").replace(/\s+/g, " ").trim().toUpperCase();
    const prefix = (content.tag?.trim() || "ANATOMY").toUpperCase().replace(/:$/, "");
    const hx = portrait ? safe.left : m * 1.2;
    const head = headingOf(layout, prefix, name, (portrait ? safe.right : W - m * 1.2) - hx, (portrait ? 92 : 84) * u);
    const capTop = portrait ? safe.top : m * 1.2;
    const kickerBase = capTop + 0.75 * head.kickerSize;
    const firstBase = head.inline ? capTop + 0.75 * head.size : kickerBase + 0.28 * head.kickerSize + 16 * u + 0.75 * head.size;
    const lastBase = firstBase + (head.lines.length - 1) * 1.06 * head.size;
    const headPad = Math.ceil(head.size * 0.18);
    const headW = Math.max(...head.lines.map((line) => textWidth(line, { ...HEAD, size: head.size })), head.inline ? 0 : textWidth(head.kicker, { ...HEAD, size: head.kickerSize })) * 1.02 + 2 * headPad;
    const headTop = capTop - 0.25 * (head.inline ? head.size : head.kickerSize) - headPad;
    const headH = lastBase + 0.28 * head.size + headPad - headTop;
    const headEl = drawing("callout-heading", 3, e0, frames, { width: headW, height: headH }, (d) => {
      if (!head.inline) d.text(headPad, kickerBase - headTop, head.kicker, { size: head.kickerSize, ...HEAD, fill: palette.accent });
      head.lines.forEach((line, i) => {
        const runs = head.inline && name ? [{ text: `${prefix}:`, fill: palette.accent }, { text: line.slice(prefix.length + 1), fill: palette.ink }] : [{ text: line, fill: head.inline ? palette.accent : palette.ink }];
        d.text(headPad, firstBase - headTop + i * 1.06 * head.size, runs, { size: head.size, ...HEAD, fill: palette.ink });
      });
    }, enter(pose(hx - headPad + headW / 2, headTop + headH / 2), e0 + 2, { dx: -26 * u, frames: 12, ease: "out_strong" }));
    headEl.effects = [glow(palette)];
    elements.push(headEl);
    const ruleY = lastBase + 0.28 * head.size + 22 * u;
    const ruleW = W - 2 * hx;
    const ruleAt = e0 + 6;
    elements.push(
      cued(drawing("callout-rule", 4, ruleAt, frames, { width: ruleW, height: 6 * u, cx: 0, cy: 3 * u }, (d) => d.line(0, 3 * u, ruleW, 3 * u, { stroke: palette.line, strokeWidth: 2 * u }), [
        key(ruleAt, pose(hx, ruleY, { sx: 0 })),
        key(Math.min(frames - 1, ruleAt + 16), pose(hx, ruleY), "out"),
      ]), e0),
    );

    // Label type: a column each side, one size for every name and one for every value.
    const colGap = 40 * u;
    const colW = portrait ? (safe.right - safe.left - colGap) / 2 : W * 0.24;
    const type = labelType(layout, labels, values, colW, (portrait ? 48 : 46) * u, (portrait ? 36 : 34) * u);
    const nameLead = type.nameSize * 1.12;
    const indent = textWidth("00  ", { ...NAME, size: type.nameSize });
    /** A label block from the top of its first line to the foot of its last, px. */
    const valueLead = type.valueSize * 1.2;
    const blockH = (l: CalloutLabel) => 0.95 * type.nameSize + (l.name.length - 1) * nameLead + (l.value.length > 0 ? 1.3 * type.valueSize + (l.value.length - 1) * valueLead + 0.28 * type.valueSize : 0.28 * type.nameSize);
    const blockW = (l: CalloutLabel) => Math.max(...[...l.name.map((line) => textWidth(line, { ...NAME, size: type.nameSize })), ...l.value.map((line) => textWidth(line, { ...VALUE, size: type.valueSize }))].map((w) => indent + w));
    /** Technical frame around the product: hairline box and corner ticks. */
    const tick = 22 * u;
    const fpad = 16 * u;

    // Where the product sits and where each label goes.
    let box: ProductBox;
    interface Placed {
      label: CalloutLabel;
      anchor: { x: number; y: number };
      leftSide: boolean;
      /** Portrait: the label's slot above the product. */
      above: boolean;
      /** The label block's anchor point: its text's start (or end) x and its first baseline. */
      x: number;
      y: number;
      /** Portrait: the rule the label stands on (or hangs from). */
      rule: number;
    }
    let placed: Placed[];
    if (portrait) {
      // One label a slot: each anchor takes its own quadrant, else the nearest free slot.
      const slotsFor = (anchors: readonly NormPoint[]) => {
        const taken = new Set<string>();
        return type.items.map((l) => {
          const up = anchors[l.i]!.y < 0.5;
          const lt = anchors[l.i]!.x < 0.5;
          const pick = [
            [up, lt],
            [!up, lt],
            [up, !lt],
            [!up, !lt],
          ].find(([a, b]) => !taken.has(`${a}${b}`))!;
          taken.add(`${pick[0]}${pick[1]}`);
          return { above: pick[0]!, leftSide: pick[1]! };
        });
      };
      const reach = fpad + tick + 14 * u;
      const ruleGap = 14 * u;
      const room = { top: ruleY + 40 * u, bottom: safe.bottom };
      const maxW = W * 0.84;
      // The product as big as the room the label rows leave: as wide as it can be, from 4:5 (tall) to square.
      const boxFor = (slots: readonly { above: boolean }[]) => {
        const zone = (above: boolean) => {
          const hs = type.items.filter((_, k) => slots[k]!.above === above).map(blockH);
          return hs.length > 0 ? reach + ruleGap + Math.max(...hs) : 0;
        };
        const zones = zone(true) + zone(false);
        const maxH = room.bottom - room.top - zones;
        const b = productBox(product, maxW, maxH, W / 2, 0, Math.max(TALLEST_FRAME, Math.min(1, maxW / maxH)), focus);
        b.cy = room.top + (room.bottom - room.top - zones - b.h) / 2 + zone(true) + b.h / 2;
        return b;
      };
      const rows = (slots: readonly { above: boolean }[]) => slots.map((x) => x.above).join();
      const first = slotsFor(anchorsOn(cropToAspect(product, TALLEST_FRAME, focus)));
      box = boxFor(first);
      let anchors = anchorsOn(box.crop);
      const slots = slotsFor(anchors);
      if (rows(slots) !== rows(first)) {
        box = boxFor(slots);
        anchors = anchorsOn(box.crop);
      }
      const top = box.cy - box.h / 2;
      const bottom = box.cy + box.h / 2;
      placed = type.items.map((l, k) => {
        const { above, leftSide } = slots[k]!;
        const p = anchors[l.i]!;
        const rule = above ? top - reach : bottom + reach;
        const firstBase = above ? rule - ruleGap - blockH(l) + 0.95 * type.nameSize : rule + ruleGap + 0.95 * type.nameSize;
        return { label: l, anchor: { x: box.cx - box.w / 2 + p.x * box.w, y: top + p.y * box.h }, leftSide, above, x: leftSide ? safe.left : safe.right, y: firstBase, rule };
      });
    } else {
      // The label columns take what they need; a product too wide for the rest is cropped squarer (not past square).
      const widest = Math.max(...type.items.map(blockW));
      const maxW = Math.min(W * 0.46, W - 2 * (m + widest + 24 * u + 0.03 * W));
      const own = product.width / product.height;
      // Under the heading's rule (a long name stacks the heading taller).
      const roomTop = ruleY + 40 * u;
      const maxH = Math.min(H * 0.62, H - m - roomTop);
      box = productBox(product, maxW, maxH, W / 2, 0, own > maxW / maxH ? Math.max(1, maxW / maxH) : undefined, focus);
      box.cy = Math.max(H * 0.56, roomTop + box.h / 2);
      const anchors = anchorsOn(box.crop);
      const left = box.cx - box.w / 2;
      const top = box.cy - box.h / 2;
      // Labels on fixed slots down each side (in anchor order, so leaders never cross): the leaders angle out.
      const slots: Record<number, number[]> = { 1: [0.18], 2: [0.12, 0.88], 3: [0.06, 0.5, 0.94], 4: [0.04, 0.36, 0.68, 0.98] };
      placed = type.items.map((l) => {
        const p = anchors[l.i]!;
        return { label: l, anchor: { x: left + p.x * box.w, y: top + p.y * box.h }, leftSide: p.x < 0.5, above: false, x: 0, y: 0, rule: 0 };
      });
      for (const leftSide of [true, false]) {
        const side = placed.filter((q) => q.leftSide === leftSide).sort((a, b) => a.anchor.y - b.anchor.y);
        const at = slots[side.length] ?? [];
        side.forEach((q, k) => {
          q.y = Math.max(ruleY + 24 * u + type.nameSize, Math.min(H - m - blockH(q.label) + type.nameSize * 0.95, top + at[k]! * box.h));
          q.x = leftSide ? left - 0.03 * W - 24 * u : left + box.w + 0.03 * W + 24 * u;
        });
      }
    }
    const left = box.cx - box.w / 2;

    // The halo: discs of the accent, each faint, together a soft glow.
    const R = Math.max(box.w, box.h) * 0.78;
    elements.push(
      drawing("callout-halo", 0, e0, frames, { width: 2 * R, height: 2 * R }, (d) => {
        for (let i = 0; i < 9; i += 1) d.circle(R, R, R * (1 - i * 0.1), { fill: palette.accent, fillOpacity: 0.035 });
      }, enter(pose(box.cx, box.cy), e0, { s: 0.75, frames: 16, ease: "out" })),
    );
    elements.push(mediaCard("callout-product", 1, e0, frames, product, frame.fps, { width: box.w, radius: 6 * u, ...(box.crop ? { crop: box.crop } : {}) }, enter(pose(box.cx, box.cy), e0, { s: 1.06, frames: 14, ease: "out" })));
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

    // Callouts, one per beat: the dot, the leader, the run (or rule), the label.
    const enters = beats.entrances(labels.length, frames, 18, 1);
    const cues = [e0, ...enters];
    placed.forEach((q, i) => {
      const at = enters[i]!;
      if (at >= frames) return;
      const l = q.label;
      const { x: ax, y: ay } = q.anchor;
      const w = blockW(l);
      const anchorEnd = portrait ? !q.leftSide : q.leftSide;
      // The leader: portrait straight up or down to the label's rule; landscape an elbow out of the product.
      let elbow: { x: number; y: number };
      const runs: [number, number][] = [];
      if (portrait) {
        elbow = { x: ax, y: q.rule };
        const [x0, x1] = q.leftSide ? [q.x, Math.max(q.x + w, ax)] : [Math.min(q.x - w, ax), q.x];
        runs.push([ax, x0], [ax, x1]);
      } else {
        const edge = q.leftSide ? left - 0.03 * W : left + box.w + 0.03 * W;
        elbow = { x: edge, y: q.y - type.nameSize * 0.36 };
        runs.push([edge, q.leftSide ? q.x + 10 * u : q.x - 10 * u]);
      }
      const r = 8 * u;
      elements.push(
        drawing(`callout-dot-${i + 1}`, 5 + i * 5, at, frames, { width: 56 * u, height: 56 * u }, (d) => {
          d.circle(28 * u, 28 * u, 24 * u, { fill: palette.accent, fillOpacity: 0.18 });
          d.circle(28 * u, 28 * u, 15 * u, { stroke: palette.accent, strokeWidth: 2.5 * u });
          d.circle(28 * u, 28 * u, r, { fill: palette.ink });
        }, enter(pose(ax, ay), at, { s: 0.2, frames: 7, ease: "out_back" })),
      );
      elements.push(cued(segment(`callout-lead-${i + 1}`, 6 + i * 5, at + 2, frames, ax, ay, elbow.x, elbow.y, at + 2, frames, palette, u), at));
      const runAt = at + 2 + drawFrames(Math.hypot(elbow.x - ax, elbow.y - ay), u);
      runs
        .filter(([x0, x1]) => Math.abs(x1 - x0) >= 2 * u)
        .forEach(([x0, x1], k) => {
          if (runAt < frames) elements.push(cued(segment(`callout-run-${i + 1}${k > 0 ? "b" : ""}`, 7 + i * 5 + k, runAt, frames, x0, elbow.y, x1, elbow.y, runAt, frames, palette, u), at));
        });
      // The label: index and name (its next line hangs under the name), the value under the name.
      const labelAt = Math.min(frames - 2, runAt + 3);
      const pad = Math.ceil(type.nameSize * 0.3);
      const lw = Math.ceil(w * 1.02 + 2 * pad);
      const lh = Math.ceil(blockH(l) + 2 * pad);
      const drawLeft = anchorEnd ? q.x - lw + pad : q.x - pad;
      const drawTop = q.y - 0.95 * type.nameSize - pad;
      const tx = anchorEnd ? lw - pad : pad;
      const anchor = anchorEnd ? "end" : "start";
      elements.push(
        cued(drawing(`callout-label-${i + 1}`, 9 + i * 5, labelAt, frames, { width: lw, height: lh }, (d) => {
          l.name.forEach((line, k) => {
            const runsOf = k === 0 ? [{ text: `${l.index}  `, fill: palette.accent }, { text: line, fill: palette.ink }] : [{ text: line, fill: palette.ink }];
            d.text(tx + (k > 0 && !anchorEnd ? indent : 0), pad + 0.95 * type.nameSize + k * nameLead, runsOf, { size: type.nameSize, ...NAME, fill: palette.ink, anchor });
          });
          l.value.forEach((line, k) => {
            d.text(tx + (anchorEnd ? 0 : indent), pad + 0.95 * type.nameSize + (l.name.length - 1) * nameLead + 1.3 * type.valueSize + k * valueLead, line, { size: type.valueSize, ...VALUE, fill: palette.muted, anchor });
          });
        }, enter(pose(drawLeft + lw / 2, drawTop + lh / 2), labelAt, { dx: (q.leftSide ? -1 : 1) * 18 * u, frames: 8, ease: "out_strong" })), at),
      );
    });
    return { elements, cues };
  },
};
