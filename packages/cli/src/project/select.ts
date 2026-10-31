/**
 * Which project a command works on: `-p/--project <file.zvn>`, else
 * `ZENVI_PROJECT`, else the only `*.zvn` in the current folder.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { CliError } from "../output.js";

export const PROJECT_EXTENSIONS = [".zvn", ".osp"];

export function isProjectPath(file: string): boolean {
  return PROJECT_EXTENSIONS.includes(path.extname(file).toLowerCase());
}

export interface SelectOptions {
  flag?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

/** The project file, or undefined when none is named and the folder has none. Throws when ambiguous. */
export async function findProject(options: SelectOptions = {}): Promise<string | undefined> {
  const cwd = options.cwd ?? process.cwd();
  const named = options.flag ?? options.env?.ZENVI_PROJECT ?? process.env.ZENVI_PROJECT;
  if (named?.trim()) return path.resolve(cwd, named.trim());
  let names: string[];
  try {
    names = await readdir(cwd);
  } catch {
    return undefined;
  }
  const candidates = names.filter((n) => path.extname(n).toLowerCase() === ".zvn" && !n.startsWith(".")).sort();
  if (candidates.length === 1) return path.join(cwd, candidates[0]!);
  if (candidates.length > 1) {
    // The way out goes in the message itself: scripts and agents often keep only the error line.
    throw new CliError(
      `This folder has ${candidates.length} projects (${candidates.slice(0, 4).join(", ")}${candidates.length > 4 ? ", …" : ""}): ` +
        `name one with -p, e.g. \`zenvi -p ${candidates[0]} <command>\`, or \`export ZENVI_PROJECT=${candidates[0]}\`.`,
      2,
      "-p works before or after the command; a backup copy elsewhere (or not ending in .zvn) stops the question.",
    );
  }
  return undefined;
}

/** Like findProject, but a project is required. */
export async function requireProject(options: SelectOptions = {}): Promise<string> {
  const found = await findProject(options);
  if (!found) {
    throw new CliError("No project given and no .zvn file in this folder.", 2, "Create one with `zenvi new my-edit.zvn`, or pass -p <file.zvn>.");
  }
  return found;
}
