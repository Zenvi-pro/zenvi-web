/**
 * A tiny promise wrapper over IndexedDB: one database for the editor, with
 * object stores created by version upgrades.
 */

export const DB_NAME = "zenvi-editor";
export const DB_VERSION = 1;

export const STORES = {
  /** Local project metadata (small; listed on the home page). */
  projects: "projects",
  /** Full project JSON, keyed like `projects`. */
  projectData: "projectData",
  /** Media blobs when OPFS is unavailable (keyed by sha256). */
  mediaBlobs: "mediaBlobs",
  /** Per-viewer key/value settings that must survive reloads. */
  kv: "kv",
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

function upgrade(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(STORES.projects)) {
    const store = db.createObjectStore(STORES.projects, { keyPath: "id" });
    store.createIndex("updatedAt", "updatedAt");
  }
  if (!db.objectStoreNames.contains(STORES.projectData)) db.createObjectStore(STORES.projectData, { keyPath: "id" });
  if (!db.objectStoreNames.contains(STORES.mediaBlobs)) db.createObjectStore(STORES.mediaBlobs, { keyPath: "sha256" });
  if (!db.objectStoreNames.contains(STORES.kv)) db.createObjectStore(STORES.kv);
}

let opening: Promise<IDBDatabase> | null = null;

export function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

export function openDatabase(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  if (opening && factory === indexedDB) return opening;
  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgraded the schema: close so it can proceed; reopen lazily.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB is blocked by another tab. Close other Zenvi tabs and retry."));
  });
  if (factory === indexedDB) {
    opening = promise;
    promise.catch(() => {
      opening = null;
    });
  }
  return promise;
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}
