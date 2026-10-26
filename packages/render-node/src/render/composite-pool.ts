/**
 * `CompositePool`: the engine's CPU compositor on worker threads, so a
 * render composites several frames at once while the main thread plans,
 * decodes and feeds the encoder.
 *
 * Pixels are identical to compositing on the main thread: every worker runs
 * the same `compositeFrame`, and frames with an effect that keeps state
 * across frames (DenoiseImage, BeatSync, SphericalProjection:
 * `KernelSpec.sequential`) all go to worker 0 in timeline order, so those
 * effects see the same sequence as a single-threaded render. Other frames,
 * effects included (Color Grade, Film Grain: pure per frame), are
 * independent and go to the least busy worker.
 *
 * Workers load `composite-worker.mjs` next to a bundle (the CLI and cloud
 * builds emit it) or, from the source tree, the tsx dev entry. When neither
 * can start, `CompositePool.start` returns undefined and the render
 * composites on the main thread as before.
 */

import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { FramePlan, RgbaImage } from "@zenvi/engine";
import { isSequentialEffect } from "@zenvi/engine/render";
import type { PreparedFrame } from "../decode/sources.js";
import { processLimits, type ContainerLimits } from "../limits.js";
import { bundleDir } from "../resources.js";
import type { CompositeRequest, CompositeResponse, WireImage } from "./composite-worker.js";

/** Per-worker budget for cached still images (masks, titles, photos). */
const CACHE_BYTES = 128 * 1024 * 1024;
/** What one worker costs on top of its still-image cache: its own heap, the compositor and frames in flight. */
const WORKER_OVERHEAD_BYTES = 96 * 1024 * 1024;
/** Share of a container's memory limit the workers may take; the rest is the main thread's decode and encode. */
const WORKER_MEMORY_SHARE = 0.25;
/** Renders shorter than this composite on the main thread (worker start-up costs more). */
const MIN_POOL_FRAMES = 60;
const MAX_THREADS = 4;

/**
 * Worker threads for a render of `frames` frames: `ZENVI_RENDER_THREADS`
 * when set (0 disables the pool), else up to 4, one core left for the main
 * thread, ffmpeg and the encoder. In a container the CPU quota and the
 * memory limit bound it too, so a small one composites on the main thread.
 */
export function compositeThreads(frames: number, env: NodeJS.ProcessEnv = process.env, limits: ContainerLimits = processLimits()): number {
  const forced = env.ZENVI_RENDER_THREADS?.trim();
  if (forced) {
    const n = Number(forced);
    return Number.isInteger(n) && n >= 0 ? Math.min(n, 16) : 0;
  }
  if (frames < MIN_POOL_FRAMES) return 0;
  const cpus = limits.cpus === undefined ? availableParallelism() : Math.min(availableParallelism(), Math.max(1, Math.floor(limits.cpus)));
  const byMemory = limits.memoryBytes === undefined ? MAX_THREADS : Math.floor((limits.memoryBytes * WORKER_MEMORY_SHARE) / (CACHE_BYTES + WORKER_OVERHEAD_BYTES));
  return Math.max(0, Math.min(MAX_THREADS, cpus - 1, byMemory, Math.ceil(frames / 30)));
}

/** The worker script for this build, if one exists. */
export function compositeWorkerScript(): string | undefined {
  const bundle = bundleDir();
  if (bundle) {
    const file = path.join(bundle, "composite-worker.mjs");
    return existsSync(file) ? file : undefined;
  }
  const dev = fileURLToPath(new URL("./composite-worker-dev.mjs", import.meta.url));
  return existsSync(dev) ? dev : undefined;
}

interface Pending {
  resolve(image: RgbaImage): void;
  reject(error: Error): void;
}

class Slot {
  readonly pending = new Map<number, Pending>();
  /** Still images this worker holds, oldest first (mirrors the worker's cache). */
  readonly cached = new Map<RgbaImage, { key: number; bytes: number }>();
  cachedBytes = 0;
  failure: Error | undefined;
  readonly ready: Promise<void>;

  constructor(readonly worker: Worker) {
    this.ready = new Promise<void>((resolve, reject) => {
      const onMessage = (message: unknown) => {
        if ((message as { ready?: boolean }).ready) {
          worker.off("message", onMessage);
          resolve();
        }
      };
      worker.on("message", onMessage);
      worker.once("error", reject);
      worker.once("exit", (code) => reject(new Error(`composite worker exited (${code}) before it was ready`)));
    });
    worker.on("message", (message: CompositeResponse | { ready: true }) => {
      if ("ready" in message) return;
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if ("image" in message) waiter.resolve(message.image);
      else waiter.reject(new Error(`Compositing failed: ${message.error}`));
    });
    const fail = (error: Error) => {
      this.failure ??= error;
      for (const waiter of this.pending.values()) waiter.reject(this.failure);
      this.pending.clear();
    };
    worker.on("error", fail);
    worker.on("exit", (code) => fail(new Error(`composite worker exited (${code})`)));
  }
}

export class CompositePool {
  private nextId = 1;
  private nextKey = 1;
  private closed = false;

  private constructor(private readonly slots: Slot[]) {}

  get size(): number {
    return this.slots.length;
  }

  /**
   * Start `threads` workers and wait until they have loaded the compositor.
   * Undefined when there is no worker script or a worker fails to start.
   */
  static async start(threads: number, log?: (message: string) => void): Promise<CompositePool | undefined> {
    if (threads <= 0) return undefined;
    const script = compositeWorkerScript();
    if (!script) return undefined;
    const slots: Slot[] = [];
    try {
      for (let i = 0; i < threads; i += 1) {
        // Never let a worker write to stdout: it carries the MCP stdio protocol.
        const worker = new Worker(script, { stdout: true });
        worker.stdout.on("data", (chunk: Buffer) => process.stderr.write(chunk));
        slots.push(new Slot(worker));
      }
      await Promise.all(slots.map((s) => s.ready));
      return new CompositePool(slots);
    } catch (error) {
      log?.(`composite workers unavailable, compositing on the main thread: ${error instanceof Error ? error.message : String(error)}`);
      await Promise.all(slots.map((s) => s.worker.terminate()));
      return undefined;
    }
  }

  /** Cache `image` in `slot` (or refresh it) and return its key; evictions go to `evict`. */
  private cacheIn(slot: Slot, image: RgbaImage, store: CompositeRequest["store"], evict: number[], keep: Set<RgbaImage>): number {
    keep.add(image);
    const hit = slot.cached.get(image);
    if (hit) {
      slot.cached.delete(image);
      slot.cached.set(image, hit);
      return hit.key;
    }
    const entry = { key: this.nextKey++, bytes: image.data.byteLength };
    slot.cached.set(image, entry);
    slot.cachedBytes += entry.bytes;
    store.push({ key: entry.key, image });
    for (const [old, info] of slot.cached) {
      if (slot.cachedBytes <= CACHE_BYTES) break;
      if (keep.has(old)) continue;
      slot.cached.delete(old);
      slot.cachedBytes -= info.bytes;
      evict.push(info.key);
    }
    return entry.key;
  }

  /** Composite `plan` with its decoded sources on a worker. */
  composite(plan: FramePlan, prepared: PreparedFrame, text: boolean): Promise<RgbaImage> {
    if (this.closed) return Promise.reject(new Error("CompositePool is closed"));
    const ordered = plan.layers.some((layer) => layer.effects.some((effect) => isSequentialEffect(effect.type)));
    let slot = this.slots[0]!;
    if (!ordered) {
      for (const candidate of this.slots) if (candidate.pending.size < slot.pending.size) slot = candidate;
    }
    if (slot.failure) return Promise.reject(slot.failure);

    const store: CompositeRequest["store"] = [];
    const evict: number[] = [];
    const keep = new Set<RgbaImage>();
    const stable = (image: RgbaImage): WireImage => ({ ref: this.cacheIn(slot, image, store, evict, keep) });
    const layers = plan.layers.map((layer, i): WireImage | null => {
      const image = prepared.layers[i];
      if (!image) return null;
      // Stills come from the still cache (same object every frame); video frames are new.
      return layer.source.kind === "image" || layer.source.kind === "svg" ? stable(image) : { image };
    });
    const images = [...prepared.images].map(([p, image]): [string, WireImage] => [p, stable(image)]);
    // Video frames an effect reads are new every frame: inline, so they never push stills out of the cache.
    const layerImages = prepared.layerImages.map((own) => (own ? [...own].map(([p, image]): [string, WireImage] => [p, { image }]) : null));
    const request: CompositeRequest = {
      type: "composite",
      id: this.nextId++,
      plan,
      layers,
      images,
      layerImages,
      texts: [...prepared.texts],
      audio: prepared.audio,
      text,
      store,
      evict,
    };
    return new Promise<RgbaImage>((resolve, reject) => {
      slot.pending.set(request.id, { resolve, reject });
      try {
        slot.worker.postMessage(request);
      } catch (error) {
        slot.pending.delete(request.id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.all(this.slots.map((s) => s.worker.terminate()));
  }
}
