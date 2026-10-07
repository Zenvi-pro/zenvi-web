/**
 * Content-addressed media storage in the browser.
 *
 * Bytes are keyed by SHA-256, so importing the same file twice (or into two
 * projects) stores it once, and a desktop project whose files carry
 * `fingerprint.sha256` finds media the browser already has. OPFS
 * (`navigator.storage.getDirectory()`) is used when it supports writable
 * streams; otherwise blobs go into IndexedDB.
 */
import { openDatabase, requestToPromise, STORES, transactionDone } from "./idb";

export interface StoredMedia {
  sha256: string;
  file: File;
  /** OPFS handle when the bytes live in OPFS (lets the decoder read lazily). */
  handle?: FileSystemFileHandle;
}

export interface MediaStore {
  readonly kind: "opfs" | "idb" | "memory";
  has(sha256: string): Promise<boolean>;
  /** Store `blob` under `sha256` (no-op when present). */
  put(sha256: string, blob: Blob, name: string): Promise<void>;
  get(sha256: string): Promise<StoredMedia | null>;
  remove(sha256: string): Promise<void>;
}

const MEDIA_DIR = "media";

function isHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export class OpfsMediaStore implements MediaStore {
  readonly kind = "opfs" as const;
  private dir: Promise<FileSystemDirectoryHandle> | null = null;

  static async supported(): Promise<boolean> {
    try {
      if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return false;
      const root = await navigator.storage.getDirectory();
      const probe = await root.getFileHandle(".zenvi-probe", { create: true });
      const ok = typeof (probe as FileSystemFileHandle & { createWritable?: unknown }).createWritable === "function";
      await root.removeEntry(".zenvi-probe").catch(() => undefined);
      return ok;
    } catch {
      return false;
    }
  }

  private directory(): Promise<FileSystemDirectoryHandle> {
    if (!this.dir) {
      this.dir = navigator.storage.getDirectory().then((root) => root.getDirectoryHandle(MEDIA_DIR, { create: true }));
    }
    return this.dir;
  }

  async has(sha256: string): Promise<boolean> {
    if (!isHash(sha256)) return false;
    try {
      const handle = await (await this.directory()).getFileHandle(sha256);
      const file = await handle.getFile();
      return file.size > 0;
    } catch {
      return false;
    }
  }

  async put(sha256: string, blob: Blob, _name: string): Promise<void> {
    if (!isHash(sha256)) throw new Error(`Not a SHA-256 hex digest: ${sha256}`);
    if (await this.has(sha256)) return;
    const dir = await this.directory();
    // Write to a temporary name, then rename, so a crash never leaves a
    // truncated file under the final (content-addressed) name.
    const tmpName = `${sha256}.part`;
    const tmp = await dir.getFileHandle(tmpName, { create: true });
    const writable = await tmp.createWritable();
    try {
      await blob.stream().pipeTo(writable);
    } catch (error) {
      await dir.removeEntry(tmpName).catch(() => undefined);
      throw error;
    }
    const movable = tmp as FileSystemFileHandle & { move?: (name: string) => Promise<void> };
    if (typeof movable.move === "function") {
      await movable.move(sha256);
    } else {
      const final = await dir.getFileHandle(sha256, { create: true });
      const out = await final.createWritable();
      await (await tmp.getFile()).stream().pipeTo(out);
      await dir.removeEntry(tmpName).catch(() => undefined);
    }
  }

  async get(sha256: string): Promise<StoredMedia | null> {
    if (!isHash(sha256)) return null;
    try {
      const handle = await (await this.directory()).getFileHandle(sha256);
      const file = await handle.getFile();
      if (file.size === 0) return null;
      return { sha256, file, handle };
    } catch {
      return null;
    }
  }

  async remove(sha256: string): Promise<void> {
    if (!isHash(sha256)) return;
    await (await this.directory()).removeEntry(sha256).catch(() => undefined);
  }
}

interface MediaRecord {
  sha256: string;
  blob: Blob;
  name: string;
  type: string;
}

export class IdbMediaStore implements MediaStore {
  readonly kind = "idb" as const;

  async has(sha256: string): Promise<boolean> {
    const db = await openDatabase();
    const tx = db.transaction(STORES.mediaBlobs, "readonly");
    const count = await requestToPromise(tx.objectStore(STORES.mediaBlobs).count(sha256));
    return count > 0;
  }

  async put(sha256: string, blob: Blob, name: string): Promise<void> {
    if (await this.has(sha256)) return;
    const db = await openDatabase();
    const tx = db.transaction(STORES.mediaBlobs, "readwrite");
    const record: MediaRecord = { sha256, blob, name, type: blob.type };
    tx.objectStore(STORES.mediaBlobs).put(record);
    await transactionDone(tx);
  }

  async get(sha256: string): Promise<StoredMedia | null> {
    const db = await openDatabase();
    const tx = db.transaction(STORES.mediaBlobs, "readonly");
    const record = (await requestToPromise(tx.objectStore(STORES.mediaBlobs).get(sha256))) as MediaRecord | undefined;
    if (!record) return null;
    return { sha256, file: new File([record.blob], record.name, { type: record.type }) };
  }

  async remove(sha256: string): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(STORES.mediaBlobs, "readwrite");
    tx.objectStore(STORES.mediaBlobs).delete(sha256);
    await transactionDone(tx);
  }
}

export class MemoryMediaStore implements MediaStore {
  readonly kind = "memory" as const;
  private readonly files = new Map<string, File>();

  async has(sha256: string): Promise<boolean> {
    return this.files.has(sha256);
  }

  async put(sha256: string, blob: Blob, name: string): Promise<void> {
    if (!this.files.has(sha256)) this.files.set(sha256, new File([blob], name, { type: blob.type }));
  }

  async get(sha256: string): Promise<StoredMedia | null> {
    const file = this.files.get(sha256);
    return file ? { sha256, file } : null;
  }

  async remove(sha256: string): Promise<void> {
    this.files.delete(sha256);
  }
}

let store: Promise<MediaStore> | null = null;

/** The best media store this browser supports (resolved once). */
export function mediaStore(): Promise<MediaStore> {
  if (!store) {
    store = (async () => {
      if (await OpfsMediaStore.supported()) return new OpfsMediaStore();
      try {
        await openDatabase();
        return new IdbMediaStore();
      } catch {
        return new MemoryMediaStore();
      }
    })();
  }
  return store;
}

/** Test hook. */
export function setMediaStore(next: MediaStore | null): void {
  store = next ? Promise.resolve(next) : null;
}

/** Ask the browser not to evict our storage under pressure (best effort, once). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate) return null;
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}
