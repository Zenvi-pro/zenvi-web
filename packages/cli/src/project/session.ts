/**
 * One open project: the document, its file, and the Node host the tools
 * use. Shared by one-shot CLI commands and the long-lived MCP server.
 *
 * - Every tool call is one undo step (the engine records it); the session
 *   saves after any call that changed the document, so history persists in
 *   the file and `zenvi undo` works across invocations.
 * - Saves are atomic and happen under the project lock; before each call the
 *   session reloads the file if another process changed it.
 * - `open_project_tool` / save-as switch the session's file, like the
 *   desktop; a tool that starts a new untitled project detaches the session
 *   from the old file so autosave cannot overwrite it.
 */

import path from "node:path";
import type { Project, ToolHost, ToolResult, ToolSurface } from "@zenvi/engine";
import { ProjectDocument } from "@zenvi/engine";
import {
  createNodeHost,
  fileState,
  readProjectFile,
  withProjectLock,
  writeProjectFile,
  type FileState,
  type NodeHost,
  type NodeHostOptions,
} from "@zenvi/render-node";
import type { Registry } from "../engine/registry.js";

export const HISTORY_LIMIT = 50;

export interface SessionOptions {
  registry: Registry;
  /** Surface tool calls run on (`cli` for commands, `mcp` for the MCP server). */
  surface?: ToolSurface;
  /** Host settings (backend, import policy…). `projectFile` is managed by the session. */
  host?: Omit<NodeHostOptions, "projectFile">;
  historyLimit?: number;
}

export interface RunOutcome {
  result: ToolResult;
  /** The document changed (and was saved when the session has a file). */
  changed: boolean;
  /** Where it was saved, if it was. */
  savedTo?: string;
}

function sameState(a: FileState | undefined, b: FileState | undefined): boolean {
  return a?.mtimeMs === b?.mtimeMs && a?.size === b?.size;
}

export class ProjectSession {
  readonly host: NodeHost;
  doc: ProjectDocument;
  private fileValue: string | undefined;
  private diskState: FileState | undefined;
  private openedDuringCall = false;
  private loadEvents = 0;

  private constructor(
    project: Project,
    file: string | undefined,
    private readonly options: SessionOptions,
  ) {
    this.fileValue = file ? path.resolve(file) : undefined;
    this.doc = this.makeDoc(project);
    const base = createNodeHost({ ...options.host, projectFile: () => this.fileValue });
    // Track the desktop's file semantics: open switches files, save-as too.
    const storage = base.storage!;
    this.host = {
      ...base,
      storage: {
        ...storage,
        open: async (p) => {
          const target = path.resolve(this.fileValue ? path.dirname(this.fileValue) : process.cwd(), p);
          const loaded = await storage.open(target);
          this.fileValue = target;
          this.openedDuringCall = true;
          this.diskState = await fileState(target);
          return loaded;
        },
        save: async (project, p) => {
          const target = p ? path.resolve(this.fileValue ? path.dirname(this.fileValue) : process.cwd(), p) : this.fileValue;
          if (!target) return storage.save(project, p);
          const saved = await withProjectLock(target, () => writeProjectFile(target, project, { engineAssetsDir: this.assetsDir() }));
          this.fileValue = saved;
          this.diskState = await fileState(saved);
          return saved;
        },
      },
    };
  }

  private assetsDir(): string | undefined {
    return this.options.host?.engineAssetsDir;
  }

  private makeDoc(project: Project): ProjectDocument {
    const doc = new ProjectDocument(project, { historyLimit: this.options.historyLimit ?? HISTORY_LIMIT });
    doc.subscribe((event) => {
      if (event.source === "load") this.loadEvents += 1;
    });
    return doc;
  }

  /** Open an existing project file. */
  static async open(file: string, options: SessionOptions): Promise<ProjectSession> {
    const abs = path.resolve(file);
    const project = await readProjectFile(abs);
    const session = new ProjectSession(project, abs, options);
    session.diskState = await fileState(abs);
    return session;
  }

  /** A session on `project`, saved to `file` when given (created on first save). */
  static fromProject(project: Project, file: string | undefined, options: SessionOptions): ProjectSession {
    return new ProjectSession(project, file, options);
  }

  get file(): string | undefined {
    return this.fileValue;
  }

  get toolHost(): ToolHost {
    return this.host;
  }

  /** Reload when the file changed on disk since this session last read or wrote it. */
  async reloadIfChanged(): Promise<boolean> {
    if (!this.fileValue) return false;
    const now = await fileState(this.fileValue);
    if (!now || sameState(now, this.diskState)) return false;
    const project = await readProjectFile(this.fileValue);
    this.doc = this.makeDoc(project);
    this.diskState = now;
    return true;
  }

  /** Write the document (history included) to the session's file. */
  async save(target?: string): Promise<string> {
    const file = target ? path.resolve(target) : this.fileValue;
    if (!file) throw new Error("This project has no file yet.");
    await withProjectLock(file, () => writeProjectFile(file, this.doc.toJSON(), { engineAssetsDir: this.assetsDir() }));
    this.fileValue = file;
    this.diskState = await fileState(file);
    return file;
  }

  /** Switch to another project (open it, or create it from `project`). */
  async switchTo(file: string, project?: Project): Promise<void> {
    const abs = path.resolve(file);
    const loaded = project ?? (await readProjectFile(abs));
    this.doc = this.makeDoc(loaded);
    this.fileValue = abs;
    if (project) await this.save(abs);
    else this.diskState = await fileState(abs);
  }

  private queue: Promise<unknown> = Promise.resolve();

  /** Run one tool on the project; saves when it changed the document. Calls run one at a time. */
  run(name: string, args: unknown, signal?: AbortSignal): Promise<RunOutcome> {
    const next = this.queue.then(() => this.runNow(name, args, signal));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async runNow(name: string, args: unknown, signal?: AbortSignal): Promise<RunOutcome> {
    if (this.fileValue) {
      const file = this.fileValue;
      return withProjectLock(file, () => this.runLocked(name, args, signal));
    }
    return this.runLocked(name, args, signal);
  }

  private async runLocked(name: string, args: unknown, signal?: AbortSignal): Promise<RunOutcome> {
    await this.reloadIfChanged();
    const doc = this.doc;
    const before = doc.revision;
    const fileBefore = this.fileValue;
    this.openedDuringCall = false;
    const loadsBefore = this.loadEvents;
    const result = await this.options.registry.run({ doc, host: this.host, signal }, name, args, this.options.surface ?? "cli");
    const changed = doc.revision !== before;
    // A tool loaded a different project into the document (new_project_tool,
    // open_project_tool). Opening already switched files; anything else is a
    // new untitled project that must not overwrite the old file.
    if (this.loadEvents !== loadsBefore && !this.openedDuringCall && this.fileValue === fileBefore) {
      this.fileValue = undefined;
      this.diskState = undefined;
      return { result, changed };
    }
    if (changed && this.fileValue && !this.openedDuringCall) {
      return { result, changed, savedTo: await this.save() };
    }
    return { result, changed };
  }
}
