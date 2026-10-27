/**
 * Peak rides for master_audio_tool (DEPLOY.md S3.6). When the true-peak
 * ceiling stops the mix short of its loudness target (an unmastered music
 * bed with 15 dB of crest, a few hot hits), the frames whose peaks would pass
 * the ceiling at the target are turned down just enough, on every clip that
 * plays there (a voice included): a look-ahead limiter on the mix bus, written
 * as volume keyframes because libopenshot has no bus and its Compressor
 * (Compressor.cpp:48-113) detects on the mono sum, so it misses the peaks of
 * a wide stereo bed. libopenshot ramps each frame's volume from the previous
 * frame's value (Timeline.cpp add_layer, ApplyGainRamp), so a ride holds one
 * frame either side of the peak; the desktop plays the same limited mix the
 * export delivers.
 */

import type { Transaction } from "../../history/document.js";
import type { Project } from "../../model/types.js";
import { setClipKeyframes } from "../../ops/clips.js";
import { shapeVolume, type GainPoint } from "../mix-curves.js";
import { fpsFloatOf } from "./common.js";

/** The most a frame is turned down, dB: past it a hit loses its snap and a bed pumps. */
export const MAX_RIDE_DB = 4;

/** Under the ceiling the rides aim for, dB: they measure sample peaks, the ceiling is in true peak. */
const MARGIN_DB = 0.5;

/** A ride eases in and out by at most this much per frame, dB. */
const SLEW_DB = 2;

export interface RideStem {
  channels: readonly Float32Array[];
  /** Gain the plan adds to it, dB. */
  gainDb: number;
}

/** dB to take off each timeline frame (0 where nothing passes the ceiling). */
export type Rides = Float64Array;

/**
 * The rides that let the planned mix (`stems` at their planned gains) rise by
 * `shortfallLu` without passing `ceilingDbtp`: per timeline frame, the dB its
 * peak would pass by, held a frame either side and eased by SLEW_DB a frame,
 * capped at MAX_RIDE_DB. Null when no frame passes.
 */
export function planPeakRides(stems: readonly RideStem[], sampleRate: number, fps: number, ceilingDbtp: number, shortfallLu: number): Rides | null {
  const n = Math.max(0, ...stems.map((st) => st.channels[0]?.length ?? 0));
  const frame = sampleRate / fps;
  const frames = Math.ceil(n / frame);
  const gains = stems.map((st) => 10 ** ((st.gainDb + shortfallLu) / 20));
  const ceiling = 10 ** ((ceilingDbtp - MARGIN_DB) / 20);
  const need = new Float64Array(frames);
  for (let k = 0; k < frames; k += 1) {
    let peak = 0;
    for (let i = Math.floor(k * frame); i < Math.min(n, Math.floor((k + 1) * frame)); i += 1) {
      for (let c = 0; c < 2; c += 1) {
        let x = 0;
        for (const [s, st] of stems.entries()) x += (st.channels[Math.min(c, st.channels.length - 1)]![i] ?? 0) * gains[s]!;
        peak = Math.max(peak, Math.abs(x));
      }
    }
    need[k] = peak > ceiling ? Math.min(MAX_RIDE_DB, 20 * Math.log10(peak / ceiling)) : 0;
  }
  if (!need.some((d) => d > 0)) return null;
  const rides = Float64Array.from(need, (_, k) => Math.max(need[k - 1] ?? 0, need[k]!, need[k + 1] ?? 0));
  for (let k = 1; k < frames; k += 1) rides[k] = Math.max(rides[k]!, rides[k - 1]! - SLEW_DB);
  for (let k = frames - 2; k >= 0; k -= 1) rides[k] = Math.max(rides[k]!, rides[k + 1]! - SLEW_DB);
  return rides;
}

/** Ride each clip down through the frames it plays in, on top of its own curve (ducks and fades kept). */
export function applyPeakRides(tx: Transaction, rides: Rides, clipIds: readonly string[]): void {
  const fps = fpsFloatOf(tx.project);
  for (const id of clipIds) {
    const clip = tx.project.clips.find((c) => String(c.id) === id)!;
    const start = Number(clip.position) || 0;
    const end = start + (Number(clip.end) - Number(clip.start));
    const first = Math.max(0, Math.floor(start * fps));
    const last = Math.min(rides.length - 1, Math.ceil(end * fps));
    const points: GainPoint[] = [];
    for (let k = first; k <= last; k += 1) {
      // The clip's ends and the ride's corners: a flat stretch costs two points.
      if (k !== first && k !== last && rides[k] === (rides[k - 1] ?? 0) && rides[k] === (rides[k + 1] ?? 0)) continue;
      points.push({ t: Math.min(end, Math.max(start, k / fps)), db: -rides[k]! });
    }
    if (points.every((p) => p.db === 0)) continue;
    const shaped = shapeVolume(clip, fps, points, "relative");
    setClipKeyframes(tx, id, "volume", shaped.points.map((p) => ({ frame: p.co.X, value: p.co.Y, interpolation: p.interpolation })), { mode: "replace" });
  }
}

/** Frames ridden and the deepest ride, for the receipt. */
export function ridesSummary(rides: Rides, project: Project): { frames: number; maxDb: number; seconds: number } {
  const ridden = rides.filter((d) => d > 0.05);
  return { frames: ridden.length, maxDb: Math.round(Math.max(0, ...ridden) * 10) / 10, seconds: Math.round((ridden.length / fpsFloatOf(project)) * 100) / 100 };
}
