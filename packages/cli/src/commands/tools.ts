/** `zenvi tools` (the catalog) and `zenvi call <tool>` (any tool, raw arguments). */

import type { Command } from "commander";
import { createNodeHost } from "@zenvi/render-node";
import { missingCapabilities } from "../engine/registry.js";
import { hostOfTool } from "../hosts/adobe-tools.js";
import { CliError } from "../output.js";
import { hostOptions, runToolCommand, type CommandContext } from "./context.js";
import { runHostToolCommand } from "./hosts.js";

/** `--args '{…}'` merged with `key=value` pairs (values that look like JSON are parsed). */
export function parseCallArgs(json: string | undefined, pairs: string[]): Record<string, unknown> {
  let args: Record<string, unknown> = {};
  if (json) {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("expected an object");
      args = parsed as Record<string, unknown>;
    } catch (error) {
      throw new CliError(`--args is not a JSON object: ${(error as Error).message}`, 2);
    }
  }
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq <= 0) throw new CliError(`Expected key=value, got "${pair}".`, 2);
    const key = pair.slice(0, eq);
    const raw = pair.slice(eq + 1);
    let value: unknown = raw;
    if (/^[[{]/.test(raw.trim())) {
      try {
        value = JSON.parse(raw);
      } catch {
        value = raw;
      }
    }
    args[key] = value;
  }
  return args;
}

export function registerToolCommands(program: Command, ctx: CommandContext): void {
  program
    .command("tools")
    .description("list the editing tools (the same catalog the MCP server exposes)")
    .option("-a, --all", "include tools this machine cannot run (and why)")
    .option("--schema", "include each tool's JSON input schema (with --json)")
    .action(async (opts: { all?: boolean; schema?: boolean }) => {
      const host = createNodeHost({ ...hostOptions(ctx) });
      const tools = ctx.registry.list("cli", host, { includeUnavailable: true });
      const rows = tools
        .map((t) => ({ tool: t, missing: missingCapabilities(t, host) }))
        .filter((r) => opts.all || r.missing.length === 0);
      if (ctx.out.json) {
        ctx.out.data({
          tools: rows.map(({ tool, missing }) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            contract: tool.contract ?? false,
            available: missing.length === 0,
            ...(missing.length ? { missing } : {}),
            ...(opts.schema ? { inputSchema: tool.inputSchema } : {}),
          })),
        });
        return;
      }
      if (rows.length === 0) {
        ctx.out.line("No tools in this build.");
        return;
      }
      ctx.out.table(
        ["tool", "what it does"],
        rows.map(({ tool, missing }) => [
          tool.name,
          `${(tool.description.split(/(?<=\.)\s/)[0] ?? "").slice(0, 90)}${missing.length ? ctx.out.style(` (needs ${missing.join(", ")})`, "dim") : ""}`,
        ]),
      );
      ctx.out.line(ctx.out.style(`\n${rows.length} tools. Run one with: zenvi call <tool> key=value … (After Effects / Premiere Pro tools: zenvi ae, zenvi premiere)`, "dim"));
    });

  program
    .command("call")
    .description("run any tool with raw arguments: zenvi call add_clip_to_timeline_tool file_id=AB12CD34EF position_seconds=4 (ae_* / premiere_* run in After Effects / Premiere Pro)")
    .argument("<tool>", "tool name (see `zenvi tools`)")
    .argument("[pairs...]", "key=value arguments")
    .option("--args <json>", "arguments as a JSON object")
    .action(async (tool: string, pairs: string[], opts: { args?: string }) => {
      const args = parseCallArgs(opts.args, pairs);
      // ae_* / premiere_* run in After Effects / Premiere Pro through Zenvi Link.
      if (hostOfTool(tool)) await runHostToolCommand(ctx, tool, args);
      else await runToolCommand(ctx, tool, args);
    });
}
