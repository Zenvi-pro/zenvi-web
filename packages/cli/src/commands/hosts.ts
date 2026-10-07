/**
 * Hosts and Adobe commands: `zenvi hosts` (what `zenvi mcp` can drive),
 * `zenvi adobe install|doctor` (Zenvi Link, the After Effects / Premiere Pro
 * extension), and `zenvi ae <tool>` / `zenvi premiere <tool>` (one Zenvi
 * Link tool, with the same key=value arguments as `zenvi call`).
 */

import { lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import { describeAction, HOST_TOOL_PREFIX, planExtensionInstall, runInstallPlan, type HostId, type HostImage } from "@zenvi/adobe-link";
import { callAdobeTool, catalogTools, isOkHostStatus, type CliHostReceipt } from "../hosts/adobe-tools.js";
import { adobeDoctor } from "../hosts/doctor.js";
import { bundledExtension, defaultDetectDeps, findInstalledExtensions } from "../hosts/extension.js";
import { APP_LABEL } from "../hosts/policy.js";
import { HostRegistry, type HostEntry } from "../hosts/registry.js";
import { CliError } from "../output.js";
import { findProject } from "../project/select.js";
import { VERSION } from "../version.js";
import type { CommandContext } from "./context.js";
import type { DoctorCheck } from "./integrations.js";
import { parseCallArgs } from "./tools.js";

async function pathExists(file: string): Promise<boolean> {
  return lstat(file).then(
    () => true,
    () => false,
  );
}

function hostRegistry(ctx: CommandContext, project: string | undefined): HostRegistry {
  return new HostRegistry({ config: ctx.config, env: ctx.env, clientVersion: VERSION, portable: () => ({ project: project ?? null }) });
}

function hostState(entry: HostEntry): string {
  if (entry.kind === "zenvi") return entry.id === "zenvi-portable" ? "ready" : entry.connected ? "running" : "not running";
  return entry.connected ? "connected" : entry.status === "absent" ? "not connected" : String(entry.status);
}

function hostDetails(entry: HostEntry): string {
  const project = typeof entry.project === "string" && entry.project ? entry.project : undefined;
  if (entry.id === "zenvi-portable") return `${project ?? "no project selected"}${entry.routes_to ? " (edits go to the desktop app)" : ""}`;
  if (entry.id === "zenvi-desktop") {
    return entry.connected ? [project ?? "untitled project", entry.version ? `Zenvi ${String(entry.version)}` : "", entry.pid ? `pid ${String(entry.pid)}` : ""].filter(Boolean).join(" · ") : "start it with `zenvi open`";
  }
  const count = `${String(entry.tools)} tool${entry.tools === 1 ? "" : "s"}`;
  const listed = entry.tools_listed ? count : `${count}, not listed by zenvi mcp`;
  if (entry.connected) {
    return [`${String(entry.app_name ?? entry.label)} ${String(entry.app_version ?? "")}`.trim(), project ?? "no saved project", listed].join(" · ");
  }
  return `${String(entry.reason)} · ${listed} · \`zenvi adobe doctor\``;
}

function printChecks(ctx: CommandContext, checks: DoctorCheck[]): void {
  for (const c of checks) {
    const mark = c.level === "ok" ? ctx.out.style("✓", "green") : c.level === "warn" ? ctx.out.style("!", "yellow") : ctx.out.style("✗", "red");
    ctx.out.line(`${mark} ${c.name.padEnd(14)} ${c.detail}`);
    if (c.hint && c.level !== "ok") ctx.out.line(ctx.out.style(`  ${" ".repeat(14)} ${c.hint}`, "dim"));
  }
}

/** `get_state` and `ae_get_state` both name ae_get_state. */
export function hostToolName(host: HostId, tool: string): string {
  const prefix = HOST_TOOL_PREFIX[host];
  return tool.startsWith(prefix) ? tool : `${prefix}${tool}`;
}

async function saveImages(ctx: CommandContext, images: HostImage[], out: string | undefined): Promise<string[]> {
  if (!out || images.length === 0) return [];
  const target = path.resolve(ctx.cwd, out);
  const ext = path.extname(target);
  const saved: string[] = [];
  for (const [i, image] of images.entries()) {
    const file = images.length === 1 ? target : `${target.slice(0, target.length - ext.length)}-${i + 1}${ext}`;
    await writeFile(file, Buffer.from(image.data, "base64"));
    saved.push(file);
  }
  return saved;
}

/** Print a host receipt (JSON with --json) and set the exit code. */
function printHostReceipt(ctx: CommandContext, receipt: CliHostReceipt, images: HostImage[], saved: string[]): void {
  const ok = isOkHostStatus(receipt.status);
  if (!ok) ctx.exitCode = 1;
  if (ctx.out.json) {
    ctx.out.data({ ...receipt, ...(images.length ? { images: images.length } : {}), ...(saved.length ? { saved } : {}) });
    return;
  }
  if (!ok) ctx.out.error(receipt.summary.replace(/^Error:\s*/, ""));
  else ctx.out.line(`${receipt.status === "unchanged" ? ctx.out.style("•", "dim") : ctx.out.style("✓", "green")} ${receipt.summary}`);
  for (const w of receipt.warnings ?? []) ctx.out.warn(w);
  if (ok && receipt.data && Object.keys(receipt.data).length) ctx.out.line(ctx.out.style(JSON.stringify(receipt.data, null, 2), "dim"));
  for (const file of saved) ctx.out.line(`  saved ${file}`);
  if (images.length && !saved.length) ctx.out.info(ctx.out.style(`  ${images.length} image(s): pass --out <file.png> to save`, "dim"));
}

/** Run one ae_* / premiere_* tool and print it (`zenvi ae`, `zenvi premiere`, `zenvi call`). */
export async function runHostToolCommand(ctx: CommandContext, tool: string, args: Record<string, unknown>, out?: string): Promise<void> {
  const project = await findProject({ flag: ctx.flags().project, cwd: ctx.cwd, env: ctx.env }).catch(() => undefined);
  const registry = hostRegistry(ctx, project);
  try {
    const { receipt, images } = await callAdobeTool(registry, tool, args);
    printHostReceipt(ctx, receipt, images, isOkHostStatus(receipt.status) ? await saveImages(ctx, images, out) : []);
  } finally {
    await registry.close();
  }
}

function listFamily(ctx: CommandContext, host: HostId, command: string): void {
  const tools = [...catalogTools(host).values()];
  if (ctx.out.json) {
    ctx.out.data({ host, tools: tools.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema })) });
    return;
  }
  ctx.out.table(
    ["tool", "what it does"],
    tools.map((t) => [t.name, (t.description.split(/(?<=\.)\s/)[0] ?? "").slice(0, 90)]),
  );
  ctx.out.line(ctx.out.style(`\n${tools.length} ${APP_LABEL[host]} tool${tools.length === 1 ? "" : "s"}. Run one with: zenvi ${command} <tool> key=value … (the prefix is optional)`, "dim"));
}

export function registerHostCommands(program: Command, ctx: CommandContext): void {
  program
    .command("hosts")
    .description("the apps zenvi can drive: the Zenvi desktop app, the portable engine, After Effects and Premiere Pro (Zenvi Link)")
    .action(async () => {
      const project = await findProject({ flag: ctx.flags().project, cwd: ctx.cwd, env: ctx.env }).catch(() => undefined);
      const registry = hostRegistry(ctx, project);
      try {
        const report = await registry.list();
        if (ctx.out.json) {
          ctx.out.data(report);
          return;
        }
        ctx.out.table(
          ["host", "state", "details"],
          report.hosts.map((h) => [`${h.id}${h.active ? " *" : ""}`, hostState(h), hostDetails(h)]),
        );
        ctx.out.line(ctx.out.style("\n* active: the connected host used most recently. Adobe apps connect through Zenvi Link: `zenvi adobe install`, `zenvi adobe doctor`.", "dim"));
      } finally {
        await registry.close();
      }
    });

  const adobe = program.command("adobe").description("Zenvi Link, the After Effects / Premiere Pro extension zenvi drives them through: install, uninstall, check");

  adobe
    .command("install")
    .description("install Zenvi Link into the CEP extensions folder (and allow unsigned extensions); restart the apps afterwards")
    .option("--dry-run", "print what would happen, change nothing")
    .option("--uninstall", "remove Zenvi Link")
    .option("--platform <platform>", "plan for darwin or win32 (only with --dry-run)")
    .action(async (opts: { dryRun?: boolean; uninstall?: boolean; platform?: string }) => {
      if (opts.platform && !opts.dryRun) throw new CliError("--platform only works with --dry-run.", 2);
      const platform = opts.platform ?? process.platform;
      if (platform !== "darwin" && platform !== "win32") {
        throw new CliError(`Zenvi Link runs in After Effects and Premiere Pro on macOS and Windows; this is ${platform}.`, 1);
      }
      const detect = { ...defaultDetectDeps(ctx.config.home, ctx.env), platform };
      const source = await bundledExtension(detect);
      if (!source && !opts.uninstall) {
        throw new CliError(
          "This zenvi build has no Zenvi Link extension to install.",
          1,
          "From a checkout: npm run build -w @zenvi/adobe-link (or npm run install:dev -w @zenvi/adobe-link for a linked dev install), or set ZENVI_ADOBE_EXTENSION to a built pro.zenvi.link folder.",
        );
      }
      const plan = planExtensionInstall({ platform, home: ctx.config.home, appData: ctx.env.APPDATA, source: source?.dir ?? "", uninstall: opts.uninstall, copy: true });
      const installed = await findInstalledExtensions(detect);
      const replacingLink = !opts.uninstall && installed.some((copy) => copy.dir === plan.target && copy.linked);
      const machineWide = installed.filter((copy) => copy.scope === "system");
      const present = await pathExists(plan.target);
      // Nothing to remove here: say so instead of claiming a removal.
      const nothingToRemove = Boolean(opts.uninstall) && !present;
      const actions = nothingToRemove ? [] : plan.actions;
      const notes = [
        ...(replacingLink ? ["This replaces a development link (npm run install:dev) with the copy that ships with zenvi."] : []),
        ...(opts.uninstall && machineWide.length
          ? [`A machine-wide copy stays at ${machineWide.map((copy) => copy.dir).join(", ")} (installed by a ZXP installer; remove it with that installer, with administrator rights).`]
          : []),
        ...(nothingToRemove ? [] : plan.notes),
      ];
      if (!opts.dryRun && actions.length) {
        try {
          runInstallPlan(actions);
        } catch (error) {
          throw new CliError(`Could not ${opts.uninstall ? "remove" : "install"} Zenvi Link at ${plan.target}: ${(error as Error).message}`, 1, opts.uninstall ? undefined : "The previous install, if any, is unchanged.");
        }
      }
      const verb = opts.uninstall ? "uninstall" : "install";
      const summary = nothingToRemove
        ? `Zenvi Link is not installed at ${plan.target}; nothing to remove`
        : opts.dryRun
          ? `Would ${verb} Zenvi Link${source?.version && !opts.uninstall ? ` ${source.version}` : ""} at ${plan.target}`
          : opts.uninstall
            ? `Removed Zenvi Link from ${plan.target}`
            : `Installed Zenvi Link${source?.version ? ` ${source.version}` : ""} at ${plan.target}`;
      const changed = !opts.dryRun && actions.length > 0;
      if (ctx.out.json) {
        ctx.out.data({ status: changed ? "applied" : "unchanged", summary, target: plan.target, source: source?.dir ?? null, version: source?.version ?? null, actions: actions.map(describeAction), notes, dryRun: Boolean(opts.dryRun) });
        return;
      }
      ctx.out.line(`${changed ? ctx.out.style("✓", "green") : ctx.out.style("•", "dim")} ${summary}${opts.dryRun && actions.length ? ":" : ""}`);
      if (opts.dryRun) for (const action of actions) ctx.out.line(`  ${describeAction(action)}`);
      for (const note of notes) ctx.out.line(note);
    });

  adobe
    .command("doctor")
    .description("check Zenvi Link: the extension, its install, PlayerDebugMode, the apps, the live connections, the MCP tool listing")
    .action(async () => {
      const checks = await adobeDoctor({ desktopDir: ctx.config.desktopDir, detect: defaultDetectDeps(ctx.config.home, ctx.env), clientVersion: VERSION });
      const failedChecks = checks.filter((c) => c.level === "fail");
      if (failedChecks.length) ctx.exitCode = 1;
      if (ctx.out.json) {
        ctx.out.data({ status: failedChecks.length ? "error" : "applied", summary: failedChecks.length ? `${failedChecks.length} problem(s)` : "No blocking problems", checks });
        return;
      }
      printChecks(ctx, checks);
    });

  for (const [command, host] of [
    ["ae", "aftereffects"],
    ["premiere", "premiere"],
  ] as const) {
    program
      .command(command)
      .description(`run one ${APP_LABEL[host]} tool through Zenvi Link: zenvi ${command} ${host === "aftereffects" ? "add_text text=\"Launch day\" placement=lower-third" : "get_sequence"}; without a tool, list them`)
      .argument("[tool]", `tool name, with or without the ${HOST_TOOL_PREFIX[host]} prefix`)
      .argument("[pairs...]", "key=value arguments (values that look like JSON are parsed)")
      .option("--args <json>", "arguments as a JSON object")
      .option("-o, --out <file>", "save returned images (frame captures) here")
      .action(async (tool: string | undefined, pairs: string[], opts: { args?: string; out?: string }) => {
        if (!tool) {
          listFamily(ctx, host, command);
          return;
        }
        await runHostToolCommand(ctx, hostToolName(host, tool), parseCallArgs(opts.args, pairs), opts.out);
      });
  }
}
