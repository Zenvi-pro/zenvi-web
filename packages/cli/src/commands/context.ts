/**
 * What every command gets: config, output, auth, the tool registry, the
 * global flags, and helpers to run tools on the selected project with the
 * right engine and print the receipt.
 */

import { existsSync } from "node:fs";
import type { ToolReceipt } from "@zenvi/engine/tools";
import type { JsonSchemaObject } from "@zenvi/engine/tools";
import { Auth } from "../auth/session.js";
import type { ZenviConfig } from "../config.js";
import { chooseExecutor, type CallOutcome, type EngineChoice, type Executor } from "../engine/executor.js";
import type { Registry } from "../engine/registry.js";
import { CliError, type Output } from "../output.js";
import { findProject, requireProject } from "../project/select.js";
import { ProjectSession } from "../project/session.js";
import { VERSION } from "../version.js";

export interface GlobalFlags {
  project?: string;
  json?: boolean;
  quiet?: boolean;
  engine?: EngineChoice;
  desktop?: boolean;
}

export interface CommandContext {
  config: ZenviConfig;
  out: Output;
  auth: Auth;
  registry: Registry;
  flags: () => GlobalFlags;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Set by commands; the process exit code. */
  exitCode: number;
}

export function engineChoice(flags: GlobalFlags): EngineChoice {
  if (flags.desktop) return "desktop";
  const e = flags.engine ?? "auto";
  if (e !== "auto" && e !== "portable" && e !== "desktop") throw new CliError(`--engine must be auto, portable or desktop (got ${String(e)}).`, 2);
  return e;
}

/** Host options for the Node ToolHost (backend with the signed-in token). */
export function hostOptions(ctx: CommandContext) {
  return {
    backend: { baseUrl: ctx.config.backendUrl, token: () => ctx.auth.backendToken(), userAgent: `zenvi-cli/${VERSION}` },
    // Zenvi desktop's folder on this computer: its recent projects, recovery copies and custom profiles.
    desktopDir: ctx.config.desktopDir,
    log: ctx.env.ZENVI_DEBUG ? (m: string) => ctx.out.info(`[debug] ${m}`) : undefined,
  };
}

export async function openSession(ctx: CommandContext, file: string): Promise<ProjectSession> {
  if (!existsSync(file)) throw new CliError(`Project not found: ${file}`, 1, "Create it with `zenvi new <file.zvn>`.");
  return ProjectSession.open(file, { registry: ctx.registry, host: hostOptions(ctx) });
}

/** Run `fn` with an executor for the selected project (portable or desktop). */
export async function withExecutor<T>(ctx: CommandContext, fn: (executor: Executor) => Promise<T>, opts: { requireFile?: boolean } = {}): Promise<T> {
  const flags = ctx.flags();
  const choice = engineChoice(flags);
  const file = opts.requireFile === false ? await findProject({ flag: flags.project, cwd: ctx.cwd, env: ctx.env }) : await requireProject({ flag: flags.project, cwd: ctx.cwd, env: ctx.env });
  const executor = await chooseExecutor({
    config: ctx.config,
    registry: ctx.registry,
    choice,
    projectFile: file,
    openSession: async () => {
      if (!file) throw new CliError("No project given and no .zvn file in this folder.", 2, "Pass -p <file.zvn>.");
      return openSession(ctx, file);
    },
    clientVersion: VERSION,
    warn: (m) => ctx.out.warn(m),
  });
  try {
    return await fn(executor);
  } finally {
    await executor.close();
  }
}

/** The tool's JSON Schema property names. */
function schemaProps(schema: JsonSchemaObject | undefined): Set<string> {
  return new Set(Object.keys(schema?.properties ?? {}));
}

/**
 * Map friendly values onto a tool's real argument names: for each value,
 * the first candidate name the tool's input schema declares. Keeps the CLI
 * working against the desktop contract names (`timeline_clip_id`) and the
 * direct tools alike.
 */
export function toolArgs(ctx: CommandContext, tool: string, values: Array<[candidates: string[], value: unknown]>): Record<string, unknown> {
  const def = ctx.registry.get(tool);
  const props = schemaProps(def?.inputSchema);
  const args: Record<string, unknown> = {};
  for (const [candidates, value] of values) {
    if (value === undefined) continue;
    const name = def ? candidates.find((c) => props.has(c)) : candidates[0];
    if (!name) throw new CliError(`${tool} does not take ${candidates[0]} in this build.`, 2);
    args[name] = value;
  }
  return args;
}

function statusMark(ctx: CommandContext, receipt: ToolReceipt | undefined, ok: boolean): string {
  if (!ok) return ctx.out.style("✗", "red");
  if (receipt?.status === "unchanged") return ctx.out.style("•", "dim");
  return ctx.out.style("✓", "green");
}

/** Print a tool call's result (receipt JSON with `engine`/`project`, or a human summary). */
export function printOutcome(ctx: CommandContext, outcome: CallOutcome, extra: Record<string, unknown> = {}): void {
  if (!outcome.ok) ctx.exitCode = 1;
  if (ctx.out.json) {
    const body = outcome.receipt ?? { status: outcome.ok ? "applied" : "error", summary: outcome.text };
    ctx.out.data({ ...body, engine: outcome.engine, project: outcome.project ?? null, ...extra });
    return;
  }
  const receipt = outcome.receipt;
  // Listings carry the desktop's full text (legacy_text) behind a one-line summary.
  const data = receipt?.data as { legacy_text?: unknown } | undefined;
  const summary = outcome.ok && typeof data?.legacy_text === "string" && data.legacy_text ? data.legacy_text : (receipt?.summary ?? outcome.text);
  const [first, ...rest] = summary.split("\n");
  if (!outcome.ok) {
    ctx.out.error(summary.replace(/^Error:\s*/, ""));
  } else {
    ctx.out.line(`${statusMark(ctx, receipt, outcome.ok)} ${first ?? ""}`);
    for (const line of rest) ctx.out.line(line);
  }
  for (const w of receipt?.warnings ?? []) ctx.out.warn(w);
  for (const n of receipt?.notes ?? []) ctx.out.line(ctx.out.style(`  note: ${n}`, "dim"));
  if (outcome.engine === "desktop") ctx.out.info(ctx.out.style("(ran in the Zenvi desktop app)", "dim"));
}

/** Run one tool on the selected project and print the outcome. */
export async function runToolCommand(ctx: CommandContext, tool: string, args: Record<string, unknown>, extra?: Record<string, unknown>): Promise<CallOutcome> {
  return withExecutor(ctx, async (executor) => {
    const outcome = await executor.call(tool, args);
    printOutcome(ctx, outcome, extra);
    return outcome;
  });
}
