/**
 * The technique draws of recent films on this machine (`DrawMemoryHost`):
 * one line per film in `<cache dir>/technique-draws.jsonl`, so a house
 * style's next draw (engine brief/house.ts) skips what the last films used,
 * the way cinetic's pick.py `--avoid` skips an earlier plan. Losing the file
 * only makes the next draw forget; nothing else reads it.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DrawMemoryHost } from "@zenvi/engine";

export const DRAW_MEMORY_FILE = "technique-draws.jsonl";
/** Films whose picks the next draw avoids. */
export const RECENT_FILMS = 3;
/** Lines kept: enough history, small enough to rewrite. */
const KEEP = 50;

interface DrawLine {
  at: string;
  project?: string;
  techniques: string[];
}

async function readLines(file: string): Promise<DrawLine[]> {
  const text = await readFile(file, "utf8").catch(() => "");
  return text.split("\n").flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as DrawLine;
      return Array.isArray(parsed.techniques) ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

export function createDrawMemory(dir: string): DrawMemoryHost {
  const file = path.join(dir, DRAW_MEMORY_FILE);
  return {
    recent: async () => [...new Set((await readLines(file)).slice(-RECENT_FILMS).flatMap((l) => l.techniques.map(String)))],
    remember: async (techniques, project) => {
      if (techniques.length === 0) return;
      // A film drawn again (a re-run, a reroll) replaces its own line.
      const lines = (await readLines(file)).filter((l) => project === undefined || l.project !== project);
      lines.push({ at: new Date().toISOString(), ...(project ? { project } : {}), techniques: [...techniques] });
      await mkdir(dir, { recursive: true });
      await writeFile(file, lines.slice(-KEEP).map((l) => JSON.stringify(l)).join("\n") + "\n");
    },
  };
}
