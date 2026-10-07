/**
 * Show a project in the Zenvi desktop app: shared by `zenvi open` and the
 * MCP `launch_editor` tool.
 */

import type { ZenviConfig } from "../config.js";
import { CliError } from "../output.js";
import { DesktopClient } from "./client.js";
import { discoverDesktop, hasProjectOpen } from "./discovery.js";
import { defaultLauncherDeps, findDesktopApp, focusDesktopApp, launchDesktopApp, type DesktopApp, type LauncherDeps } from "./launcher.js";

export interface OpenResult {
  /** focused: already showing it; loaded: running app switched to it; launched: app started. */
  method: "focused" | "loaded" | "launched";
  project?: string;
  app?: DesktopApp;
  command?: { command: string; args: string[] };
  summary: string;
}

export interface OpenOptions {
  config: ZenviConfig;
  project?: string;
  deps?: LauncherDeps;
  clientVersion?: string;
}

export const DOWNLOAD_URL = "https://zenvi.pro/download";

export async function openInDesktop(options: OpenOptions): Promise<OpenResult> {
  const deps = options.deps ?? defaultLauncherDeps();
  const project = options.project;
  const live = (await discoverDesktop(options.config)).filter((e) => e.kind === "gui");
  const app = await findDesktopApp(deps).catch(() => undefined);

  if (live.length > 0) {
    const gui = live[0]!;
    if (!project || (await hasProjectOpen(gui, project))) {
      await focusDesktopApp(app, deps);
      return { method: "focused", project, app, summary: project ? `Zenvi already has ${project} open.` : "Brought Zenvi to the front." };
    }
    const client = new DesktopClient(gui, options.clientVersion);
    try {
      const result = await client.callTool("open_project_tool", { file_path: project });
      if (result.isError) throw new CliError(`Zenvi could not open the project: ${(result.receipt?.summary ?? result.text).replace(/^Error:\s*/, "")}`);
    } finally {
      await client.close();
    }
    await focusDesktopApp(app, deps);
    return { method: "loaded", project, app, summary: `Opened ${project} in the running Zenvi app.` };
  }

  if (!app) {
    throw new CliError("The Zenvi desktop app is not installed on this machine.", 1, `Get it at ${DOWNLOAD_URL}, set ZENVI_DESKTOP_CMD for a dev checkout, or use \`zenvi open --web\`.`);
  }
  const command = await launchDesktopApp(app, project, deps);
  return { method: "launched", project, app, command, summary: project ? `Started Zenvi on ${project}.` : "Started Zenvi." };
}
