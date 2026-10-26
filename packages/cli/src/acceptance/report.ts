/**
 * The acceptance report: pass/fail per step, the tool-call success rate
 * overall and per tool, timings, as JSON (for CI and dashboards) and a short
 * Markdown table (for people).
 */

import type { ScenarioResult, ToolCallRecord } from "./run.js";

export interface ToolStats {
  calls: number;
  ok: number;
  failed: number;
  skipped: number;
  /** ok / (ok + failed); skipped calls do not count. Null when nothing ran. */
  successRate: number | null;
  medianMs: number;
  maxMs: number;
}

export interface AcceptanceReport {
  kind: "zenvi-acceptance";
  version: 1;
  generatedAt: string;
  scenarios: ScenarioResult[];
  totals: { scenarios: Record<"pass" | "fail" | "skip", number>; steps: Record<"pass" | "fail" | "skip", number>; toolCalls: ToolStats };
  tools: Record<string, ToolStats>;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function toolStats(calls: readonly Pick<ToolCallRecord, "outcome" | "ms">[]): ToolStats {
  const ok = calls.filter((c) => c.outcome === "pass").length;
  const failed = calls.filter((c) => c.outcome === "fail").length;
  const ran = calls.filter((c) => c.outcome !== "skip").map((c) => c.ms);
  return {
    calls: calls.length,
    ok,
    failed,
    skipped: calls.length - ok - failed,
    successRate: ok + failed > 0 ? Math.round((ok / (ok + failed)) * 1000) / 1000 : null,
    medianMs: Math.round(median(ran)),
    maxMs: Math.round(Math.max(0, ...ran)),
  };
}

function counts<T extends { outcome: "pass" | "fail" | "skip" }>(rows: readonly T[]): Record<"pass" | "fail" | "skip", number> {
  return { pass: rows.filter((r) => r.outcome === "pass").length, fail: rows.filter((r) => r.outcome === "fail").length, skip: rows.filter((r) => r.outcome === "skip").length };
}

export function buildReport(scenarios: ScenarioResult[], now: Date = new Date()): AcceptanceReport {
  const calls = scenarios.flatMap((s) => s.steps.flatMap((st) => st.calls));
  const byTool = new Map<string, ToolCallRecord[]>();
  for (const c of calls) byTool.set(c.tool, [...(byTool.get(c.tool) ?? []), c]);
  return {
    kind: "zenvi-acceptance",
    version: 1,
    generatedAt: now.toISOString(),
    scenarios,
    totals: { scenarios: counts(scenarios), steps: counts(scenarios.flatMap((s) => s.steps)), toolCalls: toolStats(calls) },
    tools: Object.fromEntries([...byTool.keys()].sort().map((t) => [t, toolStats(byTool.get(t)!)])),
  };
}

const pct = (r: number | null): string => (r === null ? "—" : `${(r * 100).toFixed(0)}%`);
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 160);

export function reportMarkdown(report: AcceptanceReport): string {
  const t = report.totals;
  const lines = [
    "# Zenvi acceptance (MCP)",
    "",
    `Tool calls: ${t.toolCalls.ok}/${t.toolCalls.ok + t.toolCalls.failed} succeeded (${pct(t.toolCalls.successRate)}), ${t.toolCalls.skipped} skipped. ` +
      `Steps: ${t.steps.pass} pass, ${t.steps.fail} fail, ${t.steps.skip} skip. Scenarios: ${t.scenarios.pass} pass, ${t.scenarios.fail} fail, ${t.scenarios.skip} skip.`,
    "",
  ];
  for (const s of report.scenarios) {
    const over = s.budgetSeconds !== undefined && s.ms > s.budgetSeconds * 1000 ? ` (over its ${s.budgetSeconds} s budget)` : "";
    lines.push(`## ${s.title} — ${s.runner}: ${s.outcome.toUpperCase()} in ${secs(s.ms)}${over}`, "");
    if (s.steps.length === 0) {
      lines.push(`${s.reason ?? ""}`, "");
      continue;
    }
    lines.push("| step | tool | result | time | note |", "| --- | --- | --- | --- | --- |");
    for (const st of s.steps) {
      const note = st.outcome === "pass" ? st.checks.map((c) => `${c.name}: ${c.detail}`).join("; ") || (st.summary ?? "") : (st.reason ?? "");
      lines.push(`| ${st.id} | ${st.tool} | ${st.outcome} | ${secs(st.ms)} | ${cell(note)} |`);
    }
    lines.push("");
  }
  lines.push("## Per tool", "", "| tool | ok | failed | skipped | success | median | max |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const [tool, st] of Object.entries(report.tools)) {
    lines.push(`| ${tool} | ${st.ok} | ${st.failed} | ${st.skipped} | ${pct(st.successRate)} | ${secs(st.medianMs)} | ${secs(st.maxMs)} |`);
  }
  return `${lines.join("\n")}\n`;
}
