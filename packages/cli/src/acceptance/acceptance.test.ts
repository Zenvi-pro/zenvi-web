import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir, removeDir } from "@zenvi/render-node/test-support";
import { afterAll, describe, expect, it } from "vitest";
import { buildReport, reportMarkdown } from "./report.js";
import { buildReplayReport, extractCalls, groupFailures, normaliseMessage, pairIds, rewriteArgs, type ReplayCall } from "./replay.js";
import { runScenario } from "./run.js";
import { getPath, loadScenarios, MissingReference, parseScenario, resolveRefs, unmet } from "./scenario.js";
import { startPortable } from "./targets.js";

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await removeDir(d);
});

describe("scenario data", () => {
  it("validates every bundled scenario", async () => {
    const all = await loadScenarios();
    expect(all.map((s) => s.id)).toEqual(["basic", "motion-reel", "match-cut", "kinetic-captions", "blocks-fx-3d"]);
    expect(() => parseScenario({ id: "x", title: "x", steps: [{ id: "a", tool: "t" }, { id: "a", tool: "t" }] })).toThrow(/duplicate step id a/);
    expect(() => parseScenario({ id: "x", title: "x", steps: [{ id: "a", tool: "t", after: ["b"] }, { id: "b", tool: "t" }] })).toThrow(/a runs after b, which is not an earlier step/);
  });

  it("reads receipt paths and resolves references, keeping a whole reference's type", () => {
    const scope = { fixtures: { a: "/m/a.mp4" }, work: "/w", add: { clips: [{ id: "C1" }, { id: "C2" }], data: { fileIds: ["F1", "F2"] } } };
    expect(getPath(scope, "add.clips[1].id")).toBe("C2");
    expect(getPath(scope, "add.clips.length")).toBe(2);
    expect(resolveRefs({ ids: "${add.data.fileIds}", out: "${work}/x.mp4", paths: '["${fixtures.a}"]' }, scope)).toEqual({ ids: ["F1", "F2"], out: "/w/x.mp4", paths: '["/m/a.mp4"]' });
    expect(() => resolveRefs("${add.clips[5].id}", scope)).toThrow(MissingReference);
  });

  it("explains unmet expectations", () => {
    expect(unmet([1, 2], { length: { min: 2 } })).toBe("");
    expect(unmet([1], { length: { min: 2, max: 2 } })).toBe("length 1 is not 2..2");
    expect(unmet(3.5, { min: 4 })).toBe("3.5 is not >= 4");
    expect(unmet("Timeline clips (3).", { matches: "clips \\(3\\)" })).toBe("");
    expect(unmet(undefined, { exists: true })).toBe("missing");
  });
});

describe("report", () => {
  it("counts tool calls per tool and leaves skipped ones out of the success rate", () => {
    const step = (id: string, tool: string, outcome: "pass" | "fail" | "skip", ms: number) => ({
      id,
      tool,
      outcome,
      ms,
      checks: [],
      calls: outcome === "skip" ? [] : [{ tool, role: "step" as const, outcome, ms, summary: "" }],
    });
    const report = buildReport([
      { id: "s", title: "S", runner: "portable", target: "t", outcome: "fail", ms: 10, steps: [step("a", "x_tool", "pass", 10), step("b", "x_tool", "fail", 30), step("c", "y_tool", "skip", 0)] },
    ]);
    expect(report.totals.toolCalls).toMatchObject({ calls: 2, ok: 1, failed: 1, successRate: 0.5 });
    expect(report.tools.x_tool).toMatchObject({ ok: 1, failed: 1, medianMs: 20, maxMs: 30 });
    expect(report.totals.steps).toEqual({ pass: 1, fail: 1, skip: 1 });
    expect(reportMarkdown(report)).toMatch(/Tool calls: 1\/2 succeeded \(50%\)/);
  });
});

describe("transcript replay", () => {
  const receipt = (status: string, summary: string, extra: Record<string, unknown> = {}) => JSON.stringify({ contract: 3, status, tool: "t", summary, clips: [], ...extra });
  const transcript = [
    { type: "system", subtype: "init", cwd: "/runs/x/project" },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "u1", name: "mcp__zenvi__import_files_tool", input: { paths: '["/m/a.mp4"]' } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "u1", content: [{ type: "text", text: receipt("applied", "Imported 1 file(s). file_id=AAAAAAAAA1", { data: { fileIds: ["AAAAAAAAA1"] } }) }] }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "u2", name: "mcp__zenvi__add_clip_to_timeline_tool", input: { file_id: "AAAAAAAAA1", track: "10" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "u2", is_error: true, content: receipt("refused", "Error: Unknown track or layer '10'.") }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "u3", name: "Skill", input: {} }] } },
  ]
    .map((l) => JSON.stringify(l))
    .join("\n");

  it("extracts the Zenvi calls with what they answered", () => {
    const { cwd, calls } = extractCalls(transcript);
    expect(cwd).toBe("/runs/x/project");
    expect(calls.map((c) => [c.tool, c.original.ok])).toEqual([
      ["import_files_tool", true],
      ["add_clip_to_timeline_tool", false],
    ]);
    expect(calls[1]!.original.summary).toBe("Error: Unknown track or layer '10'.");
  });

  it("maps the original ids onto the replay's and moves outputs to the new folder", () => {
    const ids = new Map<string, string>();
    pairIds({ summary: "file_id=AAAAAAAAA1", data: { fileIds: ["AAAAAAAAA1"] }, clips: [{ id: "CCCCCCCCC1" }] }, { summary: "file_id=BBBBBBBBB1", data: { fileIds: ["BBBBBBBBB1"] }, clips: [{ id: "DDDDDDDDD1" }] }, ids);
    expect(Object.fromEntries(ids)).toEqual({ AAAAAAAAA1: "BBBBBBBBB1", CCCCCCCCC1: "DDDDDDDDD1" });
    const known = new Set(["AAAAAAAAA1", "CCCCCCCCC1", "EEEEEEEEE1"]);
    const out = rewriteArgs({ file_id: "AAAAAAAAA1", ids: '["CCCCCCCCC1"]', output: "/runs/x/project/out.mp4", text: "HELLO" }, { ids, known, fromDir: "/runs/x/project", toDir: "/tmp/new" });
    expect(out).toEqual({ args: { file_id: "BBBBBBBBB1", ids: '["DDDDDDDDD1"]', output: "/tmp/new/out.mp4", text: "HELLO" }, unmapped: [] });
    expect(rewriteArgs({ clip_id: "EEEEEEEEE1" }, { ids, known, toDir: "/tmp/new" }).unmapped).toEqual(["EEEEEEEEE1"]);
    // Media relative to the original folder is read from there, also inside a JSON-array string.
    const here = path.dirname(fileURLToPath(import.meta.url));
    expect(rewriteArgs({ paths: '["scenarios", "missing"]', output: "out.mp4" }, { ids, known, fromDir: here, toDir: "/tmp/new" }).args).toEqual({ paths: JSON.stringify([path.join(here, "scenarios"), "missing"]), output: "out.mp4" });
  });

  it("groups failures by their generalised message and proposes fixes for known ones", () => {
    expect(normaliseMessage("Error: Unknown track or layer '10'. Call list_layers_tool")).toBe("Error: Unknown track or layer 'N'. Call list_layers_tool");
    const rows = ["'10'", "'11'", "'7'"].map((n, i) => ({ run: `r${i % 2}`, tool: "add_clip_to_timeline_tool", args: "{}", summary: `Error: Unknown track or layer ${n}.`, failedOriginally: true }));
    const [top] = groupFailures([...rows, { run: "r0", tool: "x_tool", args: "{}", summary: "Error: other", failedOriginally: false }]);
    expect(top).toMatchObject({ tool: "add_clip_to_timeline_tool", count: 3, failedOriginally: 3, runs: ["r0", "r1"] });
    expect(top!.proposal).toMatch(/one past the stack/);
  });

  it("counts regressions and calls fixed since the original session", () => {
    const row = (index: number, originalOk: boolean, outcome: ReplayCall["outcome"]): ReplayCall => ({ run: "r", index, tool: "t", args: "{}", originalOk, originalSummary: originalOk ? "ok" : "Error: was", outcome, summary: outcome === "failed" ? "Error: now" : "ok", ms: 1 });
    const report = buildReplayReport("/runs", 1, [row(0, true, "ok"), row(1, true, "failed"), row(2, false, "ok"), row(3, false, "skipped")]);
    expect(report.totals).toMatchObject({ calls: 4, replayed: 3, ok: 2, failed: 1, skipped: 1, regressions: 1, fixedSince: 1, originalFailed: 2, originalSuccessRate: 0.5 });
  });
});

describe("the basic scenario over zenvi mcp (stdio)", () => {
  it("passes every step well inside its CI budget", async () => {
    const work = await makeTempDir("zenvi-acceptance-test-");
    dirs.push(work);
    const [basic] = await loadScenarios();
    const target = await startPortable({ work, home: path.join(work, "home") });
    try {
      const result = await runScenario(target, basic!);
      const failed = result.steps.filter((s) => s.outcome !== "pass").map((s) => `${s.id}: ${s.reason}`);
      expect(failed).toEqual([]);
      expect(result.outcome).toBe("pass");
      expect(result.ms).toBeLessThan(basic!.budgetSeconds! * 1000);
      const report = buildReport([result]);
      expect(report.totals.toolCalls.successRate).toBe(1);
      expect(Object.keys(report.tools)).toEqual(expect.arrayContaining(["split_clip_tool", "add_captions_tool", "set_clip_volume_tool", "render_video"]));
    } finally {
      await target.close();
    }
  }, 120_000);
});
