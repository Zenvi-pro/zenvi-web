/** Project commands: new, info, files, clips, tracks, markers, undo, redo. */

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import * as engine from "@zenvi/engine";
import { findProfile, PROFILES, type Project } from "@zenvi/engine";
import { CliError } from "../output.js";
import { isProjectPath } from "../project/select.js";
import { ProjectSession } from "../project/session.js";
import { hostOptions, runToolCommand, toolArgs, type CommandContext } from "./context.js";

type CreateProject = (opts?: { profile?: string }) => Project;

/** A new empty project (engine `createProject`, the desktop's File ▸ New). */
export function newProject(profile?: string): Project {
  const create = (engine as unknown as { createProject?: CreateProject }).createProject;
  if (!create) throw new CliError("This build's engine cannot create projects (createProject is not exported).");
  if (profile && !findProfile(profile)) {
    const hint = PROFILES.filter((p) => !p.legacy && p.description.toLowerCase().includes(profile.toLowerCase().split(" ")[0] ?? ""))
      .slice(0, 5)
      .map((p) => `"${p.description}"`)
      .join(", ");
    throw new CliError(`Unknown profile "${profile}".`, 2, hint ? `Try ${hint}.` : "Run `zenvi new --profile list` to see them.");
  }
  return create(profile ? { profile } : {});
}

export function registerProjectCommands(program: Command, ctx: CommandContext): void {
  program
    .command("new")
    .description("create an empty project (.zvn); the file is [file], else -p/ZENVI_PROJECT, else ./untitled.zvn")
    .argument("[file]", "project file to create")
    .option("--profile <profile>", 'video profile, e.g. "HD 1080p 30 fps" (`list` prints them)')
    .option("-f, --force", "overwrite an existing file")
    .action(async (positional: string | undefined, opts: { profile?: string; force?: boolean }) => {
      if (opts.profile === "list") {
        const current = PROFILES.filter((p) => !p.legacy);
        if (ctx.out.json) ctx.out.data({ profiles: current.map((p) => ({ key: p.key, description: p.description, width: p.width, height: p.height, fps: p.fps })) });
        else ctx.out.table(["profile", "size", "fps"], current.map((p) => [p.description, `${p.width}x${p.height}`, (p.fps.num / p.fps.den).toFixed(3).replace(/\.?0+$/, "")]));
        return;
      }
      const named = ctx.flags().project ?? ctx.env.ZENVI_PROJECT?.trim() ?? undefined;
      const asFile = (value: string) => path.resolve(ctx.cwd, isProjectPath(value) ? value : `${value}.zvn`);
      if (positional && named && asFile(positional) !== asFile(named)) {
        throw new CliError(`Two different project files given: ${asFile(positional)} and ${asFile(named)} (-p/ZENVI_PROJECT).`, 2, "Pass only one.");
      }
      const file = asFile(positional ?? named ?? "untitled.zvn");
      if (existsSync(file) && !opts.force) throw new CliError(`${file} already exists.`, 1, "Pass --force to replace it.");
      const project = newProject(opts.profile);
      await mkdir(path.dirname(file), { recursive: true });
      const session = ProjectSession.fromProject(project, file, { registry: ctx.registry, host: hostOptions(ctx) });
      await session.save();
      const info = { project: file, id: project.id, profile: project.profile, width: project.width, height: project.height, fps: project.fps };
      if (ctx.out.json) ctx.out.data({ status: "applied", summary: `Created ${path.basename(file)}`, engine: "portable", ...info });
      else {
        ctx.out.line(`${ctx.out.style("✓", "green")} Created ${file}`);
        ctx.out.line(ctx.out.style(`  ${project.profile}, ${project.width}x${project.height}`, "dim"));
      }
    });

  program
    .command("info")
    .description("project summary: profile, duration, files, tracks, clips")
    .action(async () => {
      await runToolCommand(ctx, "get_project_info_tool", {});
    });

  program
    .command("files")
    .description("media in the project bin")
    .action(async () => {
      await runToolCommand(ctx, "list_files_tool", {});
    });

  program
    .command("clips")
    .description("clips on the timeline")
    .option("-t, --track <track>", "only this track (number from the bottom, or layer)")
    .action(async (opts: { track?: string }) => {
      await runToolCommand(ctx, "list_clips_tool", toolArgs(ctx, "list_clips_tool", [[["layer", "track"], opts.track]]));
    });

  program
    .command("tracks")
    .description("tracks (layers), bottom to top")
    .action(async () => {
      await runToolCommand(ctx, "list_layers_tool", {});
    });

  program
    .command("markers")
    .description("timeline markers")
    .action(async () => {
      await runToolCommand(ctx, "list_markers_tool", {});
    });

  for (const [name, tool, verb] of [
    ["undo", "undo_tool", "undo"],
    ["redo", "redo_tool", "redo"],
  ] as const) {
    program
      .command(name)
      .description(`${verb} the last edit(s); history is saved in the project, so this works across commands`)
      .argument("[steps]", "how many steps", "1")
      .action(async (steps: string) => {
        await runToolCommand(ctx, tool, { steps });
      });
  }

  program
    .command("save")
    .description("save the project (optionally to a new file)")
    .argument("[file]", "save as this file")
    .action(async (file?: string) => {
      await runToolCommand(ctx, "save_project_tool", file ? { path: path.resolve(ctx.cwd, file) } : {});
    });
}
