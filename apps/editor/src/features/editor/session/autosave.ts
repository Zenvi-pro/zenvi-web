/**
 * Debounced, serialized saving.
 *
 * `notify()` on every change; a save runs `delayMs` after the last change, or
 * at most `maxWaitMs` after the first unsaved change during continuous edits
 * (dragging, scrubbing). Saves never overlap: changes made during a save
 * schedule another one. Failures retry with backoff and surface as `error`.
 */

export type SaveState = "saved" | "dirty" | "saving" | "error";

export interface AutosaveStatus {
  state: SaveState;
  lastSavedAt: number | null;
  error: string | null;
}

export interface AutosaverOptions {
  save: () => Promise<void>;
  delayMs?: number;
  maxWaitMs?: number;
  /** Backoff after a failure (doubles up to 30 s). */
  retryMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class Autosaver {
  private status: AutosaveStatus = { state: "saved", lastSavedAt: null, error: null };
  private readonly listeners = new Set<(status: AutosaveStatus) => void>();
  private timer: unknown = null;
  private firstDirtyAt: number | null = null;
  private running: Promise<void> | null = null;
  private changedDuringSave = false;
  private failures = 0;
  private disposed = false;
  private readonly opts: Required<AutosaverOptions>;

  constructor(options: AutosaverOptions) {
    this.opts = {
      delayMs: 800,
      maxWaitMs: 4000,
      retryMs: 2000,
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      ...options,
    };
  }

  get current(): AutosaveStatus {
    return this.status;
  }

  get dirty(): boolean {
    return this.status.state === "dirty" || this.status.state === "error" || this.changedDuringSave;
  }

  subscribe(listener: (status: AutosaveStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Something changed: schedule a save. */
  notify(): void {
    if (this.disposed) return;
    if (this.running) {
      this.changedDuringSave = true;
      return;
    }
    const now = this.opts.now();
    if (this.firstDirtyAt === null) this.firstDirtyAt = now;
    this.set({ state: "dirty" });
    const waited = now - this.firstDirtyAt;
    const delay = Math.max(0, Math.min(this.opts.delayMs, this.opts.maxWaitMs - waited));
    this.schedule(delay);
  }

  /** Save now if there are unsaved changes. Resolves when everything is saved (or failed). */
  async flush(): Promise<void> {
    if (this.running) {
      await this.running;
      if (this.changedDuringSave) return this.flush();
      return;
    }
    if (!this.dirty) return;
    this.cancelTimer();
    await this.run();
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
    this.listeners.clear();
  }

  private schedule(ms: number): void {
    this.cancelTimer();
    this.timer = this.opts.setTimer(() => {
      this.timer = null;
      void this.run();
    }, ms);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.opts.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private run(): Promise<void> {
    if (this.running) return this.running;
    this.firstDirtyAt = null;
    this.changedDuringSave = false;
    this.set({ state: "saving" });
    const job = (async () => {
      try {
        await this.opts.save();
        this.failures = 0;
        this.running = null;
        if (this.changedDuringSave && !this.disposed) {
          this.changedDuringSave = false;
          this.set({ state: "dirty", lastSavedAt: this.opts.now(), error: null });
          this.firstDirtyAt = this.opts.now();
          this.schedule(this.opts.delayMs);
        } else {
          this.set({ state: "saved", lastSavedAt: this.opts.now(), error: null });
        }
      } catch (error) {
        this.running = null;
        this.failures += 1;
        this.set({ state: "error", error: error instanceof Error ? error.message : String(error) });
        if (!this.disposed) this.schedule(Math.min(30_000, this.opts.retryMs * 2 ** (this.failures - 1)));
      }
    })();
    this.running = job;
    return job;
  }

  private set(patch: Partial<AutosaveStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of [...this.listeners]) listener(this.status);
  }
}
