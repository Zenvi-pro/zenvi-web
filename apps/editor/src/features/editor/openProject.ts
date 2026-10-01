/**
 * Opening a project for the editor route: a local one from IndexedDB, or a
 * Zenvi Cloud one (route id = the raw cloud id, `c_…`) cached locally under
 * the same id so edits survive reloads and going offline.
 */
import { parseProject, PROJECT_FORMAT_VERSION, type Project } from "@zenvi/engine";
import type { CloudClient, CloudMediaEntry } from "@/lib/cloud";
import { describeProject, type LocalProjectMeta, type ProjectRepository } from "@/lib/storage/projects";

export interface OpenedProject {
  meta: LocalProjectMeta;
  project: Project;
  /** Signed read URLs the cloud returned with the project, by sha256. */
  cloudMedia?: CloudMediaEntry[];
}

export async function openLocal(repository: ProjectRepository, id: string, now = Date.now()): Promise<OpenedProject | null> {
  const stored = await repository.load(id);
  if (!stored) return null;
  const meta = { ...stored.meta, openedAt: now };
  void repository.updateMeta(id, { openedAt: now });
  return { meta, project: stored.project };
}

/**
 * The cloud copy wins unless the local cache has changes made on top of the
 * same revision that were not synced yet. Cloud JSON goes through the
 * engine's `parseProject` (the desktop load rules), like a `.zvn` file.
 */
export async function openCloud(repository: ProjectRepository, cloud: CloudClient, cloudId: string, now = Date.now()): Promise<OpenedProject> {
  const cached = await repository.load(cloudId);
  const remote = await cloud.getProject(cloudId);
  const unsynced = Boolean(
    cached?.meta.cloud && cached.meta.cloud.revision === remote.revision && (cached.meta.cloud.syncedAt ?? 0) < cached.meta.updatedAt,
  );
  const project = unsynced && cached ? cached.project : parseProject(currentStampForWebCopies(remote.project));
  const meta: LocalProjectMeta = {
    id: cloudId,
    name: remote.name,
    createdAt: cached?.meta.createdAt ?? now,
    updatedAt: unsynced && cached ? cached.meta.updatedAt : now,
    openedAt: now,
    source: "cloud",
    thumbnail: cached?.meta.thumbnail,
    cloud: { id: cloudId, revision: remote.revision, syncedAt: unsynced ? (cached?.meta.cloud?.syncedAt ?? null) : now },
    ...describeProject(project),
  };
  await repository.save(meta, project);
  return { meta, project, cloudMedia: remote.media };
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
