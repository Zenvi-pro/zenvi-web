/**
 * A bar chart race read from the block's parameters, and its state at any
 * moment: values interpolate linearly between periods, ranks ease so an
 * overtake slides instead of jumping. Pure, so a frame depends on t alone.
 */

import type { Params } from "../../params.js";

export interface Series {
  name: string;
  values: number[];
}

export interface RacePlan {
  series: Series[];
  periods: string[];
  /** The period labels as numbers when they all are (years), so the clock can count between them. */
  numericPeriods: number[] | null;
}

const NUMBER = /^[-+]?\d*\.?\d+$/;
const num = Number;

export function planRace(params: Params): RacePlan | { error: string } {
  const periods = ((params.periods as string[] | undefined) ?? []).map((s) => s.trim());
  const series: Series[] = [];
  for (const entry of (params.series as string[] | undefined) ?? []) {
    const eq = entry.indexOf("=");
    if (eq <= 0) return { error: `bar_race series: "${entry}" is not "Name=v1, v2, …"` };
    const name = entry.slice(0, eq).trim();
    // Values are separated by commas, spaces or semicolons, so no thousands separators: 1,240 is two values.
    const parts = entry
      .slice(eq + 1)
      .split(/[\s,;]+/)
      .filter(Boolean);
    if (parts.some((s) => !NUMBER.test(s))) return { error: `bar_race series "${name}": every value must be a number (got "${entry.slice(eq + 1).trim()}")` };
    const values = parts.map(num);
    if (values.length !== periods.length) return { error: `bar_race series "${name}" has ${values.length} values for ${periods.length} periods` };
    if (values.some((v) => v < 0)) return { error: `bar_race series "${name}": values must not be negative` };
    series.push({ name, values });
  }
  if (series.length < 2) return { error: "bar_race needs at least 2 series" };
  if (periods.length < 2) return { error: "bar_race needs at least 2 periods" };
  const numericPeriods = periods.every((s) => NUMBER.test(s)) ? periods.map(num) : null;
  return { series, periods, numericPeriods };
}

/** Every series' value at race position `pos` (0 = first period, periods - 1 = last). */
export function valuesAt(plan: RacePlan, pos: number): number[] {
  const last = plan.periods.length - 1;
  const p = Math.min(last, Math.max(0, pos));
  const i = Math.min(last - 1, Math.floor(p));
  const f = p - i;
  return plan.series.map((s) => s.values[i]! + (s.values[i + 1]! - s.values[i]!) * f);
}

/** Rank of each series (0 = largest; ties keep the given order). */
export function ranksOf(values: readonly number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const ranks = new Array<number>(values.length);
  order.forEach(([, i], r) => (ranks[i] = r));
  return ranks;
}

/**
 * Ranks eased over the last `window` of race position: the mean rank over
 * 12 samples, so a swap slides over the window instead of jumping.
 */
export function smoothRanks(plan: RacePlan, pos: number, window: number): number[] {
  const n = 12;
  const sum = new Array<number>(plan.series.length).fill(0);
  for (let k = 0; k < n; k += 1) {
    const ranks = ranksOf(valuesAt(plan, pos - (window * k) / (n - 1)));
    ranks.forEach((r, i) => (sum[i]! += r));
  }
  return sum.map((s) => s / n);
}

/** The period label at `pos`: years count through (1997 between 1990 and 2000), other labels step. */
export function periodLabel(plan: RacePlan, pos: number): string {
  const last = plan.periods.length - 1;
  const p = Math.min(last, Math.max(0, pos));
  if (plan.numericPeriods) {
    const i = Math.min(last - 1, Math.floor(p));
    const a = plan.numericPeriods[i]!;
    const b = plan.numericPeriods[i + 1]!;
    return String(Math.floor(a + (b - a) * (p - i) + 1e-9));
  }
  return plan.periods[Math.round(p)]!;
}

/** Race positions where the top `top` order changes (an overtake), at most one per `gap`. */
export function overtakes(plan: RacePlan, top: number, gap: number, samplesPerPeriod = 60): number[] {
  const out: number[] = [];
  const last = plan.periods.length - 1;
  let prev = ranksOf(valuesAt(plan, 0));
  for (let s = 1; s <= last * samplesPerPeriod; s += 1) {
    const pos = s / samplesPerPeriod;
    const ranks = ranksOf(valuesAt(plan, pos));
    const changed = ranks.some((r, i) => r !== prev[i] && (r < top || prev[i]! < top));
    if (changed && (out.length === 0 || pos - out[out.length - 1]! >= gap)) out.push(pos);
    prev = ranks;
  }
  return out;
}

export function checkRace(params: Params): string | undefined {
  const plan = planRace(params);
  return "error" in plan ? plan.error : undefined;
}
