/**
 * `MediaHost.kitSample` on local disk: the recorded SFX kit's sounds
 * (engine sfx/recorded.ts) downloaded from Freesound's CDN on first use
 * into `<cache>/sfx-kit/<sha256>.mp3`, shared by every project, and checked
 * against the kit's checksum before they are kept or used.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** The only place kit sounds come from. */
const KIT_ORIGIN = "https://cdn.freesound.org/";
/** Kit sounds are short previews; this stops anything else. */
const MAX_SAMPLE_BYTES = 4 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

export interface KitSampleOptions {
  /** Zenvi's cache folder; the kit lives in its `sfx-kit` folder. */
  cacheRoot: string;
  fetchImpl?: typeof fetch;
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export function createKitSampleCache(options: KitSampleOptions): (sample: { url: string; sha256: string; bytes: number }, opts?: { signal?: AbortSignal }) => Promise<string> {
  const doFetch = options.fetchImpl ?? fetch;
  const dir = path.join(options.cacheRoot, "sfx-kit");
  return async (sample, opts = {}) => {
    if (!/^[0-9a-f]{64}$/.test(sample.sha256)) throw new Error("the kit sound has no valid checksum.");
    if (!sample.url.startsWith(KIT_ORIGIN)) throw new Error(`${sample.url} is not on Freesound's CDN.`);
    const dest = path.join(dir, `${sample.sha256}.mp3`);
    const have = await readFile(dest).catch(() => undefined);
    if (have && sha256(have) === sample.sha256) return dest;
    const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) : AbortSignal.timeout(FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await doFetch(sample.url, { signal, redirect: "error" });
    } catch (error) {
      throw new Error(`could not reach Freesound (${error instanceof Error ? error.message : String(error)}).`);
    }
    if (!response.ok) throw new Error(`Freesound answered ${response.status} for ${sample.url}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_SAMPLE_BYTES) throw new Error(`${sample.url} is ${bytes.length} bytes, too large for a kit sound.`);
    if (sha256(bytes) !== sample.sha256) throw new Error(`${sample.url} does not match the kit's checksum (Freesound changed the file).`);
    await mkdir(dir, { recursive: true });
    // Written beside, then renamed: another process reading the cache never sees half a file.
    const temp = `${dest}.${process.pid}.${Date.now()}.part`;
    try {
      await writeFile(temp, bytes);
      await rename(temp, dest);
    } finally {
      await rm(temp, { force: true });
    }
    return dest;
  };
}
