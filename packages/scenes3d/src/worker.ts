/**
 * A Blender process kept alive between renders (blender/worker.py reads one
 * JSON command per line). Shaders compiled for one job serve the next, so a
 * draft after the first takes about a second instead of four (measured on
 * an M2 Pro, Blender 5.2 EEVEE: cold job 4.4 s, warm 0.6-1.3 s).
 *
 * Jobs run one at a time. A cancelled or crashed job kills the process; the
 * next job starts a fresh one. The process quits after `idleMs` without
 * work and is replaced after `maxJobs` jobs (Blender leaks a little per
 * scene reset). It never keeps Node alive.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { MIN_BLENDER, versionAtLeast } from "./blender.js";
import { blenderArgs, type BlenderJob } from "./job.js";

const PREFIX = "@@zenvi3d ";

export interface WorkerEvent {
  event: "ready" | "frame" | "done" | "error";
  id?: string | null;
  blender?: string;
  frame?: number;
  frames?: number;
  message?: string;
  trace?: string;
  backdrop?: string | null;
  build_seconds?: number;
  render_seconds?: number;
}

export interface WorkerResult {
  backdrop: string | null;
  blender: string;
  buildSeconds: number;
  renderSeconds: number;
}

export interface BlenderWorkerOptions {
  blender: string;
  scriptsDir: string;
  idleMs?: number;
  maxJobs?: number;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  /** Process factory (tests). */
  spawnProcess?: (command: string, args: string[]) => ChildProcessWithoutNullStreams;
}

/** Parse one stdout line; null for Blender's own output. */
export function parseWorkerLine(line: string): WorkerEvent | null {
  const at = line.indexOf(PREFIX);
  if (at < 0) return null;
  try {
    return JSON.parse(line.slice(at + PREFIX.length)) as WorkerEvent;
  } catch {
    return null;
  }
}

interface Pending {
  id: string;
  onFrame?: (frame: number, frames: number) => void;
  resolve: (result: WorkerResult) => void;
  reject: (error: Error) => void;
}

export class BlenderWorker {
  private child: ChildProcessWithoutNullStreams | undefined;
  private ready: Promise<string> | undefined;
  private version = "";
  private pending: Pending | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private jobs = 0;
  private idle: NodeJS.Timeout | undefined;
  private tail: string[] = [];

  constructor(private readonly options: BlenderWorkerOptions) {}

  /** Render one job; resolves when every frame is written. */
  run(job: BlenderJob, options: { signal?: AbortSignal; onFrame?: (frame: number, frames: number) => void } = {}): Promise<WorkerResult> {
    const next = this.queue.then(() => this.runNow(job, options));
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Stop the process (pending work is rejected). */
  close(): void {
    this.stop(new Error("The Blender worker was closed."));
  }

  private async runNow(job: BlenderJob, options: { signal?: AbortSignal; onFrame?: (frame: number, frames: number) => void }): Promise<WorkerResult> {
    if (options.signal?.aborted) throw new Error("Cancelled.");
    if (this.idle) clearTimeout(this.idle);
    if (this.child && this.jobs >= (this.options.maxJobs ?? 25)) this.stop(undefined);
    const blender = await this.start();
    this.jobs += 1;
    const child = this.child!;
    // Keep Node alive while Blender works for us; an idle worker never does.
    this.hold(child, true);
    const result = new Promise<WorkerResult>((resolve, reject) => {
      this.pending = { id: job.id, onFrame: options.onFrame, resolve, reject };
    });
    const abort = () => this.stop(new Error("Cancelled."));
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdin.write(`${JSON.stringify({ cmd: "render", job })}\n`);
    try {
      const done = await result;
      return { ...done, blender };
    } finally {
      options.signal?.removeEventListener("abort", abort);
      this.pending = undefined;
      this.hold(child, false);
      this.armIdle();
    }
  }

  private start(): Promise<string> {
    if (this.child && this.ready) return this.ready;
    const args = blenderArgs(this.options.scriptsDir);
    const make = this.options.spawnProcess ?? ((command: string, a: string[]) => spawn(command, a, { stdio: ["pipe", "pipe", "pipe"], env: this.options.env ?? process.env }));
    const child = make(this.options.blender, args);
    this.child = child;
    this.jobs = 0;
    this.tail = [];
    this.ready = new Promise<string>((resolve, reject) => {
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        const event = parseWorkerLine(line);
        if (!event) {
          this.keep(line);
          return;
        }
        if (event.event === "ready") {
          this.version = event.blender ?? "";
          if (!versionAtLeast(this.version, MIN_BLENDER)) {
            reject(new Error(`Blender ${this.version} is too old for Zenvi 3D: install Blender ${MIN_BLENDER} or newer.`));
            this.stop(undefined);
            return;
          }
          resolve(this.version);
          return;
        }
        this.handle(event);
      });
      createInterface({ input: child.stderr }).on("line", (line) => this.keep(line));
      child.on("error", (error) => {
        reject(new Error(`Could not start Blender (${this.options.blender}): ${error.message}`));
        this.stop(new Error(`Blender stopped: ${error.message}`));
      });
      child.on("exit", (code, signal) => {
        if (this.child !== child) return;
        const why = `Blender exited (${signal ?? `code ${code}`})${this.tail.length > 0 ? `: ${this.tail.slice(-6).join(" | ")}` : ""}`;
        reject(new Error(why));
        this.child = undefined;
        this.ready = undefined;
        this.pending?.reject(new Error(why));
      });
    });
    return this.ready;
  }

  private hold(child: ChildProcessWithoutNullStreams, on: boolean): void {
    for (const handle of [child, child.stdin, child.stdout, child.stderr] as unknown as { ref?: () => void; unref?: () => void }[]) {
      if (on) handle.ref?.();
      else handle.unref?.();
    }
  }

  private handle(event: WorkerEvent): void {
    const job = this.pending;
    if (!job || (event.id !== undefined && event.id !== null && event.id !== job.id)) return;
    if (event.event === "frame") job.onFrame?.(Number(event.frame) || 0, Number(event.frames) || 0);
    else if (event.event === "done") {
      job.resolve({ backdrop: event.backdrop ?? null, blender: this.version, buildSeconds: Number(event.build_seconds) || 0, renderSeconds: Number(event.render_seconds) || 0 });
    } else if (event.event === "error") {
      this.options.log?.(`zenvi3d: ${event.trace ?? event.message}`);
      job.reject(new Error(event.message ?? "the scene script failed"));
    }
  }

  private keep(line: string): void {
    if (!line.trim() || /^Fra:\d+/.test(line)) return;
    this.tail.push(line.trim());
    if (this.tail.length > 40) this.tail.shift();
  }

  private armIdle(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.stop(undefined), this.options.idleMs ?? 120_000);
    this.idle.unref();
  }

  private stop(reason: Error | undefined): void {
    const child = this.child;
    this.child = undefined;
    this.ready = undefined;
    if (this.idle) clearTimeout(this.idle);
    if (reason) this.pending?.reject(reason);
    if (!child) return;
    try {
      child.stdin.end(`${JSON.stringify({ cmd: "quit" })}\n`);
    } catch {
      // The pipe is gone already.
    }
    child.kill("SIGTERM");
    const hard = setTimeout(() => child.kill("SIGKILL"), 3000);
    hard.unref();
  }
}
