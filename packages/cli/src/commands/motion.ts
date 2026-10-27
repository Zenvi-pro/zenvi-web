/**
 * `zenvi motion`: Zenvi Motion blocks without a project. `setup` downloads
 * the headless Chrome renders use, `list` shows the blocks, `render` renders
 * one block to a file (placing one on the timeline is
 * `zenvi call add_motion_block_tool block=… params='{…}'`).
 */

import path from "node:path";
import type { Command } from "commander";
import { allParams, BLOCKS, getBlock } from "@zenvi/motion";
import { ChromeLaunchError, ChromeMissingError, findChrome, installChrome, MotionBlockError, renderBlock } from "@zenvi/motion/node";
import { CliError } from "../output.js";
import type { CommandContext } from "./context.js";
import { parseFps } from "./render.js";
import { parseCallArgs } from "./tools.js";

interface RenderFlags {
  output?: string;
  size: string;
  fps: string;
  seconds?: string;
  alpha?: boolean;
  opaque?: boolean;
  motionBlur?: string;
  draft?: boolean;
  params?: string;
  media: string[];
}

function parseSize(text: string): [number, number] {
  const m = /^(\d+)x(\d+)$/.exec(text.trim());
  if (!m) throw new CliError(`--size must be WIDTHxHEIGHT, e.g. 1080x1920 (got ${text}).`, 2);
  return [Number(m[1]), Number(m[2])];
}

export function registerMotionCommands(program: Command, ctx: CommandContext): void {
  const motion = program.command("motion").description("Zenvi Motion blocks: parametric motion graphics rendered with headless Chrome");

  motion
    .command("setup")
    .description("download chrome-headless-shell (about 90 MB) into Zenvi's cache, for rendering motion blocks")
    .action(async () => {
      const existing = await findChrome(ctx.env);
      if (existing) {
        ctx.out.info(`Headless Chrome is ready: ${existing}`);
        return;
      }
      ctx.out.info("Downloading chrome-headless-shell…");
      const exe = await installChrome(ctx.env);
      ctx.out.info(`Installed ${exe}`);
    });

  motion
    .command("list")
    .description("list the motion blocks and their parameters")
    .argument("[block]", "one block: its parameters")
    .action((id: string | undefined) => {
      const blocks = id ? [getBlock(id)].filter((b) => b !== undefined) : [...BLOCKS];
      if (id && blocks.length === 0) throw new CliError(`Unknown motion block ${id} (zenvi motion list).`, 2);
      if (ctx.out.json) {
        ctx.out.data({ blocks });
        return;
      }
      ctx.out.table(
        ["block", "seconds", "what it is"],
        blocks.map((b) => [b.id, `${b.duration.min}-${b.duration.max}`, b.description.split(/(?<=\.)\s/)[0] ?? ""]),
      );
      if (id) {
        for (const [name, spec] of Object.entries(allParams(blocks[0]!))) ctx.out.line(`  ${name} (${spec.type}): ${spec.description}`);
      }
    });

  motion
    .command("render")
    .description("render one block to a video file: zenvi motion render prompt_bar -o prompt.mov prompt='Plan my trip'")
    .argument("<block>", "block id (zenvi motion list)")
    .argument("[pairs...]", "param=value pairs (lists as JSON: words='[\"a\",\"b\"]')")
    .option("-o, --output <file>", "output file (.mov with alpha, .mp4 opaque); default <block>.mov|.mp4 here")
    .option("--size <WxH>", "frame size", "1080x1920")
    .option("--fps <rate>", "frame rate", "30")
    .option("--seconds <s>", "length (default the block's)")
    .option("--alpha", "transparent background (ProRes 4444 .mov)")
    .option("--opaque", "opaque background (H.264 .mp4)")
    .option("--motion-blur <n>", "sub-frames averaged per frame (4-8 for fast moves)")
    .option("--draft", "half size, quicker")
    .option("--params <json>", "params as a JSON object")
    .option("--media <name=file>", "a media param's file (repeatable)", (v: string, all: string[]) => [...all, v], [] as string[])
    .action(async (id: string, pairs: string[], flags: RenderFlags) => {
      const block = getBlock(id);
      if (!block) throw new CliError(`Unknown motion block ${id} (zenvi motion list).`, 2);
      const params = parseCallArgs(flags.params, pairs);
      const media: Record<string, string> = {};
      for (const entry of flags.media) {
        const [name, file] = entry.split(/=(.*)/s, 2) as [string, string | undefined];
        if (!file) throw new CliError(`--media needs name=file (got ${entry}).`, 2);
        media[name] = path.resolve(ctx.cwd, file);
        params[name] ??= path.basename(file);
      }
      const [width, height] = parseSize(flags.size);
      const fps = parseFps(flags.fps)!;
      const alpha = flags.alpha ? true : flags.opaque ? false : block.alpha;
      const output = path.resolve(ctx.cwd, flags.output ?? `${id}${alpha ? ".mov" : ".mp4"}`);
      try {
        const result = await renderBlock(id, params, {
          width,
          height,
          fps,
          seconds: flags.seconds ? Number(flags.seconds) : undefined,
          alpha,
          motionBlurSamples: flags.motionBlur ? Number(flags.motionBlur) : undefined,
          draft: flags.draft,
          media,
          output,
          env: ctx.env,
          onProgress: (done, total) => {
            if (!ctx.out.json && (done === total || done % 30 === 0)) process.stderr.write(`\r${done}/${total} frames`);
          },
        });
        if (!ctx.out.json) process.stderr.write("\n");
        if (ctx.out.json) ctx.out.data(result);
        else ctx.out.info(`${result.cached ? "Reused" : "Rendered"} ${id}: ${result.path} (${result.width}x${result.height}, ${result.frames} frames, ${result.codec}${result.cached ? "" : `, ${result.renderSeconds.toFixed(1)} s`})`);
      } catch (error) {
        if (error instanceof MotionBlockError) throw new CliError(error.message, 2);
        if (error instanceof ChromeMissingError || error instanceof ChromeLaunchError) throw new CliError(error.message, 1);
        throw error;
      }
    });
}
