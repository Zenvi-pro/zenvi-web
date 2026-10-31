/**
 * Datamosh carry: the picture before a cut keeps moving into the picture
 * after it.
 *
 * A real datamosh drops the I-frame at a cut, so the next clip's motion
 * vectors push the last picture of the previous one around. Zenvi does the
 * same thing without touching a bitstream: `estimateFlow` measures the
 * previous clip's motion over its last frames (block matching on small gray
 * frames) and `moshMaps` turns that into one pair of `displace` maps per
 * frame for the next clip's first frames. Each frame's map is the last
 * frame's map pushed along the flow again, so where blocks disagree pixels
 * drag and smear instead of only sliding; the push eases off so the clip
 * lands clean. The ffmpeg half is `datamosh` in graph.ts; the host
 * (render-node) decodes the frames and writes the maps.
 *
 * Pure: no files, no ffmpeg.
 */

/** Width the host decodes the previous clip's frames at for `estimateFlow`. */
export const FLOW_ANALYSIS_WIDTH = 320;
/** Previous-clip frames the flow is measured over (the last N, so N - 1 frame pairs). */
export const FLOW_FRAMES = 5;
/** Frames a displace map can move a pixel by (an 8-bit map centred on 128). */
export const MAX_DISPLACE = 127;

export interface GrayFrame {
  width: number;
  height: number;
  /** One byte per pixel, row by row. */
  data: Uint8Array;
}

/** Motion of a frame's blocks in frame pixels per frame: the content moves by (dx, dy). */
export interface FlowField {
  /** Size of the frames it was measured on. */
  width: number;
  height: number;
  block: number;
  cols: number;
  rows: number;
  dx: Float32Array;
  dy: Float32Array;
}

export interface FlowOptions {
  block?: number;
  /** Largest motion per frame searched for, in frame pixels. */
  range?: number;
}

/**
 * Block-matching motion between consecutive gray frames, averaged over all
 * pairs with later pairs weighing more (the motion right at the cut matters
 * most). A block takes the shift with the least sum of absolute differences,
 * refined to a fraction of a pixel; flat blocks, where no shift beats
 * standing still by 10%, do not move; a 3×3 median drops lone outliers.
 */
export function estimateFlow(frames: readonly GrayFrame[], options: FlowOptions = {}): FlowField {
  const first = frames[0];
  if (!first || frames.length < 2) throw new Error("estimateFlow needs at least two frames.");
  const { width, height } = first;
  for (const f of frames) if (f.width !== width || f.height !== height || f.data.length !== width * height) throw new Error("estimateFlow: frames differ in size.");
  const block = options.block ?? 8;
  const range = options.range ?? 10;
  const cols = Math.floor(width / block);
  const rows = Math.floor(height / block);
  if (cols < 1 || rows < 1) throw new Error("estimateFlow: frames are smaller than one block.");
  const dx = new Float32Array(cols * rows);
  const dy = new Float32Array(cols * rows);
  let weightSum = 0;
  for (let i = 1; i < frames.length; i++) {
    const weight = i;
    weightSum += weight;
    const pair = pairFlow(frames[i - 1]!, frames[i]!, block, range, cols, rows);
    for (let c = 0; c < dx.length; c++) {
      dx[c]! += pair.dx[c]! * weight;
      dy[c]! += pair.dy[c]! * weight;
    }
  }
  for (let c = 0; c < dx.length; c++) {
    dx[c]! /= weightSum;
    dy[c]! /= weightSum;
  }
  return { width, height, block, cols, rows, dx: median3(dx, cols, rows), dy: median3(dy, cols, rows) };
}

function pairFlow(prev: GrayFrame, cur: GrayFrame, block: number, range: number, cols: number, rows: number): { dx: Float32Array; dy: Float32Array } {
  const { width, height } = cur;
  const dx = new Float32Array(cols * rows);
  const dy = new Float32Array(cols * rows);
  // Standing still is only beaten by a clear win; far shifts cost a little more than near ones.
  const stay = 0.9;
  const penalty = block * block * 0.02;
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const x0 = bx * block;
      const y0 = by * block;
      const sad = (u: number, v: number): number => {
        const px = x0 - u;
        const py = y0 - v;
        if (px < 0 || py < 0 || px + block > width || py + block > height) return Number.POSITIVE_INFINITY;
        let sum = 0;
        for (let y = 0; y < block; y++) {
          const a = (y0 + y) * width + x0;
          const b = (py + y) * width + px;
          for (let x = 0; x < block; x++) sum += Math.abs(cur.data[a + x]! - prev.data[b + x]!);
        }
        return sum;
      };
      const zero = sad(0, 0);
      let best = zero;
      let bu = 0;
      let bv = 0;
      for (let v = -range; v <= range; v++) {
        for (let u = -range; u <= range; u++) {
          if (u === 0 && v === 0) continue;
          const cost = sad(u, v) + (Math.abs(u) + Math.abs(v)) * penalty;
          if (cost < best) {
            best = cost;
            bu = u;
            bv = v;
          }
        }
      }
      if ((bu === 0 && bv === 0) || best > zero * stay) continue;
      const cell = by * cols + bx;
      dx[cell] = bu + parabola(sad(bu - 1, bv), best - (Math.abs(bu) + Math.abs(bv)) * penalty, sad(bu + 1, bv));
      dy[cell] = bv + parabola(sad(bu, bv - 1), best - (Math.abs(bu) + Math.abs(bv)) * penalty, sad(bu, bv + 1));
    }
  }
  return { dx, dy };
}

/** Offset (-0.5..0.5) of the minimum of the parabola through three evenly spaced costs; 0 when an end is out of the frame. */
function parabola(before: number, centre: number, after: number): number {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return 0;
  const curve = before - 2 * centre + after;
  if (curve <= 0) return 0;
  return Math.max(-0.5, Math.min(0.5, (before - after) / (2 * curve)));
}

function median3(field: Float32Array, cols: number, rows: number): Float32Array {
  const out = new Float32Array(field.length);
  const window: number[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      window.length = 0;
      for (let v = Math.max(0, y - 1); v <= Math.min(rows - 1, y + 1); v++) for (let u = Math.max(0, x - 1); u <= Math.min(cols - 1, x + 1); u++) window.push(field[v * cols + u]!);
      window.sort((a, b) => a - b);
      out[y * cols + x] = window[window.length >> 1]!;
    }
  }
  return out;
}

/** Mean motion in frame pixels per frame (what a receipt can say about the previous clip's last moments). */
export function flowSpeed(flow: FlowField): number {
  let sum = 0;
  for (let c = 0; c < flow.dx.length; c++) sum += Math.hypot(flow.dx[c]!, flow.dy[c]!);
  return flow.dx.length > 0 ? sum / flow.dx.length : 0;
}

export interface MoshSize {
  /** Output frame size in pixels. */
  width: number;
  height: number;
}

export interface MoshParams {
  /** Frames the mosh lasts. */
  frames: number;
  /** Macroblock size in output pixels (the maps are one pixel per block, drawn blocky). */
  block: number;
  /** 0-1: how hard the carried motion pushes. */
  amount: number;
}

export interface MoshMaps {
  cols: number;
  rows: number;
  /** One map per frame, `cols × rows` bytes, 128 = no move (ffmpeg `displace`). */
  x: Uint8Array[];
  y: Uint8Array[];
}

/** Share of the push kept at frame `n` of `frames`: full for the first stretch, then eased out to nothing at the last frame. */
export function moshEase(n: number, frames: number): number {
  const t = Math.min(1, Math.max(0, (n + 1) / frames));
  const s = Math.min(1, Math.max(0, (t - 0.4) / 0.6));
  return 1 - s * s * (3 - 2 * s);
}

/**
 * The displacement maps of the carry. The flow (measured on another
 * frame size) is resampled to one vector per output block and scaled to
 * output pixels; frame n's displacement is frame n-1's, looked up where the
 * flow carried each block from, plus one more flow step: out(p) = prev(p - v).
 */
export function moshMaps(flow: FlowField, size: MoshSize, params: MoshParams): MoshMaps {
  const block = Math.max(2, Math.round(params.block));
  const cols = Math.ceil(size.width / block);
  const rows = Math.ceil(size.height / block);
  const gain = 0.6 + 1.6 * params.amount;
  const toOutX = (size.width / flow.width) * gain;
  const toOutY = (size.height / flow.height) * gain;
  const vx = new Float32Array(cols * rows);
  const vy = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const fx = ((c + 0.5) / cols) * flow.cols - 0.5;
      const fy = ((r + 0.5) / rows) * flow.rows - 0.5;
      vx[r * cols + c] = sample(flow.dx, flow.cols, flow.rows, fx, fy) * toOutX;
      vy[r * cols + c] = sample(flow.dy, flow.cols, flow.rows, fx, fy) * toOutY;
    }
  }
  let mx: Float32Array = new Float32Array(cols * rows);
  let my: Float32Array = new Float32Array(cols * rows);
  const x: Uint8Array[] = [];
  const y: Uint8Array[] = [];
  for (let n = 0; n < params.frames; n++) {
    const nx = new Float32Array(cols * rows);
    const ny = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const at = (c - vx[i]! / block);
        const bt = (r - vy[i]! / block);
        nx[i] = clampShift(sample(mx, cols, rows, at, bt) - vx[i]!);
        ny[i] = clampShift(sample(my, cols, rows, at, bt) - vy[i]!);
      }
    }
    mx = nx;
    my = ny;
    const ease = moshEase(n, params.frames);
    x.push(toBytes(mx, ease));
    y.push(toBytes(my, ease));
  }
  return { cols, rows, x, y };
}

function clampShift(value: number): number {
  return Math.max(-MAX_DISPLACE, Math.min(MAX_DISPLACE, value));
}

function toBytes(field: Float32Array, ease: number): Uint8Array {
  const out = new Uint8Array(field.length);
  for (let i = 0; i < field.length; i++) out[i] = Math.round(128 + field[i]! * ease);
  return out;
}

/** Bilinear lookup at fractional cell coordinates (edges repeat). */
function sample(field: Float32Array, cols: number, rows: number, x: number, y: number): number {
  const cx = Math.min(cols - 1, Math.max(0, x));
  const cy = Math.min(rows - 1, Math.max(0, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(cols - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const top = field[y0 * cols + x0]! * (1 - fx) + field[y0 * cols + x1]! * fx;
  const bottom = field[y1 * cols + x0]! * (1 - fx) + field[y1 * cols + x1]! * fx;
  return top * (1 - fy) + bottom * fy;
}
