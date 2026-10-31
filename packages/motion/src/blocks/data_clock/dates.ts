/**
 * Calendar stepping for the data_clock block: parse "2006", "2006-03" or
 * "2006-03-21", step by day, week, month, quarter or year, format the stamp.
 * UTC calendar arithmetic only, so a frame never depends on the machine's zone.
 */

import type { Params } from "../../params.js";

export type Step = "day" | "week" | "month" | "quarter" | "year";
export type DateFormat = "auto" | "year" | "month" | "date" | "day";

/** A calendar day. */
export interface Ymd {
  y: number;
  m: number;
  d: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function parseDate(s: string): Ymd | undefined {
  const m = /^\s*(-?\d{1,4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?\s*$/.exec(s);
  if (!m) return undefined;
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) : 1;
  const d = m[3] ? Number(m[3]) : 1;
  if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return undefined;
  return { y, m: mo, d };
}

/** Date.UTC with the year taken literally (Date.UTC reads 0..99 as 1900..1999). */
function utc(y: number, m: number, d: number): Date {
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d);
  return t;
}

function daysIn(y: number, m: number): number {
  return utc(y, m + 1, 0).getUTCDate();
}

/** `n` steps after `from` (months clamp the day: 31 Jan + 1 month = 28/29 Feb). */
export function addSteps(from: Ymd, step: Step, n: number): Ymd {
  if (step === "day" || step === "week") {
    const t = utc(from.y, from.m, from.d + n * (step === "week" ? 7 : 1));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }
  const months = from.y * 12 + (from.m - 1) + n * (step === "year" ? 12 : step === "quarter" ? 3 : 1);
  const y = Math.floor(months / 12);
  const m = months - y * 12 + 1;
  return { y, m, d: Math.min(from.d, daysIn(y, m)) };
}

/** Whole steps from `a` to `b` (b on or after a). */
export function stepsBetween(a: Ymd, b: Ymd, step: Step): number {
  if (step === "day" || step === "week") {
    const days = Math.round((utc(b.y, b.m, b.d).getTime() - utc(a.y, a.m, a.d).getTime()) / 86_400_000);
    return Math.floor(days / (step === "week" ? 7 : 1));
  }
  const months = b.y * 12 + b.m - (a.y * 12 + a.m);
  const n = Math.floor(months / (step === "year" ? 12 : step === "quarter" ? 3 : 1));
  // A step lands on a clamped day (31 Jan + 1 month = 28 Feb), so count the steps that do not pass b.
  const past = (c: Ymd): boolean => c.y * 10_000 + c.m * 100 + c.d > b.y * 10_000 + b.m * 100 + b.d;
  return past(addSteps(a, step, n)) ? n - 1 : n;
}

const pad = (n: number): string => String(n).padStart(2, "0");

export function formatDate(date: Ymd, format: DateFormat, step: Step): string {
  const f = format === "auto" ? (step === "year" ? "year" : step === "month" || step === "quarter" ? "month" : "date") : format;
  if (f === "year") return String(date.y);
  if (f === "month") return step === "quarter" ? `Q${Math.ceil(date.m / 3)} ${date.y}` : `${MONTHS[date.m - 1]} ${date.y}`;
  if (f === "day") return `${date.d} ${MONTHS[date.m - 1]} ${date.y}`;
  return `${date.y} / ${pad(date.m)} / ${pad(date.d)}`;
}

export interface Legend {
  label: string;
  min: string;
  max: string;
  ramp: string;
}

export const RAMPS: Readonly<Record<string, readonly string[]>> = {
  thermal: ["#140B34", "#5C1A6E", "#B5325A", "#EE6A2A", "#FCE38A"],
  ocean: ["#0B1D51", "#1F4E8C", "#2C8FB8", "#6FD3C6", "#E6F9D8"],
  aurora: ["#2A0F5E", "#2E5C9A", "#1FA187", "#7AD151", "#F4E61E"],
  heat: ["#FFF5D6", "#FDC66F", "#F2762E", "#C2281D", "#5C0B0B"],
  mono: ["#111114", "#55555E", "#9A9AA3", "#D6D6DC", "#FFFFFF"],
};

export interface ClockPlan {
  start: Ymd;
  step: Step;
  /** Steps after start the clock reaches. */
  count: number;
  /** Steps per second. */
  rate: number;
  legends: Legend[];
}

/** Seconds the clock runs (from 0.3 s to 0.8 s before the end). */
export const runFor = (seconds: number): number => Math.max(0.5, seconds - 1.1);

export function planClock(params: Params, seconds: number): ClockPlan | { error: string } {
  const step = String(params.step ?? "day") as Step;
  const start = parseDate(String(params.start ?? ""));
  if (!start) return { error: `data_clock start: "${String(params.start)}" is not a date like 2006, 2006-03 or 2006-03-21` };
  const endText = String(params.end ?? "").trim();
  const end = endText ? parseDate(endText) : undefined;
  if (endText && !end) return { error: `data_clock end: "${endText}" is not a date like 2006, 2006-03 or 2006-03-21` };
  let count: number;
  let rate = Number(params.rate ?? 0);
  if (end) {
    count = stepsBetween(start, end, step);
    if (count < 1) return { error: `data_clock end (${endText}) must be at least one ${step} after start` };
    if (rate > 0) count = Math.max(1, Math.min(count, Math.floor(rate * runFor(seconds))));
    else rate = count / runFor(seconds);
  } else {
    if (rate <= 0) rate = 2;
    count = Math.max(1, Math.floor(rate * runFor(seconds)));
  }
  const legends: Legend[] = [];
  for (const entry of (params.legends as string[] | undefined) ?? []) {
    const m = /^(.*?)\s*=\s*(.+?)\s*\.\.\s*(.+?)\s*(?:@\s*([a-z]+))?\s*$/i.exec(entry);
    if (!m) return { error: `data_clock legends: "${entry}" is not "Label=min..max" (optionally "@thermal")` };
    const ramp = (m[4] ?? Object.keys(RAMPS)[legends.length % Object.keys(RAMPS).length]!).toLowerCase();
    if (!Object.hasOwn(RAMPS, ramp)) return { error: `data_clock legends: no colour ramp "${m[4]}" (${Object.keys(RAMPS).join(", ")})` };
    legends.push({ label: m[1]!, min: m[2]!, max: m[3]!, ramp });
  }
  return { start, step, count, rate, legends };
}

export function checkClock(params: Params): string | undefined {
  // The length does not change what is valid, only how many steps fit.
  const plan = planClock(params, 10);
  return "error" in plan ? plan.error : undefined;
}
