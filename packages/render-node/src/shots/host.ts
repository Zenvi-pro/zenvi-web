/**
 * `ShotHost` for Node: SigLIP keyframe embeddings of local media, cached in
 * Zenvi's cache folder (`<cache>/shots/<model>/`) by file content, so a file
 * is embedded once however many projects use it.
 *
 * The cache key is the desktop fingerprint (size, first and last MB) rather
 * than a full content hash: hashing gigabytes of footage on every search
 * would cost more than embedding it, and two different videos of the same
 * size with the same first and last megabyte do not happen in practice.
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ShotEmbeddings, ShotHost, ShotModelStatus } from "@zenvi/engine";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { AbortedError, spawnManaged } from "../ffmpeg/process.js";
import { frames } from "../matte/generate.js";
import { modelDownloadMb, modelPresent, ensureModel, type ModelCacheOptions } from "../matte/model-cache.js";
import { onnxRuntimeAvailable } from "../matte/rvm.js";
import { fingerprint } from "../probe/fingerprint.js";
import { cacheDir } from "../svg/fonts.js";
import { SIGLIP_BASE, Siglip } from "./siglip.js";

const SIZE = 224;
const FRAME_BYTES = SIZE * SIZE * 3;
/** Frames embedded per model call while the decoder keeps reading. */
const CHUNK = 32;
const CACHE_FORMAT = 1;

export interface NodeShotHostOptions extends ModelCacheOptions {
  /** Project path → local file (default: the path itself). */
  resolveMedia?: (projectPath: string) => string;
  threads?: number;
}

interface CacheFile {
  format: number;
  model: string;
  version: string;
  interval: number;
  times: number[];
  dims: number;
  /** Float32 little-endian, keyframe after keyframe, base64. */
  vectors: string;
}

/**
 * ffmpeg arguments for 224 × 224 rgb24 keyframes (displayed orientation,
 * squashed like SiglipImageProcessor): the first frame, then the first frame
 * at least `interval` after the last one kept, so a clip shorter than the
 * interval still has a keyframe and keyframe i sits within a frame of
 * i × interval.
 */
export function keyframeArgs(file: string, interval: number): string[] {
  return ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", file, "-map", "0:v:0", "-an", "-sn", "-dn",
    "-vf", `select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,${interval - 0.001})',scale=${SIZE}:${SIZE}:flags=bicubic,format=rgb24`,
    "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"];
}

function encodeVectors(vectors: readonly Float32Array[]): string {
  const all = new Float32Array(vectors.reduce((n, v) => n + v.length, 0));
  let at = 0;
  for (const v of vectors) {
    all.set(v, at);
    at += v.length;
  }
  return Buffer.from(all.buffer).toString("base64");
}

function decodeVectors(base64: string, dims: number): Float32Array[] {
  const bytes = Buffer.from(base64, "base64");
  const all = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return Array.from({ length: Math.floor(all.length / dims) }, (_, i) => all.slice(i * dims, (i + 1) * dims));
}

export function createNodeShotHost(options: NodeShotHostOptions = {}): ShotHost {
  const model = new Siglip(options);
  const local = options.resolveMedia ?? ((p: string) => p);
  const root = path.join(options.root ?? cacheDir(options.env), "shots", SIGLIP_BASE.id);
  const missing = (): string =>
    `the shot model (SigLIP base, Apache-2.0) is not downloaded yet: a one-time ${modelDownloadMb(SIGLIP_BASE)} MB download into Zenvi's cache. ` +
    "Ask the person first, then call embed_media_tool with download=true (or run `zenvi shots setup`)";
  const status = async (): Promise<ShotModelStatus> => {
    if (!onnxRuntimeAvailable()) return { ready: false, detail: "shot embeddings need onnxruntime-node (npm install onnxruntime-node)" };
    if (await modelPresent(SIGLIP_BASE, options)) return { ready: true, detail: `${SIGLIP_BASE.name} (${SIGLIP_BASE.license}) is installed` };
    return { ready: false, detail: missing(), downloadMb: modelDownloadMb(SIGLIP_BASE) };
  };
  const requireReady = async (): Promise<void> => {
    const now = await status();
    if (!now.ready) throw new Error(now.detail);
  };

  async function cachePath(file: string, interval: number): Promise<string> {
    const fp = await fingerprint(file);
    if (!fp) throw new Error(`${file} is not a readable file`);
    return path.join(root, `${fp.sha256.slice(0, 32)}-${fp.size}-${interval}.json`);
  }

  async function compute(file: string, interval: number, signal?: AbortSignal): Promise<{ times: number[]; vectors: Float32Array[] }> {
    const decoder = spawnManaged(resolveBinary("ffmpeg", options.env), keyframeArgs(file, interval), { signal });
    const vectors: Float32Array[] = [];
    let pending: Uint8Array[] = [];
    try {
      for await (const rgb of frames(decoder.child.stdout! as AsyncIterable<Buffer>, FRAME_BYTES)) {
        pending.push(rgb);
        if (pending.length < CHUNK) continue;
        vectors.push(...(await model.embedImages(pending, signal)));
        pending = [];
      }
      if (pending.length > 0) vectors.push(...(await model.embedImages(pending, signal)));
      const code = await decoder.exited;
      if (decoder.spawnError()) throw decoder.spawnError()!;
      if (code !== 0) throw decoder.failure("decoding keyframes failed");
    } catch (error) {
      await decoder.kill();
      throw signal?.aborted ? new AbortedError() : error;
    }
    if (vectors.length === 0) throw new Error(`${path.basename(file)} has no video frames`);
    return { times: vectors.map((_, i) => Math.round(i * interval * 1000) / 1000), vectors };
  }

  return {
    model: model.info,
    status,
    async setup(signal) {
      if (!onnxRuntimeAvailable()) return status();
      await ensureModel(SIGLIP_BASE, { ...options, signal: signal ?? options.signal });
      return status();
    },
    async embedFile(projectPath, request): Promise<ShotEmbeddings | null> {
      const file = local(projectPath);
      const where = await cachePath(file, request.interval);
      const text = await readFile(where, "utf8").catch(() => undefined);
      if (text) {
        try {
          const cached = JSON.parse(text) as CacheFile;
          if (cached.format === CACHE_FORMAT && cached.version === model.info.version && cached.dims === model.info.dims) {
            return { times: cached.times, vectors: decodeVectors(cached.vectors, cached.dims), cached: true };
          }
        } catch {
          // A torn or foreign file: embed again and overwrite it.
        }
      }
      if (request.cachedOnly) return null;
      await requireReady();
      const started = performance.now();
      const made = await compute(file, request.interval, request.signal ?? options.signal);
      options.log?.(`embedded ${made.vectors.length} keyframes of ${file} in ${((performance.now() - started) / 1000).toFixed(1)} s`);
      const body: CacheFile = { format: CACHE_FORMAT, model: model.info.name, version: model.info.version, interval: request.interval, times: made.times, dims: model.info.dims, vectors: encodeVectors(made.vectors) };
      await mkdir(root, { recursive: true });
      const part = `${where}.part-${process.pid}-${Math.random().toString(36).slice(2)}`;
      try {
        await writeFile(part, JSON.stringify(body));
        await rename(part, where);
      } finally {
        await rm(part, { force: true });
      }
      return { ...made, cached: false };
    },
    async embedFrames(projectPath, times, signal) {
      await requireReady();
      const file = local(projectPath);
      const ffmpeg = resolveBinary("ffmpeg", options.env);
      const rgb: Uint8Array[] = [];
      for (const t of times) {
        const child = spawnManaged(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-ss", String(Math.max(0, t)), "-i", file, "-frames:v", "1",
          "-vf", `scale=${SIZE}:${SIZE}:flags=bicubic,format=rgb24`, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { signal });
        let frame: Uint8Array | undefined;
        for await (const f of frames(child.child.stdout! as AsyncIterable<Buffer>, FRAME_BYTES)) frame ??= f;
        const code = await child.exited;
        if (child.spawnError()) throw child.spawnError()!;
        if (code !== 0 || !frame) throw child.failure(`reading the frame at ${t} s of ${path.basename(file)} failed`);
        rgb.push(frame);
      }
      return model.embedImages(rgb, signal);
    },
    async embedText(texts, signal) {
      await requireReady();
      return model.embedText(texts, signal);
    },
  };
}
