/**
 * Make several, keep the best: fork_project_tool keeps the open edit as a
 * named variant to try a different cut on, compare_renders_tool watches two
 * renders side by side (both orders, review/compare.ts), and
 * pick_best_variant_tool runs a small tournament over the variants' renders
 * and makes the winner the open project. A single agent run swings 12-16
 * bench points; picking the best of three is the cheapest way up.
 */

import { z } from "zod";
import type { Project } from "../../model/types.js";
import {
  combineOrders,
  combineSeparate,
  COMPARE_MAX_SECONDS,
  COMPARE_MAX_VARIANTS,
  type CompareRequest,
  type PairJudgment,
} from "../../review/compare.js";
import { isWatchError, WATCH_DIMENSION_NAMES, type WatchDimension } from "../../review/watch.js";
import { directTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { applied, failed, refused, unchanged, type ToolReceipt } from "../receipt.js";

const FORK = "fork_project_tool";
const COMPARE = "compare_renders_tool";
const PICK = "pick_best_variant_tool";

const PROJECT_EXTS = [".zvn", ".osp", ".flow"];
/** Project keys a variant does not bring along: the open project keeps its identity and its own undo history. */
const KEEP_KEYS = new Set(["id", "history"]);

const fmt = (value: number): string => `${value.toFixed(2)}s`;
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const focusArg = z
  .array(z.enum(WATCH_DIMENSION_NAMES as [WatchDimension, ...WatchDimension[]]))
  .max(4)
  .optional()
  .describe("Dimensions to weigh most, e.g. [\"pacing\", \"transitions\"] when the variants differ on pacing.");
const briefArg = z.string().max(2000).optional().describe("What the edit was asked to be (the brief), so the judge picks the better attempt at it.");

// ---------------------------------------------------------------------------
// Judging two renders
// ---------------------------------------------------------------------------

/** Seconds of each render, read the way the watch host opens it; a refusal in words when one is too long or unreadable. */
async function checkLengths(call: ToolCall, tool: string, paths: readonly string[]): Promise<ToolReceipt | null> {
  const watcher = call.host.watch!;
  const media = call.host.media;
  const read = watcher.length
    ? (p: string) => watcher.length!(p, call.signal)
    : media
      ? async (p: string) => Number((await media.probe(p)).duration)
      : null;
  if (!read) return null;
  for (const p of paths) {
    let seconds: number;
    try {
      seconds = await read(p);
    } catch (error) {
      return refused(tool, `Error: could not read ${p}: ${message(error)}`);
    }
    if (!(seconds > 0)) return refused(tool, `Error: could not read the length of ${p}.`);
    if (seconds > COMPARE_MAX_SECONDS + 0.5) {
      return refused(tool, `Error: ${p} is ${fmt(seconds)} long; comparing takes renders of at most ${COMPARE_MAX_SECONDS} s. Render the variants as short proxies (or the part that differs) and compare those.`);
    }
  }
  return null;
}

/** a vs b: both orders through `compare` when the host has it, else one watch of each. */
async function judgePair(call: ToolCall, a: string, b: string, request: CompareRequest): Promise<PairJudgment> {
  const watcher = call.host.watch!;
  if (watcher.compare) {
    // One after the other: the same model and rate limit, and a refusal (credits) stops before the second.
    const ab = await watcher.compare(a, b, request);
    const ba = await watcher.compare(b, a, request);
    return combineOrders(ab, ba);
  }
  const first = await watcher.watch(a, request);
  const second = await watcher.watch(b, request);
  return combineSeparate(first, second);
}

/** A watch that did not happen, as the tool's receipt. */
function watchFailure(call: ToolCall, tool: string, error: unknown): ToolReceipt {
  if (call.signal?.aborted) return refused(tool, "Error: cancelled");
  if (isWatchError(error)) return (error.code === "failed" ? failed : refused)(tool, `Error: ${error.message}`);
  return failed(tool, `Error: comparing failed: ${message(error)}`);
}

function scoreTable(judgment: PairJudgment, names: { a: string; b: string }): string {
  const cell = (v: number | null): string => (v === null ? "-" : String(v));
  const rows = WATCH_DIMENSION_NAMES.filter((d) => judgment.scores.a[d] !== null || judgment.scores.b[d] !== null).map(
    (d) => `${d} ${cell(judgment.scores.a[d])} vs ${cell(judgment.scores.b[d])}`,
  );
  return `Scores (${names.a} vs ${names.b}): ${rows.join(" · ")}; overall ${cell(judgment.overall.a)} vs ${cell(judgment.overall.b)}`;
}

function decidedText(judgment: PairJudgment): string {
  if (judgment.method === "separate") {
    return judgment.decidedBy === "kept" ? "a tie on separate watches (within half a point)" : "on separate watches (less reliable than side by side)";
  }
  if (judgment.decidedBy === "agreed") return "both orders agree";
  return judgment.decidedBy === "scores" ? "the orders disagreed; the mean scores decide" : "a tie in both orders and scores";
}

function fixLines(judgment: Pick<PairJudgment, "fixes">): string[] {
  return judgment.fixes.map((f, i) => `${i + 1}. ${f.dimension} at ${fmt(f.start)}: ${f.problem} Fix: ${f.fix} Tools: ${f.tools.join(", ")}`);
}

function judgmentData(judgment: PairJudgment, paths: { a: string; b: string }) {
  return {
    method: judgment.method,
    model: judgment.model,
    via: judgment.via,
    winner: judgment.winner === "a" ? paths.a : paths.b,
    decided_by: judgment.decidedBy,
    orders: judgment.orders,
    scores: { [paths.a]: judgment.scores.a, [paths.b]: judgment.scores.b },
    overall: { [paths.a]: judgment.overall.a, [paths.b]: judgment.overall.b },
    margin: judgment.margin,
    why: judgment.why,
    fixes: judgment.fixes,
    usage: judgment.usage,
  };
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

const variantName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "a short lowercase name: letters, digits and dashes (e.g. \"fast-cuts\")")
  .describe("The variant's name, saying how it differs: \"fast-cuts\", \"bold-type\", \"warm-grade\".");

/**
 * Where a variant of the open project is kept: `<project>-<name>.zvn` in the
 * same folder. Hosts resolve relative paths (renders, media, the base project)
 * from the open project's folder, so a variant in a subfolder would render
 * `renders/x.mp4` somewhere else and could not reopen the base by its name.
 */
function variantPath(current: string | null, name: string): string {
  const base = (current ?? "").split(/[\\/]/).pop() ?? "";
  const stem = PROJECT_EXTS.reduce((s, ext) => (s.endsWith(ext) ? s.slice(0, -ext.length) : s), base) || "project";
  return `${stem}-${name}.zvn`;
}

/**
 * The open project becomes `winner` in one undo step: every top-level key
 * that differs is replaced, keys the winner lacks are kept (unknown keys
 * survive), and the open project keeps its id and history.
 */
function adoptVariant(call: ToolCall, winner: Project, label: string): number {
  const current = call.doc.project as unknown as Record<string, unknown>;
  const incoming = winner as unknown as Record<string, unknown>;
  const changed = Object.keys(incoming).filter((k) => !KEEP_KEYS.has(k) && k in current && JSON.stringify(current[k]) !== JSON.stringify(incoming[k]));
  if (changed.length === 0) return 0;
  call.commit((tx) => {
    for (const key of changed) tx.replace([key], structuredClone(incoming[key]));
  }, label);
  return changed.length;
}

interface Variant {
  name: string;
  project: string;
  render: string;
}

const forkInput = z.strictObject({
  name: variantName,
  path: z.string().min(1).optional().describe("Where to keep the copy instead (a .zvn path relative to the project's folder). Keep it in the project's folder, so relative render and project paths mean the same in every variant. Default <project>-<name>.zvn."),
  replace: z.boolean().optional().describe("Replace a variant already saved under this name (default false: refused)."),
});

const compareInput = z.strictObject({
  a: z.string().min(1).describe("The first render (a path as render/export wrote it)."),
  b: z.string().min(1).describe("The second render."),
  brief: briefArg,
  focus: focusArg,
});

const pickInput = z.strictObject({
  variants: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(40).optional().describe("A label for the receipt (default: the project file's name)."),
        project: z.string().min(1).describe("The variant's project (.zvn), as fork_project_tool saved it."),
        render: z.string().min(1).describe("Its render or proxy render, at most 60 s."),
      }),
    )
    .min(2)
    .max(COMPARE_MAX_VARIANTS)
    .describe(`2-${COMPARE_MAX_VARIANTS} variants, each a project and its render. The first is the champion to beat.`),
  brief: briefArg,
  focus: focusArg,
  apply: z.boolean().optional().describe("Make the winner the open project, one undo step (default true). false: only report the ranking."),
});

export const variantTools: CatalogTool[] = [
  directTool({
    name: FORK,
    title: "Keep the edit as a variant",
    description:
      "Save a copy of the open edit as a named variant (<project>-<name>.zvn next to it, the same media, no copy of any file) and stay on the open project; changes nothing and makes no undo step. " +
      "Best-of-N: fork 2-3 variants that differ on purpose (pacing, type system, grade or music), open_project_tool each and make its change, render each as a short proxy, then pick_best_variant_tool.",
    input: forkInput,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["storage"],
    run: async (call, args: z.output<typeof forkInput>) => {
      const storage = call.host.storage!;
      if (!storage.saveCopy) return unavailable(FORK, "keeping a variant needs project storage that can save a copy, which this host does not provide.");
      const current = storage.currentPath?.() ?? null;
      if (!current && !args.path) return refused(FORK, "Error: save the project first (save_project_tool with a path), so the variant's media paths have a folder to resolve from.");
      let target = args.path ?? variantPath(current, args.name);
      if (!PROJECT_EXTS.some((ext) => target.endsWith(ext))) target += ".zvn";
      let where: string;
      try {
        where = await storage.saveCopy(call.doc.toJSON(), target, { overwrite: args.replace === true });
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (code === "EEXIST") return refused(FORK, `Error: a variant is already saved at ${target}; give another name, or replace: true to overwrite it.`);
        return failed(FORK, `Error: could not save the variant: ${message(error)}`);
      }
      const clips = (call.doc.project.clips ?? []).length;
      return applied(
        FORK,
        `Kept the edit (${clips} clips) as variant "${args.name}" at ${where}. The open project is unchanged. ` +
          `To work on the variant: open_project_tool file_path "${where}", make its change, render it, then open the original again before pick_best_variant_tool.`,
        { data: { name: args.name, project: where, of: current, clips } },
        0,
      );
    },
  }),

  directTool({
    name: COMPARE,
    title: "Compare two renders",
    description:
      `Watch two renders side by side with sound and say which is the better edit: 1-10 per dimension for each, the winner, and the 3 fixes that would most improve the winner, each with the tools that make it. ` +
      `Each pair is watched twice with the order swapped and the scores averaged, which cancels the judge's bias for one side. Renders at most ${COMPARE_MAX_SECONDS} s; costs two watches. Changes nothing.`,
    input: compareInput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    requires: ["watch"],
    run: async (call, args: z.output<typeof compareInput>) => {
      if (args.a === args.b) return refused(COMPARE, "Error: a and b are the same render; give two different files.");
      const tooLong = await checkLengths(call, COMPARE, [args.a, args.b]);
      if (tooLong) return tooLong;
      let judgment: PairJudgment;
      try {
        judgment = await judgePair(call, args.a, args.b, { brief: args.brief, focus: args.focus, signal: call.signal });
      } catch (error) {
        return watchFailure(call, COMPARE, error);
      }
      const won = judgment.winner === "a" ? args.a : args.b;
      const fixes = fixLines(judgment);
      const summary =
        `${won} is the better edit (${decidedText(judgment)}; margin ${judgment.margin >= 0 ? "+" : ""}${judgment.margin} for ${args.a}). ${judgment.why}` +
        `\n${scoreTable(judgment, { a: args.a, b: args.b })}` +
        (fixes.length > 0 ? `\nFix these on ${won} first:\n${fixes.join("\n")}` : "");
      return applied(COMPARE, summary, { data: judgmentData(judgment, { a: args.a, b: args.b }) }, 0);
    },
  }),

  directTool({
    name: PICK,
    title: "Pick the best variant",
    description:
      `Run a small tournament over 2-${COMPARE_MAX_VARIANTS} variants' renders (each match watched side by side in both orders, winner stays on) and make the winner the open project in one undo step, ` +
      `keeping the open project's file. Returns the ranking, every match's scores, and the winner's 3 most important fixes with their tools: make them, render, and watch_render_tool once. ` +
      `Call it from the original project (open_project_tool it again after editing the variants). Renders at most ${COMPARE_MAX_SECONDS} s each; costs two watches per match.`,
    input: pickInput,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    requires: ["watch", "storage"],
    run: async (call, args: z.output<typeof pickInput>) => {
      const storage = call.host.storage!;
      if (!storage.readCopy) return unavailable(PICK, "picking a variant needs project storage that can read another project, which this host does not provide.");
      const variants: Variant[] = args.variants.map((v) => ({ name: v.name ?? (v.project.split(/[\\/]/).pop() ?? v.project), project: v.project, render: v.render }));
      if (new Set(variants.map((v) => v.render)).size < variants.length) return refused(PICK, "Error: two variants share a render; give each variant its own render.");
      if (new Set(variants.map((v) => v.name)).size < variants.length) return refused(PICK, "Error: two variants share a name; give each its own name.");
      const apply = args.apply !== false;
      // Everything is read before the first watch: a variant that cannot be opened must not cost a tournament.
      const projects = new Map<Variant, Project>();
      if (apply) {
        for (const v of variants) {
          try {
            projects.set(v, await storage.readCopy(v.project));
          } catch (error) {
            return refused(PICK, `Error: could not open variant ${v.name} (${v.project}): ${message(error)}`);
          }
        }
      }
      const tooLong = await checkLengths(call, PICK, variants.map((v) => v.render));
      if (tooLong) return tooLong;

      const request: CompareRequest = { brief: args.brief, focus: args.focus, signal: call.signal };
      const matches: Array<{ a: Variant; b: Variant; judgment: PairJudgment }> = [];
      let champion = variants[0]!;
      for (const challenger of variants.slice(1)) {
        let judgment: PairJudgment;
        try {
          judgment = await judgePair(call, champion.render, challenger.render, request);
        } catch (error) {
          const receipt = watchFailure(call, PICK, error);
          return matches.length > 0 ? { ...receipt, summary: `${receipt.summary} (after ${matches.length} match(es); nothing changed)` } : receipt;
        }
        matches.push({ a: champion, b: challenger, judgment });
        if (judgment.winner === "b") champion = challenger;
      }

      const winnerOf = (m: (typeof matches)[number]): Variant => (m.judgment.winner === "a" ? m.a : m.b);
      const wins = (v: Variant): number => matches.filter((m) => winnerOf(m) === v).length;
      const meanOverall = (v: Variant): number => {
        const seen = matches.flatMap((m) => (m.a === v ? [m.judgment.overall.a] : m.b === v ? [m.judgment.overall.b] : [])).filter((x): x is number => x !== null);
        return seen.length > 0 ? seen.reduce((x, y) => x + y, 0) / seen.length : 0;
      };
      const ranking = [champion, ...variants.filter((v) => v !== champion).sort((x, y) => wins(y) - wins(x) || meanOverall(y) - meanOverall(x))];
      const matchLines = matches.map((m, i) => {
        const j = m.judgment;
        return `${i + 1}. ${m.a.name} ${j.overall.a ?? "?"} vs ${m.b.name} ${j.overall.b ?? "?"}: ${winnerOf(m).name} (${decidedText(j)})`;
      });
      // The champion played the last match (it held or took the title there): its fixes next to its strongest rival.
      const winnerFixes = matches[matches.length - 1]!.judgment.fixes;

      let changedKeys = 0;
      if (apply) {
        try {
          changedKeys = adoptVariant(call, projects.get(champion)!, `Pick best variant: ${champion.name}`);
        } catch (error) {
          return failed(PICK, `Error: could not make ${champion.name} the open project: ${message(error)}`);
        }
      }
      const fixes = fixLines({ fixes: winnerFixes });
      const outcome = !apply
        ? "Nothing changed (apply: false)."
        : changedKeys > 0
          ? `${champion.name} is now the open project (one undo step; the variant files stay as they are).`
          : `The open project already is ${champion.name}; nothing changed.`;
      const summary =
        `Best of ${variants.length}: ${champion.name} (${champion.render}). ${outcome}` +
        `\nRanking: ${ranking.map((v) => v.name).join(" > ")}` +
        `\nMatches:\n${matchLines.join("\n")}` +
        (fixes.length > 0 ? `\nRefine the winner with these, render, then watch_render_tool once:\n${fixes.join("\n")}` : "");
      const data = {
        winner: { name: champion.name, project: champion.project, render: champion.render },
        ranking: ranking.map((v) => v.name),
        matches: matches.map((m) => ({ a: m.a.name, b: m.b.name, ...judgmentData(m.judgment, { a: m.a.render, b: m.b.render }) })),
        fixes: winnerFixes,
        applied: apply && changedKeys > 0,
      };
      if (apply && changedKeys > 0) return applied(PICK, summary, { data });
      return unchanged(PICK, summary, { data });
    },
  }),
];
