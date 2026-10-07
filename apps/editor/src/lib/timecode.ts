/**
 * Timecode display, ported from zenvi-core src/classes/time_parts.py
 * (`secondsToTime`, `secondsToTimecode`, `timecodeToSeconds`) so the web
 * editor shows the same HH:MM:SS:FF as the desktop.
 */
import type { Fraction } from "@zenvi/engine";

function pad(value: number, length = 2): string {
  return String(Math.trunc(value)).padStart(length, "0");
}

export interface TimeParts {
  hour: string;
  min: string;
  sec: string;
  milli: string;
  frame: string;
}

/** time_parts.py:34 `secondsToTime` (without weeks/days, which the editor never shows). */
export function secondsToTime(seconds: number, fps: Fraction): TimeParts {
  const secs = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const milliseconds = secs * 1000;
  let sec = Math.floor(milliseconds / 1000);
  const milli = milliseconds % 1000;
  let minute = Math.floor(sec / 60);
  sec %= 60;
  const hour = Math.floor(minute / 60);
  minute %= 60;
  const fpsFloat = fps.den ? fps.num / fps.den : 0;
  // Python round() is banker's rounding; frame fractions exactly at .5 are rare
  // enough in practice that Math.round only differs at those ties.
  let frame = Math.round((milli / 1000) * fpsFloat);
  if (fpsFloat > 0) frame = Math.max(0, Math.min(frame, Math.trunc(fpsFloat) - 1));
  return { hour: pad(hour), min: pad(minute), sec: pad(sec), milli: pad(milli, 3), frame: pad(frame) };
}

/** HH:MM:SS:FF (time_parts.py:73 `secondsToTimecode`). */
export function secondsToTimecode(seconds: number, fps: Fraction): string {
  const p = secondsToTime(seconds, fps);
  return `${p.hour}:${p.min}:${p.sec}:${p.frame}`;
}

/**
 * Parse what a person types into a time field: "HH:MM:SS:FF" (desktop),
 * "MM:SS", "SS.sss", "90s", "1:30". Returns seconds or null.
 */
export function parseTimecode(text: string, fps: Fraction): number | null {
  const t = text.trim().replace(/s$/i, "");
  if (!t) return null;
  const fpsFloat = fps.num / fps.den;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const parts = t.split(":");
  if (parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  const n = parts.map(Number);
  if (n.length === 4) return n[0]! * 3600 + n[1]! * 60 + n[2]! + n[3]! / fpsFloat;
  if (n.length === 3) return n[0]! * 3600 + n[1]! * 60 + n[2]!;
  if (n.length === 2) return n[0]! * 60 + n[1]!;
  return null;
}
