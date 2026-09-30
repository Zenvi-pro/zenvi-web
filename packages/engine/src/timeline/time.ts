/**
 * Frame-rate math.
 *
 * libopenshot numbers frames from 1: frame n of a stream at `fps` starts at
 * t = (n - 1) / fps. Sources: libopenshot src/Fraction.cpp (ToDouble/ToFloat),
 * src/Timeline.cpp:550-557 (`calculate_time`), :1071-1075 (clip windows),
 * src/Frame.cpp:458-483 (`GetSamplesPerFrame`). Spec: libopenshot-semantics §6.
 */

import type { Fraction } from "../model/types.js";
import { roundHalfAway } from "../model/rounding.js";

/** `Fraction::ToDouble()`: num / den. */
export function fpsFloat(fps: Fraction): number {
  return fps.num / fps.den;
}

/** `Fraction::ToFloat()`: float division (used by `Timeline::calculate_time`). */
export function fpsFloat32(fps: Fraction): number {
  return Math.fround(Math.fround(fps.num) / Math.fround(fps.den));
}

/** Length of one frame, seconds (den / num). */
export function frameDuration(fps: Fraction): number {
  return fps.den / fps.num;
}

/**
 * The 1-based frame that starts at (or nearest to) `seconds`:
 * `llround(seconds * fps) + 1`, the formula libopenshot uses for clip and
 * transition edges (Timeline.cpp:1071).
 */
export function secondsToFrame(seconds: number, fps: Fraction): number {
  return roundHalfAway(seconds * fpsFloat(fps)) + 1;
}

/** Start time of 1-based frame `frame`: (frame - 1) / fps (desktop Python `(frame - 1) / fps_float`). */
export function frameToSeconds(frame: number, fps: Fraction): number {
  return (frame - 1) / fpsFloat(fps);
}

/** libopenshot `Timeline::calculate_time`: (frame - 1) / fps.ToFloat(). */
export function frameTimeLibopenshot(frame: number, fps: Fraction): number {
  return (frame - 1) / fpsFloat32(fps);
}

/** The frame whose display interval contains `seconds` (floor, with a tiny tolerance for float noise). */
export function frameContaining(seconds: number, fps: Fraction): number {
  return Math.floor(seconds * fpsFloat(fps) + 1e-9) + 1;
}

/** `seconds` rounded to the nearest frame boundary (desktop "snap to FPS grid", properties_model.py:1016). */
export function snapToFrame(seconds: number, fps: Fraction): number {
  return roundHalfAway(seconds * fpsFloat(fps)) / fpsFloat(fps);
}

/** Whole frames in `seconds` (rounded half away from zero). */
export function secondsToFrameCount(seconds: number, fps: Fraction): number {
  return roundHalfAway(seconds * fpsFloat(fps));
}

/**
 * `Frame::GetSamplesPerFrame`: audio samples (per channel) in 1-based frame
 * `frame`. Ported literally in doubles so the fmod rounding of the running
 * total matches (Frame.cpp:458-483).
 */
export function samplesPerFrame(frame: number, fps: Fraction, sampleRate: number, channels: number): number {
  const fpsRate = fps.den / fps.num;
  let previous = sampleRate * fpsRate * (frame - 1);
  previous -= previous % channels;
  let total = sampleRate * fpsRate * frame;
  total -= total % channels;
  const count = roundHalfAway(total - previous);
  return count < 0 ? 0 : count;
}

/**
 * First sample (per channel) of 1-based frame `frame` in a stream starting at
 * frame 1: the running total `GetSamplesPerFrame` rounds.
 */
export function frameSampleOffset(frame: number, fps: Fraction, sampleRate: number, channels: number): number {
  let total = sampleRate * (fps.den / fps.num) * (frame - 1);
  total -= total % channels;
  return roundHalfAway(total);
}

/** Parse "30000/1001", "29.97", or a Fraction-like object. Returns null when invalid. */
export function parseFps(value: unknown): Fraction | null {
  if (typeof value === "object" && value !== null) {
    const { num, den } = value as { num?: unknown; den?: unknown };
    if (typeof num === "number" && typeof den === "number" && num > 0 && den > 0) return { num, den };
    return null;
  }
  if (typeof value === "string" && value.includes("/")) {
    const [n, d] = value.split("/").map((s) => Number(s.trim()));
    if (n !== undefined && d !== undefined && Number.isFinite(n) && Number.isFinite(d) && n > 0 && d > 0) {
      return { num: n, den: d };
    }
    return null;
  }
  const rate = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return fpsFromRate(rate);
}

/**
 * A frame rate number as a fraction, the way zenvi-core
 * agent_tools/project_settings.py does: 23.976 / 29.97 / 59.94 (±0.01) snap
 * to the NTSC fractions, integers stay integers, anything else is the closest
 * fraction with denominator <= 1001 (Python `Fraction.limit_denominator`).
 */
export function fpsFromRate(rate: number): Fraction {
  if (Math.abs(rate - 23.976) < 0.01) return { num: 24000, den: 1001 };
  if (Math.abs(rate - 29.97) < 0.01) return { num: 30000, den: 1001 };
  if (Math.abs(rate - 59.94) < 0.01) return { num: 60000, den: 1001 };
  if (rate === Math.trunc(rate)) return { num: rate, den: 1 };
  return limitDenominator(rate, 1001);
}

/**
 * Python `Fraction(x).limit_denominator(maxDen)`: the closest fraction to the
 * exact value of the double `x` with denominator <= maxDen. Ported from
 * CPython Lib/fractions.py (continued fractions, exact integer math).
 */
export function limitDenominator(x: number, maxDen: number): Fraction {
  const [num, den] = exactRatio(x);
  const max = BigInt(maxDen);
  if (den <= max) return { num: Number(num), den: Number(den) };
  let p0 = 0n, q0 = 1n, p1 = 1n, q1 = 0n;
  let n = num, d = den;
  for (;;) {
    const a = n / d;
    const q2 = q0 + a * q1;
    if (q2 > max) break;
    [p0, q0, p1, q1] = [p1, q1, p0 + a * p1, q2];
    [n, d] = [d, n - a * d];
  }
  const k = (max - q0) / q1;
  if (2n * d * (q0 + k * q1) <= den) return { num: Number(p1), den: Number(q1) };
  return { num: Number(p0 + k * p1), den: Number(q0 + k * q1) };
}

/** The exact value of a finite positive double as numerator/denominator in lowest terms. */
function exactRatio(x: number): [bigint, bigint] {
  let v = x;
  let k = 0;
  while (!Number.isInteger(v)) {
    v *= 2; // exact for doubles
    k += 1;
  }
  let n = BigInt(v);
  let d = 1n << BigInt(k);
  while (d > 1n && n % 2n === 0n) {
    n /= 2n;
    d /= 2n;
  }
  return [n, d];
}

/** True when two frame rates are the same rational number. */
export function sameFps(a: Fraction, b: Fraction): boolean {
  return a.num * b.den === b.num * a.den;
}
