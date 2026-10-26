/**
 * The engine bridge commands the Zenvi desktop app runs (docs/ENGINE_BRIDGE.md):
 * `zenvi tool-run` (one call per process) and `zenvi bridge` (a long-lived
 * stdio process). Both print machine answers only.
 */

import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import type { NodeHostOptions } from "@zenvi/render-node";
import { bridgeTools, serveBridge } from "../bridge/server.js";
import { parseBridgeJson, runBridgeCall } from "../bridge/run.js";
import { CliError } from "../output.js";
import { VERSION } from "../version.js";
import { hostOptions, type CommandContext } from "./context.js";
import { parseCallArgs } from "./tools.js";

/**
 * Host options for a bridged call. The backend token is the desktop's own
 * session (a request's `backend_token`, else `ZENVI_BACKEND_TOKEN`), never
 * the CLI's login: the edit belongs to whoever is signed in to the desktop.
 */
function bridgeHostOptions(ctx: CommandContext, token: string | undefined): Omit<NodeHostOptions, "projectFile"> {
  const base = hostOptions(ctx);
  const bearer = token ?? ctx.env.ZENVI_BACKEND_TOKEN;
  return { ...base, backend: { ...base.backend, token: async () => bearer || undefined } };
}

export function registerBridgeCommands(program: Command, ctx: CommandContext): void {
  program
    .command("tool-run")
    .description("(for the Zenvi desktop app) run one tool on a project snapshot and print the change as desktop update actions (JSON)")
    .argument("<tool>", "tool name")
    .argument("[pairs...]", "key=value arguments")
    .requiredOption("--snapshot <file>", "the project JSON as the desktop holds it in memory")
    .requiredOption("--project-file <file>", "absolute path the project is saved at (its folder and <name>_assets folder)")
    .option("--args <json>", "arguments as a JSON object")
    .action(async (tool: string, pairs: string[], opts: { snapshot: string; projectFile: string; args?: string }) => {
      let project: unknown;
      try {
        project = parseBridgeJson(await readFile(opts.snapshot, "utf8"));
      } catch (error) {
        throw new CliError(`Cannot read the snapshot ${opts.snapshot}: ${(error as Error).message}`, 1);
      }
      const answer = await runBridgeCall(
        { tool, args: parseCallArgs(opts.args, pairs), project, project_file: opts.projectFile },
        { registry: ctx.registry, host: bridgeHostOptions(ctx, undefined) },
      );
      ctx.out.data(answer);
      if (!answer.ok) ctx.exitCode = 1;
    });

  program
    .command("bridge")
    .description("(for the Zenvi desktop app) serve tool calls as JSON-RPC lines on stdin/stdout")
    .option("--tools", "print the catalog as the bridge runs it (JSON) and exit")
    .action(async (opts: { tools?: boolean }) => {
      if (opts.tools) {
        ctx.out.data({ engine_version: VERSION, tools: bridgeTools(ctx.registry) });
        return;
      }
      await serveBridge({
        registry: ctx.registry,
        input: process.stdin,
        output: process.stdout,
        hostFor: (request) => bridgeHostOptions(ctx, request.backend_token),
        log: (m) => process.stderr.write(`${m}\n`),
      });
    });
}
