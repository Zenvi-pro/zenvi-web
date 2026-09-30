/**
 * The session's media: where each project file's bytes are, importing new
 * files, and relinking files a desktop project points at.
 *
 * Resolution order for a file: its content hash (`fingerprint.sha256`, or
 * `cloud.sha256`) in this browser's media store → a signed Zenvi Cloud URL
 * (signed in, cloud project) → missing (the relink dialog asks for it).
 */
import type { ImportedMedia, Project, ProjectFile, ReaderInfo } from "@zenvi/engine";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { CloudClient } from "@/lib/cloud";
import { cleanFileName } from "@/lib/projectFactory";
import { hashFile, partialFingerprint } from "@/lib/storage/hash";
import type { MediaStore } from "@/lib/storage/media";

import type { MediaSourceSpec } from "@zenvi/render-web";

export type { MediaSourceSpec };

export type MediaStatus = "resolving" | "ready" | "missing" | "error";

export interface MediaEntryState {
  status: MediaStatus;
  /** Where the bytes came from. */
  origin?: "local" | "cloud";
  error?: string;
}

export interface MediaRegistryLike {
  register(fileId: string, spec: MediaSourceSpec): void;
  unregister(fileId: string): void;
}

export type ProbeFn = (spec: MediaSourceSpec, options: { path: string }) => Promise<ReaderInfo>;

export interface ImportProgress {
  file: string;
  index: number;
  count: number;
  phase: "hashing" | "storing" | "probing";
  fraction: number;
}

export interface MediaLibraryOptions {
  store: () => Promise<MediaStore>;
  probe: ProbeFn;
  registry?: MediaRegistryLike | null;
  /** Cloud access for cloud projects (null when signed out or local). */
  cloud?: () => CloudClient | null;
}

/**
 * A file's content address: the full-file SHA-256 in `cloud.sha256` (written
 * on import here, by desktop push and by the CLI). `fingerprint.sha256` is the
 * desktop's partial hash and is never used as an address.
 */
export function fileHash(file: Pick<ProjectFile, "cloud">): string | null {
  const sha = file.cloud?.sha256;
  return typeof sha === "string" && /^[0-9a-f]{64}$/i.test(sha) ? sha.toLowerCase() : null;
}

/** Display name of a project file: its `name`, else the path's basename. */
export function fileDisplayName(file: Pick<ProjectFile, "name" | "path">): string {
  if (typeof file.name === "string" && file.name) return file.name;
  const path = String(file.path ?? "");
  return path.split(/[\\/]/).pop() || path || "Untitled";
}

export class MediaLibrary {
  readonly status: StoreApi<Record<string, MediaEntryState>> = createStore<Record<string, MediaEntryState>>(() => ({}));
  private readonly specs = new Map<string, MediaSourceSpec>();
  private readonly resolving = new Map<string, Promise<void>>();
  private registry: MediaRegistryLike | null;

  constructor(private readonly options: MediaLibraryOptions) {
    this.registry = options.registry ?? null;
  }

  /** Plug in the renderer's registry once it has loaded; replays known sources. */
  setRegistry(registry: MediaRegistryLike | null): void {
    this.registry = registry;
    if (registry) for (const [id, spec] of this.specs) registry.register(id, spec);
  }

  spec(fileId: string): MediaSourceSpec | undefined {
    return this.specs.get(fileId);
  }

  /** Resolve every file in the project that is not resolved yet; forget removed files. */
  async sync(project: Project): Promise<void> {
    const ids = new Set(project.files.map((f) => f.id));
    for (const id of [...this.specs.keys()]) {
      if (!ids.has(id)) {
        this.specs.delete(id);
        this.registry?.unregister(id);
        this.setStatus(id, null);
      }
    }
    await Promise.all(project.files.filter((f) => !this.specs.has(f.id)).map((f) => this.resolve(f)));
  }

  missing(project: Project): ProjectFile[] {
    const status = this.status.getState();
    return project.files.filter((f) => status[f.id]?.status === "missing" || status[f.id]?.status === "error");
  }

  /** Resolve one file (deduplicated while in flight). */
  resolve(file: ProjectFile): Promise<void> {
    const running = this.resolving.get(file.id);
    if (running) return running;
    const job = this.doResolve(file).finally(() => this.resolving.delete(file.id));
    this.resolving.set(file.id, job);
    return job;
  }

  /** Bytes for a file the session just imported (skips a store round trip). */
  attach(fileId: string, spec: MediaSourceSpec, origin: "local" | "cloud" = "local"): void {
    this.specs.set(fileId, spec);
    this.registry?.register(fileId, spec);
    this.setStatus(fileId, { status: "ready", origin });
  }

  /**
   * Hash, store and probe files for import. Returns the media to add
   * (`addFile`), in order, plus the bytes to attach once ids are known.
   */
  async importFiles(files: File[], onProgress?: (p: ImportProgress) => void): Promise<{ media: ImportedMedia; spec: MediaSourceSpec }[]> {
    const store = await this.options.store();
    const out: { media: ImportedMedia; spec: MediaSourceSpec }[] = [];
    for (const [index, file] of files.entries()) {
      const report = (phase: ImportProgress["phase"], fraction: number) =>
        onProgress?.({ file: file.name, index, count: files.length, phase, fraction });
      report("hashing", 0);
      const sha256 = await hashFile(file, (f) => report("hashing", f));
      report("storing", 0);
      await store.put(sha256, file, file.name);
      const stored = await store.get(sha256);
      const spec: MediaSourceSpec = stored?.handle
        ? { kind: "opfs", handle: stored.handle }
        : { kind: "blob", blob: stored?.file ?? file, name: file.name };
      report("probing", 0);
      const [info, fingerprint] = await Promise.all([
        this.options.probe({ kind: "blob", blob: file, name: file.name }, { path: file.name }),
        partialFingerprint(file),
      ]);
      // Content-derived relative path: unique per file (the engine dedupes by
      // path) and where a pull to disk would put it (`<project>/media/<hash>/<name>`).
      const path = mediaPath(sha256, file.name);
      out.push({
        spec,
        media: {
          path,
          name: file.name,
          info: { ...info, path },
          fingerprint,
          cloud: { sha256, size: file.size, content_type: file.type || contentTypeFor(file.name), name: file.name },
        },
      });
      report("probing", 1);
    }
    return out;
  }

  /**
   * Store a file picked to relink `target`. Returns the fields to write on the
   * project file (its fingerprint), or throws when the pick is not usable.
   */
  async relink(target: ProjectFile, file: File): Promise<{ patch: Partial<ProjectFile>; matchesFingerprint: boolean | null }> {
    const store = await this.options.store();
    const [sha256, fingerprint] = await Promise.all([hashFile(file), partialFingerprint(file)]);
    await store.put(sha256, file, file.name);
    const stored = await store.get(sha256);
    const spec: MediaSourceSpec = stored?.handle ? { kind: "opfs", handle: stored.handle } : { kind: "blob", blob: file, name: file.name };
    this.attach(target.id, spec, "local");
    // The desktop fingerprint tells whether this is the same file the project used.
    const known = target.fingerprint?.sha256;
    const matchesFingerprint = known ? known === fingerprint.sha256 && Number(target.fingerprint?.size) === fingerprint.size : null;
    return {
      patch: { cloud: { ...(target.cloud ?? {}), sha256, size: file.size, content_type: file.type || contentTypeFor(file.name), name: file.name } },
      matchesFingerprint,
    };
  }

  private async doResolve(file: ProjectFile): Promise<void> {
    this.setStatus(file.id, { status: "resolving" });
    const sha = fileHash(file);
    try {
      if (sha) {
        const store = await this.options.store();
        const stored = await store.get(sha);
        if (stored) {
          this.attach(file.id, stored.handle ? { kind: "opfs", handle: stored.handle } : { kind: "blob", blob: stored.file, name: fileDisplayName(file) }, "local");
          return;
        }
        const cloud = this.options.cloud?.();
        if (cloud?.enabled && file.cloud?.sha256) {
          const cloudSha = file.cloud.sha256;
          const url = await cloud.mediaUrl(cloudSha);
          this.attach(file.id, { kind: "url", url, name: fileDisplayName(file), refresh: () => cloud.mediaUrl(cloudSha) }, "cloud");
          return;
        }
      }
      this.setStatus(file.id, { status: "missing" });
    } catch (error) {
      this.setStatus(file.id, { status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }

  private setStatus(fileId: string, state: MediaEntryState | null): void {
    const current = this.status.getState();
    if (state === null) {
      if (!(fileId in current)) return;
      const { [fileId]: _removed, ...rest } = current;
      this.status.setState(rest, true);
      return;
    }
    this.status.setState({ ...current, [fileId]: state }, true);
  }
}

const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

export function mediaPath(sha256: string, name: string): string {
  const safe = cleanFileName(name, "_") || "media";
  return `media/${sha256.slice(0, 16)}/${safe}`;
}

export function contentTypeFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Match picked files to missing project files by name (case-insensitive
 * basename), preferring an equal size when the project knows it.
 */
export function matchRelinkCandidates(missing: ProjectFile[], picked: File[]): Map<string, File> {
  const byName = new Map<string, File[]>();
  for (const file of picked) {
    const key = file.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), file]);
  }
  const out = new Map<string, File>();
  for (const target of missing) {
    const candidates = byName.get(fileDisplayName(target).toLowerCase()) ?? byName.get(String(target.path).split(/[\\/]/).pop()?.toLowerCase() ?? "");
    if (!candidates?.length) continue;
    const size = Number(target.fingerprint?.size ?? target.file_size ?? NaN);
    const exact = Number.isFinite(size) ? candidates.find((c) => c.size === size) : undefined;
    out.set(target.id, exact ?? candidates[0]!);
  }
  return out;
}
