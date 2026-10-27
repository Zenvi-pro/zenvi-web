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

/** The most a frame of a hit is turned down, dB: past it a hit loses its snap. */
export const MAX_RIDE_DB = 4;

/** The most a bed is turned down under a hit, dB: the reels' pre-hit hole is 10-15 dB for 100-150 ms. */
export const MAX_BED_RIDE_DB = 10;

/** Under the ceiling the rides aim for, dB: they measure sample peaks, the ceiling is in true peak. */
const MARGIN_DB = 0.5;

/** A ride eases in and out by at most this much per frame, dB. */
const SLEW_DB = 2;

export interface RideStem {
  channels: readonly Float32Array[];
  /** Gain the plan adds to it, dB. */
  gainDb: number;
  /** A bed (music, ambience): ridden under a hit before the hit itself is. */
  bed: boolean;
}

/** dB to take off each timeline frame: `bed` on the beds only, `all` on every clip (0 where nothing passes the ceiling). */
export interface Rides {
  bed: Float64Array;
  all: Float64Array;
}

/** Hold a frame either side, ease by SLEW_DB a frame. */
function smooth(need: Float64Array): Float64Array {
  const out = Float64Array.from(need, (_, k) => Math.max(need[k - 1] ?? 0, need[k]!, need[k + 1] ?? 0));
  for (let k = 1; k < out.length; k += 1) out[k] = Math.max(out[k]!, out[k - 1]! - SLEW_DB);
  for (let k = out.length - 2; k >= 0; k -= 1) out[k] = Math.max(out[k]!, out[k + 1]! - SLEW_DB);
  return out;
}

/**
 * The rides that let the planned mix (`stems` at their planned gains) rise by
 * `shortfallLu` without passing `ceilingDbtp`. Per timeline frame whose peak
 * would pass: the beds under it come down just enough (up to MAX_BED_RIDE_DB),
 * so a hit keeps its transient and stands further out of the bed; where the
 * peak is the hit itself (or there is no bed), every clip comes down by what
 * it passes by, up to MAX_RIDE_DB. Held a frame either side, eased by SLEW_DB
 * a frame. Null when no frame passes.
 */
export function planPeakRides(stems: readonly RideStem[], sampleRate: number, fps: number, ceilingDbtp: number, shortfallLu: number): Rides | null {
  const n = Math.max(0, ...stems.map((st) => st.channels[0]?.length ?? 0));
  const frame = sampleRate / fps;
  const frames = Math.ceil(n / frame);
  const gains = stems.map((st) => 10 ** ((st.gainDb + shortfallLu) / 20));
  const ceiling = 10 ** ((ceilingDbtp - MARGIN_DB) / 20);
  const hasBed = stems.some((st) => st.bed);
  /** The frame's peak with the beds `bedDb` down. */
  const peakOf = (k: number, bedDb: number): number => {
    const bedGain = 10 ** (-bedDb / 20);
    let peak = 0;
    for (let i = Math.floor(k * frame); i < Math.min(n, Math.floor((k + 1) * frame)); i += 1) {
      for (let c = 0; c < 2; c += 1) {
        let x = 0;
        for (const [s, st] of stems.entries()) x += (st.channels[Math.min(c, st.channels.length - 1)]![i] ?? 0) * gains[s]! * (st.bed ? bedGain : 1);
        peak = Math.max(peak, Math.abs(x));
      }
    }
    return peak;
  };
  const bed = new Float64Array(frames);
  const all = new Float64Array(frames);
  for (let k = 0; k < frames; k += 1) {
    const peak = peakOf(k, 0);
    if (peak <= ceiling) continue;
    if (hasBed && peakOf(k, MAX_BED_RIDE_DB) <= ceiling) {
      let lo = 0;
      let hi = MAX_BED_RIDE_DB;
      for (let it = 0; it < 8; it += 1) {
        const mid = (lo + hi) / 2;
        if (peakOf(k, mid) <= ceiling) hi = mid;
        else lo = mid;
      }
      bed[k] = hi;
    } else all[k] = Math.min(MAX_RIDE_DB, 20 * Math.log10(peak / ceiling));
  }
  if (!bed.some((d) => d > 0) && !all.some((d) => d > 0)) return null;
  return { bed: smooth(bed), all: smooth(all) };
}

/** Ride each clip down through the frames it plays in (beds by both rides), on top of its own curve (ducks and fades kept). */
export function applyPeakRides(tx: Transaction, rides: Rides, clips: readonly { id: string; bed: boolean }[]): void {
  const fps = fpsFloatOf(tx.project);
  for (const { id, bed } of clips) {
    const db = bed ? Float64Array.from(rides.all, (x, k) => x + rides.bed[k]!) : rides.all;
    const clip = tx.project.clips.find((c) => String(c.id) === id)!;
    const start = Number(clip.position) || 0;
    const end = start + (Number(clip.end) - Number(clip.start));
    const first = Math.max(0, Math.floor(start * fps));
    const last = Math.min(db.length - 1, Math.ceil(end * fps));
    const points: GainPoint[] = [];
    for (let k = first; k <= last; k += 1) {
      // The clip's ends and the ride's corners: a flat stretch costs two points.
      if (k !== first && k !== last && db[k] === (db[k - 1] ?? 0) && db[k] === (db[k + 1] ?? 0)) continue;
      points.push({ t: Math.min(end, Math.max(start, k / fps)), db: -db[k]! });
    }
    if (points.every((p) => p.db === 0)) continue;
    const shaped = shapeVolume(clip, fps, points, "relative");
    setClipKeyframes(tx, id, "volume", shaped.points.map((p) => ({ frame: p.co.X, value: p.co.Y, interpolation: p.interpolation })), { mode: "replace" });
  }
}

/** Frames ridden and the deepest rides, for the receipt. */
export function ridesSummary(rides: Rides, project: Project): { frames: number; bedMaxDb: number; allMaxDb: number; seconds: number } {
  const frames = rides.all.filter((d, k) => d > 0.05 || rides.bed[k]! > 0.05).length;
  const max = (a: Float64Array): number => Math.round(a.reduce((m, d) => Math.max(m, d), 0) * 10) / 10;
  return { frames, bedMaxDb: max(rides.bed), allMaxDb: max(rides.all), seconds: Math.round((frames / fpsFloatOf(project)) * 100) / 100 };
}
