/**
 * compare: two to four clips frame-locked side by side for an A/B (T033:
 * raw vs edit, before / after, three takes), every clip playing from one
 * in-point so the same moment shows in each panel.
 *
 *   side_by_side  columns with a thin gutter (the field shows through as the
 *                 divider); the outer panels slide in from their sides, the
 *                 inner from below, one per half beat (default landscape)
 *   stacked       rows, the same from the top and bottom (default portrait)
 *   diagonal      two clips split by a slanted rule: the second, seen through
 *                 a polygon window (a Mask effect), pushes in from its side
 *                 carrying the rule on its edge
 *   offset        two or three framed boxes staggered over a blurred, dimmed
 *                 copy of the last clip, labels under them
 *
 * Labels pop in on the half beat after the last panel lands. `replay` ends
 * on the last clip alone: on a beat about 60 % of the way in it slides to
 * the centre and fills the frame (side by side, stacked, diagonal: the clip
 * is drawn whole behind its panel's window, which grows to the whole
 * picture; offset: its box grows to cover the frame).
 * `sound` keeps the first clip's own sound.
 */

import { cropToAspect, drawing, enter, mediaCard, Motion, pose } from "../elements.js";
import { backdrop } from "../elements.js";
import type { Layout } from "../layout.js";
import { cardFrame, cardFramePad, type CardFrameStyle } from "../shapes.js";
import { refuse, type TemplateInput, type TemplateOutput, type TemplateSpec } from "../template.js";
import type { Rect } from "../tiles.js";
import type { Element, Key, MediaSource, MotionMedia, Pose } from "../types.js";
import { blurredBackdrop, BLEED, chipElement, chipSize, coverWidth, fullBleed, lockedStart, onPicture } from "./layout-parts.js";

export const COMPARE_VARIANTS = ["side_by_side", "stacked", "diagonal", "offset"] as const;
type Variant = (typeof COMPARE_VARIANTS)[number];

/** Frames a panel takes to arrive. */
const TRAVEL = 10;
/** Frames the replay takes to grow to the full frame. */
const GROW = 12;

interface Panel {
  rect: Rect;
  /** Off-frame offset it arrives from. */
  from: { dx: number; dy: number };
}

function splitPanels(variant: "side_by_side" | "stacked", count: number, layout: Layout, gap: number): Panel[] {
  const { W, H } = layout;
  return Array.from({ length: count }, (_, i) => {
    const outer = i === 0 ? -1 : i === count - 1 ? 1 : 0;
    if (variant === "side_by_side") {
      const w = (W - (count - 1) * gap) / count;
      const rect = { x: i * (w + gap), y: 0, w, h: H };
      return { rect, from: outer < 0 ? { dx: -(rect.x + rect.w), dy: 0 } : outer > 0 ? { dx: W - rect.x, dy: 0 } : { dx: 0, dy: H } };
    }
    const h = (H - (count - 1) * gap) / count;
    const rect = { x: 0, y: i * (h + gap), w: W, h };
    return { rect, from: outer < 0 ? { dx: 0, dy: -(rect.y + rect.h) } : outer > 0 ? { dx: 0, dy: H - rect.y } : { dx: W, dy: 0 } };
  });
}

/** Box centres and width (shares of the frame) of the offset layout. */
function offsetBoxes(count: number, layout: Layout, aspect: number): Rect[] {
  const { W, H, portrait } = layout;
  const spots = portrait
    ? count === 2
      ? [[0.34, 0.4], [0.66, 0.6]]
      : [[0.3, 0.3], [0.5, 0.5], [0.7, 0.7]]
    : count === 2
      ? [[0.34, 0.45], [0.66, 0.55]]
      : [[0.22, 0.45], [0.5, 0.55], [0.78, 0.45]];
  // As big as the stagger allows: a share of the frame's height, narrower when the boxes would collide.
  const maxH = H * (portrait ? (count === 2 ? 0.36 : 0.28) : count === 2 ? 0.66 : 0.56);
  const maxW = W * (portrait ? (count === 2 ? 0.56 : 0.44) : count === 2 ? 0.4 : 0.28);
  const h = Math.min(maxH, maxW / aspect);
  const w = h * aspect;
  return spots.map(([x, y]) => ({ x: x! * W - w / 2, y: y! * H - h / 2, w, h }));
}

const centreOf = (r: Rect): Pose => pose(r.x + r.w / 2, r.y + r.h / 2);

export const compare: TemplateSpec = {
  id: "compare",
  summary:
    "Two to four clips frame-locked (one in-point) for an A/B: side by side or stacked with a thin divider, split on a slanted rule (diagonal), or as staggered framed boxes over a blurred copy (offset); panels slide in one per half beat, labels pop in, and replay ends on the last clip grown back to the full frame.",
  reads: "file_ids (the clips, in order: raw then edit), labels (one per clip: before, after), variant (side_by_side | stacked | diagonal | offset; default by the frame's shape), replay (end on the last clip full frame), sound (keep the first clip's sound), backdrop (offset: false for the palette's field instead of the blur)",
  media: "required",
  beats: (content) => {
    const n = Math.max(2, Math.min(4, content.fileIds?.length ?? 2));
    const total = Math.ceil(n / 2) + (content.replay ? 6 : 4);
    return total + (total % 2);
  },
  build(input: TemplateInput): TemplateOutput {
    const { content, palette, layout, frames, beats, media, frame } = input;
    const { W, H, u, portrait } = layout;
    const files = (content.fileIds ?? []).map((id) => media.get(id) as MotionMedia);
    const variant = (content.variant ?? (portrait ? "stacked" : "side_by_side")) as Variant;
    if (!(COMPARE_VARIANTS as readonly string[]).includes(variant)) refuse(`compare variant is ${COMPARE_VARIANTS.join(", ")} (got ${content.variant})`);
    const most = variant === "diagonal" ? 2 : variant === "offset" ? 3 : 4;
    if (files.length < 2 || files.length > most) refuse(`compare ${variant} takes ${most === 2 ? "2" : `2 to ${most}`} file_ids (got ${files.length})`);
    const count = files.length;
    const fps = frame.fps;
    const start = lockedStart(files, frames / fps);
    const at = (i: number) => beats.frame(i * 0.5);
    const enters = Array.from({ length: count }, (_, i) => at(i));
    const labelsAt = at(count);
    if (labelsAt + 8 > frames) refuse(`compare needs at least ${((labelsAt + 8) / fps).toFixed(1)} s for ${count} panels at this tempo`);
    // The replay starts on a beat about 60 % of the way in, once the labels have been read.
    const replayBeat = Math.max(beats.beatAfter(labelsAt + 8), beats.beatAfter(Math.round(frames * 0.6) - 1));
    const replayAt = content.replay ? beats.frame(replayBeat) : frames;
    if (content.replay && replayAt + BLEED + 4 > frames) refuse(`compare with replay needs a longer duration (the replay starts at ${(replayAt / fps).toFixed(1)} s)`);
    const labels = (content.labels ?? []).map((l) => l.trim());
    const elements: Element[] = [];
    const cues = [...enters];
    const card = (i: number, track: number, o: { width: number; radius: number; crop?: MediaSource["crop"] }, keys: Key[]): Element => {
      let el = mediaCard(`panel-${i + 1}`, track, enters[i]!, frames, files[i]!, fps, { ...o, ...(start !== undefined ? { start } : {}) }, keys);
      if (content.sound && i === 0) el = { ...el, source: { ...(el.source as MediaSource), sound: true } };
      return { ...el, cue: enters[i]! };
    };
    const chipKeys = (el: Element): Element => (content.replay ? { ...el, keys: new Motion(el.keys).stay(replayAt).to(replayAt + 6, { ...el.keys[el.keys.length - 1]!.pose, alpha: 0 }, "out").keys } : el);
    const chipAt = (i: number, x: number, y: number, maxWidth: number, dark = false) => {
      if (!labels[i]) return;
      elements.push(chipKeys(chipElement(`label-${i + 1}`, 20 + i, labelsAt, frames, layout, labels[i]!, x, y, maxWidth, { dark })));
    };
    if (content.replay) cues.push(replayAt);
    if (labels.some((l) => l)) cues.push(labelsAt);
    const { safe } = layout;
    const inset = 22 * u;

    if (variant === "side_by_side" || variant === "stacked") {
      const gap = Math.max(2, Math.round(8 * u));
      elements.push(backdrop("compare-bg", 0, 0, frames, layout, (d) => d.rect(0, 0, W, H, { fill: palette.background })));
      splitPanels(variant, count, layout, gap).forEach((p, i) => {
        const rest = centreOf(p.rect);
        const crop = cropToAspect(files[i]!, p.rect.w / p.rect.h);
        const last = i === count - 1;
        const arrive = enter(rest, enters[i]!, { ...p.from, alpha: 1, frames: TRAVEL, ease: "out_strong" });
        if (content.replay && last) {
          // The replayed clip is drawn whole, covering the frame from its panel's centre, seen through the panel as a
          // window: going full bleed then shows the whole clip, not its panel's crop blown up.
          const f = files[i]!;
          const width = coverWidth(f, layout);
          const r = p.rect;
          const points = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(([x, y]) => onPicture(f, width, rest.x, rest.y, x!, y!));
          const motion = new Motion(arrive);
          const windowKeys = [{ frame: enters[i]!, grow: 0, ease: "out" as const }, ...fullBleed(motion, replayAt, frames, layout)];
          const panel = card(i, 1 + i, { width, radius: 0 }, motion.keys);
          elements.push({ ...panel, source: { ...(panel.source as MediaSource), window: { points, feather: 0.003, keys: windowKeys } } });
        } else elements.push(card(i, 1 + i, { width: p.rect.w, radius: 0, ...(crop ? { crop } : {}) }, arrive));
        const c = labels[i] ? chipSize(layout, labels[i]!, p.rect.w - 2 * inset) : null;
        if (c) chipAt(i, Math.max(p.rect.x, safe.left) + inset + c.w / 2, Math.min(p.rect.y + p.rect.h, safe.bottom) - inset - c.h / 2, p.rect.w - 2 * inset);
      });
      return { elements, cues };
    }

    if (variant === "diagonal") {
      // The rule runs through the frame's centre, leaning t px each way: across a wide frame, down a tall one.
      const t = portrait ? 0.07 * H : 0.1 * W;
      const [a, b] = files as [MotionMedia, MotionMedia];
      const restA = pose(W / 2, H / 2);
      elements.push(card(0, 1, { width: coverWidth(a, layout), radius: 0 }, enter(restA, enters[0]!, { s: 1.08, alpha: 0, frames: TRAVEL, ease: "out" })));
      // Window of the second clip, frame px overscanned 10 %: the side right of (below) the rule.
      const quad: [number, number][] = portrait
        ? [[-0.1 * W, H / 2 + 1.2 * t], [1.1 * W, H / 2 - 1.2 * t], [1.1 * W, 1.1 * H], [-0.1 * W, 1.1 * H]]
        : [[W / 2 + 1.2 * t, -0.1 * H], [1.1 * W, -0.1 * H], [1.1 * W, 1.1 * H], [W / 2 - 1.2 * t, 1.1 * H]];
      const widthB = coverWidth(b, layout);
      const points = quad.map(([x, y]) => onPicture(b, widthB, W / 2, H / 2, x, y));
      const from = portrait ? { dx: 0, dy: H / 2 + 1.2 * t } : { dx: W / 2 + 1.2 * t, dy: 0 };
      const keysB = enter(pose(W / 2, H / 2), enters[1]!, { ...from, alpha: 1, frames: TRAVEL, ease: "out_strong" });
      const motionB = new Motion(keysB);
      const windowKeys = [{ frame: enters[1]!, grow: 0, ease: "out" as const }, ...(content.replay ? fullBleed(motionB, replayAt, frames, layout) : [])];
      const panelB = card(1, 2, { width: widthB, radius: 0 }, motionB.keys);
      elements.push({ ...panelB, source: { ...(panelB.source as MediaSource), window: { points, feather: 0.004, keys: windowKeys } } });
      // The rule rides on the second clip's edge.
      const length = Math.hypot(portrait ? W * 1.2 : 2.4 * t, portrait ? 2.4 * t : H * 1.2);
      const angle = portrait ? (-Math.atan2(2 * t, W) * 180) / Math.PI : (Math.atan2(2 * t, H) * 180) / Math.PI;
      const thick = Math.max(4, 8 * u);
      const ruleKeys = keysB.map((k) => ({ ...k, pose: { ...k.pose, rotation: angle } }));
      const ruleTo = content.replay ? replayAt + 6 : frames;
      const rule = drawing("compare-rule", 3, enters[1]!, ruleTo, portrait ? { width: length, height: thick } : { width: thick, height: length }, (d) => d.rect(0, 0, portrait ? length : thick, portrait ? thick : length, { fill: "#ffffff" }), content.replay ? new Motion(ruleKeys).stay(replayAt).to(replayAt + 6, { ...ruleKeys[ruleKeys.length - 1]!.pose, alpha: 0 }, "out").keys : ruleKeys);
      elements.push({ ...rule, cue: enters[1]! });
      const ca = labels[0] ? chipSize(layout, labels[0], W * 0.4) : null;
      const cb = labels[1] ? chipSize(layout, labels[1], W * 0.4) : null;
      if (ca) chipAt(0, safe.left + inset + ca.w / 2, (portrait ? safe.top : safe.bottom) + (portrait ? 1 : -1) * (inset + ca.h / 2), W * 0.4);
      if (cb) chipAt(1, safe.right - inset - cb.w / 2, safe.bottom - inset - cb.h / 2, W * 0.4);
      return { elements, cues };
    }

    // offset: framed boxes over a blurred copy of the last clip.
    const aspect = Math.min(1.4, Math.max(0.5, files[0]!.width / files[0]!.height));
    const boxes = offsetBoxes(count, layout, aspect);
    if (content.backdrop === false) elements.push(backdrop("compare-bg", 0, 0, frames, layout, (d) => d.rect(0, 0, W, H, { fill: palette.background })));
    else elements.push(blurredBackdrop("compare-bg", 0, 0, frames, files[count - 1]!, fps, layout));
    const style: CardFrameStyle = { radius: Math.round(Math.min(boxes[0]!.w, boxes[0]!.h) * 0.05), border: { color: "#ffffff", width: Math.max(2, 3 * u) }, shadow: { color: "#000000", opacity: 0.35, offset: 12 * u } };
    const pad = cardFramePad(style);
    boxes.forEach((box, i) => {
      const rest = centreOf(box);
      const crop = cropToAspect(files[i]!, aspect);
      const arrive = enter(rest, enters[i]!, { dy: 0.12 * H, s: 0.92, alpha: 0, frames: TRAVEL, ease: "out_strong" });
      const grows = content.replay === true && i === count - 1;
      // The replayed box squares its corners as it grows (keyed corner_radius); its frame fades out.
      const keys = grows
        ? new Motion(arrive.map((k) => ({ ...k, pose: { ...k.pose, radius: style.radius } })))
            .stay(replayAt)
            .to(replayAt + GROW, { ...pose(W / 2, H / 2, { s: Math.max(W / box.w, H / box.h) * 1.002 }), radius: 0 }, "in_out").keys
        : arrive;
      const panel = card(i, 1 + 2 * i, { width: box.w, radius: style.radius, ...(crop ? { crop } : {}) }, keys);
      elements.push(panel);
      const frameKeys = grows ? new Motion(arrive).stay(replayAt).to(replayAt + 6, { ...rest, alpha: 0 }, "out").keys : arrive;
      const frameTo = Math.min(panel.to, grows ? replayAt + 6 : frames);
      elements.push({ ...drawing(`panel-${i + 1}-frame`, 2 + 2 * i, enters[i]!, frameTo, { width: box.w + 2 * pad, height: box.h + 2 * pad }, (d) => cardFrame(d, pad, pad, box.w, box.h, style), frameKeys), cue: enters[i]! });
      const c = labels[i] ? chipSize(layout, labels[i]!, box.w) : null;
      if (c) chipAt(i, rest.x, Math.min(box.y + box.h + inset + c.h / 2, safe.bottom - c.h / 2), box.w);
    });
    return { elements, cues };
  },
};
