/**
 * Parts the layout templates share (card_cascade, compare, window_cascade,
 * pass_wipe): a label chip, a blurred and dimmed copy of a clip behind a
 * layout, the in-point that frame-locks several clips, and the window of a
 * picture that covers the frame while centred on a point.
 */

import { defaultEffectJson } from "../../effects/registry.js";
import { makeKeyframePoint } from "../../keyframe/edit.js";
import type { Effect } from "../../model/types.js";
import { drawing, enter, key, mediaFill, mediaWindow, Motion, pose } from "../elements.js";
import { typeSize, type Layout } from "../layout.js";
import { clampText, ROOMY, textWidth } from "../text.js";
import type { Element, Key, MotionMedia, WindowKey } from "../types.js";

const constant = (value: number) => ({ Points: [makeKeyframePoint(1, value)] });

/** A label chip's size for `text` (label type, one line clamped to `maxWidth`). */
export function chipSize(layout: Layout, text: string, maxWidth: number): { text: string; size: number; w: number; h: number } {
  const size = typeSize(layout, "label", 30 * layout.u);
  const shown = clampText(text, { size, font: "sans", bold: true }, maxWidth / ROOMY - 2 * size);
  return { text: shown, size, w: textWidth(shown, { size, font: "sans", bold: true }) * ROOMY + 2 * size, h: size * 2 };
}

/** A pill label centred at (x, y) that pops in at `at` and stays to `to`. Light chip on dark footage unless `dark`. */
export function chipElement(name: string, track: number, at: number, to: number, layout: Layout, text: string, x: number, y: number, maxWidth: number, o: { dark?: boolean } = {}): Element {
  const c = chipSize(layout, text, maxWidth);
  const fill = o.dark ? "#14161c" : "#ffffff";
  const ink = o.dark ? "#ffffff" : "#14161c";
  return drawing(name, track, at, to, { width: c.w, height: c.h }, (d) => {
    d.rect(0, 0, c.w, c.h, { fill, fillOpacity: 0.94, rx: c.h / 2 });
    d.text(c.w / 2, c.h / 2 + c.size * 0.36, c.text, { size: c.size, font: "sans", bold: true, fill: ink, anchor: "middle" });
  }, enter(pose(x, y), at, { s: 0.7, alpha: 0, frames: 8, ease: "out_back" }));
}

/** Radius of the backdrop blur, source px per 1080 px of the picture's short side. */
const BLUR = 28;

/**
 * A frame-filling copy of `media` behind a layout, blurred (libopenshot Blur,
 * scaled to the source's size) and dimmed (Brightness), muted. `start` pins
 * its in-point (the layout's clips are frame-locked to it).
 */
export function blurredBackdrop(name: string, track: number, from: number, to: number, media: MotionMedia, fps: number, layout: Layout, start?: number): Element {
  const el = mediaFill(name, track, from, to, media, fps, layout, [key(from, pose(layout.W / 2, layout.H / 2, { s: 1.06 }))]);
  if (start !== undefined && media.kind === "video" && el.source.kind === "media") el.source = { ...el.source, start, speed: 1 };
  const radius = Math.round((BLUR * Math.min(media.width, media.height)) / 1080);
  const blur = { ...stripId(defaultEffectJson("Blur", "TEMPLATE00")), horizontal_radius: constant(radius), vertical_radius: constant(radius), sigma: constant(Math.max(3, radius / 3)), iterations: constant(3) };
  const dim = { ...stripId(defaultEffectJson("Brightness", "TEMPLATE00")), brightness: constant(-0.18) };
  return { ...el, effects: [blur, dim] as Omit<Effect, "id">[] };
}

function stripId(effect: Effect): Omit<Effect, "id"> {
  const { id: _id, ...rest } = effect;
  return rest;
}

/**
 * One in-point that frame-locks `files` for `seconds`: the moment every one
 * of them has (the shortest video's window, from mediaWindow), so passes of
 * one shot, or a raw take and its edit, show the same frame side by side.
 * Undefined when every file is a photo.
 */
export function lockedStart(files: readonly MotionMedia[], seconds: number): number | undefined {
  const videos = files.filter((m) => m.kind === "video");
  if (videos.length === 0) return undefined;
  const shortest = videos.reduce((a, b) => (b.duration < a.duration ? b : a));
  return mediaWindow(shortest, seconds).start;
}

/** Width a picture is drawn at to cover the frame (Best Fit keeps its aspect). */
export function coverWidth(media: MotionMedia, layout: Layout): number {
  const aspect = media.width / media.height;
  return Math.max(layout.W, layout.H * aspect);
}

/** A frame point as a share of a picture drawn `width` px wide with its centre at (cx, cy). */
export function onPicture(media: MotionMedia, width: number, cx: number, cy: number, x: number, y: number): { x: number; y: number } {
  const height = (width * media.height) / media.width;
  return { x: (x - cx) / width + 0.5, y: (y - cy) / height + 0.5 };
}

/**
 * A frame-filling clip playing from a fixed in-point `start` (frame-locked
 * with the others), as long as the file allows within `from`-`to`.
 */
export function lockedFill(name: string, track: number, from: number, to: number, media: MotionMedia, fps: number, layout: Layout, start: number | undefined, keys?: Key[]): Element {
  const el = mediaFill(name, track, from, to, media, fps, layout, keys);
  if (start === undefined || media.kind !== "video" || el.source.kind !== "media") return el;
  const left = Math.floor((media.duration - start) * fps + 1e-6);
  return { ...el, to: Math.min(to, from + Math.max(1, left)), source: { ...el.source, start, speed: 1 } };
}

/** Frames of a window's move to full bleed, and of the settle after it. */
export const BLEED = 12;
export const SETTLE = 10;
/** Punch of a picture filling the frame. */
const PUNCH = 1.3;

/**
 * A windowed picture going full bleed at `at`: it slides to the frame's
 * centre and punches in while its window's edge grows (linear for the
 * field's 6 %), the last two frames filling the rest of the frame, then it
 * settles back to the frame's size when there is room (`frames`). Returns
 * the picture's motion and its window keys from `at` on.
 */
export function fullBleed(motion: Motion, at: number, frames: number, layout: Layout): WindowKey[] {
  const { W, H } = layout;
  motion.stay(at).to(at + BLEED, pose(W / 2, H / 2, { s: PUNCH }), "in");
  if (at + BLEED + SETTLE <= frames) motion.to(at + BLEED + SETTLE, pose(W / 2, H / 2), "out");
  return [
    { frame: at, grow: 0, ease: "smooth" },
    { frame: at + BLEED - 2, grow: 0.055, ease: "in" },
    { frame: at + BLEED, grow: 1.1, ease: "linear" },
  ];
}
