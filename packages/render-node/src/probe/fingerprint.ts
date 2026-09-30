/**
 * Media fingerprints.
 *
 * `fingerprint()` is a port of zenvi-core src/classes/media_fingerprint.py:
 * SHA-256 over the decimal size, the first 1 MB and the last 1 MB. The
 * desktop stores it in `files[].fingerprint` and relinks moved media by
 * comparing it, so it must be computed the same way here. It is NOT a content
 * hash: never use it as a storage key.
 *
 * `sha256File()` is the full streaming content hash (cloud media are
 * content-addressed by it).
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import type { FileFingerprint } from "@zenvi/engine";

const SAMPLE_BYTES = 1024 * 1024;

/** Desktop-compatible fingerprint, or undefined for missing files and image-sequence patterns. */
export async function fingerprint(path: string): Promise<FileFingerprint | undefined> {
  if (!path || path.includes("%")) return undefined;
  let size: number;
  let mtime: number;
  try {
    const st = await stat(path);
    if (!st.isFile()) return undefined;
    size = st.size;
    // Python's os.stat().st_mtime: float seconds.
    mtime = st.mtimeMs / 1000;
  } catch {
    return undefined;
  }
  const digest = createHash("sha256");
  digest.update(String(size), "ascii");
  const handle = await open(path, "r");
  try {
    const head = Buffer.alloc(Math.min(SAMPLE_BYTES, size));
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    digest.update(head.subarray(0, bytesRead));
    if (size > SAMPLE_BYTES) {
      const tail = Buffer.alloc(SAMPLE_BYTES);
      const start = Math.max(0, size - SAMPLE_BYTES);
      const { bytesRead: tailRead } = await handle.read(tail, 0, tail.length, start);
      digest.update(tail.subarray(0, tailRead));
    }
  } finally {
    await handle.close();
  }
  return { size, mtime, sha256: digest.digest("hex") };
}

export interface HashProgress {
  bytes: number;
  total: number;
}

/** Full-file SHA-256 (lowercase hex), streamed. */
export async function sha256File(
  path: string,
  options: { signal?: AbortSignal; onProgress?: (p: HashProgress) => void } = {},
): Promise<string> {
  const total = (await stat(path)).size;
  const digest = createHash("sha256");
  let bytes = 0;
  const stream = createReadStream(path, { highWaterMark: 1024 * 1024, signal: options.signal });
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    digest.update(chunk);
    bytes += chunk.length;
    options.onProgress?.({ bytes, total });
  }
  return digest.digest("hex");
}
