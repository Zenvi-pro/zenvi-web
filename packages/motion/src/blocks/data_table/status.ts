/**
 * Chip colours by the status word in it: green done, amber waiting, red stuck
 * (the convention of status boards). Stuck is read first so a negated word
 * ("unpaid", "not ready", "incomplete") is not taken for done.
 */
const STATUS: readonly [RegExp, string][] = [
  [/block|fail|overdue|\blate\b|error|off track|declined|unpaid|inactive|incomplete|\bnot (done|ready|paid|approved|active|live)|^no$/i, "#EF5350"],
  [/review|pending|progress|scheduled|draft|waiting|queued|soon|not started|to ?do/i, "#F2A93B"],
  [/done|live|shipped|complete|paid|active|on track|ready|approved|^yes$/i, "#2FBF71"],
];

/** The chip colour for a status word, `fallback` (the accent) when it names none. */
export function statusColor(text: string, fallback: string): string {
  return STATUS.find(([re]) => re.test(text.trim()))?.[1] ?? fallback;
}
