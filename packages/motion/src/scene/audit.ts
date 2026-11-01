/**
 * The layout audit of a scene: every text fragment the kit drew, on every
 * frame, against the title-safe zone, the other fragments, the smallest
 * readable size and the reading budget. cinetic's layout-audit
 * (assets/remotion-starter/src/lib/Audit.tsx, MIT): 22 px at 1080p, 32 px
 * in a 9:16 frame, at most 8 film words readable at once (product strings
 * apart). Only readable text counts: opacity 0.5 and up. Frames with the
 * same finding merge into one stretch. DOM-free: runs on the Node side.
 */

import { OVERLAP_SHARE, type SceneProblem } from "@zenvi/engine";
import type { TextBox } from "./contract.js";

export const MIN_TEXT_PX = 22;
export const MIN_TEXT_PX_TALL = 32;
export const MAX_READABLE_WORDS = 8;
/** Design px a box may poke past the safe zone before it counts (anti-aliasing, a descender). */
const SAFE_SLACK = 2;

export interface AuditFrame {
  /** Scene frame. */
  frame: number;
  boxes: readonly TextBox[];
}

export interface AuditFrameSize {
  width: number;
  height: number;
  safe: { top: number; right: number; bottom: number; left: number };
}

const readable = (b: TextBox, minPx: number): boolean => b.opacity >= 0.5 && b.px >= minPx * 0.999 && b.text.trim().length > 0;
const wordsOf = (text: string): number => text.split(/\s+/).filter(Boolean).length;

function overlapShare(a: TextBox, b: TextBox): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const smaller = Math.min(a.w * a.h, b.w * b.h);
  return w > 0 && h > 0 && smaller > 0 ? (w * h) / smaller : 0;
}

/** Findings of one frame: key (what, which) → message. */
function frameFindings(boxes: readonly TextBox[], size: AuditFrameSize, minPx: number): Map<string, { code: string; message: string }> {
  const out = new Map<string, { code: string; message: string }>();
  const { safe, width, height } = size;
  const shown = boxes.filter((b) => b.opacity >= 0.5 && b.text.trim().length > 0);
  for (const b of shown) {
    if (b.x < safe.left - SAFE_SLACK || b.y < safe.top - SAFE_SLACK || b.x + b.w > width - safe.right + SAFE_SLACK || b.y + b.h > height - safe.bottom + SAFE_SLACK) {
      out.set(`safe-area\0${b.id}`, { code: "safe-area", message: `"${b.id}" leaves the title-safe zone (insets ${safe.top}/${safe.right}/${safe.bottom}/${safe.left} px)` });
    }
    if (b.px < minPx * 0.999) out.set(`small-text\0${b.id}`, { code: "small-text", message: `"${b.id}" is ${Math.round(b.px)} px; readable text is ${minPx} px at least in this frame` });
  }
  for (let i = 0; i < shown.length; i += 1) {
    for (let j = i + 1; j < shown.length; j += 1) {
      const a = shown[i]!;
      const b = shown[j]!;
      if (a.id === b.id) continue;
      if (overlapShare(a, b) > OVERLAP_SHARE) {
        const [x, y] = [a.id, b.id].sort();
        out.set(`overlap\0${x}\0${y}`, { code: "overlap", message: `"${x}" and "${y}" overlap` });
      }
    }
  }
  const words = shown.filter((b) => !b.ui && readable(b, minPx)).reduce((n, b) => n + wordsOf(b.text), 0);
  if (words > MAX_READABLE_WORDS) out.set("words", { code: "words", message: `${words} words to read at once; a frame holds ${MAX_READABLE_WORDS} at most (split the line in fragments that take turns)` });
  return out;
}

/** The audit's findings over the scene, one warning per finding per stretch of frames. */
export function auditLayout(frames: readonly AuditFrame[], size: AuditFrameSize): SceneProblem[] {
  const minPx = size.height > size.width * 1.5 ? MIN_TEXT_PX_TALL : MIN_TEXT_PX;
  const open = new Map<string, { code: string; message: string; from: number; to: number; last: number }>();
  const done: SceneProblem[] = [];
  const close = (key: string): void => {
    const s = open.get(key)!;
    open.delete(key);
    done.push({ code: s.code, severity: "warning", message: s.message, frames: { from: s.from, to: s.to } });
  };
  frames.forEach((fr, index) => {
    const found = frameFindings(fr.boxes, size, minPx);
    for (const [key, f] of found) {
      const s = open.get(key);
      if (s && s.last === index - 1) {
        s.to = fr.frame;
        s.last = index;
      } else {
        if (s) close(key);
        open.set(key, { ...f, from: fr.frame, to: fr.frame, last: index });
      }
    }
    for (const key of [...open.keys()]) if (open.get(key)!.last !== index) close(key);
  });
  for (const key of [...open.keys()]) close(key);
  return done.sort((a, b) => a.frames!.from - b.frames!.from);
}
