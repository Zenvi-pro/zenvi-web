/**
 * Opening a project for the editor route: a local one from IndexedDB, or a
 * Zenvi Cloud one (route id = the raw cloud id, `c_…`) cached locally under
 * the same id so edits survive reloads and going offline.
 *
 * Edits made in this browser are never dropped silently: when the cache
 * holds changes that were not synced and the cloud copy moved on meanwhile,
 * the local copy opens with a conflict for the person to resolve — keep mine
 * (overwrite the cloud copy) or use the cloud's (this browser's copy is kept
 * as a separate local project).
 */
import { parseProject, PROJECT_FORMAT_VERSION, type Project } from "@zenvi/engine";
import type { CloudClient, CloudMediaEntry, CloudProjectDocument } from "@/lib/cloud";
import { describeProject, newLocalId, type LocalProjectMeta, type ProjectRepository, type StoredProject } from "@/lib/storage/projects";

export interface CloudConflict {
  /** The cloud copy's revision (a "keep mine" save names it in If-Match). */
  cloudRevision: string;
  cloudName: string;
}

export interface OpenedProject {
  meta: LocalProjectMeta;
  project: Project;
  /** Signed read URLs the cloud returned with the project, by sha256. */
  cloudMedia?: CloudMediaEntry[];
  /** This browser's unsynced edits are based on an older cloud revision. */
  conflict?: CloudConflict;
}

export async function openLocal(repository: ProjectRepository, id: string, now = Date.now()): Promise<OpenedProject | null> {
  const stored = await repository.load(id);
  if (!stored) return null;
  const meta = { ...stored.meta, openedAt: now };
  void repository.updateMeta(id, { openedAt: now });
  return { meta, project: stored.project };
}

/** The cache holds edits made after its last sync. */
export function hasUnsyncedEdits(cached: StoredProject | undefined): boolean {
  return Boolean(cached?.meta.cloud && (cached.meta.cloud.syncedAt ?? 0) < cached.meta.updatedAt);
}

/** Store the cloud copy as the synced cache entry for `cloudId`. */
async function cacheCloudCopy(repository: ProjectRepository, cloudId: string, remote: CloudProjectDocument, cached: StoredProject | undefined, now: number): Promise<OpenedProject> {
  const project = parseProject(currentStampForWebCopies(remote.project));
  const meta: LocalProjectMeta = {
    id: cloudId,
    name: remote.name,
    createdAt: cached?.meta.createdAt ?? now,
    updatedAt: now,
    openedAt: now,
    source: "cloud",
    thumbnail: cached?.meta.thumbnail,
    cloud: { id: cloudId, revision: remote.revision, syncedAt: now },
    ...describeProject(project),
  };
  await repository.save(meta, project);
  return { meta, project, cloudMedia: remote.media };
}

/**
 * Open a cloud project. The cloud copy wins, except over edits this browser
 * has not synced: on the same revision those simply continue; on an older
 * revision they open as they are, with `conflict` set (never overwritten).
 * Cloud JSON goes through the engine's `parseProject` (the desktop load
 * rules), like a `.zvn` file.
 */
export async function openCloud(repository: ProjectRepository, cloud: CloudClient, cloudId: string, now = Date.now()): Promise<OpenedProject> {
  const cached = await repository.load(cloudId);
  const remote = await cloud.getProject(cloudId);
  if (cached && hasUnsyncedEdits(cached)) {
    const meta: LocalProjectMeta = { ...cached.meta, openedAt: now };
    await repository.updateMeta(cloudId, { openedAt: now });
    const opened: OpenedProject = { meta, project: cached.project, cloudMedia: remote.media };
    if (cached.meta.cloud!.revision !== remote.revision) opened.conflict = { cloudRevision: remote.revision, cloudName: remote.name };
    return opened;
  }
  return cacheCloudCopy(repository, cloudId, remote, cached, now);
}

/**
 * Conflict → "use the cloud version": keep this browser's copy as its own
 * local project (not linked to the cloud), then make the cloud copy the
 * cached one. Returns the archived project's id.
 */
export async function adoptCloudCopy(
  repository: ProjectRepository,
  cloud: CloudClient,
  cloudId: string,
  local: { meta: LocalProjectMeta; project: Project },
  now = Date.now(),
): Promise<{ archivedId: string; archivedName: string }> {
  const remote = await cloud.getProject(cloudId);
  const archivedId = newLocalId();
  const archivedName = `${local.meta.name} (edits from this browser)`;
  const { cloud: _link, ...rest } = local.meta;
  await repository.save({ ...rest, ...describeProject(local.project), id: archivedId, name: archivedName, createdAt: now, updatedAt: now, openedAt: undefined, source: "new" }, local.project);
  const cached = await repository.load(cloudId);
  await cacheCloudCopy(repository, cloudId, remote, cached, now);
  return { archivedId, archivedName };
}

/**
 * Editor builds before the version stamp saved the template's "0.0.0", which
 * `parseProject` (like the desktop) reads as an OpenShot beta file and
 * inverts every clip's alpha. Nothing else writes "0.0.0" to the cloud (the
 * desktop and the CLI stamp their own versions), so such a copy is current
 * web data: give it the current stamp instead of the beta upgrade.
 */
export function currentStampForWebCopies(json: Project): Project {
  const version = json && typeof json === "object" ? (json as { version?: unknown }).version : undefined;
  if (!version || typeof version !== "object" || (version as Record<string, unknown>)["openshot-qt"] !== "0.0.0") return json;
  return { ...json, version: { ...(version as Record<string, string>), ...PROJECT_FORMAT_VERSION } };
}
