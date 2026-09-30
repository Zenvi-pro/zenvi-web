/** Desktop, agent and diagnostics commands: open, mcp, mcp-config, doctor. */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import { binaryVersion, encoderNames, FontIndex, initResvg, resolveBinary } from "@zenvi/render-node";
import { AGENT_TARGETS, claudeDesktopConfigPath, codexConfigPath, mcpConfig, type AgentTarget } from "../agents/mcp-config.js";
import { selfMcpCommand } from "../agents/self-command.js";
import { pushProject } from "../cloud/sync.js";
import { discoverDesktop } from "../desktop/discovery.js";
import { findDesktopApp } from "../desktop/launcher.js";
import { openInDesktop } from "../desktop/open.js";
import { CliError } from "../output.js";
import { findProject } from "../project/select.js";
import { openUrl } from "../util/open-url.js";
import { VERSION } from "../version.js";
import { cloudClient } from "./account.js";
import { openSession, type CommandContext } from "./context.js";

export function registerIntegrationCommands(program: Command, ctx: CommandContext): void {
  program
    .command("open")
    .description("show the project in the Zenvi desktop app (or in the web editor with --web)")
    .argument("[project]", "project file (default: the selected project)")
    .option("--web", "push to Zenvi Cloud and open it in the web editor instead")
    .action(async (projectArg: string | undefined, opts: { web?: boolean }) => {
      const project = projectArg ? path.resolve(ctx.cwd, projectArg) : await findProject({ flag: ctx.flags().project, cwd: ctx.cwd, env: ctx.env });
      if (opts.web) {
        if (!project) throw new CliError("No project to open.", 2, "Pass a .zvn file.");
        const session = await openSession(ctx, project);
        const result = await pushProject({ config: ctx.config, client: cloudClient(ctx), projectFile: project, project: session.doc.toJSON(), warn: (m) => ctx.out.warn(m) });
        const opened = await openUrl(result.editorUrl, ctx.env);
        if (ctx.out.json) ctx.out.data({ status: "applied", summary: `Opened ${result.editorUrl}`, engine: "portable", project, method: "web", opened, ...result });
        else ctx.out.line(`${ctx.out.style("✓", "green")} ${opened ? "Opened" : "Open"} ${result.editorUrl}`);
        return;
      }
      const result = await openInDesktop({ config: ctx.config, project, clientVersion: VERSION });
      if (ctx.out.json) ctx.out.data({ status: "applied", summary: result.summary, project: project ?? null, method: result.method, app: result.app ?? null });
      else ctx.out.line(`${ctx.out.style("✓", "green")} ${result.summary}`);
    });

  program
    .command("mcp")
    .description("run the local MCP server on stdio (for Claude Code, Claude Desktop, Codex, Cursor)")
    .action(async () => {
      const { runStdioServer } = await import("../mcp/server.js");
      await runStdioServer(ctx);
    });

  program
    .command("mcp-config")
    .description("print (or --install) the MCP config for claude-code, claude-desktop, codex or cursor")
    .argument("<host>", AGENT_TARGETS.join(" | "))
    .option("--install", "write it into the host's config (other entries are kept)")
    .option("--scope <scope>", "user (default) or project (claude-code, cursor)")
    .option("--name <name>", "server name", "zenvi")
    .option("--force", "replace an existing different entry with the same name")
    .action(async (host: string, opts: { install?: boolean; scope?: string; name: string; force?: boolean }) => {
      if (!(AGENT_TARGETS as readonly string[]).includes(host)) throw new CliError(`Unknown host "${host}". Use one of: ${AGENT_TARGETS.join(", ")}.`, 2);
      if (opts.scope && opts.scope !== "user" && opts.scope !== "project") throw new CliError("--scope must be user or project.", 2);
      const result = await mcpConfig({
        target: host as AgentTarget,
        command: selfMcpCommand(ctx.env),
        name: opts.name,
        scope: opts.scope as "user" | "project" | undefined,
        install: opts.install,
        force: opts.force,
        cwd: ctx.cwd,
        home: ctx.config.home,
        env: ctx.env,
      });
      if (ctx.out.json) {
        ctx.out.data({ status: result.changed ? "applied" : "unchanged", summary: result.message, ...result });
        return;
      }
      if (!opts.install) {
        ctx.out.line(result.message);
        ctx.out.line("");
        ctx.out.line(result.snippet);
        ctx.out.line("");
        ctx.out.line(ctx.out.style("Run again with --install to write it for you.", "dim"));
      } else {
        ctx.out.line(`${ctx.out.style(result.changed ? "✓" : "•", result.changed ? "green" : "dim")} ${result.message}`);
        if (result.backup) ctx.out.line(ctx.out.style(`  previous file kept as ${result.backup}`, "dim"));
      }
    });

  program
    .command("doctor")
    .description("check ffmpeg, fonts, the desktop app, Zenvi Cloud/backend and your sign-in")
    .action(async () => {
      const checks = await runDoctor(ctx);
      const failed = checks.filter((c) => c.level === "fail");
      if (failed.length) ctx.exitCode = 1;
      if (ctx.out.json) {
        ctx.out.data({ status: failed.length ? "error" : "applied", summary: failed.length ? `${failed.length} problem(s)` : "All good", checks });
        return;
      }
      for (const c of checks) {
        const mark = c.level === "ok" ? ctx.out.style("✓", "green") : c.level === "warn" ? ctx.out.style("!", "yellow") : ctx.out.style("✗", "red");
        ctx.out.line(`${mark} ${c.name.padEnd(16)} ${c.detail}`);
        if (c.hint && c.level !== "ok") ctx.out.line(ctx.out.style(`  ${" ".repeat(16)} ${c.hint}`, "dim"));
      }
    });
}

export interface DoctorCheck {
  name: string;
  level: "ok" | "warn" | "fail";
  detail: string;
  hint?: string;
}

async function probeUrl(url: string): Promise<{ ok: boolean; status?: number; ms: number; error?: string }> {
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": `zenvi-cli/${VERSION}` } });
    await res.body?.cancel().catch(() => undefined);
    return { ok: res.ok, status: res.status, ms: Date.now() - start };
  } catch (error) {
    return { ok: false, ms: Date.now() - start, error: (error as Error).message };
  }
}

export async function runDoctor(ctx: CommandContext): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "node", level: major >= 22 ? "ok" : "fail", detail: `v${process.versions.node}`, hint: "Zenvi needs Node.js 22 or newer." });

  for (const bin of ["ffmpeg", "ffprobe"] as const) {
    try {
      const v = await binaryVersion(bin);
      checks.push({ name: bin, level: "ok", detail: `${v.version} (${v.path})` });
    } catch {
      checks.push({ name: bin, level: "fail", detail: `not found (${resolveBinary(bin)})`, hint: "Install FFmpeg (macOS: brew install ffmpeg; Windows: winget install ffmpeg; Linux: apt install ffmpeg) or set ZENVI_FFMPEG/ZENVI_FFPROBE." });
    }
  }
  try {
    const encoders = await encoderNames();
    const wanted = ["libx264", "aac", "libvpx-vp9", "libopus", "libmp3lame", "png", "gif", "mjpeg"];
    const missing = wanted.filter((e) => !encoders.has(e));
    checks.push({ name: "encoders", level: missing.length ? "warn" : "ok", detail: missing.length ? `missing ${missing.join(", ")}` : wanted.join(", "), hint: "Some export formats need a fuller FFmpeg build." });
  } catch {
    // Reported by the ffmpeg check.
  }
  try {
    await initResvg();
    const fonts = await FontIndex.scan();
    const dejavu = fonts.has("dejavu sans");
    checks.push({ name: "titles/fonts", level: "ok", detail: `${fonts.faces.length} font faces${dejavu ? ", DejaVu Sans installed" : " (titles use DejaVu Sans; a similar font substitutes)"}` });
  } catch (error) {
    checks.push({ name: "titles/fonts", level: "warn", detail: `SVG renderer unavailable: ${(error as Error).message}` });
  }
  const toolCount = ctx.registry.tools.length;
  checks.push({ name: "tools", level: toolCount > 0 ? "ok" : "fail", detail: `${toolCount} editing tools in this build` });
  try {
    const { defaultRenderEngine } = await import("@zenvi/render-node");
    await defaultRenderEngine();
    checks.push({ name: "renderer", level: "ok", detail: "frame planner and compositor available" });
  } catch (error) {
    checks.push({ name: "renderer", level: "fail", detail: (error as Error).message });
  }

  const app = await findDesktopApp().catch(() => undefined);
  const live = await discoverDesktop(ctx.config, { legacy: true, clientVersion: VERSION });
  checks.push({
    name: "desktop app",
    level: app ? "ok" : "warn",
    detail: app ? `${app.location}${live.length ? `, running (${live.map((e) => e.kind).join(", ")}${live[0]?.project ? `: ${live[0].project}` : ""})` : ""}` : "not installed",
    hint: "Optional: `zenvi open` shows projects in it. https://zenvi.pro/download",
  });

  const [cloud, backend] = await Promise.all([probeUrl(`${ctx.config.cloudUrl}/health`), probeUrl(`${ctx.config.backendUrl}/health`)]);
  checks.push({ name: "zenvi cloud", level: cloud.ok ? "ok" : "warn", detail: cloud.ok ? `${ctx.config.cloudUrl} (${cloud.ms} ms)` : `${ctx.config.cloudUrl}: ${cloud.error ?? `HTTP ${cloud.status}`}`, hint: "Needed for push/pull and `zenvi login --device`." });
  checks.push({ name: "zenvi backend", level: backend.ok ? "ok" : "warn", detail: backend.ok ? `${ctx.config.backendUrl} (${backend.ms} ms)` : `${ctx.config.backendUrl}: ${backend.error ?? `HTTP ${backend.status}`}`, hint: "Needed for AI tools (search, generation, voice-over)." });

  const who = await ctx.auth.whoami();
  checks.push({
    name: "sign-in",
    level: who.loggedIn ? "ok" : "warn",
    detail: who.loggedIn ? `${who.email ?? who.userId ?? "signed in"} (${who.kind === "pat" ? "personal token" : "Zenvi account"})` : who.expired ? "expired" : "not signed in",
    hint: "Run `zenvi login` for cloud and AI features.",
  });

  const configured: string[] = [];
  const configFiles: Array<[string, string]> = [
    ["claude-desktop", claudeDesktopConfigPath(ctx.config.home, process.platform, ctx.env)],
    ["cursor", path.join(ctx.config.home, ".cursor", "mcp.json")],
    ["codex", codexConfigPath(ctx.config.home, ctx.env)],
  ];
  for (const [name, file] of configFiles) {
    const text = await readFile(file, "utf8").catch(() => "");
    if (/zenvi[^\n]*\bmcp\b|mcp_servers\.zenvi\b|"zenvi"\s*:/.test(text)) configured.push(name);
  }
  checks.push({ name: "agent configs", level: "ok", detail: configured.length ? `zenvi configured for ${configured.join(", ")}` : "none yet (see `zenvi mcp-config`)" });
  return checks;
}
