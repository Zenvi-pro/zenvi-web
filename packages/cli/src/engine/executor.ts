/**
 * Who runs a tool call: the portable engine on the project file, or a
 * running desktop app that has the same project open (so the desktop's next
 * save cannot overwrite the CLI's edit). Reported as `engine` in `--json`.
 */

import type { Progress } from "@modelcontextprotocol/sdk/types.js";
import type { ToolImage } from "@zenvi/engine";
import { parseReceipt, type ToolReceipt } from "@zenvi/engine/tools";
import type { ZenviConfig } from "../config.js";
import { DesktopClient, type DesktopToolInfo } from "../desktop/client.js";
import { discoverDesktop, hasProjectOpen, type DesktopEndpoint } from "../desktop/discovery.js";
import { CliError } from "../output.js";
import { ProjectSession } from "../project/session.js";
import type { Registry } from "./registry.js";

export type EngineName = "portable" | "desktop";
export type EngineChoice = "auto" | EngineName;

export interface CallOutcome {
  engine: EngineName;
  /** The project file the call worked on, when known. */
  project?: string;
  ok: boolean;
  receipt?: ToolReceipt;
  /** Result text (the receipt JSON, or desktop prose). */
  text: string;
  images: ToolImage[];
  /** Where the portable engine saved the project after a change. */
  savedTo?: string;
}

export interface Executor {
  readonly engine: EngineName;
  readonly project?: string;
  call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallOutcome>;
  close(): Promise<void>;
}

export class PortableExecutor implements Executor {
  readonly engine = "portable" as const;
  constructor(readonly session: ProjectSession) {}

  get project(): string | undefined {
    return this.session.file;
  }

  async call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallOutcome> {
    const { result, savedTo } = await this.session.run(name, args, signal);
    const receipt = (result.data as ToolReceipt | undefined) ?? parseReceipt(result.text) ?? undefined;
    return { engine: "portable", project: this.session.file, ok: result.ok, receipt, text: result.text, images: result.images ?? [], savedTo };
  }

  async close(): Promise<void> {}
}

export class DesktopExecutor implements Executor {
  readonly engine = "desktop" as const;
  private tools: Promise<Map<string, DesktopToolInfo>> | undefined;

  constructor(
    readonly client: DesktopClient,
    readonly project?: string,
  ) {}

  async call(name: string, args: Record<string, unknown>, signal?: AbortSignal, options: { onprogress?: (progress: Progress) => void } = {}): Promise<CallOutcome> {
    const r = await this.client.callTool(name, args, { ...options, ...(signal ? { signal } : {}) });
    return { engine: "desktop", project: this.project ?? this.client.endpoint.project, ok: !r.isError, receipt: r.receipt, text: r.text, images: r.images };
  }

  private listed(): Promise<Map<string, DesktopToolInfo>> {
    this.tools ??= this.client.listTools().then((tools) => new Map(tools.map((t) => [t.name, t])));
    this.tools.catch(() => {
      this.tools = undefined;
    });
    return this.tools;
  }

  /** Whether this desktop build has a tool (its tools/list, read once). */
  async hasTool(name: string): Promise<boolean> {
    return (await this.listed()).has(name);
  }

  /** The tool's input schema as this desktop build publishes it, when it lists its properties. */
  async toolSchema(name: string): Promise<{ properties: Record<string, unknown> } | undefined> {
    const schema = (await this.listed()).get(name)?.inputSchema as { properties?: Record<string, unknown> } | undefined;
    return schema?.properties ? { properties: schema.properties } : undefined;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export interface ChooseOptions {
  config: ZenviConfig;
  registry: Registry;
  choice: EngineChoice;
  /** The project to work on (portable engine requires it to exist unless `session` is given). */
  projectFile?: string;
  /** Build the portable session (so callers control creation and host options). */
  openSession: () => Promise<ProjectSession>;
  clientVersion?: string;
  warn?: (message: string) => void;
}

/** Pick the engine for a command, following the desktop-attach rules. */
export async function chooseExecutor(options: ChooseOptions): Promise<Executor> {
  const { choice, projectFile } = options;
  if (choice === "portable") {
    if (projectFile) {
      const live = await discoverDesktop(options.config);
      for (const endpoint of live) {
        if (await hasProjectOpen(endpoint, projectFile)) {
          options.warn?.(`The Zenvi desktop app has ${projectFile} open; its next save will overwrite changes made here.`);
          break;
        }
      }
    }
    return new PortableExecutor(await options.openSession());
  }

  const live = await discoverDesktop(options.config, { legacy: choice === "desktop", clientVersion: options.clientVersion });
  let target: DesktopEndpoint | undefined;
  if (projectFile) {
    for (const endpoint of live) {
      if (await hasProjectOpen(endpoint, projectFile)) {
        target = endpoint;
        break;
      }
    }
  }
  if (!target && choice === "desktop") {
    const gui = live.find((e) => e.kind !== "headless") ?? live[0];
    if (!gui) {
      throw new CliError("No running Zenvi desktop app was found.", 1, "Start Zenvi (or `zenvi open <project>`), or drop --desktop to edit the file directly.");
    }
    if (projectFile && gui.project && !(await hasProjectOpen(gui, projectFile))) {
      throw new CliError(`The Zenvi desktop app has ${gui.project} open, not ${projectFile}.`, 1, `Run \`zenvi open ${projectFile}\` first, or drop --desktop.`);
    }
    target = gui;
  }
  if (target) return new DesktopExecutor(new DesktopClient(target, options.clientVersion), projectFile ?? target.project);
  return new PortableExecutor(await options.openSession());
}
