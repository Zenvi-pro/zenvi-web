/**
 * The frame as every template lays it out: units and margins, the area
 * that stays clear of a platform's UI, and the smallest type of each role.
 *
 *   units      `u` is 1 px at 1080 on the frame's short side; margins and
 *              preferred sizes scale with it.
 *   type       every word is set at its role's floor or larger, a share of the
 *              frame's short side (a phone shows either orientation across its
 *              width): label 3 %, body and captions 4 %, headings 7.5 %. Text
 *              that cannot fit at its floor wraps onto more lines, then is cut
 *              with an ellipsis (or refused, where a template cannot cut it);
 *              it never shrinks under the floor.
 *   safe area  9:16 and taller frames keep words, and the button a pointer
 *              presses, out of the platforms' UI: the top 8 % (tabs, search),
 *              the bottom 15 % (caption, sound, account) and the right 11 %
 *              (like, comment, share). Pictures may run under those bands.
 *              Groups stay centred on the frame's vertical axis, so a centred
 *              line is at most `centredWidth` wide, and are centred on the
 *              safe area's middle (`opticalCentre`, above the frame's middle).
 *              Other frames: the outer margin all round.
 */

import { balanceLines, clampText, fitSize, textWidth, type TextStyle } from "./text.js";
import type { MotionFrame } from "./types.js";

export const TYPE_ROLES = ["label", "body", "heading"] as const;
export type TypeRole = (typeof TYPE_ROLES)[number];

/** Smallest type of each role, as a share of the frame's short side. */
export const TYPE_FLOOR: Readonly<Record<TypeRole, number>> = { label: 0.03, body: 0.04, heading: 0.075 };

/** Bands of a 9:16 frame that the platforms draw their UI over, as shares of its height (top, bottom) and width (right). */
export const PLATFORM_BANDS = { top: 0.08, bottom: 0.15, right: 0.11 } as const;

/** Frames at least this tall for their width get the platform bands (9:16 is 1.78; 4:5 and square feed posts are not covered). */
const TALL = 1.6;

/** Where words and controls may sit, frame px. */
export interface SafeArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Layout {
  W: number;
  H: number;
  u: number;
  /** Outer margin, px. */
  m: number;
  portrait: boolean;
  /** 9:16 or taller: the platform bands are kept clear. */
  tall: boolean;
  /** Width / height. */
  aspect: number;
  safe: SafeArea;
  /** Smallest size of each type role, px. */
  type: Readonly<Record<TypeRole, number>>;
}

export function layoutOf(frame: MotionFrame): Layout {
  const W = frame.width;
  const H = frame.height;
  const short = Math.min(W, H);
  const u = short / 1080;
  const m = Math.round(64 * u);
  const tall = H >= W * TALL;
  const safe: SafeArea = tall
    ? { left: m, top: Math.round(H * PLATFORM_BANDS.top), right: W - Math.max(m, Math.round(W * PLATFORM_BANDS.right)), bottom: H - Math.round(H * PLATFORM_BANDS.bottom) }
    : { left: m, top: m, right: W - m, bottom: H - m };
  const type = { label: Math.ceil(short * TYPE_FLOOR.label), body: Math.ceil(short * TYPE_FLOOR.body), heading: Math.ceil(short * TYPE_FLOOR.heading) };
  return { W, H, u, m, portrait: H > W * 1.05, tall, aspect: W / H, safe, type };
}

/** A size for text of `role`: `wanted` px, never under the role's floor. */
export function typeSize(layout: Layout, role: TypeRole, wanted = 0): number {
  return Math.max(layout.type[role], Math.round(wanted));
}

/** The safe area's vertical middle: where a group is centred (on 9:16 above the frame's middle, clear of the caption band). */
export function opticalCentre(layout: Layout): number {
  return (layout.safe.top + layout.safe.bottom) / 2;
}

/** The widest a group centred on the frame may be and stay inside the safe area. */
export function centredWidth(layout: Layout): number {
  return 2 * Math.min(layout.W / 2 - layout.safe.left, layout.safe.right - layout.W / 2);
}

export interface FittedType {
  lines: string[];
  size: number;
}

/**
 * Lines and size for `text` of `role` in `width` (and `height`, line height
 * `leading` × size): the biggest size up to `max` in the fewest balanced
 * lines (an extra line only for clearly bigger type), never under the role's
 * floor: when even `maxLines` lines need smaller type, the text fills them at
 * the floor and the last is cut with an ellipsis.
 */
export function fitType(
  layout: Layout,
  role: TypeRole,
  text: string,
  style: Omit<TextStyle, "size">,
  o: { width: number; max: number; maxLines?: number; height?: number; leading?: number },
): FittedType {
  const floor = layout.type[role];
  const max = Math.max(floor, o.max);
  const maxLines = Math.max(1, o.maxLines ?? 1);
  const leading = o.leading ?? 1.08;
  let best: FittedType | null = null;
  for (let n = 1; n <= maxLines; n += 1) {
    const lines = balanceLines(text, n);
    if (n > 1 && lines.length < n) break;
    const byHeight = o.height === undefined ? max : o.height / (lines.length * leading);
    const size = Math.floor(Math.min(fitSize(lines, style, o.width, max), byHeight, max));
    if (size < floor) continue;
    if (!best || size > best.size * 1.12) best = { lines, size };
  }
  return best ?? { lines: wrapLines(text, { ...style, size: floor }, o.width, maxLines), size: floor };
}

/**
 * Lines and size for text that wraps like a text box (greedy: each line as
 * full as it gets), the biggest size up to `max` at which it takes at most
 * `maxLines` lines, an extra line only for clearly bigger type; null when it
 * needs more lines at the role's floor.
 */
export function fitWrapped(layout: Layout, role: TypeRole, text: string, style: Omit<TextStyle, "size">, o: { width: number; max: number; maxLines: number }): FittedType | null {
  const floor = layout.type[role];
  let best: FittedType | null = null;
  for (let n = 1; n <= o.maxLines; n += 1) {
    for (let size = Math.floor(Math.max(floor, o.max)); size >= floor; size -= 1) {
      const lines = wrapLines(text, { ...style, size }, o.width, Number.POSITIVE_INFINITY);
      if (lines.length > n || lines.some((line) => textWidth(line, { ...style, size }) > o.width)) continue;
      if (!best || size > best.size * 1.12) best = { lines, size };
      break;
    }
  }
  return best;
}

/** `text` filled greedily into lines of `width` at `style`; past `maxLines` the rest joins the last line, cut with an ellipsis. */
export function wrapLines(text: string, style: TextStyle, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, style) > width && lines.length < maxLines - 1) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  lines.push(line);
  return Number.isFinite(maxLines) ? lines.map((l) => clampText(l, style, width)) : lines;
}
