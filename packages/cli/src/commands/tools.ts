/** `zenvi tools` (the catalog) and `zenvi call <tool>` (any tool, raw arguments). */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import { createMotionHost } from "@zenvi/motion/node";
import { createNodeHost } from "@zenvi/render-node";
import { missingCapabilities } from "../engine/registry.js";
import { hostOfTool } from "../hosts/adobe-tools.js";
import { CliError } from "../output.js";
import { hostOptions, runToolCommand, type CommandContext } from "./context.js";
import { parseTime } from "./edit.js";
import { runHostToolCommand } from "./hosts.js";
import { defaultFramePath, writeTimelineFrame } from "./render.js";

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
      const node = createNodeHost({ ...hostOptions(ctx) });
      const host = { ...node, motion: createMotionHost({ projectFile: node.projectFile, resolveMedia: node.resolveMedia, env: ctx.env }) };
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
    .option("--images <dir>", "save the images the tool returns (frames, contact sheets) into this folder")
    .action(async (tool: string, pairs: string[], opts: { args?: string; images?: string }) => {
      const args = parseCallArgs(opts.args, pairs);
      // ae_* / premiere_* run in After Effects / Premiere Pro through Zenvi Link.
      if (hostOfTool(tool)) await runHostToolCommand(ctx, tool, args);
      else if (PREVIEW_FRAME_NAMES.has(tool)) await previewFrameCommand(ctx, args, opts.images);
      else {
        const outcome = await runToolCommand(ctx, tool, args);
        if (opts.images) {
          await mkdir(opts.images, { recursive: true });
          for (const [i, image] of outcome.images.entries()) {
            const file = path.join(opts.images, `${tool}-${i + 1}.${image.mimeType === "image/jpeg" ? "jpg" : "png"}`);
            await writeFile(file, Buffer.from(image.data, "base64"));
            ctx.out.info(ctx.out.style(`image saved: ${file}`, "dim"));
          }
        }
      }
    });
}

/** The MCP server's preview_frame (mcp/extra-tools.ts), and the name agents give it by the catalog's habit. */
const PREVIEW_FRAME_NAMES: ReadonlySet<string> = new Set(["preview_frame", "preview_frame_tool"]);

/** `zenvi call preview_frame seconds=2`: the MCP tool's arguments, the frame written to a file (into --images when given) like `zenvi frame`. */
async function previewFrameCommand(ctx: CommandContext, args: Record<string, unknown>, imagesDir: string | undefined): Promise<void> {
  let seconds: number | undefined;
  try {
    seconds = parseTime(String(args.seconds ?? args.time_seconds ?? ""));
  } catch {
    seconds = undefined;
  }
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) throw new CliError("preview_frame needs seconds=<timeline time ≥ 0>.", 2);
  if (args.format !== undefined && args.format !== "jpeg" && args.format !== "png") throw new CliError(`preview_frame format is jpeg or png, not '${String(args.format)}'.`, 2);
  const format = args.format === "png" ? "png" : "jpeg";
  if (imagesDir) await mkdir(path.resolve(ctx.cwd, imagesDir), { recursive: true });
  const output = imagesDir ? path.join(imagesDir, defaultFramePath(seconds, format)) : undefined;
  const width = Math.max(64, Math.min(1920, Number(args.width) || 768));
  await writeTimelineFrame(ctx, seconds, output, { width, format, grid: args.grid === true || args.grid === "true" });
}
