import type { FileFingerprint } from "@zenvi/engine";
import { sha256Blob, toHex } from "./sha256";

/** Files at or below this size are hashed with WebCrypto in one shot. */
const SMALL_FILE = 32 * 1024 * 1024;

type Pending = { resolve: (hex: string) => void; reject: (error: Error) => void; onProgress?: (fraction: number) => void };

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === "undefined") return null;
  if (!worker) {
    try {
      worker = new Worker(new URL("./hash.worker.ts", import.meta.url), { type: "module", name: "zenvi-hash" });
      worker.onmessage = (event: MessageEvent<{ id: number; sha256?: string; progress?: number; error?: string }>) => {
        const job = pending.get(event.data.id);
        if (!job) return;
        if (event.data.progress !== undefined) {
          job.onProgress?.(event.data.progress);
          return;
        }
        pending.delete(event.data.id);
        if (event.data.sha256) job.resolve(event.data.sha256);
        else job.reject(new Error(event.data.error ?? "Hashing failed"));
      };
      worker.onerror = () => {
        workerBroken = true;
        for (const job of pending.values()) job.reject(new Error("Hash worker failed"));
        pending.clear();
        worker?.terminate();
        worker = null;
      };
    } catch {
      workerBroken = true;
      return null;
    }
  }
  return worker;
}

/**
 * SHA-256 of a file as lowercase hex. Small files use WebCrypto; big files
 * stream through a Worker so the UI stays responsive (falls back to hashing
 * on the main thread in slices when Workers are unavailable).
 */
export async function hashFile(file: Blob, onProgress?: (fraction: number) => void): Promise<string> {
  if (file.size <= SMALL_FILE && typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    onProgress?.(1);
    return toHex(new Uint8Array(digest));
  }
  const w = getWorker();
  if (!w) return sha256Blob(file, (done, total) => onProgress?.(total ? done / total : 1));
  const id = nextId++;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    w.postMessage({ id, file });
  });
}

const SAMPLE_BYTES = 1024 * 1024;

/**
 * The desktop's fast partial fingerprint (zenvi-core
 * src/classes/media_fingerprint.py:14 `fingerprint`): SHA-256 of the decimal
 * size, the first 1 MB and, when larger, the last 1 MB. It identifies a file
 * for relinking; it is NOT a content address (use the full-file hash).
 */
export async function partialFingerprint(file: File): Promise<FileFingerprint & { mtime: number }> {
  const size = file.size;
  const parts: Uint8Array[] = [new TextEncoder().encode(String(size)), new Uint8Array(await file.slice(0, SAMPLE_BYTES).arrayBuffer())];
  if (size > SAMPLE_BYTES) parts.push(new Uint8Array(await file.slice(Math.max(0, size - SAMPLE_BYTES), size).arrayBuffer()));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    joined.set(p, offset);
    offset += p.length;
  }
  const digest = await crypto.subtle.digest("SHA-256", joined);
  return { size, mtime: file.lastModified / 1000, sha256: toHex(new Uint8Array(digest)) };
}
