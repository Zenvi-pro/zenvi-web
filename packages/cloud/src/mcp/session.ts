/**
 * "Current project" for remote MCP connections. The MCP endpoint is
 * stateless (no Mcp-Session-Id: hosts reconnect freely and the service may
 * restart), so state is keyed by connection — the OAuth grant, or the
 * personal token — kept in memory and mirrored to a small blob. A new
 * connection starts on the project the person last opened from any client.
 */

import type { BlobStore } from "../storage/types.js";
import type { Clock } from "../util/clock.js";
import { isoAt } from "../util/clock.js";
import { isProjectId, sessionPath } from "../services/paths.js";

interface SessionState {
  projectId: string;
  updatedAt: string;
}

const LAST = "last";

export class SessionStore {
  private readonly memory = new Map<string, string>();

  constructor(
    private readonly blobs: BlobStore,
    private readonly clock: Clock,
  ) {}

  async current(userId: string, connection: string): Promise<string | null> {
    const key = `${userId}/${connection}`;
    const cached = this.memory.get(key);
    if (cached) return cached;
    const own = await this.read(userId, connection);
    const projectId = own ?? (await this.read(userId, LAST));
    if (projectId) this.memory.set(key, projectId);
    return projectId;
  }

  async set(userId: string, connection: string, projectId: string): Promise<void> {
    const key = `${userId}/${connection}`;
    if (this.memory.get(key) === projectId) return;
    this.memory.set(key, projectId);
    const state: SessionState = { projectId, updatedAt: isoAt(this.clock.now()) };
    const body = JSON.stringify(state);
    await Promise.all([
      this.blobs.write(sessionPath(userId, connection), body, { contentType: "application/json" }),
      this.blobs.write(sessionPath(userId, LAST), body, { contentType: "application/json" }),
    ]);
  }

  /** Forget a project everywhere in memory (after deletion). */
  forget(userId: string, projectId: string): void {
    for (const [key, value] of this.memory) {
      if (key.startsWith(`${userId}/`) && value === projectId) this.memory.delete(key);
    }
  }

  private async read(userId: string, connection: string): Promise<string | null> {
    const blob = await this.blobs.read(sessionPath(userId, connection));
    if (!blob) return null;
    try {
      const state = JSON.parse(blob.data.toString("utf8")) as SessionState;
      return typeof state.projectId === "string" && isProjectId(state.projectId) ? state.projectId : null;
    } catch {
      return null;
    }
  }
}
