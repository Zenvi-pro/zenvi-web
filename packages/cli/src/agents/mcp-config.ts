/**
 * `zenvi mcp-config <host> [--install]`: register the local stdio MCP
 * server (`zenvi mcp`) with Claude Code, Claude Desktop, Codex or Cursor.
 *
 * Rules: only the server's own entry is written; other servers, settings and
 * formatting-insensitive content are kept; a file that does not parse is
 * never rewritten; an existing entry with the same name that is not a zenvi
 * stdio server (e.g. the desktop app's HTTP registration, zenvi-core
 * src/windows/agent_runners.py `register_claude`) is only replaced with
 * `--force`; the previous file is kept as `<file>.zenvi-backup`.
 */

import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { whichSync } from "@zenvi/render-node";
import { CliError } from "../output.js";
import type { McpCommand } from "./self-command.js";
import { readTable, tomlArray, tomlString, upsertTable } from "./toml.js";

const execFileAsync = promisify(execFile);

export const AGENT_TARGETS = ["claude-code", "claude-desktop", "codex", "cursor"] as const;
export type AgentTarget = (typeof AGENT_TARGETS)[number];

export interface McpConfigOptions {
  target: AgentTarget;
  command: McpCommand;
  name?: string;
  scope?: "user" | "project";
  install?: boolean;
  force?: boolean;
  cwd?: string;
  home: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Runs the `claude` CLI (tests inject a fake). */
  runClaude?: (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
}

export interface McpConfigResult {
  target: AgentTarget;
  name: string;
  scope?: "user" | "project";
  /** Config file this target uses (written with --install). */
  file?: string;
  /** What to paste or run by hand. */
  snippet: string;
  installed: boolean;
  changed: boolean;
  backup?: string;
  command: McpCommand;
  message: string;
}

function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function claudeDesktopConfigPath(home: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (platform === "win32") return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "Claude", "claude_desktop_config.json");
}

export function codexConfigPath(home: string, env: NodeJS.ProcessEnv): string {
  return path.join(env.CODEX_HOME || path.join(home, ".codex"), "config.toml");
}

/** An entry that runs some `zenvi … mcp` stdio server (so updating it is not clobbering). */
function isZenviStdio(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as { command?: unknown; args?: unknown; type?: unknown; url?: unknown };
  if (e.url !== undefined || (e.type !== undefined && e.type !== "stdio")) return false;
  const argv = [e.command, ...(Array.isArray(e.args) ? e.args : [])].map(String);
  return argv.includes("mcp") && argv.some((a) => /zenvi/i.test(a));
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function writeWithBackup(file: string, text: string, hadFile: boolean): Promise<string | undefined> {
  await mkdir(path.dirname(file), { recursive: true });
  let backup: string | undefined;
  if (hadFile) {
    backup = `${file}.zenvi-backup`;
    await copyFile(file, backup);
  }
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file);
  return backup;
}

async function mergeJsonServer(
  file: string,
  name: string,
  entry: Record<string, unknown>,
  force: boolean,
): Promise<{ changed: boolean; backup?: string }> {
  const hadFile = await exists(file);
  let root: Record<string, unknown> = {};
  if (hadFile) {
    const text = await readFile(file, "utf8");
    if (text.trim()) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
        root = parsed as Record<string, unknown>;
      } catch (error) {
        throw new CliError(`${file} is not valid JSON (${(error as Error).message}); not touching it.`, 1, "Fix the file, then run this again.");
      }
    }
  }
  const servers = root.mcpServers ?? {};
  if (typeof servers !== "object" || Array.isArray(servers)) throw new CliError(`${file}: "mcpServers" is not an object; not touching it.`);
  const existing = (servers as Record<string, unknown>)[name];
  if (existing !== undefined && sameJson(existing, entry)) return { changed: false };
  if (existing !== undefined && !force && !isZenviStdio(existing)) {
    throw new CliError(
      `${file} already has a different "${name}" MCP server (${JSON.stringify(existing).slice(0, 120)}).`,
      1,
      `Pass --force to replace it, or --name <other> to add Zenvi next to it.`,
    );
  }
  const next = { ...root, mcpServers: { ...(servers as Record<string, unknown>), [name]: entry } };
  const backup = await writeWithBackup(file, `${JSON.stringify(next, null, 2)}\n`, hadFile);
  return { changed: true, backup };
}

function codexSection(name: string, command: McpCommand): string {
  return [
    `[mcp_servers.${/^[A-Za-z0-9_-]+$/.test(name) ? name : tomlString(name)}]`,
    `command = ${tomlString(command.command)}`,
    `args = ${tomlArray(command.args)}`,
    "# Renders and previews can take minutes.",
    "startup_timeout_sec = 30",
    "tool_timeout_sec = 1800",
  ].join("\n");
}

async function defaultRunClaude(env: NodeJS.ProcessEnv, home: string): Promise<(args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>> {
  const candidates = [whichSync("claude", env), path.join(home, ".local", "bin", "claude"), path.join(home, ".claude", "local", "claude")];
  let claude: string | undefined;
  for (const c of candidates) if (c && (await exists(c))) {
    claude = c;
    break;
  }
  if (!claude) throw new CliError("The Claude Code CLI (`claude`) was not found.", 1, "Install Claude Code, or run the printed command yourself.");
  const bin = claude;
  return async (args) => {
    try {
      const { stdout, stderr } = await execFileAsync(bin, args, { timeout: 60_000, env });
      return { code: 0, stdout, stderr };
    } catch (error) {
      const e = error as { code?: number; stdout?: string; stderr?: string };
      return { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
  };
}

export async function mcpConfig(options: McpConfigOptions): Promise<McpConfigResult> {
  const name = options.name ?? "zenvi";
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const { command } = options;
  const stdioEntry = { command: command.command, args: command.args };
  const base = { target: options.target, name, command, installed: false, changed: false };

  switch (options.target) {
    case "claude-code": {
      const scope = options.scope ?? "user";
      const entry = { type: "stdio", ...stdioEntry, env: {} };
      if (scope === "project") {
        const file = path.join(cwd, ".mcp.json");
        const snippet = JSON.stringify({ mcpServers: { [name]: entry } }, null, 2);
        if (!options.install) return { ...base, scope, file, snippet, message: `Add this to ${file} (Claude Code asks you to approve project servers).` };
        const { changed, backup } = await mergeJsonServer(file, name, entry, options.force ?? false);
        return { ...base, scope, file, snippet, installed: true, changed, backup, message: changed ? `Wrote "${name}" to ${file}.` : `${file} already has this "${name}" server.` };
      }
      const json = JSON.stringify(entry);
      const snippet = `claude mcp add-json ${shellQuote(name)} ${shellQuote(json)} --scope user`;
      if (!options.install) return { ...base, scope, snippet, message: "Run this to add Zenvi to Claude Code for your user (or install the Zenvi plugin: /plugin marketplace add Zenvi-pro/zenvi-web)." };
      const run = options.runClaude ?? (await defaultRunClaude(env, options.home));
      const existing = await run(["mcp", "get", name]);
      if (existing.code === 0) {
        const mentionsOurs = /zenvi/i.test(existing.stdout) && /\bmcp\b/.test(existing.stdout) && !/https?:\/\//.test(existing.stdout);
        if (!options.force && !mentionsOurs) {
          throw new CliError(`Claude Code already has an MCP server named "${name}":\n${existing.stdout.trim()}`, 1, "Pass --force to replace it, or --name <other>.");
        }
        await run(["mcp", "remove", name, "--scope", "user"]);
      }
      const added = await run(["mcp", "add-json", name, json, "--scope", "user"]);
      if (added.code !== 0) throw new CliError(`claude mcp add-json failed: ${(added.stderr || added.stdout).trim()}`);
      return { ...base, scope, snippet, installed: true, changed: true, message: `Added "${name}" to Claude Code (user scope). Start a new \`claude\` session to use it.` };
    }
    case "claude-desktop": {
      const file = claudeDesktopConfigPath(options.home, platform, env);
      const snippet = JSON.stringify({ mcpServers: { [name]: stdioEntry } }, null, 2);
      if (!options.install) return { ...base, file, snippet, message: `Merge this into ${file}, then restart Claude Desktop.` };
      const { changed, backup } = await mergeJsonServer(file, name, stdioEntry, options.force ?? false);
      return { ...base, file, snippet, installed: true, changed, backup, message: changed ? `Wrote "${name}" to ${file}. Restart Claude Desktop.` : `${file} already has this "${name}" server.` };
    }
    case "cursor": {
      const scope = options.scope ?? "user";
      const file = scope === "project" ? path.join(cwd, ".cursor", "mcp.json") : path.join(options.home, ".cursor", "mcp.json");
      const snippet = JSON.stringify({ mcpServers: { [name]: stdioEntry } }, null, 2);
      if (!options.install) return { ...base, scope, file, snippet, message: `Merge this into ${file}.` };
      const { changed, backup } = await mergeJsonServer(file, name, stdioEntry, options.force ?? false);
      return { ...base, scope, file, snippet, installed: true, changed, backup, message: changed ? `Wrote "${name}" to ${file}. Reload Cursor's MCP servers.` : `${file} already has this "${name}" server.` };
    }
    case "codex": {
      const file = codexConfigPath(options.home, env);
      const section = codexSection(name, command);
      const table = `mcp_servers.${name}`;
      const snippet = `${section}\n\n# or: codex mcp add ${shellQuote(name)} -- ${[command.command, ...command.args].map(shellQuote).join(" ")}`;
      if (!options.install) return { ...base, file, snippet, message: `Add this to ${file}.` };
      const hadFile = await exists(file);
      const original = hadFile ? await readFile(file, "utf8") : "";
      let current: string | undefined;
      try {
        current = readTable(original, table);
      } catch (error) {
        throw new CliError(`${file} could not be read as TOML (${(error as Error).message}); not touching it.`);
      }
      if (current === section.trim()) return { ...base, file, snippet, installed: true, message: `${file} already has this "${name}" server.` };
      if (current !== undefined && !options.force && !/zenvi/i.test(current)) {
        throw new CliError(`${file} already has a different [${table}] table.`, 1, "Pass --force to replace it, or --name <other>.");
      }
      const updated = upsertTable(original, table, section);
      if (readTable(updated, table) !== section.trim()) throw new CliError("Refusing to write: the edited config did not read back as expected.");
      const backup = await writeWithBackup(file, updated, hadFile);
      return { ...base, file, snippet, installed: true, changed: true, backup, message: `Wrote [${table}] to ${file}. Start a new codex session to use it.` };
    }
  }
}
