/**
 * Render jobs: records in the `renders` table (PK user id, RK render id), an
 * in-process queue with concurrency 1, and a worker that downloads the media a
 * project uses into a temp dir, calls the renderer and uploads the result to
 * `u/{user}/p/{project}/renders/{render}.{ext}`.
 *
 * The project is snapshotted when the job is created, so the render shows
 * exactly the revision that was asked for even if editing continues. Asking
 * again for the same revision and options returns the existing job
 * (idempotent: remote MCP hosts retry slow calls).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { type ExportOptions, type Project, serializeProject } from "@zenvi/engine";
import { AlreadyExistsError, ApiError, notFound, PreconditionFailedError } from "../http/errors.js";
import type { Logger } from "../http/log.js";
import { errorMessage } from "../http/log.js";
import type { BlobStore, Stored, TableEntity, TableStore } from "../storage/types.js";
import type { Clock } from "../util/clock.js";
import { isoAt } from "../util/clock.js";
import { randomId, sha256Hex } from "../util/crypto.js";
import { displayName, fileSha256 } from "../projects/model.js";
import type { MediaService } from "../services/media.js";
import { attachmentDisposition } from "../services/media.js";
import { renderPath, renderSnapshotPath } from "../services/paths.js";
import type { LoadedProject, ProjectService } from "../services/projects.js";
import { CONTENT_TYPES, type PresetName, type RenderFormat, type RenderOverrides, resolveRenderOptions } from "./options.js";
import type { PathResolver, Renderer } from "./renderer.js";
import { projectPathResolver } from "./resolve.js";

export type RenderStatus = "queued" | "running" | "done" | "error";

export interface RenderJob {
  renderId: string;
  projectId: string;
  status: RenderStatus;
  /** 0..1 */
  progress: number;
  format: RenderFormat;
  options: ExportOptions;
  revision: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  bytes?: number;
  error?: string;
  fileName: string;
}

export interface RenderJobView extends RenderJob {
  url?: string;
  urlExpiresAt?: string;
}

interface RenderRow extends TableEntity {
  projectId: string;
  status: RenderStatus;
  progress: number;
  format: string;
  options: string;
  revision: string;
  requestKey: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  bytes?: number;
  error?: string;
  fileName: string;
  attempts: number;
  /** Refreshed while a worker renders; a stale one means the worker died. */
  heartbeatAt?: string;
}

/**
 * Idempotency key row (same partition as the user's jobs): which job renders
 * a (project, revision, options) combination. Carries no `status` or
 * `projectId`, so job queries never see it.
 */
interface KeyRow extends TableEntity {
  renderId: string;
  claimedAt: string;
}

const TABLE = "renders" as const;
/** How long a claimed key may wait for its job row before another request takes it over. */
const CLAIM_GRACE_MS = 30_000;
const MAX_ATTEMPTS = 2;
const HEARTBEAT_MS = 15_000;
/** A running job whose heartbeat is older than this is re-queued by `recover`. */
const STALE_MS = 60_000;
const REUSE_DONE_MS = 24 * 3_600_000;
const PROGRESS_WRITE_MS = 2_000;
const URL_SECONDS = 3600;

function toJob(row: RenderRow): RenderJob {
  let options: ExportOptions;
  try {
    options = JSON.parse(row.options) as ExportOptions;
  } catch {
    options = { format: row.format as RenderFormat, width: 0, height: 0, fps: { num: 0, den: 1 } };
  }
  return {
    renderId: row.rowKey,
    projectId: row.projectId,
    status: row.status,
    progress: typeof row.progress === "number" ? row.progress : 0,
    format: row.format as RenderFormat,
    options,
    revision: row.revision,
    createdAt: row.createdAt,
    startedAt: row.startedAt ?? undefined,
    finishedAt: row.finishedAt ?? undefined,
    bytes: typeof row.bytes === "number" ? row.bytes : undefined,
    error: row.error ?? undefined,
    fileName: row.fileName,
  };
}

function safeFileBase(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "_").trim().slice(0, 100) || "render";
}

function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return match ? `.${match[1]!.toLowerCase()}` : "";
}

export interface RenderServiceOptions {
  tables: TableStore;
  blobs: BlobStore;
  projects: ProjectService;
  media: MediaService;
  renderer: Renderer;
  clock: Clock;
  log: Logger;
  tmpDir: string;
  maxRenderMediaBytes: number;
  /** Built-in assets (`@transitions/…`) on disk, when this build ships them. */
  resolveAsset?: (projectPath: string) => string | undefined;
}

export class RenderService {
  private readonly queue: { userId: string; renderId: string }[] = [];
  /** Jobs in this process's queue or running here (`user/render`). */
  private readonly local = new Set<string>();
  private running: { userId: string; renderId: string; controller: AbortController } | null = null;
  private idle: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly options: RenderServiceOptions) {}

  get rendererAvailable(): boolean {
    return this.options.renderer.available;
  }

  /**
   * Start a render, or return the job already rendering (or rendered, within
   * a day) this project revision with these options. Idempotent under
   * concurrency: the (project, revision, options) key is claimed with an
   * insert-if-absent row, so simultaneous retries get the same job.
   */
  async start(userId: string, projectId: string, input: { preset?: PresetName; options?: RenderOverrides }): Promise<RenderJob> {
    const loaded = await this.options.projects.get(userId, projectId);
    const options = resolveRenderOptions(loaded.project, input.preset, input.options ?? {});
    const requestKey = sha256Hex(`${loaded.revision}\n${JSON.stringify(options)}`).slice(0, 32);
    const keyRowKey = `key:${projectId}:${requestKey}`;

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const now = this.options.clock.now();
      const key = await this.options.tables.get<KeyRow>(TABLE, userId, keyRowKey);
      if (!key) {
        const renderId = randomId("r_", 16);
        try {
          await this.options.tables.create<KeyRow>(TABLE, { partitionKey: userId, rowKey: keyRowKey, renderId, claimedAt: isoAt(now) });
        } catch (error) {
          if (error instanceof AlreadyExistsError) continue; // another request won the key: use its job
          throw error;
        }
        return this.createJob(userId, projectId, renderId, loaded, options, requestKey);
      }
      const existing = await this.options.tables.get<RenderRow>(TABLE, userId, key.renderId);
      if (existing && (await this.reusable(userId, existing, now))) return toJob(existing);
      if (!existing && now - Date.parse(key.claimedAt) < CLAIM_GRACE_MS) {
        // The winner is still writing its job row.
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      // The keyed job failed, expired or never got written: replace it, if nobody else did first.
      const renderId = randomId("r_", 16);
      try {
        await this.options.tables.update<KeyRow>(
          TABLE,
          { partitionKey: userId, rowKey: keyRowKey, renderId, claimedAt: isoAt(now) },
          { etag: key.etag, mode: "replace" },
        );
      } catch (error) {
        if (error instanceof PreconditionFailedError) continue;
        throw error;
      }
      return this.createJob(userId, projectId, renderId, loaded, options, requestKey);
    }
    throw new ApiError(503, "busy", "Could not start the render; try again.");
  }

  private async reusable(userId: string, row: Stored<RenderRow>, now: number): Promise<boolean> {
    if (row.status === "queued" || row.status === "running") return true;
    if (row.status === "done" && row.finishedAt && now - Date.parse(row.finishedAt) < REUSE_DONE_MS) {
      return (await this.options.blobs.head(renderPath(userId, row.projectId, row.rowKey, row.format))) !== null;
    }
    return false;
  }

  private async createJob(
    userId: string,
    projectId: string,
    renderId: string,
    loaded: LoadedProject,
    options: ExportOptions,
    requestKey: string,
  ): Promise<RenderJob> {
    await this.options.blobs.write(renderSnapshotPath(userId, projectId, renderId), serializeProject(loaded.project), {
      contentType: "application/json",
    });
    const row: RenderRow = {
      partitionKey: userId,
      rowKey: renderId,
      projectId,
      status: "queued",
      progress: 0,
      format: options.format,
      options: JSON.stringify(options),
      revision: loaded.revision,
      requestKey,
      createdAt: isoAt(this.options.clock.now()),
      fileName: `${safeFileBase(loaded.meta.name)}.${options.format}`,
      attempts: 0,
    };
    await this.options.tables.create(TABLE, row);
    this.options.media.invalidateUsage(userId);
    this.enqueue(userId, renderId);
    return toJob(row);
  }

  async get(userId: string, projectId: string, renderId: string): Promise<RenderJobView> {
    const row = await this.options.tables.get<RenderRow>(TABLE, userId, renderId);
    if (!row || row.projectId !== projectId) throw notFound("Render");
    return this.view(userId, row);
  }

  /** A job by id alone (MCP `get_render_status`); still scoped to the user. */
  async getById(userId: string, renderId: string): Promise<RenderJobView> {
    const row = await this.options.tables.get<RenderRow>(TABLE, userId, renderId);
    if (!row) throw notFound("Render");
    return this.view(userId, row);
  }

  async list(userId: string, projectId: string): Promise<RenderJob[]> {
    const jobs: RenderJob[] = [];
    for await (const row of this.options.tables.query<RenderRow>(TABLE, { partitionKey: userId, where: [["projectId", "eq", projectId]] })) {
      jobs.push(toJob(row));
    }
    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  }

  /** Wait until the job finishes or `timeoutMs` passes; returns its latest state. */
  async waitFor(userId: string, renderId: string, timeoutMs: number, signal?: AbortSignal): Promise<RenderJobView> {
    const deadline = this.options.clock.now() + timeoutMs;
    for (;;) {
      const job = await this.getById(userId, renderId);
      if (job.status === "done" || job.status === "error") return job;
      if (this.options.clock.now() >= deadline || signal?.aborted) return job;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  /**
   * Pick up jobs no live worker owns: queued ones, and running ones whose
   * heartbeat stopped (the process died or restarted). Call at startup and
   * periodically; a second instance during a deploy leaves jobs with a fresh
   * heartbeat alone, and claims are ETag-checked, so a job never runs twice.
   */
  async recover(): Promise<number> {
    const now = this.options.clock.now();
    const pending: Stored<RenderRow>[] = [];
    for (const status of ["running", "queued"] as const) {
      for await (const row of this.options.tables.query<RenderRow>(TABLE, { where: [["status", "eq", status]] })) pending.push(row);
    }
    pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let picked = 0;
    for (const row of pending) {
      if (this.local.has(`${row.partitionKey}/${row.rowKey}`)) continue;
      if (row.status === "running") {
        const beat = Date.parse(row.heartbeatAt ?? row.startedAt ?? row.createdAt);
        if (now - beat < STALE_MS) continue;
        if (row.attempts >= MAX_ATTEMPTS) {
          await this.finish(row.partitionKey, row.rowKey, { status: "error", error: "The render was interrupted twice; start it again." });
          continue;
        }
        try {
          await this.options.tables.update<RenderRow>(TABLE, { ...row, status: "queued", progress: 0 }, { etag: row.etag, mode: "replace" });
        } catch (error) {
          if (error instanceof PreconditionFailedError) continue;
          throw error;
        }
      }
      this.enqueue(row.partitionKey, row.rowKey);
      picked += 1;
    }
    return picked;
  }

  /** Stop taking jobs and abort the running one (it resumes after restart). */
  async stop(): Promise<void> {
    this.stopped = true;
    this.running?.controller.abort(new Error("service shutting down"));
    await this.idle;
  }

  /** Resolves when the queue is empty (tests). */
  async drain(): Promise<void> {
    while ((this.running || this.queue.length > 0) && !this.stopped) await this.idle;
  }

  private enqueue(userId: string, renderId: string): void {
    const key = `${userId}/${renderId}`;
    if (this.local.has(key)) return;
    this.local.add(key);
    this.queue.push({ userId, renderId });
    if (!this.running) this.idle = this.pump();
  }

  private async pump(): Promise<void> {
    while (!this.stopped) {
      const next = this.queue.shift();
      if (!next) return;
      const controller = new AbortController();
      this.running = { ...next, controller };
      try {
        await this.run(next.userId, next.renderId, controller.signal);
      } catch (error) {
        this.options.log.error("render worker failed", { renderId: next.renderId, error: errorMessage(error) });
      } finally {
        this.running = null;
        this.local.delete(`${next.userId}/${next.renderId}`);
      }
    }
  }

  private async run(userId: string, renderId: string, signal: AbortSignal): Promise<void> {
    const row = await this.options.tables.get<RenderRow>(TABLE, userId, renderId);
    if (!row || row.status !== "queued") return;
    const job = toJob(row);
    const claimedAt = isoAt(this.options.clock.now());
    try {
      // Claim: only one worker (even across instances) moves it to running.
      await this.options.tables.update<RenderRow>(
        TABLE,
        { ...row, status: "running", startedAt: claimedAt, heartbeatAt: claimedAt, attempts: (row.attempts ?? 0) + 1, progress: 0 },
        { etag: row.etag, mode: "replace" },
      );
    } catch (error) {
      if (error instanceof PreconditionFailedError) return;
      throw error;
    }
    const heartbeat = setInterval(() => {
      void this.options.tables
        .update<RenderRow>(TABLE, { partitionKey: userId, rowKey: renderId, heartbeatAt: isoAt(this.options.clock.now()) } as RenderRow)
        .catch(() => undefined);
    }, HEARTBEAT_MS);
    heartbeat.unref();

    const tmp = await mkdtemp(join(this.options.tmpDir, "zenvi-render-"));
    const started = this.options.clock.now();
    try {
      const snapshot = await this.options.blobs.read(renderSnapshotPath(userId, job.projectId, renderId));
      if (!snapshot) throw new Error("The project snapshot for this render is missing.");
      const project = JSON.parse(snapshot.data.toString("utf8")) as Project;
      const resolveMedia = await this.mediaResolver(userId, project, tmp, signal);
      let lastWrite = 0;
      const output = join(tmp, `output.${job.format}`);
      await this.options.renderer.render({
        project,
        resolveMedia,
        output,
        options: job.options,
        signal,
        onProgress: (fraction) => {
          const now = this.options.clock.now();
          if (now - lastWrite < PROGRESS_WRITE_MS) return;
          lastWrite = now;
          const progress = Math.max(0, Math.min(0.99, fraction));
          void this.options.tables
            .update<RenderRow>(TABLE, { partitionKey: userId, rowKey: renderId, progress, heartbeatAt: isoAt(now) } as RenderRow)
            .catch(() => undefined);
        },
      });
      const { size } = await this.options.blobs.writeFile(renderPath(userId, job.projectId, renderId, job.format), output, {
        contentType: CONTENT_TYPES[job.format],
        contentDisposition: attachmentDisposition(job.fileName),
      });
      this.options.media.invalidateUsage(userId);
      await this.finish(userId, renderId, { status: "done", bytes: size });
      this.options.log.info("render done", { renderId, ms: this.options.clock.now() - started, bytes: size });
    } catch (error) {
      if (signal.aborted && this.stopped) {
        this.options.log.warn("render interrupted by shutdown", { renderId });
        return;
      }
      const message = errorMessage(error).slice(0, 500);
      await this.finish(userId, renderId, { status: "error", error: message });
      this.options.log.warn("render failed", { renderId, error: message });
    } finally {
      clearInterval(heartbeat);
      await rm(tmp, { recursive: true, force: true });
    }
  }

  /**
   * A resolver that downloads each media file once, on first use. Refuses
   * files that are not in Zenvi Cloud and projects whose clip media together
   * exceed the render media cap.
   */
  private async mediaResolver(userId: string, project: Project, tmp: string, signal: AbortSignal): Promise<PathResolver> {
    const inventory = await this.options.media.inventory(userId);
    const used = new Set(project.clips.map((clip) => clip.file_id));
    let total = 0;
    for (const file of project.files) {
      if (!used.has(file.id)) continue;
      const sha = fileSha256(file);
      const info = sha ? inventory.get(sha) : undefined;
      if (!sha || !info) {
        throw new ApiError(409, "media_missing", `"${displayName(file)}" is not in Zenvi Cloud yet. Upload it, then render again.`);
      }
      total += info.size;
    }
    if (total > this.options.maxRenderMediaBytes) {
      throw new Error(`This project uses ${Math.round(total / 1024 ** 3)} GB of media; cloud renders are limited to ${Math.round(this.options.maxRenderMediaBytes / 1024 ** 3)} GB.`);
    }
    const downloads = new Map<string, Promise<string>>();
    return projectPathResolver(project, {
      resolveAsset: this.options.resolveAsset,
      fetchFile: async (file, sha) => {
        signal.throwIfAborted();
        if (!inventory.has(sha)) throw new Error(`"${displayName(file)}" is not in Zenvi Cloud.`);
        let pending = downloads.get(sha);
        if (!pending) {
          const target = join(tmp, `${sha}${extensionOf(displayName(file))}`);
          pending = this.options.media.download(userId, sha, target).then(() => target);
          downloads.set(sha, pending);
        }
        return pending;
      },
    });
  }

  private async finish(userId: string, renderId: string, result: { status: "done" | "error"; bytes?: number; error?: string }): Promise<void> {
    await this.options.tables.update<RenderRow>(TABLE, {
      partitionKey: userId,
      rowKey: renderId,
      status: result.status,
      progress: result.status === "done" ? 1 : 0,
      finishedAt: isoAt(this.options.clock.now()),
      bytes: result.bytes,
      error: result.error,
    } as RenderRow);
  }

  private async view(userId: string, row: RenderRow): Promise<RenderJobView> {
    const job = toJob(row);
    if (job.status !== "done") return job;
    const path = renderPath(userId, job.projectId, job.renderId, job.format);
    const url = await this.options.blobs.signUrl(path, {
      permission: "read",
      expiresInSeconds: URL_SECONDS,
      contentType: CONTENT_TYPES[job.format],
      contentDisposition: attachmentDisposition(job.fileName),
    });
    return { ...job, url, urlExpiresAt: isoAt(this.options.clock.now() + URL_SECONDS * 1000) };
  }
}
