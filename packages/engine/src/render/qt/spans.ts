/**
 * Span plumbing of Qt 5.15's raster engine (qpaintengine_raster.cpp,
 * qdrawhelper.cpp): how spans reach the blend functions matters for exact
 * output, because `handleSpans` fetches a transformed texture once per run of
 * adjacent spans *within one blend call*, and a new fetch recomputes the
 * 16.16 sampling position instead of accumulating it. So the producers'
 * batching (256 spans: QSpanBuffer, fillRect_normalized, the gray raster),
 * the clip intersection (`qt_span_fill_clipped`, chunks of 256) and the
 * merge rules are reproduced here.
 */

import { maskSpans as emitMaskSpans, type CoverageMask } from "./rasterizer.js";

export interface Span {
  x: number;
  y: number;
  len: number;
  coverage: number;
}

/** QSpanBuffer::SPAN_BUFFER_SIZE, fillRect_normalized's nspans, QT_FT_MAX_GRAY_SPANS. */
export const SPAN_BATCH = 256;
/** qt_span_fill_clipped's NSPANS. */
const CLIPPED_BATCH = 256;

/** qt_div_255. */
function div255(x: number): number {
  return (x + (x >> 8) + 0x80) >> 8;
}

/**
 * A path clip (`QClipData` built by `qt_span_clip` with ReplaceClip): the
 * gray raster's spans in raster order, the first span of each line, and the
 * bounds `QClipData::fixup` computes.
 */
export class ClipData {
  readonly lines = new Map<number, number>();
  readonly xmin: number;
  readonly xmax: number;
  readonly ymin: number;
  readonly ymax: number;

  constructor(readonly spans: readonly Span[]) {
    if (spans.length === 0) {
      this.xmin = this.xmax = this.ymin = this.ymax = 0;
      return;
    }
    let xmin = Number.POSITIVE_INFINITY;
    let xmax = 0;
    let y = -1;
    spans.forEach((s, i) => {
      if (s.y !== y) {
        y = s.y;
        this.lines.set(y, i);
      }
      xmin = Math.min(xmin, s.x);
      xmax = Math.max(xmax, s.x + s.len);
    });
    this.xmin = xmin;
    this.xmax = xmax;
    this.ymin = spans[0]!.y;
    this.ymax = spans[spans.length - 1]!.y + 1;
  }

  /**
   * The spans the gray raster emits for a coverage mask: maximal runs of
   * equal non-zero coverage per row, rows top to bottom (gray_hline merges
   * adjacent equal spans; a flush never splits a run).
   */
  static fromMask(mask: CoverageMask | null): ClipData {
    return new ClipData(mask ? maskSpans(mask) : []);
  }
}

/** Raster-order spans of a coverage mask (see `ClipData.fromMask`). */
export function maskSpans(mask: CoverageMask): Span[] {
  const out: Span[] = [];
  emitMaskSpans(mask, (x, y, len, coverage) => out.push({ x, y, len, coverage }));
  return out;
}

/**
 * `qt_intersect_spans` (qpaintengine_raster.cpp:4080-4141), literally,
 * including its `spans->y < clip->count` line lookup.
 */
function intersect(clip: ClipData, state: { current: number }, spans: readonly Span[], start: number, end: number, out: Span[], available: number): number {
  const clipSpans = clip.spans;
  const clipCount = clipSpans.length;
  let ci = state.current;
  let si = start;
  while (available > 0 && si < end) {
    if (ci >= clipCount) {
      si = end;
      break;
    }
    const s = spans[si]!;
    const c = clipSpans[ci]!;
    if (c.y > s.y) {
      si += 1;
      continue;
    }
    if (s.y !== c.y) {
      const line = s.y < clipCount ? clip.lines.get(s.y) : undefined;
      if (line !== undefined) ci = line;
      else ci += 1;
      continue;
    }
    const sx1 = s.x;
    const sx2 = sx1 + s.len;
    const cx1 = c.x;
    const cx2 = cx1 + c.len;
    if (cx1 < sx1 && cx2 < sx1) {
      ci += 1;
      continue;
    } else if (sx1 < cx1 && sx2 < cx1) {
      si += 1;
      continue;
    }
    const x = Math.max(sx1, cx1);
    const len = Math.min(sx2, cx2) - x;
    if (len) {
      out.push({ x, y: s.y, len, coverage: div255(s.coverage * c.coverage) });
      available -= 1;
    }
    if (sx2 < cx2) si += 1;
    else ci += 1;
  }
  state.current = ci;
  return si;
}

/** A blend function: one call of Qt's `ProcessSpans` with these spans. */
export type BlendSpans = (spans: readonly Span[]) => void;

/**
 * Deliver producer spans to `blend` the way the raster engine does: in
 * batches of `SPAN_BATCH`, each batch clipped by `qt_span_fill_clipped`
 * (fresh clip cursor per batch, output chunks of 256) when there is a clip.
 */
export function deliverSpans(spans: readonly Span[], clip: ClipData | null, blend: BlendSpans): void {
  for (let start = 0; start < spans.length; start += SPAN_BATCH) {
    const end = Math.min(spans.length, start + SPAN_BATCH);
    if (!clip) {
      blend(spans.slice(start, end));
      continue;
    }
    const state = { current: 0 };
    let si = start;
    while (si < end) {
      const out: Span[] = [];
      si = intersect(clip, state, spans, si, end, out, CLIPPED_BATCH);
      if (out.length) blend(out);
    }
  }
}

/** The texture fetch for one run: pixels [x, x + length) of row y, premultiplied RGBA. */
export type FetchRun = (x: number, y: number, length: number) => Uint8ClampedArray;
/** Compose `len` fetched pixels from `offset` at (x, y) with span coverage × const alpha. */
export type ProcessRun = (x: number, y: number, len: number, coverage: number, src: Uint8ClampedArray, offset: number) => void;

/** qdrawhelper.cpp BufferSize. */
export const BUFFER_SIZE = 2048;

/**
 * `handleSpans` (qdrawhelper.cpp): merge adjacent spans of one call into
 * runs, fetch each run in BufferSize chunks, process span by span with
 * `coverage = (span.coverage * constAlpha) >> 8`.
 */
export function handleSpans(spans: readonly Span[], constAlpha: number, fetch: FetchRun, process: ProcessRun): void {
  let coverage = 0;
  let i = 0;
  const count = spans.length;
  while (i < count) {
    if (!spans[i]!.len) {
      i += 1;
      continue;
    }
    let x = spans[i]!.x;
    const y = spans[i]!.y;
    let right = x + spans[i]!.len;
    for (let j = i + 1; j < count && spans[j]!.y === y && spans[j]!.x === right; j += 1) right += spans[j]!.len;
    let length = right - x;
    while (length) {
      let l = Math.min(BUFFER_SIZE, length);
      length -= l;
      const src = fetch(x, y, l);
      let offset = 0;
      while (l > 0) {
        const s = spans[i]!;
        if (x === s.x) coverage = (s.coverage * constAlpha) >> 8;
        const spanRight = s.x + s.len;
        const len = Math.min(l, spanRight - x);
        process(x, y, len, coverage, src, offset);
        l -= len;
        x += len;
        offset += len;
        if (x === spanRight) i += 1;
      }
    }
  }
}
