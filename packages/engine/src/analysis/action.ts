/**
 * On-screen physical actions for foley spotting (TECHNIQUES2 T078 close-mic
 * transients on detail inserts, T081 foley on hand and product actions):
 * frame-accurate moments where something hits, taps, lands, swipes or steps,
 * from small greyscale frames. Pure (no DOM, no Node).
 *
 *   motion     per frame, the mean change from the frame before in each tile of
 *              an 8 x 6 grid (a sensor-noise floor taken off); the action is the
 *              mean of the four busiest tiles, so a hand in one corner counts as
 *              much as a body filling the frame
 *   cuts       a frame where most of the picture changes at once is a cut, not
 *              an action (spot_sound_tool sounds cuts)
 *   stops      motion that dies within two frames: the last moving frame is the
 *              contact (a knife on the board, a cup set down, a key pressed);
 *              a brief, small one is a tap, a large or hard one an impact,
 *              otherwise a contact; three or more stops low in the frame at a
 *              steady 0.3-0.9 s are steps
 *   swipes     a burst of fast motion over a quarter of the frame or more that
 *              does not stop dead: the whoosh peaks on its fastest frame
 *
 * Accuracy is the frame the motion ends on; the sound designer's hit belongs
 * on that frame (or a frame earlier for a heavy object, by ear).
 */

export const ACTION_KINDS = ["impact", "tap", "contact", "swipe", "step"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** A file's picture as small greyscale frames (`MediaHost.decodeLuma`). */
export interface LumaFrames {
  fps: number;
  width: number;
  height: number;
  /** Seconds into the file of `frames[0]`. */
  startSeconds: number;
  /** One byte per pixel, row-major, `width * height` per frame. */
  frames: readonly Uint8Array[];
}

export interface ActionEvent {
  /** Index into the frames given. */
  frame: number;
  /** Seconds into the file. */
  timeSec: number;
  kind: ActionKind;
  /** 0..1, relative to the biggest motion in the frames. */
  strength: number;
  /** Where on screen, -1 (left/top) .. 1 (right/bottom). */
  x: number;
  y: number;
  /** Share of the frame that moved, 0..1. */
  area: number;
}

export const ACTION_SENSITIVITIES = ["low", "normal", "high"] as const;
export type ActionSensitivity = (typeof ACTION_SENSITIVITIES)[number];

export interface ActionOptions {
  sensitivity?: ActionSensitivity;
  /** Closest two events may be, seconds (default 0.12): the stronger one stays. */
  minGapSeconds?: number;
}

const GX = 8;
const GY = 6;
/** Pixel change under this (0-255) is sensor noise and compression. */
const NOISE = 6;
/** A tile whose mean change is above this moved. */
const TILE_ACTIVE = 4;
/** A frame where this share of tiles change a lot at once is a cut. */
const CUT_AREA = 0.75;
const CUT_LEVEL = 40;
/** Weakest action kept, as a share of the biggest motion in the frames. */
const THRESHOLD: Record<ActionSensitivity, number> = { low: 0.4, normal: 0.25, high: 0.12 };
/** Weakest action kept at all (mean tile change, 0-255): below it nothing really moved. */
const FLOOR = 3;

interface Motion {
  /** Mean of the four busiest tiles, per frame (frame 0: 0). */
  action: Float64Array;
  /** Share of tiles that moved. */
  area: Float64Array;
  /** Energy-weighted centre of the motion, -1..1. */
  x: Float64Array;
  y: Float64Array;
  cut: Uint8Array;
}

function motion(input: LumaFrames): Motion {
  const n = input.frames.length;
  const { width, height } = input;
  const action = new Float64Array(n);
  const area = new Float64Array(n);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const cut = new Uint8Array(n);
  const tiles = new Float64Array(GX * GY);
  const tileOf = (col: number, row: number) => Math.min(GY - 1, Math.floor((row * GY) / height)) * GX + Math.min(GX - 1, Math.floor((col * GX) / width));
  const counts = new Float64Array(GX * GY);
  for (let row = 0; row < height; row += 1) for (let col = 0; col < width; col += 1) counts[tileOf(col, row)]! += 1;
  for (let f = 1; f < n; f += 1) {
    tiles.fill(0);
    const a = input.frames[f - 1]!;
    const b = input.frames[f]!;
    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        const p = row * width + col;
        const d = Math.abs(b[p]! - a[p]!) - NOISE;
        if (d > 0) tiles[tileOf(col, row)]! += d;
      }
    }
    let active = 0;
    let loud = 0;
    let sum = 0;
    let cx = 0;
    let cy = 0;
    for (let t = 0; t < GX * GY; t += 1) {
      tiles[t] = tiles[t]! / Math.max(1, counts[t]!);
      if (tiles[t]! > TILE_ACTIVE) active += 1;
      if (tiles[t]! > CUT_LEVEL) loud += 1;
      sum += tiles[t]!;
      cx += tiles[t]! * (((t % GX) + 0.5) / GX * 2 - 1);
      cy += tiles[t]! * ((Math.floor(t / GX) + 0.5) / GY * 2 - 1);
    }
    const top = [...tiles].sort((p, q) => q - p);
    action[f] = (top[0]! + top[1]! + top[2]! + top[3]!) / 4;
    area[f] = active / (GX * GY);
    x[f] = sum > 0 ? cx / sum : 0;
    y[f] = sum > 0 ? cy / sum : 0;
    cut[f] = loud / (GX * GY) >= CUT_AREA ? 1 : 0;
  }
  return { action, area, x, y, cut };
}

const round = (v: number, places = 3) => Math.round(v * 10 ** places) / 10 ** places;

/** Physical actions in `input`, in time order. Fewer than three frames: none. */
export function detectActions(input: LumaFrames, options: ActionOptions = {}): ActionEvent[] {
  const n = input.frames.length;
  if (n < 3) return [];
  const m = motion(input);
  // A cut's frames, and the one on each side, are not motion.
  const nearCut = (f: number) => m.cut[f] === 1 || m.cut[f - 1] === 1 || m.cut[f + 1] === 1;
  let peak = 0;
  for (let f = 1; f < n; f += 1) if (!nearCut(f) && m.action[f]! > peak) peak = m.action[f]!;
  if (peak < FLOOR) return [];
  const threshold = Math.max(FLOOR, THRESHOLD[options.sensitivity ?? "normal"] * peak);
  const at = (f: number) => (f >= 0 && f < n && !nearCut(f) ? m.action[f]! : 0);
  const events: ActionEvent[] = [];
  const event = (f: number, kind: ActionKind, strength: number, area: number): ActionEvent => ({
    frame: f,
    timeSec: round(input.startSeconds + f / input.fps),
    kind,
    strength: round(Math.min(1, strength), 2),
    x: round(m.x[f]!, 2),
    y: round(m.y[f]!, 2),
    area: round(area, 2),
  });

  // The last two frames cannot show a stop: the frames after them are not there.
  for (let f = 1; f < n - 2; f += 1) {
    const v = at(f);
    if (v < threshold || nearCut(f)) continue;
    const stops = at(f + 1) <= 0.45 * v && at(f + 2) <= 0.5 * v;
    if (stops && v >= at(f - 1) * 0.8) {
      // How long it moved before it stopped, and how much of the frame.
      let start = f;
      while (start > 1 && at(start - 1) >= 0.3 * v) start -= 1;
      const frames = f - start + 1;
      const area = Math.max(...Array.from({ length: frames }, (_, k) => m.area[start + k]!));
      const hard = (v - at(f + 2)) / peak;
      const kind: ActionKind = area <= 0.1 && frames <= 6 ? "tap" : area >= 0.25 || hard >= 0.7 ? "impact" : "contact";
      events.push(event(f, kind, hard, area));
      continue;
    }
    // A burst of fast, wide motion that does not stop dead: the whoosh peaks on its fastest frame.
    if (m.area[f]! >= 0.25 && v >= at(f - 1) && v > at(f + 1)) {
      let a = f;
      let b = f;
      while (a > 1 && at(a - 1) >= 0.5 * v) a -= 1;
      while (b < n - 1 && at(b + 1) >= 0.5 * v) b += 1;
      if (b - a + 1 >= 3 && b - a + 1 <= Math.round(0.6 * input.fps)) events.push(event(f, "swipe", v / peak, m.area[f]!));
    }
  }

  // Steps: three or more stops in the lower part of the frame at a steady pace.
  const low = events.filter((e) => e.kind !== "swipe" && e.y > 0.2);
  for (let i = 0; i + 2 < low.length; i += 1) {
    const run = [low[i]!];
    for (let j = i + 1; j < low.length; j += 1) {
      const gap = low[j]!.timeSec - run[run.length - 1]!.timeSec;
      if (gap < 0.3 || gap > 0.9) break;
      run.push(low[j]!);
    }
    if (run.length < 3) continue;
    const gaps = run.slice(1).map((e, k) => e.timeSec - run[k]!.timeSec);
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const spread = Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length) / mean;
    if (spread <= 0.25) for (const e of run) e.kind = "step";
    i += run.length - 1;
  }

  // One event per moment: the stronger of two closer than the gap stays.
  const gap = options.minGapSeconds ?? 0.12;
  const kept: ActionEvent[] = [];
  for (const e of [...events].sort((p, q) => q.strength - p.strength)) if (kept.every((k) => Math.abs(k.timeSec - e.timeSec) >= gap)) kept.push(e);
  return kept.sort((p, q) => p.frame - q.frame);
}
