/** `zenvi render` and `zenvi frame`. */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import { timelineEnd, type ContainerFormat, type ExportOptions, type Fraction, type Project } from "@zenvi/engine";
import { FORMATS, formatFromPath, frameCaption, type RenderResult } from "@zenvi/render-node";
import { PortableExecutor } from "../engine/executor.js";
import { CliError } from "../output.js";
import { openUrl } from "../util/open-url.js";
import { printOutcome, withExecutor, type CommandContext } from "./context.js";
import { parseTime } from "./edit.js";

const QUALITIES = ["low", "medium", "high", "lossless"] as const;

export function parseFps(text: string | undefined): Fraction | undefined {
  if (!text) return undefined;
  const m = /^(\d+)(?:\/(\d+))?$/.exec(text.trim());
  if (m) return { num: Number(m[1]), den: Number(m[2] ?? 1) };
  const f = Number(text);
  if (Number.isFinite(f) && f > 0) {
    // 29.97 → 30000/1001 style rates.
    for (const base of [24, 30, 60, 120]) if (Math.abs(f - (base * 1000) / 1001) < 0.01) return { num: base * 1000, den: 1001 };
    return { num: Math.round(f * 1000), den: 1000 };
  }
  throw new CliError(`Not a frame rate: ${text}`, 2);
}

export interface RenderFlags {
  format?: string;
  quality?: string;
  width?: string;
  height?: string;
  fps?: string;
  start?: string;
  end?: string;
  videoBitrate?: string;
  audioBitrate?: string;
  open?: boolean;
}

/** Export options from flags + project defaults. */
export function exportOptionsFrom(project: Project, output: string | undefined, flags: RenderFlags): ExportOptions {
  const fromPath = output ? formatFromPath(output) : undefined;
  const format = (flags.format === "png" ? "png-sequence" : flags.format) as ContainerFormat | undefined;
  const chosen = format ?? fromPath ?? "mp4";
  if (!FORMATS[chosen]) throw new CliError(`Unknown format "${flags.format}" (mp4, webm, mov, mkv, gif, mp3, wav, png).`, 2);
  const quality = flags.quality ?? "high";
  if (!(QUALITIES as readonly string[]).includes(quality)) throw new CliError("--quality must be low, medium, high or lossless.", 2);
  let width = flags.width ? Number(flags.width) : project.width;
  let height = flags.height ? Number(flags.height) : project.height;
  if (flags.width && !flags.height) height = Math.round((width * project.height) / project.width / 2) * 2;
  if (flags.height && !flags.width) width = Math.round((height * project.width) / project.height / 2) * 2;
  if (!(width > 0 && height > 0)) throw new CliError("--width/--height must be positive numbers.", 2);
  const start = parseTime(flags.start);
  const end = parseTime(flags.end);
  const options: ExportOptions = {
    format: chosen,
    width,
    height,
    fps: parseFps(flags.fps) ?? project.fps,
    quality: quality as ExportOptions["quality"],
  };
  if (start !== undefined || end !== undefined) {
    options.range = { start: start ?? 0, end: end ?? timelineEnd(project) };
    if (options.range.end <= options.range.start) throw new CliError("--end must be after --start (and inside the timeline).", 2);
  }
  if (flags.videoBitrate) options.videoBitrate = parseBitrate(flags.videoBitrate);
  if (flags.audioBitrate) options.audioBitrate = parseBitrate(flags.audioBitrate);
  if (output) options.output = output;
  return options;
}

function parseBitrate(text: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*([kKmM]?)(?:b\/?s|bps)?$/.exec(text.trim());
  if (!m) throw new CliError(`Not a bitrate: ${text} (e.g. 8M, 192k).`, 2);
  const scale = m[2]?.toLowerCase() === "m" ? 1e6 : m[2]?.toLowerCase() === "k" ? 1e3 : 1;
  return Math.round(Number(m[1]) * scale);
}

function formatBytes(n: number | undefined): string {
  if (n === undefined) return "?";
  if (n > 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}

export function registerRenderCommands(program: Command, ctx: CommandContext): void {
  program
    .command("render")
    .description("render the timeline to a video (mp4, webm, mov, mkv, gif), audio (mp3, wav) or PNG frames")
    .argument("[output]", "output file (default: <project>.mp4 next to the project)")
    .option("-f, --format <format>", "mp4, webm, mov, mkv, gif, mp3, wav or png (default: from the file name)")
    .option("-q, --quality <quality>", "low, medium, high or lossless", "high")
    .option("--width <px>", "output width (height follows the project aspect)")
    .option("--height <px>", "output height")
    .option("--fps <rate>", "frame rate, e.g. 30 or 30000/1001 (default: the project's)")
    .option("--start <time>", "render from this timeline time")
    .option("--end <time>", "render up to this timeline time")
    .option("--video-bitrate <rate>", "e.g. 8M (default: quality-based CRF)")
    .option("--audio-bitrate <rate>", "e.g. 192k")
    .option("--open", "open the result when done")
    .action(async (outputArg: string | undefined, flags: RenderFlags) => {
      await withExecutor(ctx, async (executor) => {
        const output = outputArg ? path.resolve(ctx.cwd, outputArg) : undefined;
        if (!(executor instanceof PortableExecutor)) {
          const outcome = await executor.call("export_video_tool", { show_dialog: "false", ...(output ? { output_path: output } : {}) });
          printOutcome(ctx, outcome);
          return;
        }
        const session = executor.session;
        const exporter = session.host.exporter!;
        const project = session.doc.project;
        const options = exportOptionsFrom(project, output, flags);
        const started = Date.now();
        const result = (await exporter.export(project, options, (fraction) => {
          ctx.out.progress(`Rendering ${Math.round(fraction * 100)}%`);
        })) as RenderResult;
        ctx.out.endProgress();
        const seconds = (Date.now() - started) / 1000;
        if (ctx.out.json) {
          ctx.out.data({
            status: "applied",
            summary: `Rendered ${result.location}`,
            engine: "portable",
            project: session.file ?? null,
            output: { ...result, format: options.format, width: options.width, height: options.height, fps: options.fps, seconds },
          });
        } else {
          ctx.out.line(`${ctx.out.style("✓", "green")} Rendered ${result.location}`);
          ctx.out.line(ctx.out.style(`  ${options.format}, ${options.width}x${options.height}, ${result.durationSeconds.toFixed(2)} s, ${formatBytes(result.bytes)} in ${seconds.toFixed(1)} s`, "dim"));
          for (const w of result.warnings) ctx.out.warn(w);
        }
        if (flags.open && options.format !== "png-sequence") await openUrl(result.location);
      });
    });

  program
    .command("frame")
    .description("render one timeline frame to an image (PNG or JPEG)")
    .argument("<time>", "timeline time (seconds or timecode)")
    .argument("[output]", "image file (default: frame-<time>.png)")
    .option("--width <px>", "image width", "1280")
    .option("--jpeg", "write JPEG instead of PNG")
    .option("--grid", "draw the 0-1 coordinate grid and a frame caption (what inspect tools show models)")
    .action(async (timeArg: string, outputArg: string | undefined, flags: { width: string; jpeg?: boolean; grid?: boolean }) => {
      const seconds = parseTime(timeArg)!;
      const format = flags.jpeg || /\.jpe?g$/i.test(outputArg ?? "") ? "jpeg" : "png";
      const output = path.resolve(ctx.cwd, outputArg ?? `frame-${seconds.toFixed(2).replace(/\.?0+$/, "")}.${format === "jpeg" ? "jpg" : "png"}`);
      await withExecutor(ctx, async (executor) => {
        let data: string;
        let mimeType: string;
        if (executor instanceof PortableExecutor) {
          const project = executor.session.doc.project;
          const width = Math.min(Number(flags.width) || 1280, 8192);
          const fps = project.fps.num / project.fps.den;
          const image = await executor.session.host.frames!.renderFrame(project, seconds, {
            width,
            format,
            overlay: flags.grid ? { grid: true, caption: frameCaption(Math.floor(seconds * fps + 1e-9), seconds) } : undefined,
          });
          data = image.data;
          mimeType = image.mimeType;
        } else {
          const outcome = await executor.call("inspect_timeline_tool", { start: seconds, end: seconds, maxFrames: 1 });
          if (!outcome.ok || outcome.images.length === 0) {
            printOutcome(ctx, outcome);
            ctx.exitCode = 1;
            return;
          }
          data = outcome.images[0]!.data;
          mimeType = outcome.images[0]!.mimeType;
        }
        await writeFile(output, Buffer.from(data, "base64"));
        if (ctx.out.json) ctx.out.data({ status: "applied", summary: `Wrote ${output}`, engine: executor.engine, project: executor.project ?? null, file: output, mimeType, seconds });
        else ctx.out.line(`${ctx.out.style("✓", "green")} Wrote ${output}`);
      });
    });
}
