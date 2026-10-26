/**
 * The acceptance gate, from a terminal or CI:
 *
 *   npx tsx packages/cli/src/acceptance/main.ts [--runner portable|desktop|all]
 *     [--scenario basic,motion] [--out <dir>] [--bundle <zenvi.mjs>]
 *   npx tsx packages/cli/src/acceptance/main.ts replay [--runs <bench runs dir>]
 *     [--out <dir>] [--only <run name substring>] [--jobs 3]
 *
 * Writes report.json and report.md to --out (default a new temp folder) and
 * exits 1 when a step (or a replayed call that succeeded originally) fails.
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildReport, reportMarkdown } from "./report.js";
import { replayMarkdown, replayRuns } from "./replay.js";
import { runScenario, type ScenarioResult } from "./run.js";
import { loadScenarios, type RunnerKind, type Scenario } from "./scenario.js";
import { connectDesktop, findDesktop, startPortable } from "./targets.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    runner: { type: "string", default: "portable" },
    scenario: { type: "string" },
    out: { type: "string" },
    bundle: { type: "string" },
    runs: { type: "string", default: path.join(os.homedir(), "zenvi-motion", "bench", "runs") },
    only: { type: "string" },
    jobs: { type: "string", default: "3" },
    keep: { type: "boolean", default: false },
  },
});

function log(line: string): void {
  process.stderr.write(`${line}\n`);
}

async function runOn(kind: RunnerKind, scenario: Scenario, scratch: string): Promise<ScenarioResult> {
  const work = await mkdtemp(path.join(scratch, `${scenario.id}-${kind}-`));
  const skipped = (reason: string): ScenarioResult => ({ id: scenario.id, title: scenario.title, runner: kind, target: kind, outcome: "skip", reason, ms: 0, steps: [] });
  let target;
  if (kind === "desktop") {
    const desktop = await findDesktop();
    if ("reason" in desktop) return skipped(desktop.reason);
    target = await connectDesktop(desktop.found, work);
  } else {
    target = await startPortable({ work, home: path.join(work, "home"), bundle: values.bundle });
  }
  try {
    return await runScenario(target, scenario, {
      onStep: (s) => log(`  ${s.outcome.padEnd(4)} ${s.id} (${s.tool}, ${(s.ms / 1000).toFixed(1)} s)${s.reason ? `: ${s.reason.split("\n")[0]!.slice(0, 200)}` : ""}`),
    });
  } finally {
    await target.close();
  }
}

async function scenarios(): Promise<number> {
  const wanted = values.scenario?.split(",").map((s) => s.trim());
  const all = (await loadScenarios()).filter((s) => !wanted || wanted.includes(s.id));
  if (all.length === 0) throw new Error(`no scenario matches ${values.scenario}`);
  const runners: RunnerKind[] = values.runner === "all" ? ["portable", "desktop"] : [values.runner as RunnerKind];
  const out = values.out ?? (await mkdtemp(path.join(os.tmpdir(), "zenvi-acceptance-")));
  const scratch = await mkdtemp(path.join(os.tmpdir(), "zenvi-acceptance-work-"));
  const results: ScenarioResult[] = [];
  for (const kind of runners) {
    for (const s of all) {
      log(`${s.id} on ${kind}`);
      const r = await runOn(kind, s, scratch);
      log(`=> ${r.outcome} in ${(r.ms / 1000).toFixed(1)} s${r.reason && r.steps.length === 0 ? `: ${r.reason}` : ""}`);
      results.push(r);
    }
  }
  const report = buildReport(results);
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(out, "report.md"), reportMarkdown(report));
  if (!values.keep) await rm(scratch, { recursive: true, force: true });
  else log(`work folders kept in ${scratch}`);
  const t = report.totals.toolCalls;
  log(`tool calls ${t.ok}/${t.ok + t.failed} ok (${t.skipped} skipped); report: ${path.join(out, "report.md")}`);
  return report.totals.steps.fail > 0 ? 1 : 0;
}

async function replay(): Promise<number> {
  const out = values.out ?? (await mkdtemp(path.join(os.tmpdir(), "zenvi-replay-")));
  const report = await replayRuns({ runsDir: values.runs!, only: values.only, jobs: Math.max(1, Number(values.jobs) || 1), bundle: values.bundle, keep: values.keep, log });
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "replay.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(out, "replay.md"), replayMarkdown(report));
  log(`replayed ${report.totals.replayed} calls: ${report.totals.failed} failed (${report.totals.regressions} that succeeded originally); report: ${path.join(out, "replay.md")}`);
  return report.totals.regressions > 0 ? 1 : 0;
}

const mode = positionals[0] ?? "scenarios";
const code = await (mode === "replay" ? replay() : scenarios());
process.exit(code);
