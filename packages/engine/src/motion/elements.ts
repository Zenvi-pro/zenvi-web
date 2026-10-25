/**
 * Building blocks the templates share: the frame's layout units, poses and
 * keys, entrances, and the two element kinds (a drawing, a media card).
 */

import { Drawing, type TextRun } from "./svg.js";
import { ROOMY, textWidth } from "./text.js";
import type { Ease, Element, Key, MediaSource, MotionFrame, MotionMedia, Pose } from "./types.js";

/** Layout units of a frame: `u` is 1 px at 1080 on the short side; margins and type scale with it. */
export interface Layout {
  W: number;
  H: number;
  u: number;
  /** Outer margin, px. */
  m: number;
  portrait: boolean;
  /** Width / height. */
  aspect: number;
}

export function layoutOf(frame: MotionFrame): Layout {
  const W = frame.width;
  const H = frame.height;
  const u = Math.min(W, H) / 1080;
  return { W, H, u, m: Math.round(64 * u), portrait: H > W * 1.05, aspect: W / H };
}

export function pose(x: number, y: number, extra: Partial<Omit<Pose, "x" | "y">> = {}): Pose {
  return { x, y, s: extra.s ?? 1, alpha: extra.alpha ?? 1, rotation: extra.rotation ?? 0, ...(extra.sx !== undefined ? { sx: extra.sx } : {}) };
}

export function key(frame: number, p: Pose, ease: Ease = "out"): Key {
  return { frame: Math.round(frame), pose: p, ease };
}

/** How an element arrives. Offsets are in px (dx, dy) and relative scale. */
export interface Entrance {
  dx?: number;
  dy?: number;
  s?: number;
  /** Horizontal stretch to start from (0: a line drawing on from its centre point). */
  sx?: number;
  alpha?: number;
  rotation?: number;
  frames: number;
  ease?: Ease;
}

/** Keys of an entrance at frame `at` into `rest` (two keys; the element is invisible before `at` anyway). */
export function enter(rest: Pose, at: number, e: Entrance): Key[] {
  const from: Pose = {
    x: rest.x + (e.dx ?? 0),
    y: rest.y + (e.dy ?? 0),
    s: rest.s * (e.s ?? 1),
    alpha: e.alpha ?? 0,
    rotation: rest.rotation + (e.rotation ?? 0),
    ...(e.sx !== undefined ? { sx: e.sx } : rest.sx !== undefined ? { sx: rest.sx } : {}),
  };
  return [key(at, from), key(at + Math.max(1, Math.round(e.frames)), rest, e.ease ?? "out")];
}

/** The pose `p` seen through a camera zoomed by `z` about the frame centre. */
export function zoomed(p: Pose, z: number, layout: Layout): Pose {
  return { ...p, x: layout.W / 2 + (p.x - layout.W / 2) * z, y: layout.H / 2 + (p.y - layout.H / 2) * z, s: p.s * z };
}

/**
 * A drawing element: `draw(d)` paints into a Drawing of `width` × `height`
 * (its own coordinates, frame px at rest) whose centre is (cx, cy).
 */
export function drawing(
  name: string,
  track: number,
  from: number,
  to: number,
  box: { width: number; height: number; cx?: number; cy?: number },
  paint: (d: Drawing) => void,
  keys: Key[],
): Element {
  const width = Math.max(1, Math.ceil(box.width));
  const height = Math.max(1, Math.ceil(box.height));
  return {
    name,
    track,
    from,
    to,
    source: {
      kind: "svg",
      name,
      width,
      height,
      cx: box.cx ?? width / 2,
      cy: box.cy ?? height / 2,
      draw: (k) => {
        const d = new Drawing(width, height, k);
        paint(d);
        return d;
      },
    },
    keys,
  };
}

/** A full-frame drawing that never moves (backgrounds, scrims). */
export function backdrop(name: string, track: number, from: number, to: number, layout: Layout, paint: (d: Drawing) => void, keys?: Key[]): Element {
  return drawing(name, track, from, to, { width: layout.W, height: layout.H }, paint, keys ?? [key(from, pose(layout.W / 2, layout.H / 2))]);
}

/** Slowest a video plays to fill its time. */
const MIN_SPEED = 0.5;

/**
 * Where a media element starts in its file and how fast it plays to fill
 * `seconds`: a third of the way into longer clips (stock footage often opens
 * on a rack focus), slowed down to half speed for short ones. `seconds` comes
 * back shorter when even that cannot fill it.
 */
export function mediaWindow(media: MotionMedia, seconds: number): { start: number; speed: number; seconds: number } {
  if (media.kind === "image") return { start: 0, speed: 1, seconds };
  const usable = media.duration > 3 ? [0.2, media.duration - 0.1] : [0, media.duration];
  const length = usable[1]! - usable[0]!;
  if (length >= seconds) return { start: usable[0]! + (length - seconds) * 0.3, speed: 1, seconds };
  const speed = Math.max(MIN_SPEED, length / seconds);
  return { start: usable[0]!, speed, seconds: Math.min(seconds, length / speed) };
}

/**
 * A media card: the picture (or its crop window) `width` px wide, rounded by
 * `radius`. `start` pins the source in-point (a crop lifted out of a shot
 * shows the shot's moment).
 */
export function mediaCard(
  name: string,
  track: number,
  from: number,
  to: number,
  media: MotionMedia,
  fps: number,
  o: { width: number; radius: number; crop?: MediaSource["crop"]; start?: number },
  keys: Key[],
): Element {
  const win = o.start !== undefined && media.kind === "video" ? pinnedWindow(media, o.start, (to - from) / fps) : mediaWindow(media, (to - from) / fps);
  const end = Math.min(to, from + Math.max(1, Math.floor(win.seconds * fps + 1e-6)));
  return {
    name,
    track,
    from,
    to: end,
    source: { kind: "media", media, mode: "fit", width: o.width, radius: o.radius, ...(o.crop ? { crop: o.crop } : {}), start: win.start, speed: win.speed },
    keys,
  };
}

/** A window from a fixed in-point: as much of `seconds` as the file has left. */
function pinnedWindow(media: MotionMedia, start: number, seconds: number): { start: number; speed: number; seconds: number } {
  const from = Math.max(0, Math.min(start, media.duration));
  return { start: from, speed: 1, seconds: Math.min(seconds, Math.max(0, media.duration - from)) };
}

/** A media element covering the whole frame (scale mode Crop): it may only scale and fade. */
export function mediaFill(name: string, track: number, from: number, to: number, media: MotionMedia, fps: number, layout: Layout, keys?: Key[]): Element {
  const win = mediaWindow(media, (to - from) / fps);
  const end = Math.min(to, from + Math.max(1, Math.floor(win.seconds * fps + 1e-6)));
  return {
    name,
    track,
    from,
    to: end,
    source: { kind: "media", media, mode: "fill", width: layout.W, radius: 0, start: win.start, speed: win.speed },
    keys: keys ?? [key(from, pose(layout.W / 2, layout.H / 2))],
  };
}

/** A centred crop window that gives a picture the aspect `aspect` (w / h), or none when it already has it. */
export function cropToAspect(media: MotionMedia, aspect: number): MediaSource["crop"] | undefined {
  const own = media.width / media.height;
  if (Math.abs(own / aspect - 1) < 0.01) return undefined;
  if (own > aspect) {
    const cut = (1 - aspect / own) / 2;
    return { left: cut, right: cut, top: 0, bottom: 0 };
  }
  const cut = (1 - own / aspect) / 2;
  return { left: 0, right: 0, top: cut, bottom: cut };
}

/** A block of text: its lines, look and how it hangs from its anchor point. */
export interface TextBlock {
  lines: readonly string[];
  size: number;
  font: "sans" | "mono";
  bold?: boolean;
  tracking?: number;
  fill: string;
  opacity?: number;
  anchor: "start" | "middle" | "end";
  /** Line height, × size. */
  leading?: number;
}

/** Ascent and descent of the stacks' faces, × size (room above the first baseline and below the last). */
const ASCENT = 0.95;
const DESCENT = 0.28;

/** Where a text block sits on the frame: its drawing's box. */
export interface TextBox {
  left: number;
  top: number;
  width: number;
  height: number;
  /** The block's visual centre on the frame (its rest pose). */
  x: number;
  y: number;
}

/** The box of a text block whose anchor is at `x` and first baseline at `y` on the frame. */
export function textBox(block: TextBlock, x: number, y: number): TextBox {
  const pad = Math.ceil(block.size * 0.18);
  const widest = Math.max(...block.lines.map((line) => textWidth(line, block)), 1);
  const width = Math.ceil(widest * (block.font === "mono" ? 1.02 : ROOMY) + 2 * pad);
  const lead = (block.leading ?? 1.08) * block.size;
  const height = Math.ceil((block.lines.length - 1) * lead + (ASCENT + DESCENT) * block.size + 2 * pad);
  const left = block.anchor === "start" ? x - pad : block.anchor === "middle" ? x - width / 2 : x - width + pad;
  const top = y - pad - ASCENT * block.size;
  return { left, top, width, height, x: left + width / 2, y: top + height / 2 };
}

/** Paint a text block into a drawing whose box is `box` (from `textBox`). */
export function paintText(d: Drawing, block: TextBlock, box: TextBox, runs?: (line: string, index: number) => readonly TextRun[]): void {
  const pad = Math.ceil(block.size * 0.18);
  const x = block.anchor === "start" ? pad : block.anchor === "middle" ? box.width / 2 : box.width - pad;
  const lead = (block.leading ?? 1.08) * block.size;
  block.lines.forEach((line, i) => {
    d.text(x, pad + ASCENT * block.size + i * lead, runs ? runs(line, i) : line, {
      size: block.size,
      font: block.font,
      bold: block.bold,
      tracking: block.tracking,
      fill: block.fill,
      opacity: block.opacity,
      anchor: block.anchor,
    });
  });
}

/** A text element at rest at its box (keys default to one still key at `from`). */
export function textElement(name: string, track: number, from: number, to: number, block: TextBlock, box: TextBox, keys?: Key[]): Element {
  return drawing(name, track, from, to, { width: box.width, height: box.height }, (d) => paintText(d, block, box), keys ?? [key(from, pose(box.x, box.y))]);
}

/** The pose of the last key at or before `frame` (the pose there while the element is still). */
export function poseAt(keys: readonly Key[], frame: number): Pose {
  let out = keys[0]!.pose;
  for (const k of keys) if (k.frame <= frame) out = k.pose;
  return out;
}

/**
 * An element's keys built in time order: `to` moves to a pose, `stay` holds
 * the current pose until a frame (so the next move starts there). Keys at or
 * before the last one replace it, so a schedule squeezed by a fast tempo
 * never writes keys out of order.
 */
export class Motion {
  readonly keys: Key[];

  constructor(first: Key[] | Key) {
    this.keys = Array.isArray(first) ? [...first] : [first];
    if (this.keys.length === 0) throw new Error("a motion needs a first key");
  }

  get pose(): Pose {
    return this.keys[this.keys.length - 1]!.pose;
  }

  get frame(): number {
    return this.keys[this.keys.length - 1]!.frame;
  }

  to(frame: number, p: Pose, ease: Ease = "out"): this {
    const k = key(frame, p, ease);
    while (this.keys.length > 1 && k.frame <= this.frame) this.keys.pop();
    if (k.frame <= this.frame) this.keys[this.keys.length - 1] = { ...k, frame: this.frame };
    else this.keys.push(k);
    return this;
  }

  stay(frame: number): this {
    if (Math.round(frame) > this.frame) this.keys.push(key(frame, this.pose, "smooth"));
    return this;
  }
}

/** `el`, its entrance counted from the beat at `cue` (it starts a few frames after it). */
export function cued(el: Element, cue: number): Element {
  return { ...el, cue };
}
