/**
 * The creative-direction draw across edits (zenvi-styles BRIEF.md step 3b,
 * after Tweenkit's kinetic-cut-video brief draw, MIT): every saved brief's
 * axis picks go to `<config dir>/brief-directions.jsonl`, and the brief
 * compiler is handed a fresh seeded draw that avoids the last edit's picks,
 * so one machine's edits stop all looking alike.
 */

import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { drawDirection, repeatedAxes, type Brief } from "@zenvi/engine";

const FILE = "brief-directions.jsonl";
/** Lines kept: enough history for "the last edit", small enough to rewrite. */
const KEEP = 50;

type Picks = Record<string, string>;

function picksOf(brief: Brief): Picks {
  return Object.fromEntries(brief.direction.map((d) => [d.axis.trim().toLowerCase(), d.pick]));
}

/** The last saved edit's picks by axis ({} before the first). */
export async function lastDirection(configDir: string): Promise<Picks> {
  try {
    const lines = (await readFile(path.join(configDir, FILE), "utf8")).trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1] ?? "{}") as { picks?: Picks };
    return last.picks ?? {};
  } catch {
    return {};
  }
}

/** Record `brief`'s picks; returns the axes that repeat the previous edit's. */
export async function recordDirection(configDir: string, brief: Brief): Promise<string[]> {
  if (brief.direction.length === 0) return [];
  const last = await lastDirection(configDir);
  const file = path.join(configDir, FILE);
  const line = `${JSON.stringify({ at: new Date().toISOString(), style: brief.style, picks: picksOf(brief) })}\n`;
  try {
    await appendFile(file, line, { mode: 0o600 });
    const lines = (await readFile(file, "utf8")).trim().split("\n");
    if (lines.length > KEEP) await writeFile(file, `${lines.slice(-KEEP).join("\n")}\n`);
  } catch {
    // A read-only config dir only loses the history.
  }
  return repeatedAxes(brief, last);
}

/** The draw for the next brief, as text for the agent. */
export async function drawText(configDir: string, seed = Date.now()): Promise<string> {
  const last = await lastDirection(configDir);
  const draw = drawDirection(seed, last);
  const lines = Object.entries(draw).map(([axis, pick]) => `- ${axis}: ${pick}${last[axis] ? ` (last edit: ${last[axis]})` : ""}`);
  return [
    "Creative-direction draw for this edit (BRIEF.md 3b): take at least 3 axes into the brief's direction. Keep a pick, or re-draw one that fights the subject, and write why; never fall back to the last edit's picks.",
    ...lines,
  ].join("\n");
}
