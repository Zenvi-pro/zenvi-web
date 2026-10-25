/**
 * AI video jobs for the remote MCP server. Kling takes longer than ChatGPT's
 * tool-call budget, so `generate_video` records a job and returns at once.
 * The worker calls api.zenvi.pro, imports the file and places a clip. Asking
 * again for the same project revision and prompt returns the same job.
 */

import { addClip, addFile, ProjectDocument, type Project } from "@zenvi/engine";
import { AlreadyExistsError, ApiError, notFound, PreconditionFailedError } from "../http/errors.js";
import type { Logger } from "../http/log.js";
import { errorMessage } from "../http/log.js";
import type { TableEntity, TableStore } from "../storage/types.js";
import type { Clock } from "../util/clock.js";
import { isoAt } from "../util/clock.js";
import { randomId, sha256Hex } from "../util/crypto.js";
import type { BackendSessions } from "../auth/backend-session.js";
import type { MediaImporter } from "../services/importer.js";
import type { ProjectService } from "../services/projects.js";

const TABLE = "generations" as const;
const CLAIM_GRACE_MS = 15_000;
const STALE_MS = 3 * 60_000;
const MAX_ATTEMPTS = 2;
const BACKEND_TIMEOUT_MS = 8 * 60_000;

export type GenerationStatus = "queued" | "running" | "done" | "error";

export interface GenerationJob {
  generationId: string;
  projectId: string;
  status: GenerationStatus;
  prompt: string;
  durationSeconds: number;
  fileId?: string;
  clipId?: string;
  error?: string;
}

interface JobRow extends TableEntity {
  projectId: string;
  status: GenerationStatus;
  prompt: string;
  durationSeconds: number;
  width: number;
  height: number;
  positionSeconds?: number;
  layer?: number;
  requestKey: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  heartbeatAt?: string;
  attempts: number;
  fileId?: string;
  clipId?: string;
  error?: string;
}

interface KeyRow extends TableEntity {
  generationId: string;
  claimedAt: string;
}

export interface GenerationServiceOptions {
  tables: TableStore;
  projects: ProjectService;
  importer: MediaImporter;
  sessions: BackendSessions;
  clock: Clock;
  log: Logger;
}

export class GenerationService {
  private readonly queue: { userId: string; generationId: string }[] = [];
  private readonly local = new Set<string>();
  private running: { userId: string; generationId: string; controller: AbortController } | null = null;
  private idle: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly options: GenerationServiceOptions) {}

  async start(
    userId: string,
    projectId: string,
    input: { prompt: string; durationSeconds: number; width: number; height: number; positionSeconds?: number; layer?: number },
  ): Promise<GenerationJob> {
    const loaded = await this.options.projects.get(userId, projectId);
    const requestKey = sha256Hex(
      [loaded.revision, input.prompt, input.durationSeconds, input.width, input.height, input.positionSeconds ?? "", input.layer ?? ""].join("\n"),
    ).slice(0, 32);
    const keyRowKey = `key:${requestKey}`;

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const now = this.options.clock.now();
      const key = await this.options.tables.get<KeyRow>(TABLE, userId, keyRowKey);
      if (!key) {
        const generationId = randomId("g_", 16);
        try {
          await this.options.tables.create<KeyRow>(TABLE, { partitionKey: userId, rowKey: keyRowKey, generationId, claimedAt: isoAt(now) });
        } catch (error) {
          if (error instanceof AlreadyExistsError) continue;
          throw error;
        }
        return this.createJob(userId, projectId, generationId, input, requestKey);
      }
      const existing = await this.options.tables.get<JobRow>(TABLE, userId, key.generationId);
      if (existing && reusable(existing, now)) return toJob(existing);
      if (!existing && now - Date.parse(key.claimedAt) < CLAIM_GRACE_MS) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      const generationId = randomId("g_", 16);
      try {
        await this.options.tables.update<KeyRow>(
          TABLE,
          { partitionKey: userId, rowKey: keyRowKey, generationId, claimedAt: isoAt(now) },
          { etag: key.etag, mode: "replace" },
        );
      } catch (error) {
        if (error instanceof PreconditionFailedError) continue;
        throw error;
      }
      return this.createJob(userId, projectId, generationId, input, requestKey);
    }
    throw new ApiError(503, "busy", "Could not start video generation; try again.");
  }

  async getById(userId: string, generationId: string): Promise<GenerationJob> {
    const row = await this.options.tables.get<JobRow>(TABLE, userId, generationId);
    if (!row || !row.projectId) throw notFound("Generation");
    return toJob(row);
  }

  async waitFor(userId: string, generationId: string, timeoutMs: number, signal?: AbortSignal): Promise<GenerationJob> {
    const deadline = this.options.clock.now() + timeoutMs;
    for (;;) {
      const job = await this.getById(userId, generationId);
      if (job.status === "done" || job.status === "error") return job;
      if (this.options.clock.now() >= deadline || signal?.aborted) return job;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  async recover(): Promise<number> {
    const now = this.options.clock.now();
    const pending: { userId: string; row: JobRow & { etag: string } }[] = [];
    for (const status of ["running", "queued"] as const) {
      for await (const row of this.options.tables.query<JobRow>(TABLE, { where: [["status", "eq", status]] })) {
        pending.push({ userId: row.partitionKey, row });
      }
    }
    pending.sort((a, b) => a.row.createdAt.localeCompare(b.row.createdAt));
    let picked = 0;
    for (const { userId, row } of pending) {
      if (this.local.has(`${userId}/${row.rowKey}`)) continue;
      if (row.status === "running") {
        const beat = Date.parse(row.heartbeatAt ?? row.startedAt ?? row.createdAt);
        if (now - beat < STALE_MS) continue;
        if ((row.attempts ?? 0) >= MAX_ATTEMPTS) {
          await this.finish(userId, row.rowKey, { status: "error", error: "Video generation was interrupted. Start it again." });
          continue;
        }
        try {
          await this.options.tables.update<JobRow>(TABLE, { ...row, status: "queued" }, { etag: row.etag, mode: "replace" });
        } catch (error) {
          if (error instanceof PreconditionFailedError) continue;
          throw error;
        }
      }
      this.enqueue(userId, row.rowKey);
      picked += 1;
    }
    return picked;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.running?.controller.abort(new Error("service shutting down"));
    await this.idle;
  }

  async drain(): Promise<void> {
    while ((this.running || this.queue.length > 0) && !this.stopped) await this.idle;
  }

  private async createJob(
    userId: string,
    projectId: string,
    generationId: string,
    input: { prompt: string; durationSeconds: number; width: number; height: number; positionSeconds?: number; layer?: number },
    requestKey: string,
  ): Promise<GenerationJob> {
    const row: JobRow = {
      partitionKey: userId,
      rowKey: generationId,
      projectId,
      status: "queued",
      prompt: input.prompt,
      durationSeconds: input.durationSeconds,
      width: input.width,
      height: input.height,
      ...(input.positionSeconds !== undefined ? { positionSeconds: input.positionSeconds } : {}),
      ...(input.layer !== undefined ? { layer: input.layer } : {}),
      requestKey,
      createdAt: isoAt(this.options.clock.now()),
      attempts: 0,
    };
    await this.options.tables.create(TABLE, row);
    this.enqueue(userId, generationId);
    return toJob(row);
  }

  private enqueue(userId: string, generationId: string): void {
    const key = `${userId}/${generationId}`;
    if (this.local.has(key)) return;
    this.local.add(key);
    this.queue.push({ userId, generationId });
    if (!this.running) this.idle = this.pump();
  }

  private async pump(): Promise<void> {
    while (!this.stopped) {
      const next = this.queue.shift();
      if (!next) return;
      const controller = new AbortController();
      this.running = { ...next, controller };
      try {
        await this.run(next.userId, next.generationId, controller.signal);
      } catch (error) {
        this.options.log.error("generation worker failed", { generationId: next.generationId, error: errorMessage(error) });
      } finally {
        this.running = null;
        this.local.delete(`${next.userId}/${next.generationId}`);
      }
    }
  }

  private async run(userId: string, generationId: string, signal: AbortSignal): Promise<void> {
    const row = await this.options.tables.get<JobRow>(TABLE, userId, generationId);
    if (!row || row.status !== "queued") return;
    const claimedAt = isoAt(this.options.clock.now());
    try {
      await this.options.tables.update<JobRow>(
        TABLE,
        { ...row, status: "running", startedAt: claimedAt, heartbeatAt: claimedAt, attempts: (row.attempts ?? 0) + 1 },
        { etag: row.etag, mode: "replace" },
      );
    } catch (error) {
      if (error instanceof PreconditionFailedError) return;
      throw error;
    }
    const heartbeat = setInterval(() => {
      void this.options.tables
        .update<JobRow>(TABLE, { partitionKey: userId, rowKey: generationId, heartbeatAt: isoAt(this.options.clock.now()) } as JobRow)
        .catch(() => undefined);
    }, 15_000);
    heartbeat.unref?.();

    try {
      const placed = await this.generate(userId, row, signal);
      await this.finish(userId, generationId, { status: "done", fileId: placed.fileId, clipId: placed.clipId });
    } catch (error) {
      if (signal.aborted) return;
      await this.finish(userId, generationId, { status: "error", error: error instanceof Error ? error.message : String(error) });
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async generate(userId: string, row: JobRow, signal: AbortSignal): Promise<{ fileId: string; clipId: string }> {
    const backend = AbortSignal.timeout(BACKEND_TIMEOUT_MS);
    const live = AbortSignal.any([signal, backend]);
    const data = await this.options.sessions.request<Record<string, unknown>>(userId, "/api/v1/generation/video", {
      method: "POST",
      body: { prompt: row.prompt, duration_seconds: row.durationSeconds, width: row.width, height: row.height, mode: "t2v" },
      signal: live,
    });
    if (typeof data.error === "string" && data.error) throw new Error(data.error);
    const videoUrl = typeof data.video_url === "string" ? data.video_url : "";
    if (!videoUrl) throw new Error("No video URL returned from generation.");
    const media = await this.options.importer.importUrl(userId, videoUrl, { filename: "generated.mp4", signal: live });
    return this.place(userId, row, media);
  }

  private async place(userId: string, row: JobRow, media: Parameters<typeof addFile>[1]): Promise<{ fileId: string; clipId: string }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const loaded = await this.options.projects.get(userId, row.projectId);
      const doc = new ProjectDocument(loaded.project);
      const placed = doc.transaction("Generate video", (tx) => {
        const file = addFile(tx, media, { dedupe: true });
        tx.update(["files", { id: file.id }], {
          ai_metadata: { prompt: Array.from(row.prompt).slice(0, 500).join(""), source: "kling_t2v" },
        });
        const position = row.positionSeconds ?? timelineEnd(tx.project);
        const layer = row.layer ?? defaultLayer(tx.project);
        const clip = addClip(tx, { fileId: String(file.id), position, layer, title: "Generated video" });
        return { fileId: String(file.id), clipId: String(clip.id) };
      });
      try {
        await this.options.projects.save(userId, row.projectId, doc.toJSON(), loaded.revision);
        return placed;
      } catch (error) {
        if (error instanceof ApiError && error.code === "revision_conflict") continue;
        throw error;
      }
    }
    throw new Error("The project kept changing while the generated video was being added. Try again.");
  }

  private async finish(
    userId: string,
    generationId: string,
    result: { status: "done" | "error"; fileId?: string; clipId?: string; error?: string },
  ): Promise<void> {
    await this.options.tables.update<JobRow>(TABLE, {
      partitionKey: userId,
      rowKey: generationId,
      status: result.status,
      finishedAt: isoAt(this.options.clock.now()),
      ...(result.fileId ? { fileId: result.fileId } : {}),
      ...(result.clipId ? { clipId: result.clipId } : {}),
      ...(result.error ? { error: result.error.slice(0, 500) } : {}),
    } as JobRow);
  }
}

function reusable(row: JobRow, now: number): boolean {
  if (row.status === "queued" || row.status === "running") return true;
  if (row.status === "done" && row.finishedAt && now - Date.parse(row.finishedAt) < 24 * 3600_000) return true;
  return false;
}

function toJob(row: JobRow): GenerationJob {
  return {
    generationId: row.rowKey,
    projectId: row.projectId,
    status: row.status,
    prompt: row.prompt,
    durationSeconds: row.durationSeconds,
    ...(row.fileId ? { fileId: row.fileId } : {}),
    ...(row.clipId ? { clipId: row.clipId } : {}),
    ...(row.error ? { error: row.error } : {}),
  };
}

function timelineEnd(project: Project): number {
  let end = 0;
  for (const clip of project.clips ?? []) {
    const position = Number(clip.position) || 0;
    const start = Number(clip.start) || 0;
    const clipEnd = Number(clip.end) || 0;
    end = Math.max(end, position + Math.max(0, clipEnd - start));
  }
  return end;
}

function defaultLayer(project: Project): number {
  const numbers = (project.layers ?? []).map((layer) => Number(layer.number)).filter((n) => Number.isInteger(n) && n > 0);
  return numbers.length > 0 ? Math.min(...numbers) : 1;
}

/** Kling O1 Pro durations: 5 s unless 10 s is clearly asked for (>= 8). */
export function snapKlingDuration(duration: number | undefined): number {
  if (duration === undefined || !Number.isFinite(duration)) return 5;
  return Math.max(1, Math.min(10, duration)) >= 8 ? 10 : 5;
}

/** Text-to-video size from the project aspect. */
export function t2vDims(width: number, height: number): [number, number] {
  const aspect = (width || 1920) / Math.max(height || 1080, 1);
  if (aspect > 1.2) return [1920, 1080];
  if (aspect < 0.8) return [1080, 1920];
  return [1440, 1440];
}
