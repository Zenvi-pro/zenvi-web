/** Chart arithmetic for chart_build: reading numbers agents send as text, and a round axis top. */

/** The number in a value like "$1,240", "46%" or "-3.5k" (0 when there is none). */
export function parseValue(text: string): number {
  const n = Number(String(text).replace(/,/g, "").replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** The smallest 1, 2, 2.5 or 5 × 10^k at or above `max`: an axis top people read at a glance. */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const unit = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * unit >= max - 1e-9) return step * unit;
  return 10 * unit;
}

/** Index of the item to highlight: `asked` when in range, else the largest (`last` for a line, which ends on its news). */
export function highlightIndex(values: readonly number[], asked: number, last: boolean): number {
  if (asked >= 0 && asked < values.length) return asked;
  if (last) return values.length - 1;
  let best = 0;
  values.forEach((v, i) => {
    if (v > values[best]!) best = i;
  });
  return best;
}

/** Change from `from` to `to` as a signed whole percentage ("+283%"); empty when `from` is 0. */
export function percentChange(from: number, to: number): string {
  if (from === 0) return "";
  const pct = Math.round(((to - from) / Math.abs(from)) * 100);
  return `${pct > 0 ? "+" : pct < 0 ? "−" : "±"}${Math.abs(pct)}%`;
}
