/**
 * The command an MCP host runs to start `zenvi mcp`.
 *
 * Absolute paths, because GUI hosts (Claude Desktop, Cursor from the Dock)
 * do not inherit the shell's PATH on macOS. Node is referenced through its
 * PATH symlink (e.g. /opt/homebrew/bin/node) when that points at the running
 * binary, so a `brew upgrade node` does not break the config.
 */

import { realpathSync } from "node:fs";
import path from "node:path";
import { whichSync } from "@zenvi/render-node";

export interface McpCommand {
  command: string;
  args: string[];
}

function real(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

export function stableNodePath(env: NodeJS.ProcessEnv = process.env): string {
  const current = real(process.execPath);
  const onPath = whichSync("node", env);
  if (onPath && real(onPath) === current) return onPath;
  return process.execPath;
}

/** How this process was started: `[entry, ...]` for the bundle, loader flags + source for dev (tsx). */
export function selfMcpCommand(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): McpCommand {
  const override = env.ZENVI_MCP_COMMAND?.trim();
  if (override) {
    const parts = override.split(/\s+/);
    return { command: parts[0]!, args: [...parts.slice(1), "mcp"] };
  }
  const entry = argv[1] ? path.resolve(argv[1]) : "";
  if (/\.m?js$/.test(entry)) return { command: stableNodePath(env), args: [real(entry), "mcp"] };
  // Development: `tsx src/bin.ts` runs node with loader flags.
  return { command: process.execPath, args: [...process.execArgv, real(entry), "mcp"] };
}
