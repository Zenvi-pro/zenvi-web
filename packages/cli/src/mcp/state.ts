/**
 * Per-server project state for `zenvi mcp`: the current project session
 * (untitled in memory until a file is chosen), and the desktop attachment
 * decision, re-checked on every call so edits go through the desktop app
 * while it has the same project open.
 */

import type { Project } from "@zenvi/engine";
import type { CommandContext } from "../commands/context.js";
import { hostOptions } from "../commands/context.js";
import { newProject } from "../commands/project.js";
import { DesktopClient } from "../desktop/client.js";
import { discoverDesktop, hasProjectOpen } from "../desktop/discovery.js";
import { DesktopExecutor } from "../engine/executor.js";
import { ProjectSession } from "../project/session.js";
import { VERSION } from "../version.js";

export class McpState {
  session: ProjectSession;
  private desktop: DesktopExecutor | undefined;
  private desktopKey: string | undefined;

  private constructor(
    private readonly ctx: CommandContext,
    session: ProjectSession,
  ) {
    this.session = session;
  }

  static async create(ctx: CommandContext, projectFile: string | undefined): Promise<McpState> {
    const options = { registry: ctx.registry, host: hostOptions(ctx) };
    const session = projectFile ? await ProjectSession.open(projectFile, options) : ProjectSession.fromProject(newProject(), undefined, options);
    return new McpState(ctx, session);
  }

  async switchTo(file: string, project?: Project): Promise<void> {
    await this.session.switchTo(file, project);
    await this.dropDesktop();
  }

  /** The desktop app, when it has this session's project open. */
  async desktopExecutor(): Promise<DesktopExecutor | undefined> {
    const file = this.session.file;
    if (!file || this.ctx.env.ZENVI_MCP_ENGINE === "portable") {
      await this.dropDesktop();
      return undefined;
    }
    const live = await discoverDesktop(this.ctx.config);
    for (const endpoint of live) {
      if (await hasProjectOpen(endpoint, file)) {
        const key = `${endpoint.url}\0${endpoint.pid ?? ""}`;
        if (this.desktop && this.desktopKey === key) return this.desktop;
        await this.dropDesktop();
        this.desktop = new DesktopExecutor(new DesktopClient(endpoint, VERSION), file);
        this.desktopKey = key;
        return this.desktop;
      }
    }
    await this.dropDesktop();
    return undefined;
  }

  private async dropDesktop(): Promise<void> {
    const d = this.desktop;
    this.desktop = undefined;
    this.desktopKey = undefined;
    await d?.close();
  }

  async close(): Promise<void> {
    await this.dropDesktop();
  }
}
