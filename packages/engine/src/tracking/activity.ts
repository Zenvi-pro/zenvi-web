/**
 * Where a screen recording is active: what changed between two frames (the
 * cursor, typing, a toggle, a counter ticking) and the zoom stops an editor
 * would push in on (1.2-1.5 s holds on the UI element being discussed,
 * TECHNIQUES2 T015), as source-frame boxes and times.
 */

import type { GrayImage } from "./gray.js";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ActivitySample {
  /** Source seconds of the later frame. */
  time: number;
  /** The busiest connected region of change, 0-1 of the frame; null when nothing changed. */
  box: Box | null;
  /** Share of the frame that changed, 0..1. */
  changed: number;
}

/** A grey-level change above this counts (compression noise stays under it). */
const DIFF = 14;
const COLS = 32;
const ROWS = 18;
/** A grid cell is active when this share of its pixels changed. */
const CELL_ACTIVE = 0.01;

/** The busiest region of change between `a` and `b` (same size). */
export function activityBetween(a: GrayImage, b: GrayImage, time: number): ActivitySample {
  const { width: w, height: h } = a;
  const counts = new Float64Array(COLS * ROWS);
  const area = new Float64Array(COLS * ROWS);
  let changed = 0;
  for (let y = 0; y < h; y += 1) {
    const row = Math.min(ROWS - 1, Math.floor((y * ROWS) / h));
    for (let x = 0; x < w; x += 1) {
      const cell = row * COLS + Math.min(COLS - 1, Math.floor((x * COLS) / w));
      area[cell]! += 1;
      if (Math.abs(a.data[y * w + x]! - b.data[y * w + x]!) > DIFF) {
        counts[cell]! += 1;
        changed += 1;
      }
    }
  }
  const active = new Uint8Array(COLS * ROWS);
  for (let i = 0; i < active.length; i += 1) active[i] = area[i]! > 0 && counts[i]! / area[i]! >= CELL_ACTIVE ? 1 : 0;
  // Largest 8-connected group of active cells, by changed pixels.
  const seen = new Uint8Array(COLS * ROWS);
  let best: { weight: number; c0: number; c1: number; r0: number; r1: number } | null = null;
  for (let start = 0; start < active.length; start += 1) {
    if (!active[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let weight = 0;
    let c0 = COLS;
    let c1 = -1;
    let r0 = ROWS;
    let r1 = -1;
    while (stack.length) {
      const i = stack.pop()!;
      const c = i % COLS;
      const r = (i / COLS) | 0;
      weight += counts[i]!;
      c0 = Math.min(c0, c);
      c1 = Math.max(c1, c);
      r0 = Math.min(r0, r);
      r1 = Math.max(r1, r);
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
          const j = rr * COLS + cc;
          if (active[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    if (!best || weight > best.weight) best = { weight, c0, c1, r0, r1 };
  }
  const box = best ? { x: best.c0 / COLS, y: best.r0 / ROWS, w: (best.c1 - best.c0 + 1) / COLS, h: (best.r1 - best.r0 + 1) / ROWS } : null;
  return { time, box, changed: changed / Math.max(1, w * h) };
}

export interface ZoomStop {
  /** Source seconds the zoom has landed by, and leaves at. */
  start: number;
  end: number;
  /** The point zoomed on, 0-1 of the source frame. */
  x: number;
  y: number;
}

export interface StopOptions {
  /** Shortest hold on a stop, seconds (default 1.2). */
  minHold?: number;
  /** A stop keeps absorbing activity this close to it, 0-1 of the frame diagonal (default 0.15). */
  reach?: number;
  /** A stop survives this long without activity, seconds (default 2). */
  idle?: number;
  /** More than this share of the frame changing is a page change or scroll: zoom out (default 0.35). */
  wide?: number;
  /** Activity spread over more than this share of the frame is not one element (default 0.3). */
  maxArea?: number;
}

/**
 * Zoom stops from activity samples (and cursor positions, which win where
 * given): consecutive focused activity close together becomes one stop; a
 * page-wide change or a long idle ends it.
 */
export function planZoomStops(samples: readonly ActivitySample[], cursor: readonly { time: number; x: number; y: number }[], options: StopOptions = {}): ZoomStop[] {
  const minHold = options.minHold ?? 1.2;
  const reach = options.reach ?? 0.15;
  const idle = options.idle ?? 2;
  const wide = options.wide ?? 0.35;
  const maxArea = options.maxArea ?? 0.3;
  type Focus = { time: number; x: number; y: number } | { time: number; wide: true };
  const foci: Focus[] = [];
  if (cursor.length > 0) {
    for (const c of cursor) foci.push({ time: c.time, x: c.x, y: c.y });
  } else {
    for (const s of samples) {
      if (s.changed > wide) foci.push({ time: s.time, wide: true });
      else if (s.box && s.box.w * s.box.h <= maxArea) foci.push({ time: s.time, x: s.box.x + s.box.w / 2, y: s.box.y + s.box.h / 2 });
    }
  }
  foci.sort((a, b) => a.time - b.time);
  const stops: (ZoomStop & { n: number; last: number })[] = [];
  let open: (ZoomStop & { n: number; last: number }) | null = null;
  for (const f of foci) {
    if ("wide" in f) {
      open = null;
      continue;
    }
    if (open && f.time - open.last <= idle && Math.hypot(f.x - open.x, f.y - open.y) <= reach) {
      // Running mean: the stop settles on the middle of the activity.
      open.x += (f.x - open.x) / (open.n + 1);
      open.y += (f.y - open.y) / (open.n + 1);
      open.n += 1;
      open.last = f.time;
      open.end = f.time;
      continue;
    }
    open = { start: f.time, end: f.time, x: f.x, y: f.y, n: 1, last: f.time };
    stops.push(open);
  }
  // Hold each stop at least minHold, never into the next one.
  const out: ZoomStop[] = [];
  stops.forEach((s, i) => {
    const next = stops[i + 1];
    const end = Math.max(s.end, s.start + minHold);
    out.push({ start: s.start, end: next ? Math.min(end, next.start) : end, x: s.x, y: s.y });
  });
  return out.filter((s) => s.end - s.start >= minHold * 0.5);
}
