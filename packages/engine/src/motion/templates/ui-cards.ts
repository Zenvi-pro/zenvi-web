/**
 * ui_cards: up to three rounded UI cards, one entrance per beat.
 *
 *   landscape  a fan: the first card (the hero) rises in at the centre, the
 *              others swing out from behind it to its sides, tilted
 *   portrait   a cascade: cards slide in from alternate sides, each landing
 *              a little lower, older cards receding (smaller, drifting up)
 *
 * A card shows a video or photo cropped to the card's shape (Crop effect,
 * rounded with corner_radius) under a frame drawing (shadow, border, caption
 * chip), or, without a file, a text card (title, a line, skeleton bars).
 * With `button`, a pointer glides in on the next beat, clicks the front
 * card's button on the one after (press, ripple, the button turns into a
 * check), then the camera pushes in until the end.
 */

import { cropToAspect, cued, drawing, enter, key, mediaCard, Motion, pose, poseAt, zoomed, type Layout } from "../elements.js";
import { cardFrame, cardFramePad, pointer, type CardFrameStyle } from "../shapes.js";
import { clampText, ROOMY, textWidth } from "../text.js";
import { refuse, type TemplateInput, type TemplateOutput, type TemplateSpec } from "../template.js";
import type { Element, MotionMedia, Palette, Pose } from "../types.js";
import type { Drawing } from "../svg.js";

const MAX_CARDS = 3;
/** Camera push after the click. */
const PUSH = 1.035;

interface Slot {
  rest: Pose;
  /** Stack order, 0 = bottom. */
  depth: number;
}

function cardSize(layout: Layout, count: number): { w: number; h: number } {
  const { W, H, portrait } = layout;
  if (portrait) {
    const w = W * 0.78;
    return { w, h: Math.min(w * 0.75, H * (count === 1 ? 0.4 : 0.27)) };
  }
  const w = W * (count === 1 ? 0.3 : count === 2 ? 0.25 : 0.265);
  return { w, h: Math.min(w * 1.25, H * 0.66) };
}

function slots(layout: Layout, count: number): Slot[] {
  const { W, H, portrait } = layout;
  if (portrait) {
    const ys = count === 1 ? [0.47] : count === 2 ? [0.36, 0.6] : [0.27, 0.49, 0.71];
    const xs = [-0.05, 0.05, -0.03];
    const rots = [-2, 2, -1];
    return ys.map((y, i) => ({ rest: pose(W / 2 + xs[i]! * W, y * H, { rotation: count === 1 ? 0 : rots[i]! }), depth: i }));
  }
  if (count === 1) return [{ rest: pose(W / 2, H * 0.5), depth: 0 }];
  if (count === 2) return [{ rest: pose(W / 2 - 0.145 * W, H * 0.5, { rotation: -3 }), depth: 0 }, { rest: pose(W / 2 + 0.145 * W, H * 0.51, { rotation: 3 }), depth: 1 }];
  return [
    { rest: pose(W / 2, H * 0.5), depth: 2 },
    { rest: pose(W / 2 - 0.25 * W, H * 0.53, { s: 0.86, rotation: -5 }), depth: 0 },
    { rest: pose(W / 2 + 0.25 * W, H * 0.53, { s: 0.86, rotation: 5 }), depth: 1 },
  ];
}

/** A text card: surface, title, a muted line, skeleton bars. */
function paintTextCard(d: Drawing, pad: number, w: number, h: number, frame: CardFrameStyle, palette: Palette, u: number, title: string, line: string): void {
  cardFrame(d, pad, pad, w, h, { ...frame, border: undefined });
  d.rect(pad, pad, w, h, { fill: palette.surface, rx: frame.radius, stroke: palette.line, strokeWidth: 2 * u });
  const inset = Math.max(28 * u, w * 0.08);
  const titleSize = Math.min(48 * u, h * 0.12);
  d.circle(pad + inset + 14 * u, pad + inset + 14 * u, 14 * u, { fill: palette.accent });
  const titleText = clampText(title, { size: titleSize, font: "sans", bold: true }, (w - 2 * inset) / ROOMY);
  d.text(pad + inset, pad + inset + 28 * u + 22 * u + titleSize * 0.8, titleText, { size: titleSize, font: "sans", bold: true, fill: palette.ink, tracking: -0.01 });
  let y = pad + inset + 50 * u + titleSize * 1.4;
  if (line) {
    const lineSize = Math.min(30 * u, h * 0.075);
    d.text(pad + inset, y + lineSize * 0.4, clampText(line, { size: lineSize, font: "sans" }, (w - 2 * inset) / ROOMY), { size: lineSize, font: "sans", fill: palette.muted });
    y += lineSize * 1.6;
  }
  const bar = Math.max(10 * u, h * 0.035);
  for (const share of [0.86, 0.72, 0.5]) {
    if (y + bar > pad + h - inset) break;
    d.rect(pad + inset, y, (w - 2 * inset) * share, bar, { fill: palette.line, rx: bar / 2 });
    y += bar * 2.3;
  }
}

export const uiCards: TemplateSpec = {
  id: "ui_cards",
  summary:
    "Up to three rounded UI cards (footage or photos inside, or text cards) rise into a fan (landscape) or slide into a cascade (portrait), one per beat, with depth; with a button, a pointer glides to the front card and clicks it (press, ripple, check), then the camera pushes in.",
  reads: "file_ids (card media, in order), labels (a caption per card; a card without a file is a text card titled by its label), subtitle (text cards' second line), button (what the pointer clicks)",
  media: "optional",
  beats: (content) => {
    const n = Math.max(1, Math.min(MAX_CARDS, Math.max(content.fileIds?.length ?? 0, content.labels?.length ?? 0)));
    const total = n + (content.button ? 4 : 2);
    return total + (total % 2);
  },
  build(input: TemplateInput): TemplateOutput {
    const { content, palette, layout, frames, beats, media, frame } = input;
    const { W, H, u, portrait } = layout;
    const files = content.fileIds ?? [];
    const labels = content.labels ?? [];
    const count = Math.max(files.length, labels.length);
    if (count === 0) refuse("ui_cards needs file_ids (media for the cards) or labels (text cards)");
    if (count > MAX_CARDS) refuse(`ui_cards shows at most ${MAX_CARDS} cards`);
    const { w, h } = cardSize(layout, count);
    const radius = Math.round(Math.min(w, h) * 0.07);
    const style: CardFrameStyle = {
      radius,
      border: { color: palette.dark ? palette.line : "#ffffff", width: Math.max(2, 5 * u) },
      shadow: { color: palette.shadow, opacity: palette.shadowOpacity * 1.6, offset: 14 * u },
    };
    const pad = cardFramePad(style);
    const places = slots(layout, count);
    const button = content.button?.replace(/\s+/g, " ").trim() ?? "";
    const front = portrait ? count - 1 : 0;

    // One entrance per beat, each short enough to land before the next.
    const enters = beats.entrances(count, frames, 14);
    const spacing = count > 1 ? enters[1]! - enters[0]! : beats.span(0, 1);
    const travel = Math.max(6, Math.min(16, spacing));
    // The pointer comes in on the beat after the last card, clicks on the next.
    const pointerBeat = beats.beatAfter(enters[count - 1]!);
    const pointerAt = beats.frame(pointerBeat);
    const clickAt = beats.frame(pointerBeat + beats.step);
    const clicking = button !== "" && clickAt + 12 <= frames;
    const pushFrom = clicking ? clickAt + 12 : enters[count - 1]! + travel + 4;

    const elements: Element[] = [];
    const cardMotion: Motion[] = [];
    for (let i = 0; i < count; i += 1) {
      const { rest } = places[i]!;
      const at = enters[i]!;
      let first;
      if (portrait) {
        const side = i % 2 === 0 ? -1 : 1;
        first = enter(rest, at, { dx: side * W * 0.95, rotation: side * 9, alpha: 1, frames: travel, ease: "out_strong" });
      } else if (count === 3 && i > 0) {
        // From behind the hero card to its side.
        const hero = places[0]!.rest;
        first = enter(rest, at, { dx: hero.x - rest.x, dy: hero.y - rest.y, s: 0.9, rotation: -rest.rotation, alpha: 1, frames: travel, ease: "out_back" });
      } else {
        first = enter(rest, at, { dy: H * 0.62, s: 0.92, rotation: 4, alpha: 1, frames: travel, ease: "out_strong" });
      }
      const motion = new Motion(first);
      // Portrait: older cards recede as each new one lands.
      if (portrait) {
        for (let j = i + 1; j < count; j += 1) {
          motion.stay(enters[j]!);
          const p = motion.pose;
          motion.to(enters[j]! + travel, { ...p, y: p.y - 12 * u, s: p.s * 0.965 }, "out");
        }
      }
      if (pushFrom < frames - 2) motion.stay(pushFrom).to(frames - 1, zoomed(motion.pose, PUSH, layout), "smooth");
      cardMotion.push(motion);
    }

    // Cards, bottom to top by depth.
    for (let i = 0; i < count; i += 1) {
      const depth = places[i]!.depth;
      const keys = cardMotion[i]!.keys;
      const file = files[i];
      const label = labels[i]?.trim() ?? "";
      const from = enters[i]!;
      if (file) {
        const m = media.get(file) as MotionMedia;
        const crop = cropToAspect(m, w / h);
        const card = mediaCard(`card-${i + 1}`, depth * 3, from, frames, m, frame.fps, { width: w, radius, crop }, keys);
        elements.push(card);
        const chip = label ? clampText(label, { size: 30 * u, font: "sans", bold: true }, w * (i === front && button && !portrait ? 0.5 : 0.8)) : "";
        elements.push(
          drawing(`card-${i + 1}-frame`, depth * 3 + 1, from, card.to, { width: w + 2 * pad, height: h + 2 * pad }, (d) => {
            cardFrame(d, pad, pad, w, h, style);
            if (chip) {
              const size = 30 * u;
              const cw = textWidth(chip, { size, font: "sans", bold: true }) * ROOMY + 2 * size;
              const ch = size * 2;
              const inset = 24 * u;
              // Cascaded cards cover each other's lower part: their chips sit at the top.
              const top = portrait ? pad + inset : pad + h - inset - ch;
              d.rect(pad + inset, top, cw, ch, { fill: "#ffffff", fillOpacity: 0.94, rx: ch / 2 });
              d.text(pad + inset + cw / 2, top + ch / 2 + size * 0.36, chip, { size, font: "sans", bold: true, fill: "#14161c", anchor: "middle" });
            }
          }, keys),
        );
      } else {
        elements.push(
          drawing(`card-${i + 1}`, depth * 3 + 1, from, frames, { width: w + 2 * pad, height: h + 2 * pad }, (d) => paintTextCard(d, pad, w, h, style, palette, u, label, content.subtitle?.trim() ?? ""), keys),
        );
      }
    }

    // The button on the front card, the pointer, the click.
    const cues = [...enters];
    if (button) {
      const fr = cardMotion[front]!;
      const bSize = Math.round(34 * u);
      const bh = Math.round(bSize * 2.1);
      const bw = textWidth(button, { size: bSize, font: "sans", bold: true }) * ROOMY + bh;
      const inset = 24 * u;
      // The button rides on the front card: its offset from the card's centre, scaled and turned with the card.
      const ox = w / 2 - inset - bw / 2;
      const oy = h / 2 - inset - bh / 2;
      const at = (p: Pose): Pose => {
        const a = (p.rotation * Math.PI) / 180;
        const dx = ox * p.s;
        const dy = oy * p.s;
        return { ...p, x: p.x + dx * Math.cos(a) - dy * Math.sin(a), y: p.y + dx * Math.sin(a) + dy * Math.cos(a) };
      };
      const buttonKeys = fr.keys.map((k) => key(k.frame, at(k.pose), k.ease));
      const pressKeys = clicking ? [key(clickAt, at(poseAt(fr.keys, clickAt)), "smooth")] : [];
      const paintButton = (done: boolean) => (d: Drawing) => {
        d.rect(0, 0, bw, bh, { fill: done ? palette.ink : palette.accent, rx: bh / 2 });
        if (done) {
          const c = bh * 0.26;
          d.polyline(
            [
              [bw / 2 - c, bh / 2],
              [bw / 2 - c * 0.25, bh / 2 + c * 0.75],
              [bw / 2 + c * 1.1, bh / 2 - c * 0.7],
            ],
            { stroke: palette.dark ? palette.background : "#ffffff", strokeWidth: bh * 0.1, linecap: "round", linejoin: "round" },
          );
        } else d.text(bw / 2, bh / 2 + bSize * 0.36, button, { size: bSize, font: "sans", bold: true, fill: palette.accentInk, anchor: "middle" });
      };
      const topTrack = 3 * count + 1;
      const switchAt = clicking ? clickAt + 4 : frames;
      const frontFrom = enters[front]!;
      const upTo = (frameNo: number) => buttonKeys.filter((k) => k.frame < frameNo);
      if (switchAt > frontFrom) {
        const pressed = clicking ? [...upTo(clickAt), ...pressKeys, key(switchAt, { ...pressKeys[0]!.pose, s: pressKeys[0]!.pose.s * 0.9 }, "out")] : buttonKeys;
        elements.push(drawing("card-button", topTrack, frontFrom, switchAt, { width: bw, height: bh }, paintButton(false), pressed.length > 0 ? pressed : buttonKeys));
      }
      if (clicking) {
        const p0 = pressKeys[0]!.pose;
        const after = new Motion(key(switchAt, { ...p0, s: p0.s * 0.9 }));
        after.to(switchAt + 8, p0, "out_back");
        for (const k of buttonKeys.filter((k) => k.frame > switchAt + 8)) after.to(k.frame, k.pose, k.ease);
        elements.push(cued(drawing("card-button-done", topTrack, switchAt, frames, { width: bw, height: bh }, paintButton(true), after.keys), clickAt));

        // The pointer: in from the lower right, onto the button, a press.
        const target = at(poseAt(fr.keys, clickAt));
        const size = 64 * u;
        const ptr = pose(target.x + bw * 0.12, target.y + bh * 0.12);
        const pm = new Motion(key(pointerAt, pose(W + size, H * (portrait ? 0.86 : 0.92), { rotation: -8 })));
        pm.to(clickAt, ptr, "in_out").to(clickAt + 4, { ...ptr, s: 0.84 }, "out").to(clickAt + 11, ptr, "out");
        if (pushFrom < frames - 2) pm.stay(pushFrom).to(frames - 1, zoomed(ptr, PUSH, layout), "smooth");
        elements.push(drawing("card-pointer", topTrack + 2, pointerAt, frames, { width: size * 0.8, height: size * 1.1, cx: size * 0.08, cy: size * 0.08 }, (d) => pointer(d, size * 0.08, size * 0.08, size, "#ffffff", "#14161c"), pm.keys));

        // A ripple from the click.
        const r = 46 * u;
        elements.push(
          drawing("card-ripple", topTrack + 1, clickAt, Math.min(frames, clickAt + 16), { width: 2 * r + 8 * u, height: 2 * r + 8 * u }, (d) => d.circle(r + 4 * u, r + 4 * u, r, { stroke: palette.accent, strokeWidth: 5 * u }), [
            key(clickAt, pose(target.x, target.y, { s: 0.25, alpha: 0.9 })),
            key(Math.min(frames - 1, clickAt + 14), pose(target.x, target.y, { s: 1, alpha: 0 }), "out"),
          ]),
        );
        cues.push(pointerAt, clickAt);
      }
    }
    return { elements, cues };
  },
};
