/**
 * Run one scenario against one MCP target: make the fixtures, call each step's
 * tool, assert its receipt and run its checks. A step whose tool the host does
 * not list, whose refusal says the host lacks something (skipWhen), or whose
 * arguments need a value an earlier step did not produce is skipped with the
 * reason; later independent steps still run, so one failure does not hide the
 * rest of the success rate.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkMedia, hostHas, imageLuma, makeFixture, type CheckOutcome } from "./media.js";
import { getPath, MissingReference, referencedRoots, resolveRefs, unmet, type Check, type Scenario, type Step, type StepExpect } from "./scenario.js";
import type { CallOutcome, McpImage, McpTarget } from "./targets.js";

export type Outcome = "pass" | "fail" | "skip";

export interface ToolCallRecord {
  tool: string;
  /** The step's own call, or a check's read-only call. */
  role: "step" | "check";
  outcome: Outcome;
  ms: number;
  status?: string;
  /** Receipt summary (or the transport error). */
  summary: string;
}

export interface StepResult {
  id: string;
  tool: string;
  outcome: Outcome;
  /** Why it failed or was skipped. */
  reason?: string;
  ms: number;
  status?: string;
  summary?: string;
  /** The receipt's warnings (a passing step may still have some worth reading). */
  warnings?: string[];
  /** The receipt's `data` keys, to write checks against. */
  dataKeys?: string[];
  checks: CheckOutcome[];
  calls: ToolCallRecord[];
}

export interface ScenarioResult {
  id: string;
  title: string;
  runner: McpTarget["kind"];
  target: string;
  outcome: Outcome;
  reason?: string;
  ms: number;
  budgetSeconds?: number;
  steps: StepResult[];
}

function summaryOf(call: CallOutcome): string {
  if (call.transportError) return `transport: ${call.transportError}`;
  const s = call.receipt?.summary;
  return typeof s === "string" ? s : call.text.slice(0, 400);
}

function statusOf(call: CallOutcome): string | undefined {
  const s = call.receipt?.status;
  return typeof s === "string" ? s : undefined;
}

/** Problems with a call against what the step expects; empty when it meets them. */
export function receiptProblems(call: CallOutcome, expect: StepExpect | undefined): string[] {
  if (call.transportError) return [`no answer: ${call.transportError}`];
  const status = statusOf(call);
  const want = expect?.status ?? ["applied"];
  const problems: string[] = [];
  if (!status) problems.push(`no receipt (${call.text.slice(0, 120) || "empty answer"})`);
  else if (!want.includes(status)) problems.push(`status ${status}, wanted ${want.join("|")}: ${summaryOf(call).slice(0, 300)}`);
  for (const [p, w] of Object.entries(expect?.receipt ?? {})) {
    const why = unmet(getPath(call.receipt, p), w);
    if (why) problems.push(`${p}: ${why}`);
  }
  if (expect?.image && call.images.length === 0) problems.push("no image returned");
  return problems;
}

function skipReason(step: Step, call: CallOutcome): string | undefined {
  if (call.ok || call.transportError) return undefined;
  const summary = summaryOf(call);
  return step.skipWhen.some((re) => new RegExp(re, "i").test(summary)) ? `host lacks it: ${summary.slice(0, 240)}` : undefined;
}

export interface RunOptions {
  /** Where fixtures go (default `<target.work>/fixtures`). */
  fixtureDir?: string;
  onStep?: (result: StepResult) => void;
  /** Save each step's first returned image here as `<scenario>-<runner>-<step>.<ext>` (contact sheets, previews). */
  imageDir?: string;
}

/** Run `scenario` on `target`. Never throws for tool failures; they are results. */
export async function runScenario(target: McpTarget, scenario: Scenario, options: RunOptions = {}): Promise<ScenarioResult> {
  const started = performance.now();
  const base = { id: scenario.id, title: scenario.title, runner: target.kind, target: target.label, budgetSeconds: scenario.budgetSeconds };
  const missing = scenario.requires.filter((p) => !hostHas(p));
  if (missing.length > 0) return { ...base, outcome: "skip", reason: `this machine lacks ${missing.join(", ")}`, ms: 0, steps: [] };

  const fixtureDir = options.fixtureDir ?? path.join(target.work, "fixtures");
  const fixtures: Record<string, string> = {};
  for (const f of scenario.fixtures) {
    try {
      fixtures[f.id] = await makeFixture(fixtureDir, f);
    } catch (error) {
      return { ...base, outcome: "fail", reason: `fixture ${f.id}: ${(error as Error).message.split("\n")[0]}`, ms: performance.now() - started, steps: [] };
    }
  }

  const listed = await target.tools();
  const scope: Record<string, unknown> = { fixtures, work: target.work };
  const notDone = new Map<string, string>();
  const steps: StepResult[] = [];

  for (const step of scenario.steps) {
    const result = await runStep(target, step, scope, listed, notDone, path.join(fixtureDir, "images"), (image) =>
      options.imageDir ? saveImage(options.imageDir, `${scenario.id}-${target.kind}-${step.id}`, image) : Promise.resolve(),
    );
    // A failed check leaves the step's receipt usable; only a call that did not succeed blocks its dependents.
    if (!(step.id in scope)) notDone.set(step.id, `${step.id} ${result.outcome === "skip" ? "was skipped" : "failed"}`);
    steps.push(result);
    options.onStep?.(result);
  }

  const failed = steps.filter((s) => s.outcome === "fail");
  const passed = steps.filter((s) => s.outcome === "pass");
  const outcome: Outcome = failed.length > 0 ? "fail" : passed.length > 0 ? "pass" : "skip";
  return {
    ...base,
    outcome,
    ...(failed.length ? { reason: failed.map((s) => `${s.id}: ${s.reason}`).join("; ").slice(0, 600) } : {}),
    ms: performance.now() - started,
    steps,
  };
}

async function runStep(
  target: McpTarget,
  step: Step,
  scope: Record<string, unknown>,
  listed: Set<string>,
  notDone: Map<string, string>,
  imageDir: string,
  keepImage: (image: McpImage) => Promise<void>,
): Promise<StepResult> {
  const override = step.on?.[target.kind];
  const tool = override?.tool ?? step.tool;
  const skip = (reason: string): StepResult => ({ id: step.id, tool, outcome: "skip", reason, ms: 0, checks: [], calls: [] });
  if (step.runners && !step.runners.includes(target.kind)) return skip(`not run on ${target.kind}`);
  if (!listed.has(tool)) return skip(`${target.kind} does not offer ${tool}`);
  const rawArgs = override?.args ?? step.args;
  const blocked = [...referencedRoots([rawArgs, step.checks])].map((r) => notDone.get(r)).find(Boolean);
  if (blocked) return skip(`needs ${blocked}`);

  let args: Record<string, unknown>;
  try {
    args = resolveRefs(rawArgs, scope) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof MissingReference) return { ...skip(""), outcome: "fail", reason: error.message };
    throw error;
  }

  const call = await target.call(tool, args, step.timeoutSeconds * 1000);
  const record: ToolCallRecord = { tool, role: "step", outcome: "pass", ms: call.ms, status: statusOf(call), summary: summaryOf(call) };
  const warnings = Array.isArray(call.receipt?.warnings) ? (call.receipt.warnings as unknown[]).map(String) : [];
  const data = call.receipt?.data;
  const dataKeys = data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data) : [];
  const result: StepResult = {
    id: step.id,
    tool,
    outcome: "pass",
    ms: call.ms,
    status: record.status,
    summary: record.summary,
    ...(warnings.length ? { warnings } : {}),
    ...(dataKeys.length ? { dataKeys } : {}),
    checks: [],
    calls: [record],
  };

  const lacking = skipReason(step, call);
  if (lacking) {
    record.outcome = "skip";
    return { ...result, outcome: "skip", reason: lacking };
  }
  const problems = receiptProblems(call, step.expect);
  if (problems.length > 0) {
    record.outcome = "fail";
    const tail = call.transportError ? target.stderrTail() : "";
    return { ...result, outcome: "fail", reason: problems.join("; ") + (tail ? `\n${tail}` : "") };
  }
  scope[step.id] = { ...call.receipt, images: call.images.length };
  if (call.images[0]) await keepImage(call.images[0]);

  for (const check of step.checks) {
    try {
      await runCheck(target, check, call, scope, imageDir, result);
    } catch (error) {
      result.checks.push({ name: check.kind === "tool" ? check.tool : check.kind, ok: false, detail: (error as Error).message.split("\n")[0]! });
    }
  }
  const bad = result.checks.filter((c) => !c.ok);
  if (bad.length > 0) return { ...result, outcome: "fail", reason: bad.map((c) => `${c.name}: ${c.detail}`).join("; ") };
  return result;
}

async function saveImage(dir: string, stem: string, image: McpImage): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${stem}.${image.mimeType.includes("png") ? "png" : "jpg"}`), Buffer.from(image.data, "base64"));
}

/** One check of a step that succeeded; appends its outcomes (and a check's own tool call) to `result`. */
async function runCheck(target: McpTarget, check: Check, call: CallOutcome, scope: Record<string, unknown>, imageDir: string, result: StepResult): Promise<void> {
  if (check.kind === "image") {
    const image = call.images[0];
    if (!image) {
      result.checks.push({ name: "image not black", ok: false, detail: "no image" });
      return;
    }
    const luma = await imageLuma(imageDir, image.data, image.mimeType);
    result.checks.push({ name: "image not black", ok: luma >= check.minLuma, detail: `mean luma ${luma}` });
  } else if (check.kind === "media") {
    result.checks.push(...(await checkMedia(resolveRefs(check, scope) as typeof check)));
  } else {
    const res = await target.call(check.tool, resolveRefs(check.args, scope) as Record<string, unknown>);
    const answered = { status: ["applied", "unchanged", "ok"] };
    // The call counts as a tool success when it answered; a wrong answer is the check's failure.
    const callOk = receiptProblems(res, answered).length === 0;
    const why = receiptProblems(res, { ...answered, ...check.expect });
    result.calls.push({ tool: check.tool, role: "check", outcome: callOk ? "pass" : "fail", ms: res.ms, status: statusOf(res), summary: summaryOf(res) });
    result.checks.push({ name: check.tool, ok: why.length === 0, detail: why.join("; ") || summaryOf(res).slice(0, 160) });
  }
}
