/**
 * On-screen physical actions for foley spotting (TECHNIQUES2 T078 close-mic
 * transients on detail inserts, T081 foley on hand and product actions):
 * frame-accurate moments where something hits, taps, lands, swipes or steps,
 * from small greyscale frames. Pure (no DOM, no Node).
 *
 *   motion     per frame, the mean change from the frame before in each tile of
 *              an 8 x 6 grid (a sensor-noise floor taken off); a region is a tile
 *              and its neighbours, and its motion the mean of its four busiest
 *              tiles (or most of the busiest one), so a fingertip in one corner
 *              counts while a hand moves in another
 *   cuts       a frame where most of the picture changes at once is a cut, not
 *              an action (spot_sound_tool sounds cuts)
 *   stops      a region whose motion dies within two frames: the last moving frame is the
 *              contact (a knife on the board, a cup set down, a key pressed),
 *              unless the motion was heading up (a lift pausing at its top) or
 *              goes on next door (a fast object leaving the region); a brief one
 *              moving under 0.6 % of the frame is a tap, one still at full speed
 *              when it stops (or moving 3 % of the frame or more) an impact,
 *              one that slowed into it a contact; three or more stops low in the frame at a
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
const THRESHOLD: Record<ActionSensitivity, number> = { low: 0.3, normal: 0.15, high: 0.05 };
/** A tap changes at most this share of the frame (a fingertip, a key); an impact at least the second. */
const TAP_AREA = 0.006;
const IMPACT_AREA = 0.03;
/** Weakest action kept at all (mean tile change, 0-255): below it nothing really moved. */
const FLOOR = 3;
const TILES = GX * GY;

interface Motion {
  /** Mean change per tile, per frame (frame 0: all 0). */
  tiles: Float64Array[];
  /** Per tile and frame: change-weighted sums of pixel column and row, and the weight. */
  sx: Float64Array[];
  sy: Float64Array[];
  sw: Float64Array[];
  /** Per tile and frame: pixels that changed. */
  moved: Float64Array[];
  /** Whole picture: the mean of the four busiest tiles, and the share of tiles that moved. */
  action: Float64Array;
  area: Float64Array;
  cut: Uint8Array;
}

function motion(input: LumaFrames): Motion {
  const n = input.frames.length;
  const { width, height } = input;
  const tileOf = (col: number, row: number) => Math.min(GY - 1, Math.floor((row * GY) / height)) * GX + Math.min(GX - 1, Math.floor((col * GX) / width));
  const counts = new Float64Array(TILES);
  for (let row = 0; row < height; row += 1) for (let col = 0; col < width; col += 1) counts[tileOf(col, row)]! += 1;
  const m: Motion = { tiles: [], sx: [], sy: [], sw: [], moved: [], action: new Float64Array(n), area: new Float64Array(n), cut: new Uint8Array(n) };
  for (let f = 0; f < n; f += 1) {
    const tiles = new Float64Array(TILES);
    const sx = new Float64Array(TILES);
    const sy = new Float64Array(TILES);
    const sw = new Float64Array(TILES);
    const moved = new Float64Array(TILES);
    m.moved.push(moved);
    m.tiles.push(tiles);
    m.sx.push(sx);
    m.sy.push(sy);
    m.sw.push(sw);
    if (f === 0) continue;
    const a = input.frames[f - 1]!;
    const b = input.frames[f]!;
    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        const p = row * width + col;
        const d = Math.abs(b[p]! - a[p]!) - NOISE;
        if (d <= 0) continue;
        const t = tileOf(col, row);
        tiles[t]! += d;
        moved[t]! += 1;
        sw[t]! += d;
        sx[t]! += d * (col + 0.5);
        sy[t]! += d * (row + 0.5);
      }
    }
    let active = 0;
    let loud = 0;
    for (let t = 0; t < TILES; t += 1) {
      tiles[t] = tiles[t]! / Math.max(1, counts[t]!);
      if (tiles[t]! > TILE_ACTIVE) active += 1;
      if (tiles[t]! > CUT_LEVEL) loud += 1;
    }
    const top = [...tiles].sort((p, q) => q - p);
    m.action[f] = (top[0]! + top[1]! + top[2]! + top[3]!) / 4;
    m.area[f] = active / TILES;
    m.cut[f] = loud / TILES >= CUT_AREA ? 1 : 0;
  }
  return m;
}

/** Tiles within `reach` of each tile (3 x 3 for 1, 5 x 5 for 2; fewer at the edges). */
function around(reach: number): number[][] {
  return Array.from({ length: TILES }, (_, t) => {
    const tx = t % GX;
    const ty = Math.floor(t / GX);
    const out: number[] = [];
    for (let dy = -reach; dy <= reach; dy += 1) for (let dx = -reach; dx <= reach; dx += 1) if (tx + dx >= 0 && tx + dx < GX && ty + dy >= 0 && ty + dy < GY) out.push((ty + dy) * GX + tx + dx);
    return out;
  });
}
const NEIGHBOURS = around(1);
/** Where a fast object can be one frame later: a stop needs this much of the picture still. */
const WIDE = around(2);

const round = (v: number, places = 3) => Math.round(v * 10 ** places) / 10 ** places;

/** Physical actions in `input`, in time order. Fewer than three frames: none. */
export function detectActions(input: LumaFrames, options: ActionOptions = {}): ActionEvent[] {
  const n = input.frames.length;
  if (n < 3) return [];
  const m = motion(input);
  // A cut's frames, and the one on each side, are not motion.
  const nearCut = (f: number) => m.cut[f] === 1 || m.cut[f - 1] === 1 || m.cut[f + 1] === 1;
  // A region's motion: the mean of its four busiest tiles, or most of the busiest.
  const region = (f: number, t: number, tiles = NEIGHBOURS) => {
    if (f < 1 || f >= n || nearCut(f)) return 0;
    const e = tiles[t]!.map((k) => m.tiles[f]![k]!).sort((p, q) => q - p);
    return Math.max(((e[0] ?? 0) + (e[1] ?? 0) + (e[2] ?? 0) + (e[3] ?? 0)) / 4, 0.6 * (e[0] ?? 0));
  };
  // Where in the region the change is, -1..1 (null: nothing changed there).
  const centre = (f: number, t: number): [number, number] | null => {
    let w = 0;
    let x = 0;
    let y = 0;
    for (const k of NEIGHBOURS[t]!) {
      w += m.sw[f]![k]!;
      x += m.sx[f]![k]!;
      y += m.sy[f]![k]!;
    }
    return w > 0 ? [(x / w / input.width) * 2 - 1, (y / w / input.height) * 2 - 1] : null;
  };
  let peak = 0;
  for (let f = 1; f < n; f += 1) for (let t = 0; t < TILES; t += 1) peak = Math.max(peak, region(f, t));
  if (peak < FLOOR) return [];
  const threshold = Math.max(FLOOR, THRESHOLD[options.sensitivity ?? "normal"] * peak);
  const events: (ActionEvent & { tile: number })[] = [];
  const event = (f: number, t: number, kind: ActionKind, strength: number, area: number) => {
    const [x, y] = centre(f, t) ?? [0, 0];
    events.push({ frame: f, timeSec: round(input.startSeconds + f / input.fps), kind, strength: round(Math.min(1, strength), 2), x: round(x, 2), y: round(y, 2), area: round(area, 2), tile: t });
  };

  // Stops, region by region; the last two frames cannot show one (the frames after them are not there).
  for (let f = 1; f < n - 2; f += 1) {
    for (let t = 0; t < TILES; t += 1) {
      // One region per moving thing: the busiest tile among its neighbours speaks for it.
      if (NEIGHBOURS[t]!.some((k) => m.tiles[f]![k]! > m.tiles[f]![t]!)) continue;
      const v = region(f, t);
      // Still afterwards around it too: an object that only left the region (it moves fast) has not stopped.
      if (v < threshold || region(f + 1, t, WIDE) > 0.45 * v || region(f + 2, t, WIDE) > 0.5 * v || v < 0.5 * region(f - 1, t)) continue;
      // Where the motion was heading over the last two frames: a lift that pauses at its top is not a contact.
      const from = (f >= 3 ? centre(f - 2, t) : null) ?? (f >= 2 ? centre(f - 1, t) : null);
      const to = centre(f, t);
      if (from && to && to[1] - from[1] < 0 && Math.abs(to[1] - from[1]) > Math.abs(to[0] - from[0])) continue;
      let start = f;
      while (start > 1 && region(start - 1, t) >= 0.3 * v) start -= 1;
      const frames = f - start + 1;
      // How much of the frame it moved at most.
      let area = 0;
      for (let k = start; k <= f; k += 1) area = Math.max(area, NEIGHBOURS[t]!.reduce((sum, j) => sum + m.moved[k]![j]!, 0) / (input.width * input.height));
      // Hit at full speed (an impact) or slowed into the contact (set down): the speed at the stop against this action's fastest frame.
      let fastest = v;
      for (let k = start; k < f; k += 1) fastest = Math.max(fastest, region(k, t));
      const after = region(f + 2, t);
      const kind: ActionKind = area <= TAP_AREA && frames <= 6 ? "tap" : (v - after) / fastest >= 0.7 || area >= IMPACT_AREA ? "impact" : "contact";
      event(f, t, kind, (v - after) / peak, area);
    }
  }

  // Swipes: a burst of fast motion over a quarter of the frame or more that does not stop dead; the whoosh peaks on its fastest frame.
  const whole = (f: number) => (f >= 1 && f < n && !nearCut(f) ? m.action[f]! : 0);
  let wholePeak = 0;
  for (let f = 1; f < n; f += 1) wholePeak = Math.max(wholePeak, whole(f));
  for (let f = 1; f < n - 1; f += 1) {
    const v = whole(f);
    if (v < threshold || m.area[f]! < 0.25 || v < whole(f - 1) || v <= whole(f + 1)) continue;
    let a = f;
    let b = f;
    while (a > 1 && whole(a - 1) >= 0.5 * v) a -= 1;
    while (b < n - 1 && whole(b + 1) >= 0.5 * v) b += 1;
    // A wide motion that ends in a stop is an impact (already found), not a swipe.
    if (whole(b + 1) <= 0.45 * whole(b) && whole(b + 2) <= 0.5 * whole(b) && b + 2 < n) continue;
    if (b - a + 1 < 3 || b - a + 1 > Math.round(0.6 * input.fps)) continue;
    const top = m.tiles[f]!.indexOf(Math.max(...m.tiles[f]!));
    event(f, top, "swipe", v / Math.max(wholePeak, 1e-9), m.area[f]!);
  }

  // Steps: three or more stops in the lower part of the frame at a steady pace.
  const low = events.filter((e) => e.kind !== "swipe" && e.y > 0.2).sort((p, q) => p.frame - q.frame);
  for (let i = 0; i + 2 < low.length; i += 1) {
    const run = [low[i]!];
    for (let j = i + 1; j < low.length; j += 1) {
      const gap = low[j]!.timeSec - run[run.length - 1]!.timeSec;
      if (gap < 0.3) continue;
      if (gap > 0.9) break;
      run.push(low[j]!);
    }
    if (run.length < 3) continue;
    const gaps = run.slice(1).map((e, k) => e.timeSec - run[k]!.timeSec);
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const spread = Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length) / mean;
    if (spread <= 0.25) for (const e of run) e.kind = "step";
  }

  // One event per moment and place: of two closer than the gap within two tiles of each other, the stronger stays.
  const gap = options.minGapSeconds ?? 0.12;
  const near = (p: number, q: number) => Math.abs((p % GX) - (q % GX)) <= 2 && Math.abs(Math.floor(p / GX) - Math.floor(q / GX)) <= 2;
  const kept: (ActionEvent & { tile: number })[] = [];
  for (const e of [...events].sort((p, q) => q.strength - p.strength)) if (kept.every((k) => Math.abs(k.timeSec - e.timeSec) >= gap || !near(k.tile, e.tile))) kept.push(e);
  return kept.sort((p, q) => p.frame - q.frame || p.x - q.x).map(({ tile: _tile, ...e }) => e);
}
