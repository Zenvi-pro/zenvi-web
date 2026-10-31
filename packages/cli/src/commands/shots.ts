/**
 * `zenvi shots`: the shot model behind embed_media_tool and find_shots_tool.
 * `setup` makes the one-time download (SigLIP base, Apache-2.0, about
 * 213 MB) that tools only make when called with download=true; `status`
 * says whether it is installed.
 */

import type { Command } from "commander";
import { createNodeShotHost, onnxRuntimeAvailable } from "@zenvi/render-node";
import { CliError } from "../output.js";
import type { CommandContext } from "./context.js";

export function registerShotsCommands(program: Command, ctx: CommandContext): void {
  const shots = program.command("shots").description("shot understanding: the SigLIP model find_shots_tool and embed_media_tool see footage with");
  const host = () => {
    if (!onnxRuntimeAvailable()) throw new CliError("Shot embeddings need onnxruntime-node: npm install onnxruntime-node.", 1);
    return createNodeShotHost({ env: ctx.env, log: (m) => ctx.out.info(m) });
  };

  shots
    .command("status")
    .description("whether the shot model is installed")
    .action(async () => {
      const status = await host().status();
      if (ctx.out.json) ctx.out.data(status);
      else ctx.out.info(status.detail);
    });

  shots
    .command("setup")
    .description("download the shot model (SigLIP base, Apache-2.0, about 213 MB) into Zenvi's cache")
    .action(async () => {
      const status = await host().setup!();
      if (!status.ready) throw new CliError(status.detail, 1);
      ctx.out.info(`Shot model ready: ${status.detail}`);
    });
}
