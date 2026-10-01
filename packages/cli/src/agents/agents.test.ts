import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { makeTempDir, removeDir } from "@zenvi/render-node/test-support";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { claudeDesktopConfigPath, codexConfigPath, mcpConfig } from "./mcp-config.js";
import { selfMcpCommand } from "./self-command.js";
import { readTable, scanHeaders, upsertTable } from "./toml.js";

const command = { command: "/usr/local/bin/node", args: ["/opt/zenvi/dist/zenvi.mjs", "mcp"] };
const dirs: string[] = [];
let home: string;

beforeEach(async () => {
  home = await makeTempDir("zenvi-agents-");
  dirs.push(home);
});

afterAll(async () => {
  for (const d of dirs) await removeDir(d);
});

describe("TOML table editing", () => {
  const text = [
    "# my codex config",
    'model = "gpt-6"',
    'notes = """',
    "[not_a_table]",
    '"""',
    "",
    "[mcp_servers.other]",
    'command = "other"',
    "args = [",
    '  "[x]",',
    "]",
    "",
    "[mcp_servers.zenvi]",
    'command = "old"',
    "",
    "[mcp_servers.zenvi.env]",
    'A = "1"',
    "",
    "[profiles.fast]",
    'model = "mini"',
    "",
  ].join("\n");

  it("finds headers outside strings and arrays", () => {
    expect(scanHeaders(text).map((h) => h.name)).toEqual(["mcp_servers.other", "mcp_servers.zenvi", "mcp_servers.zenvi.env", "profiles.fast"]);
  });

  it("replaces a table and its sub-tables, keeping everything else", () => {
    const out = upsertTable(text, "mcp_servers.zenvi", '[mcp_servers.zenvi]\ncommand = "new"');
    expect(readTable(out, "mcp_servers.zenvi")).toBe('[mcp_servers.zenvi]\ncommand = "new"');
    expect(out).toContain('[mcp_servers.other]\ncommand = "other"');
    expect(out).toContain('[profiles.fast]\nmodel = "mini"');
    expect(out).toContain('notes = """\n[not_a_table]\n"""');
    expect(out).not.toContain("[mcp_servers.zenvi.env]");
    expect(upsertTable("", "a", "[a]\nx = 1")).toBe("[a]\nx = 1\n");
    expect(upsertTable('k = 1', "a", "[a]")).toBe("k = 1\n\n[a]\n");
  });
});

describe("mcp-config", () => {
  it("prints without touching files unless --install", async () => {
    const r = await mcpConfig({ target: "claude-desktop", command, home, platform: "darwin", env: {} });
    expect(r.installed).toBe(false);
    expect(JSON.parse(r.snippet)).toEqual({ mcpServers: { zenvi: command } });
    await expect(readFile(claudeDesktopConfigPath(home, "darwin", {}))).rejects.toThrow();
  });

  it("merges into Claude Desktop's config, keeps other servers and settings, backs up the file", async () => {
    const file = claudeDesktopConfigPath(home, "darwin", {});
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ globalShortcut: "Ctrl+Space", mcpServers: { other: { command: "x" } } }));
    const r = await mcpConfig({ target: "claude-desktop", command, home, platform: "darwin", env: {}, install: true });
    expect(r).toMatchObject({ installed: true, changed: true, backup: `${file}.zenvi-backup` });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ globalShortcut: "Ctrl+Space", mcpServers: { other: { command: "x" }, zenvi: command } });
    const again = await mcpConfig({ target: "claude-desktop", command, home, platform: "darwin", env: {}, install: true });
    expect(again.changed).toBe(false);
  });

  it("refuses to replace a foreign entry with the same name unless --force, and never rewrites invalid JSON", async () => {
    const file = path.join(home, ".cursor", "mcp.json");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ mcpServers: { zenvi: { url: "http://127.0.0.1:7434/mcp" } } }));
    await expect(mcpConfig({ target: "cursor", command, home, env: {}, install: true })).rejects.toThrow(/different "zenvi"/);
    const forced = await mcpConfig({ target: "cursor", command, home, env: {}, install: true, force: true });
    expect(forced.changed).toBe(true);
    expect(JSON.parse(await readFile(file, "utf8")).mcpServers.zenvi).toEqual(command);
    await writeFile(file, "{ not json");
    await expect(mcpConfig({ target: "cursor", command, home, env: {}, install: true })).rejects.toThrow(/not valid JSON/);
    expect(await readFile(file, "utf8")).toBe("{ not json");
  });

  it("writes project-scoped Cursor and Claude Code configs in the working folder", async () => {
    const cwd = path.join(home, "repo");
    await mkdir(cwd, { recursive: true });
    await mcpConfig({ target: "cursor", command, home, env: {}, install: true, scope: "project", cwd });
    expect(JSON.parse(await readFile(path.join(cwd, ".cursor", "mcp.json"), "utf8")).mcpServers.zenvi).toEqual(command);
    await mcpConfig({ target: "claude-code", command, home, env: {}, install: true, scope: "project", cwd });
    expect(JSON.parse(await readFile(path.join(cwd, ".mcp.json"), "utf8")).mcpServers.zenvi).toEqual({ type: "stdio", ...command, env: {} });
  });

  it("adds a [mcp_servers.zenvi] table to Codex's config.toml", async () => {
    const file = codexConfigPath(home, {});
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'model = "gpt-6"\n\n[mcp_servers.zenvi_editor]\nurl = "http://127.0.0.1:7434/mcp"\n');
    const r = await mcpConfig({ target: "codex", command, home, env: {}, install: true });
    const text = await readFile(file, "utf8");
    expect(r.changed).toBe(true);
    expect(text).toContain('[mcp_servers.zenvi_editor]\nurl = "http://127.0.0.1:7434/mcp"');
    expect(readTable(text, "mcp_servers.zenvi")).toContain('args = ["/opt/zenvi/dist/zenvi.mjs", "mcp"]');
    expect(text).toContain("tool_timeout_sec = 1800");
    expect((await mcpConfig({ target: "codex", command, home, env: {}, install: true })).changed).toBe(false);
  });

  it("uses `claude mcp add-json` for Claude Code's user scope and refuses to clobber the desktop's HTTP entry", async () => {
    const calls: string[][] = [];
    let existing = "";
    const runClaude = async (args: string[]) => {
      calls.push(args);
      if (args[1] === "get") return existing ? { code: 0, stdout: existing, stderr: "" } : { code: 1, stdout: "", stderr: "not found" };
      return { code: 0, stdout: "", stderr: "" };
    };
    await mcpConfig({ target: "claude-code", command, home, env: {}, install: true, runClaude });
    expect(calls).toEqual([
      ["mcp", "get", "zenvi"],
      ["mcp", "add-json", "zenvi", JSON.stringify({ type: "stdio", ...command, env: {} }), "--scope", "user"],
    ]);
    existing = "zenvi:\n  Scope: User\n  Type: http\n  URL: http://127.0.0.1:7434/mcp\n";
    await expect(mcpConfig({ target: "claude-code", command, home, env: {}, install: true, runClaude })).rejects.toThrow(/already has an MCP server named "zenvi"/);
  });

  it("describes how to launch itself with absolute paths", () => {
    const self = selfMcpCommand({ PATH: "" }, ["node", "/opt/zenvi/dist/zenvi.mjs"]);
    expect(self.args).toEqual(["/opt/zenvi/dist/zenvi.mjs", "mcp"]);
    expect(path.isAbsolute(self.command)).toBe(true);
    expect(selfMcpCommand({ ZENVI_MCP_COMMAND: "zenvi" }, [])).toEqual({ command: "zenvi", args: ["mcp"] });
  });
});
