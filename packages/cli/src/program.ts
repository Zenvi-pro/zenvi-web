/**
 * The `zenvi` command line: builds the commander program, runs it, maps
 * errors to exit codes (0 ok, 1 failed, 2 usage).
 */

import type { Writable } from "node:stream";
import { Command, CommanderError } from "commander";
import { Auth } from "./auth/session.js";
import { registerAccountCommands } from "./commands/account.js";
import type { CommandContext, GlobalFlags } from "./commands/context.js";
import { registerEditCommands } from "./commands/edit.js";
import { registerIntegrationCommands } from "./commands/integrations.js";
import { registerProjectCommands } from "./commands/project.js";
import { registerRenderCommands } from "./commands/render.js";
import { registerToolCommands } from "./commands/tools.js";
import { loadConfig } from "./config.js";
import { engineRegistry, type Registry } from "./engine/registry.js";
import { CliError, EXIT, Output } from "./output.js";
import { VERSION } from "./version.js";

export interface RunCliOptions {
  /** Arguments after the program name. */
  args: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  stdout?: Writable & { isTTY?: boolean };
  stderr?: Writable & { isTTY?: boolean };
  registry?: Registry;
  fetchImpl?: typeof fetch;
}

export function buildProgram(ctx: CommandContext, stdout: Writable, stderr: Writable): Command {
  const program = new Command();
  program
    .name("zenvi")
    .description("Edit videos from the terminal and from coding agents (Claude Code, Codex, Cursor) with the Zenvi editing engine.")
    .version(VERSION, "-V, --version")
    .option("-p, --project <file>", "project file (.zvn); default: $ZENVI_PROJECT, else the only .zvn in this folder")
    .option("--json", "print one JSON result (contract-3 receipts for edits)")
    .option("-q, --quiet", "print nothing but errors")
    .option("--engine <engine>", "auto (default): use the desktop app when it has the project open; portable; desktop")
    .option("--desktop", "send edits to the running Zenvi desktop app (same as --engine desktop)")
    .showHelpAfterError("(run `zenvi --help` for usage)")
    .configureOutput({ writeOut: (s) => stdout.write(s), writeErr: (s) => stderr.write(s) })
    .exitOverride();
  program.addHelpText(
    "after",
    `
Examples:
  zenvi new trip.zvn --profile "HD 1080p 30 fps"
  zenvi import ~/footage/*.mp4 && zenvi add ~/footage/beach.mp4 --at 0
  zenvi split C1A2B3C4D5 --at 4.5 && zenvi transition C1A2B3C4D5 --name fade
  zenvi frame 5 check.png && zenvi render trip.mp4
  zenvi open            # show it in the Zenvi desktop app
  zenvi mcp-config claude-code --install`,
  );
  registerProjectCommands(program, ctx);
  registerEditCommands(program, ctx);
  registerRenderCommands(program, ctx);
  registerToolCommands(program, ctx);
  registerAccountCommands(program, ctx);
  registerIntegrationCommands(program, ctx);
  for (const cmd of program.commands) {
    cmd.exitOverride().configureOutput({ writeOut: (s) => stdout.write(s), writeErr: (s) => stderr.write(s) });
    for (const sub of cmd.commands) sub.exitOverride().configureOutput({ writeOut: (s) => stdout.write(s), writeErr: (s) => stderr.write(s) });
  }
  return program;
}

/** The context commands (and the MCP server) run with. */
export function createContext(options: Omit<RunCliOptions, "args"> & { flags?: () => GlobalFlags } = {}): CommandContext {
  const env = options.env ?? process.env;
  const config = loadConfig(env);
  return {
    config,
    out: new Output({ json: false, stdout: options.stdout, stderr: options.stderr, env }),
    auth: new Auth(config, options.fetchImpl ?? fetch),
    registry: options.registry ?? engineRegistry(),
    flags: options.flags ?? (() => ({})),
    cwd: options.cwd ?? process.cwd(),
    env,
    exitCode: 0,
  };
}

export async function runCli(options: RunCliOptions): Promise<number> {
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let flags: GlobalFlags = {};
  const ctx = createContext({ ...options, stdout, stderr, flags: () => flags });
  const program = buildProgram(ctx, stdout, stderr);
  program.hook("preAction", (thisCommand) => {
    flags = thisCommand.optsWithGlobals() as GlobalFlags;
    ctx.out = new Output({ json: Boolean(flags.json), quiet: Boolean(flags.quiet), stdout, stderr, env });
  });
  try {
    await program.parseAsync(options.args, { from: "user" });
    return ctx.exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === "commander.helpDisplayed" || error.code === "commander.version" || error.code === "commander.help") return EXIT.ok;
      return error.exitCode === 0 ? EXIT.ok : EXIT.usage;
    }
    const cli = error instanceof CliError ? error : undefined;
    const message = error instanceof Error ? error.message : String(error);
    if (ctx.out.json) {
      ctx.out.data({ status: "error", summary: `Error: ${message}`, ...(cli?.hint ? { hint: cli.hint } : {}) });
    } else {
      ctx.out.error(message);
      if (cli?.hint) ctx.out.info(cli.hint);
      if (!cli && env.ZENVI_DEBUG && error instanceof Error && error.stack) ctx.out.info(error.stack);
    }
    return cli?.exitCode ?? EXIT.failed;
  }
}
