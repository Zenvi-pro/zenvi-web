/**
 * Per-server state for `zenvi mcp`: the current project session (untitled in
 * memory until a file is chosen), the desktop attachment decision (re-checked
 * on every call, so edits go through the desktop app while it has the same
 * project open), and the host registry (desktop, portable engine, After
 * Effects, Premiere Pro) with what this session last used.
 */

import type { Project } from "@zenvi/engine";
import type { CommandContext } from "../commands/context.js";
import { hostOptions } from "../commands/context.js";
import { newProject } from "../commands/project.js";
import { DesktopClient } from "../desktop/client.js";
import { discoverDesktop, hasProjectOpen } from "../desktop/discovery.js";
import { defaultLauncherDeps, type LauncherDeps } from "../desktop/launcher.js";
import { DesktopExecutor } from "../engine/executor.js";
import type { DetectDeps } from "../hosts/extension.js";
import { HostRegistry } from "../hosts/registry.js";
import { ProjectSession } from "../project/session.js";
import { VERSION } from "../version.js";

/** How long handoff tools wait for the desktop app to show the project after opening it. */
export const DESKTOP_WAIT_MS = 120_000;

/** While an orchestration waits on a long step, a progress message this often keeps clients from giving up. */
export const KEEP_ALIVE_MS = 15_000;

export interface McpStateOptions {
  /** Finding and starting the desktop app (tests pass fakes). Default: this machine, with the server's environment. */
  launcher?: LauncherDeps;
  /** Default {@link DESKTOP_WAIT_MS}. */
  desktopWaitMs?: number;
  /** File checks for the Adobe listing policy (tests pass fakes). */
  detect?: DetectDeps;
  /** Default {@link KEEP_ALIVE_MS}. */
  keepAliveMs?: number;
}

/** The launcher, with the server's environment (ZENVI_DESKTOP_CMD) and home. */
export function launcherDeps(ctx: CommandContext): LauncherDeps {
  return { ...defaultLauncherDeps(), env: ctx.env, home: ctx.config.home };
}

export class McpState {
  session: ProjectSession;
  readonly hosts: HostRegistry;
  readonly launcher: LauncherDeps;
  readonly desktopWaitMs: number;
  readonly keepAliveMs: number;
  /** When this server last started the desktop app (a second call waits for it instead of starting another). */
  private launchedAt: number | undefined;
  /** The open / launch in flight: concurrent handoffs share it instead of opening the app twice. */
  private opening: Promise<unknown> | undefined;
  private desktop: DesktopExecutor | undefined;
  private desktopKey: string | undefined;
  private lastPortableCall: number | undefined;

  private constructor(
    private readonly ctx: CommandContext,
    session: ProjectSession,
    options: McpStateOptions,
  ) {
    this.session = session;
    this.launcher = options.launcher ?? launcherDeps(ctx);
    this.desktopWaitMs = options.desktopWaitMs ?? DESKTOP_WAIT_MS;
    this.keepAliveMs = options.keepAliveMs ?? KEEP_ALIVE_MS;
    this.hosts = new HostRegistry({
      config: ctx.config,
      env: ctx.env,
      clientVersion: VERSION,
      detect: options.detect,
      portable: () => ({ project: this.session.file ?? null, lastCallAt: this.lastPortableCall }),
    });
  }

  static async create(ctx: CommandContext, projectFile: string | undefined, options: McpStateOptions = {}): Promise<McpState> {
    const sessionOptions = { registry: ctx.registry, host: hostOptions(ctx), surface: "mcp" as const };
    const session = projectFile ? await ProjectSession.open(projectFile, sessionOptions) : ProjectSession.fromProject(newProject(), undefined, sessionOptions);
    return new McpState(ctx, session, options);
  }

  async switchTo(file: string, project?: Project): Promise<void> {
    await this.session.switchTo(file, project);
    await this.dropDesktop();
  }

  /**
   * Run `open` unless one is in flight, and share its result. The check and
   * the registration happen without an await in between, so two calls that
   * arrive together cannot both open (or start) the app.
   */
  openOnce<T>(open: () => Promise<T>): Promise<T> {
    if (!this.opening) {
      const running = open();
      this.opening = running;
      void running.then(
        () => this.opening === running && (this.opening = undefined),
        () => this.opening === running && (this.opening = undefined),
      );
    }
    return this.opening as Promise<T>;
  }

  /** Record that this server started the desktop app. */
  noteLaunch(): void {
    this.launchedAt = Date.now();
  }

  /** True while an app this server started may still be coming up. */
  get launchPending(): boolean {
    return this.launchedAt !== undefined && Date.now() - this.launchedAt < this.desktopWaitMs;
  }

  /** The portable engine ran a tool (it counts as activity for list_hosts' active host). */
  notePortableCall(): void {
    this.lastPortableCall = Date.now();
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
        this.hosts.noteDesktopCall(endpoint);
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
    await this.hosts.close();
  }
}
