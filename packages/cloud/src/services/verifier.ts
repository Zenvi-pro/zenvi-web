/**
 * Background SHA-256 checks of large uploads (MediaService.verifyLarge), one
 * at a time so a 4 GB hash does not compete with renders for bandwidth. Jobs
 * live in blob storage (`verify/…`), so `resume()` picks up checks a restart
 * interrupted.
 */

import type { Logger } from "../http/log.js";
import { errorMessage } from "../http/log.js";
import type { MediaService } from "./media.js";

export class MediaVerifier {
  private readonly queue: { userId: string; sha256: string }[] = [];
  private readonly queued = new Set<string>();
  private running: Promise<void> | null = null;

  constructor(
    private readonly media: MediaService,
    private readonly log: Logger,
  ) {}

  enqueue(userId: string, sha256: string): void {
    const key = `${userId}/${sha256}`;
    if (this.queued.has(key)) return;
    this.queued.add(key);
    this.queue.push({ userId, sha256 });
    this.running ??= this.pump().finally(() => {
      this.running = null;
    });
  }

  /** Re-queue checks that were pending when the process stopped. */
  async resume(): Promise<number> {
    let count = 0;
    for await (const job of this.media.pendingVerifications()) {
      this.enqueue(job.userId, job.sha256);
      count += 1;
    }
    return count;
  }

  /** Resolves when nothing is queued (tests). */
  async drain(): Promise<void> {
    while (this.running) await this.running;
  }

  private async pump(): Promise<void> {
    for (let next = this.queue.shift(); next; next = this.queue.shift()) {
      const started = Date.now();
      try {
        const outcome = await this.media.verifyLarge(next.userId, next.sha256);
        const fields = { user: next.userId, sha256: next.sha256, outcome, ms: Date.now() - started };
        if (outcome === "mismatch") this.log.warn("large upload failed its hash check; deleted", fields);
        else this.log.info("large upload hash check", fields);
      } catch (error) {
        // Left in storage: the next resume() retries it.
        this.log.error("large upload hash check failed", { user: next.userId, sha256: next.sha256, error: errorMessage(error) });
      } finally {
        this.queued.delete(`${next.userId}/${next.sha256}`);
      }
    }
  }
}
