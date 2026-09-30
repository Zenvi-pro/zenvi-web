/**
 * Cloud projects in blob storage. The project JSON's ETag is its revision:
 * writes are conditional (`If-Match`), so two editors can never silently
 * overwrite each other — the loser gets a 409 with the current revision.
 */

import type { Project } from "@zenvi/engine";
import { ApiError, conflict, notFound, PreconditionFailedError, tooLarge } from "../http/errors.js";
import type { BlobStore } from "../storage/types.js";
import { decodeMeta, encodeMeta } from "../storage/types.js";
import type { Clock } from "../util/clock.js";
import { isoAt } from "../util/clock.js";
import { randomId } from "../util/crypto.js";
import { newProject, projectStats, type ProjectStats, validateProject } from "../projects/model.js";
import type { ProfileSpec } from "../projects/profiles.js";
import { metaPath, projectPath, projectPrefix, userPrefix } from "./paths.js";

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  stats: ProjectStats;
}

export interface ProjectSummary extends ProjectMeta {
  revision: string;
}

export interface LoadedProject {
  project: Project;
  revision: string;
  meta: ProjectMeta;
}

const MAX_PROJECTS_PER_USER = 1000;
const MAX_NAME = 200;

export function cleanName(name: unknown, fallback = "Untitled project"): string {
  if (typeof name !== "string") return fallback;
  // Drop control characters; collapse whitespace.
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned === "" ? fallback : cleaned.slice(0, MAX_NAME);
}

/** Normalize an If-Match / ETag header value to the bare tag. */
export function normalizeRevision(value: string): string {
  return value.trim().replace(/^W\//, "").replace(/^"(.*)"$/, "$1");
}

function metaToBlobMetadata(meta: ProjectMeta): Record<string, string> {
  return {
    name: encodeMeta(meta.name),
    createdat: meta.createdAt,
    updatedat: meta.updatedAt,
    stats: encodeMeta(JSON.stringify(meta.stats)),
  };
}

function metaFromBlobMetadata(id: string, metadata: Record<string, string>): ProjectMeta | null {
  const name = decodeMeta(metadata.name);
  if (name === undefined || !metadata.createdat || !metadata.updatedat) return null;
  let stats: ProjectStats = { clips: 0, files: 0, duration: 0, width: 0, height: 0, fps: 0 };
  try {
    stats = { ...stats, ...(JSON.parse(decodeMeta(metadata.stats) ?? "{}") as Partial<ProjectStats>) };
  } catch {
    // Keep zero stats for a meta blob written by an older build.
  }
  return { id, name, createdAt: metadata.createdat, updatedAt: metadata.updatedat, stats };
}

export class ProjectService {
  constructor(
    private readonly blobs: BlobStore,
    private readonly clock: Clock,
    private readonly maxProjectBytes: number,
  ) {}

  async list(userId: string): Promise<ProjectSummary[]> {
    const prefix = `${userPrefix(userId)}p/`;
    const metas = new Map<string, ProjectMeta>();
    const revisions = new Map<string, string>();
    for await (const item of this.blobs.list(prefix)) {
      const rest = item.path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash < 0) continue;
      const id = rest.slice(0, slash);
      const file = rest.slice(slash + 1);
      if (file === "meta.json") {
        const meta = metaFromBlobMetadata(id, item.metadata);
        if (meta) metas.set(id, meta);
      } else if (file === "project.json") {
        revisions.set(id, item.etag);
      }
    }
    const out: ProjectSummary[] = [];
    for (const [id, meta] of metas) {
      const revision = revisions.get(id);
      if (revision) out.push({ ...meta, revision });
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(userId: string, input: { name?: unknown; project?: unknown; profile?: ProfileSpec }): Promise<ProjectSummary> {
    const existing = await this.list(userId);
    if (existing.length >= MAX_PROJECTS_PER_USER) {
      throw new ApiError(403, "project_limit", `You have reached the limit of ${MAX_PROJECTS_PER_USER} cloud projects.`);
    }
    const id = randomId("c_", 16);
    const project =
      input.project === undefined || input.project === null ? newProject(id, input.profile) : validateProject(input.project);
    const body = this.serialize(project);
    const now = isoAt(this.clock.now());
    const meta: ProjectMeta = { id, name: cleanName(input.name), createdAt: now, updatedAt: now, stats: projectStats(project) };
    const { etag } = await this.blobs.write(projectPath(userId, id), body, { contentType: "application/json", ifNoneMatch: "*" });
    await this.writeMeta(userId, meta);
    return { ...meta, revision: etag };
  }

  async get(userId: string, id: string): Promise<LoadedProject> {
    const blob = await this.blobs.read(projectPath(userId, id));
    if (!blob) throw notFound("Project");
    let project: Project;
    try {
      project = JSON.parse(blob.data.toString("utf8")) as Project;
    } catch {
      throw new ApiError(500, "corrupt_project", "The stored project could not be read.");
    }
    const meta = (await this.readMeta(userId, id)) ?? {
      id,
      name: "Untitled project",
      createdAt: blob.properties.lastModified.toISOString(),
      updatedAt: blob.properties.lastModified.toISOString(),
      stats: projectStats(project),
    };
    return { project, revision: blob.properties.etag, meta };
  }

  async revision(userId: string, id: string): Promise<string> {
    const head = await this.blobs.head(projectPath(userId, id));
    if (!head) throw notFound("Project");
    return head.etag;
  }

  /**
   * Replace the project JSON if the stored revision is still `ifMatch`
   * (`*` = any existing revision). 409 with the current revision otherwise.
   */
  async save(userId: string, id: string, value: unknown, ifMatch: string): Promise<ProjectSummary> {
    const project = validateProject(value);
    const body = this.serialize(project);
    const expected = ifMatch === "*" ? "*" : normalizeRevision(ifMatch);
    let etag: string;
    try {
      ({ etag } = await this.blobs.write(projectPath(userId, id), body, { contentType: "application/json", ifMatch: expected }));
    } catch (error) {
      if (!(error instanceof PreconditionFailedError)) throw error;
      const head = await this.blobs.head(projectPath(userId, id));
      if (!head) throw notFound("Project");
      throw conflict("The project changed since you loaded it. Reload it, reapply your change and save again.", "revision_conflict", {
        revision: head.etag,
      });
    }
    const stats = projectStats(project);
    const meta = await this.updateMeta(userId, id, (previous, now) => ({
      id,
      name: previous?.name ?? "Untitled project",
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      stats,
    }));
    return { ...meta, revision: etag };
  }

  async rename(userId: string, id: string, name: unknown): Promise<ProjectMeta> {
    const head = await this.blobs.head(projectPath(userId, id));
    if (!head) throw notFound("Project");
    const fallbackStats = (await this.readMeta(userId, id))?.stats ?? projectStats((await this.get(userId, id)).project);
    return this.updateMeta(userId, id, (previous, now) => ({
      id,
      name: cleanName(name, previous?.name ?? "Untitled project"),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      stats: previous?.stats ?? fallbackStats,
    }));
  }

  /** Delete the project and everything under its prefix (renders, frames). Media stays (shared by hash). */
  async delete(userId: string, id: string): Promise<void> {
    const prefix = projectPrefix(userId, id);
    const head = await this.blobs.head(projectPath(userId, id));
    if (!head) throw notFound("Project");
    const paths: string[] = [];
    for await (const item of this.blobs.list(prefix)) paths.push(item.path);
    // project.json last, so a failure half-way leaves a listable project to retry on.
    paths.sort((a, b) => (a.endsWith("/project.json") ? 1 : b.endsWith("/project.json") ? -1 : 0));
    for (const path of paths) await this.blobs.delete(path);
  }

  private serialize(project: Project): string {
    const body = JSON.stringify(project);
    if (Buffer.byteLength(body, "utf8") > this.maxProjectBytes) {
      throw tooLarge(`Project JSON is larger than ${Math.round(this.maxProjectBytes / 1024 / 1024)} MB.`);
    }
    return body;
  }

  private async readMeta(userId: string, id: string): Promise<ProjectMeta | null> {
    return (await this.readMetaVersioned(userId, id))?.meta ?? null;
  }

  private async readMetaVersioned(userId: string, id: string): Promise<{ meta: ProjectMeta | null; etag: string } | null> {
    const blob = await this.blobs.read(metaPath(userId, id));
    if (!blob) return null;
    let meta: ProjectMeta | null;
    try {
      meta = { ...(JSON.parse(blob.data.toString("utf8")) as ProjectMeta), id };
    } catch {
      meta = metaFromBlobMetadata(id, blob.properties.metadata);
    }
    return { meta, etag: blob.properties.etag };
  }

  private async writeMeta(userId: string, meta: ProjectMeta, condition: { ifMatch?: string; ifNoneMatch?: "*" } = {}): Promise<void> {
    await this.blobs.write(metaPath(userId, meta.id), JSON.stringify(meta), {
      contentType: "application/json",
      metadata: metaToBlobMetadata(meta),
      ...condition,
    });
  }

  /** Read-modify-write of meta.json with ETag checks, so a rename and a save never lose each other's change. */
  private async updateMeta(
    userId: string,
    id: string,
    mutate: (previous: ProjectMeta | null, now: string) => ProjectMeta,
  ): Promise<ProjectMeta> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await this.readMetaVersioned(userId, id);
      const next = mutate(current?.meta ?? null, isoAt(this.clock.now()));
      try {
        await this.writeMeta(userId, next, current ? { ifMatch: current.etag } : { ifNoneMatch: "*" });
        return next;
      } catch (error) {
        if (!(error instanceof PreconditionFailedError)) throw error;
      }
    }
    throw new ApiError(503, "busy", "The project is being changed by someone else right now; try again.");
  }
}
