/**
 * A bounded on-disk cache of media blobs for frame previews, so looking at
 * several frames of a project downloads each file once. Entries are evicted
 * least-recently-used when the cache grows past its byte budget. Render jobs
 * use their own temp directories instead (see render/service.ts).
 */

import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectFile } from "@zenvi/engine";
import { displayName, fileSha256 } from "../projects/model.js";
import type { MediaService } from "../services/media.js";

interface Entry {
  path: string;
  size: number;
  usedAt: number;
}

export class MediaCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<string>>();
  private total = 0;

  constructor(
    private readonly root: string,
    private readonly maxBytes: number,
    private readonly media: MediaService,
  ) {}

  resolver(userId: string): (file: ProjectFile) => Promise<string> {
    return (file) => this.get(userId, file);
  }

  async get(userId: string, file: ProjectFile): Promise<string> {
    const sha = fileSha256(file);
    if (!sha) throw new Error(`"${displayName(file)}" is not in Zenvi Cloud.`);
    const key = `${userId}/${sha}`;
    const hit = this.entries.get(key);
    if (hit) {
      hit.usedAt = Date.now();
      return hit.path;
    }
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.fetch(userId, sha, displayName(file), key).finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    return pending;
  }

  private async fetch(userId: string, sha: string, name: string, key: string): Promise<string> {
    const dir = join(this.root, userId);
    await mkdir(dir, { recursive: true });
    const ext = /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]?.toLowerCase();
    const path = join(dir, ext ? `${sha}.${ext}` : sha);
    const partial = `${path}.part`;
    await this.media.download(userId, sha, partial);
    await rename(partial, path);
    const { size } = await stat(path);
    this.entries.set(key, { path, size, usedAt: Date.now() });
    this.total += size;
    await this.evict(key);
    return path;
  }

  private async evict(keep: string): Promise<void> {
    if (this.total <= this.maxBytes) return;
    const byAge = [...this.entries.entries()].filter(([k]) => k !== keep).sort((a, b) => a[1].usedAt - b[1].usedAt);
    for (const [key, entry] of byAge) {
      if (this.total <= this.maxBytes) break;
      this.entries.delete(key);
      this.total -= entry.size;
      await rm(entry.path, { force: true });
    }
  }
}
