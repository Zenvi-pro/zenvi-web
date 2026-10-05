/**
 * Premiere Pro time for the mock DOM: ticks (254016000000 per second), the
 * `Time` class (`ticks` string is the truth, `seconds` a float view, both
 * writable) and timecodes as Time.getFormatted writes them.
 */

export const TICKS_PER_SECOND = 254016000000;

/** Whole ticks for `seconds`, as Premiere's string. */
export function ticks(seconds: number): string {
  return String(Math.round(seconds * TICKS_PER_SECOND));
}

/** Ticks per frame; NTSC rates are exact (30000/1001 etc.). */
export function frameTicksFor(fps: number): number {
  const ntsc: Record<string, number> = { "23.976": 10594584000, "29.97": 8475667200, "59.94": 4237833600 };
  return ntsc[String(fps)] ?? Math.round(TICKS_PER_SECOND / fps);
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Ticks of a Time-like value: a Time (or {ticks}), seconds as a number, or a ticks string. */
export function ticksOf(value: unknown): number {
  if (value && typeof value === "object" && "ticks" in value) return Math.round(Number((value as { ticks: unknown }).ticks));
  if (typeof value === "number") return Math.round(value * TICKS_PER_SECOND);
  if (typeof value === "string" && value.trim() !== "") return Math.round(Number(value));
  throw new Error(`Not a time: ${String(value)}`);
}

export class Time {
  private value = 0;

  get ticks(): string {
    return String(this.value);
  }

  set ticks(value: string) {
    this.value = Math.round(Number(value));
  }

  get seconds(): number {
    return this.value / TICKS_PER_SECOND;
  }

  set seconds(value: number) {
    this.value = Math.round(value * TICKS_PER_SECOND);
  }

  /** Timecode in a display format (TIME_FORMAT: 102/106 drop-frame use ";", 109 = frames). */
  getFormatted(frameRate: Time, format: number): string {
    const frameTicks = Number(frameRate.ticks);
    const frames = Math.round(this.value / frameTicks);
    const nominal = Math.round(TICKS_PER_SECOND / frameTicks);
    if (format === 109) return String(frames);
    const sep = format === 102 || format === 106 ? ";" : ":";
    return [Math.floor(frames / (nominal * 3600)), Math.floor(frames / (nominal * 60)) % 60, Math.floor(frames / nominal) % 60, frames % nominal]
      .map(pad2)
      .join(sep);
  }

  setSecondsAsFraction(numerator: number, denominator: number): boolean {
    this.seconds = numerator / denominator;
    return true;
  }

  static fromSeconds(seconds: number): Time {
    const time = new Time();
    time.seconds = seconds;
    return time;
  }

  static fromTicks(value: number | string): Time {
    const time = new Time();
    time.ticks = String(value);
    return time;
  }
}

/** Ticks of a timecode ("00:00:01:15", "00;00;01;15", or bare frames) at a frame duration. */
export function timecodeTicks(timecode: string, frameTicks: number): number {
  const nominal = Math.round(TICKS_PER_SECOND / frameTicks);
  const parts = String(timecode).split(/[:;]/).map(Number);
  let frames = 0;
  for (const part of parts.slice(0, -1)) frames = frames * 60 + part;
  frames = frames * nominal + (parts[parts.length - 1] ?? 0);
  return frames * frameTicks;
}
