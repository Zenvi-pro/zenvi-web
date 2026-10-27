/**
 * Child-process plumbing shared by probe, decoders and encoders.
 *
 * Every ffmpeg/ffprobe child is registered so it can be killed when the
 * caller aborts, when the owning object is disposed, or when this Node
 * process exits. stderr is kept as a bounded tail so a failure can report what
 * ffmpeg said without buffering hours of progress lines.
 */

import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

const live = new Set<ChildProcess>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", () => {
    for (const child of live) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone: nothing to clean up.
      }
    }
  });
}

/** Number of ffmpeg/ffprobe children currently running (tests assert this drops to 0). */
export function liveChildCount(): number {
  return live.size;
}

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly binary: string,
    readonly args: readonly string[],
    readonly code: number | null,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "FfmpegError";
  }
}

export class BinaryNotFoundError extends Error {
  constructor(readonly binary: string) {
    super(
      `${binary} was not found. Install FFmpeg (https://ffmpeg.org/download.html; macOS: brew install ffmpeg) ` +
        `or set ZENVI_FFMPEG / ZENVI_FFPROBE to its path.`,
    );
    this.name = "BinaryNotFoundError";
  }
}

export class AbortedError extends Error {
  constructor(message = "The operation was cancelled.") {
    super(message);
    this.name = "AbortError";
  }
}

/** Keeps the last `limit` characters written to it. */
export class TailBuffer {
  private chunks: string[] = [];
  private size = 0;
  constructor(private readonly limit = 16_384) {}

  push(chunk: string): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.limit && this.chunks.length > 1) {
      this.size -= this.chunks.shift()!.length;
    }
  }

  toString(): string {
    const text = this.chunks.join("");
    return text.length > this.limit ? text.slice(text.length - this.limit) : text;
  }
}

/** The last meaningful stderr lines, for error messages. */
export function stderrSummary(stderr: string, lines = 6): string {
  const kept = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^frame=|^size=|^video:|^\[out#/.test(l));
  return kept.slice(-lines).join("\n");
}

export interface ManagedChild {
  child: ChildProcess;
  stderr: TailBuffer;
  /** Resolves with the exit code (or null when killed by a signal). Never rejects. */
  exited: Promise<number | null>;
  /** SIGTERM, then SIGKILL after `graceMs`. Resolves when the child is gone. */
  kill(graceMs?: number): Promise<void>;
  /** Error describing a non-zero exit, with the stderr tail. */
  failure(what?: string): FfmpegError;
  spawnError(): Error | undefined;
}

export interface SpawnManagedOptions {
  signal?: AbortSignal;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** stdin/stdout modes. Default: stdin ignored, stdout piped. */
  stdin?: "pipe" | "ignore";
  stdout?: "pipe" | "ignore";
  /** stderr kept, characters (default 16 KiB): more for a child whose log is its result. */
  stderrLimit?: number;
}

export function spawnManaged(binary: string, args: readonly string[], options: SpawnManagedOptions = {}): ManagedChild {
  installExitHook();
  const spawnOptions: SpawnOptions = {
    cwd: options.cwd,
    env: options.env,
    stdio: [options.stdin ?? "ignore", options.stdout ?? "pipe", "pipe"],
    windowsHide: true,
  };
  const child = spawn(binary, args, spawnOptions);
  live.add(child);
  const stderr = new TailBuffer(options.stderrLimit);
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => stderr.push(chunk));
  let spawnErr: Error | undefined;

  const exited = new Promise<number | null>((resolve) => {
    child.once("error", (error: NodeJS.ErrnoException) => {
      spawnErr = error.code === "ENOENT" ? new BinaryNotFoundError(binary) : error;
      live.delete(child);
      resolve(null);
    });
    child.once("close", (code) => {
      live.delete(child);
      resolve(code);
    });
  });

  // Unhandled EPIPE on stdin when ffmpeg exits early would crash the process.
  child.stdin?.on("error", () => undefined);
  child.stdout?.on("error", () => undefined);

  const kill = async (graceMs = 2000): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null || !live.has(child)) {
      await exited;
      return;
    }
    try {
      child.kill("SIGTERM");
    } catch {
      // Raced with exit.
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Raced with exit.
      }
    }, graceMs);
    await exited;
    clearTimeout(timer);
  };

  if (options.signal) {
    const onAbort = () => void kill(500);
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
    void exited.then(() => options.signal?.removeEventListener("abort", onAbort));
  }

  return {
    child,
    stderr,
    exited,
    kill,
    spawnError: () => spawnErr,
    failure(what = `${binary} failed`) {
      const text = stderr.toString();
      const summary = stderrSummary(text);
      return new FfmpegError(
        `${what} (exit ${child.exitCode ?? child.signalCode ?? "?"})${summary ? `: ${summary}` : ""}`,
        binary,
        args,
        child.exitCode,
        text,
      );
    },
  };
}

export interface RunResult {
  stdout: Buffer;
  stderr: string;
}

export interface RunOptions extends SpawnManagedOptions {
  input?: Uint8Array | string;
  /** Kill the child after this many milliseconds. */
  timeoutMs?: number;
  /** Refuse to buffer more stdout than this (bytes). */
  maxStdout?: number;
  what?: string;
}

/** Run a child to completion, buffering stdout. Rejects on non-zero exit. */
export async function runBinary(binary: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  if (options.signal?.aborted) throw new AbortedError();
  const managed = spawnManaged(binary, args, { ...options, stdin: options.input !== undefined ? "pipe" : "ignore" });
  const chunks: Buffer[] = [];
  let size = 0;
  let overflow = false;
  managed.child.stdout?.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (options.maxStdout !== undefined && size > options.maxStdout) {
      overflow = true;
      void managed.kill(0);
      return;
    }
    chunks.push(chunk);
  });
  if (options.input !== undefined) {
    managed.child.stdin?.end(options.input);
  }
  let timedOut = false;
  const timer =
    options.timeoutMs !== undefined
      ? setTimeout(() => {
          timedOut = true;
          void managed.kill(0);
        }, options.timeoutMs)
      : undefined;
  const code = await managed.exited;
  if (timer) clearTimeout(timer);
  const spawnError = managed.spawnError();
  if (spawnError) throw spawnError;
  if (options.signal?.aborted) throw new AbortedError();
  if (overflow) throw new FfmpegError(`${binary} produced more output than expected`, binary, args, code, managed.stderr.toString());
  if (timedOut) throw new FfmpegError(`${binary} timed out after ${options.timeoutMs} ms`, binary, args, code, managed.stderr.toString());
  if (code !== 0) throw managed.failure(options.what);
  return { stdout: Buffer.concat(chunks), stderr: managed.stderr.toString() };
}
