/**
 * The creative-direction draw across edits (zenvi-styles BRIEF.md step 3b,
 * after Tweenkit's kinetic-cut-video brief draw, MIT): every saved brief's
 * axis picks go to `<config dir>/brief-directions.jsonl`, and the brief
 * compiler is handed a fresh seeded draw that avoids the last edit's picks,
 * so one machine's edits stop all looking alike. Each line names its
 * project: a project's later saves (a revised brief) replace its line and
 * are compared with the edit before it, not with themselves.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { drawDirection, repeatedAxes, type Brief } from "@zenvi/engine";

const FILE = "brief-directions.jsonl";
/** Lines kept: enough history for "the last edit", small enough to rewrite. */
const KEEP = 50;

type Picks = Record<string, string>;

function picksOf(brief: Brief): Picks {
  return Object.fromEntries(brief.direction.map((d) => [d.axis.trim().toLowerCase(), d.pick]));
}

interface DirectionLine {
  at?: string;
  project?: string;
  style?: string;
  picks?: Picks;
}

async function readLines(file: string): Promise<DirectionLine[]> {
  try {
    return (await readFile(file, "utf8"))
      .split("\n")
      .filter((l) => l.trim())
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as DirectionLine];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/** The picks by axis of the last edit saved before this one (`project`: the edit being made, skipped); {} before the first. */
export async function lastDirection(configDir: string, project?: string): Promise<Picks> {
  const lines = await readLines(path.join(configDir, FILE));
  const last = lines.filter((l) => project === undefined || l.project !== project).pop();
  return last?.picks ?? {};
}

/** Record `brief`'s picks for `project`; returns the axes that repeat the previous edit's. */
export async function recordDirection(configDir: string, brief: Brief, project: string): Promise<string[]> {
  if (brief.direction.length === 0) return [];
  const file = path.join(configDir, FILE);
  const lines = await readLines(file);
  const last = lines.filter((l) => l.project !== project).pop()?.picks ?? {};
  const kept = [...lines.filter((l) => l.project !== project), { at: new Date().toISOString(), project, style: brief.style, picks: picksOf(brief) }].slice(-KEEP);
  try {
    await writeFile(file, kept.map((l) => `${JSON.stringify(l)}\n`).join(""), { mode: 0o600 });
  } catch {
    // A read-only config dir only loses the history.
  }
  return repeatedAxes(brief, last);
}

/** The draw for the next brief, as text for the agent. */
export async function drawText(configDir: string, project?: string, seed = Date.now()): Promise<string> {
  const last = await lastDirection(configDir, project);
  const draw = drawDirection(seed, last);
  const lines = Object.entries(draw).map(([axis, pick]) => `- ${axis}: ${pick}${last[axis] ? ` (last edit: ${last[axis]})` : ""}`);
  return [
    "Creative-direction draw for this edit (BRIEF.md 3b): take at least 3 axes into the brief's direction. Keep a pick, or re-draw one that fights the subject, and write why; never fall back to the last edit's picks.",
    ...lines,
  ].join("\n");
}
