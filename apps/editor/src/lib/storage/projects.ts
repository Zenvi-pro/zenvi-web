/**
 * Local projects: metadata + project JSON in IndexedDB.
 *
 * Metadata lives in its own store so the home page lists projects without
 * loading every project's JSON. Both records are written in one IDB
 * transaction so they never disagree.
 */
import { timelineEnd, type Fraction, type Project } from "@zenvi/engine";
import { idbAvailable, openDatabase, requestToPromise, STORES, transactionDone } from "./idb";

export interface CloudLink {
  /** Zenvi Cloud project id. */
  id: string;
  /** Revision (ETag) of the last save or load, for `If-Match`. */
  revision: string | null;
  syncedAt: number | null;
}

export interface LocalProjectMeta {
  /** Storage id; also the route id (`/editor/p/:id`). */
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  openedAt?: number;
  width: number;
  height: number;
  fps: Fraction;
  /** Timeline length in seconds (end of the last clip). */
  duration: number;
  clipCount: number;
  fileCount: number;
  /** Small JPEG data URL of a recent preview frame. */
  thumbnail?: string;
  cloud?: CloudLink;
  source?: "new" | "zvn" | "cloud" | "media";
}

export interface StoredProject {
  meta: LocalProjectMeta;
  project: Project;
}

export interface ProjectRepository {
  /** Most recently updated first. */
  list(): Promise<LocalProjectMeta[]>;
  getMeta(id: string): Promise<LocalProjectMeta | undefined>;
  load(id: string): Promise<StoredProject | undefined>;
  save(meta: LocalProjectMeta, project: Project): Promise<void>;
  updateMeta(id: string, patch: Partial<Omit<LocalProjectMeta, "id">>): Promise<LocalProjectMeta | undefined>;
  remove(id: string): Promise<void>;
}

const ID_CHARS = "abcdefghijkmnopqrstuvwxyz23456789";

/** A new local project id: 12 lowercase characters (never `c_…`, which is a cloud id). */
export function newLocalId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let id = "";
  for (const b of bytes) id += ID_CHARS[b % ID_CHARS.length];
  return id;
}

function byUpdatedDesc(a: LocalProjectMeta, b: LocalProjectMeta): number {
  return b.updatedAt - a.updatedAt;
}

export class IdbProjectRepository implements ProjectRepository {
  constructor(private readonly factory?: IDBFactory) {}

  private db(): Promise<IDBDatabase> {
    return openDatabase(this.factory);
  }

  async list(): Promise<LocalProjectMeta[]> {
    const db = await this.db();
    const tx = db.transaction(STORES.projects, "readonly");
    const all = await requestToPromise(tx.objectStore(STORES.projects).getAll() as IDBRequest<LocalProjectMeta[]>);
    return all.sort(byUpdatedDesc);
  }

  async getMeta(id: string): Promise<LocalProjectMeta | undefined> {
    const db = await this.db();
    const tx = db.transaction(STORES.projects, "readonly");
    return (await requestToPromise(tx.objectStore(STORES.projects).get(id))) as LocalProjectMeta | undefined;
  }

  async load(id: string): Promise<StoredProject | undefined> {
    const db = await this.db();
    const tx = db.transaction([STORES.projects, STORES.projectData], "readonly");
    const [meta, data] = await Promise.all([
      requestToPromise(tx.objectStore(STORES.projects).get(id)) as Promise<LocalProjectMeta | undefined>,
      requestToPromise(tx.objectStore(STORES.projectData).get(id)) as Promise<{ id: string; project: Project } | undefined>,
    ]);
    if (!meta || !data) return undefined;
    return { meta, project: data.project };
  }

  async save(meta: LocalProjectMeta, project: Project): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([STORES.projects, STORES.projectData], "readwrite");
    tx.objectStore(STORES.projects).put(meta);
    tx.objectStore(STORES.projectData).put({ id: meta.id, project });
    await transactionDone(tx);
  }

  async updateMeta(id: string, patch: Partial<Omit<LocalProjectMeta, "id">>): Promise<LocalProjectMeta | undefined> {
    const db = await this.db();
    const tx = db.transaction(STORES.projects, "readwrite");
    const store = tx.objectStore(STORES.projects);
    const current = (await requestToPromise(store.get(id))) as LocalProjectMeta | undefined;
    if (!current) {
      await transactionDone(tx);
      return undefined;
    }
    const next = { ...current, ...patch, id };
    store.put(next);
    await transactionDone(tx);
    return next;
  }

  async remove(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([STORES.projects, STORES.projectData], "readwrite");
    tx.objectStore(STORES.projects).delete(id);
    tx.objectStore(STORES.projectData).delete(id);
    await transactionDone(tx);
  }
}

/** In-memory repository: tests, and browsers without IndexedDB (nothing persists). */
export class MemoryProjectRepository implements ProjectRepository {
  private readonly metas = new Map<string, LocalProjectMeta>();
  private readonly projects = new Map<string, Project>();

  async list(): Promise<LocalProjectMeta[]> {
    return [...this.metas.values()].map((m) => structuredClone(m)).sort(byUpdatedDesc);
  }

  async getMeta(id: string): Promise<LocalProjectMeta | undefined> {
    const meta = this.metas.get(id);
    return meta ? structuredClone(meta) : undefined;
  }

  async load(id: string): Promise<StoredProject | undefined> {
    const meta = this.metas.get(id);
    const project = this.projects.get(id);
    if (!meta || !project) return undefined;
    return { meta: structuredClone(meta), project: structuredClone(project) };
  }

  async save(meta: LocalProjectMeta, project: Project): Promise<void> {
    this.metas.set(meta.id, structuredClone(meta));
    this.projects.set(meta.id, structuredClone(project));
  }

  async updateMeta(id: string, patch: Partial<Omit<LocalProjectMeta, "id">>): Promise<LocalProjectMeta | undefined> {
    const current = this.metas.get(id);
    if (!current) return undefined;
    const next = { ...current, ...structuredClone(patch), id };
    this.metas.set(id, next);
    return structuredClone(next);
  }

  async remove(id: string): Promise<void> {
    this.metas.delete(id);
    this.projects.delete(id);
  }
}

let repository: ProjectRepository | null = null;

export function projectRepository(): ProjectRepository {
  if (!repository) repository = idbAvailable() ? new IdbProjectRepository() : new MemoryProjectRepository();
  return repository;
}

/** Test hook. */
export function setProjectRepository(next: ProjectRepository | null): void {
  repository = next;
}

/** Metadata derived from a project snapshot (everything except identity and timestamps). */
export function describeProject(project: Project): Pick<LocalProjectMeta, "width" | "height" | "fps" | "duration" | "clipCount" | "fileCount"> {
  const end = timelineEnd(project);
  return {
    width: project.width,
    height: project.height,
    fps: { num: project.fps.num, den: project.fps.den },
    duration: end,
    clipCount: project.clips.length,
    fileCount: project.files.length,
  };
}
