/**
 * Worker side of `CompositePool`: runs the engine's `compositeFrame` on
 * frames posted by the render loop and posts the canvas back (transferred).
 *
 * Each worker keeps its own `CompositorState`. The pool sends every frame
 * that has clip effects to worker 0, in timeline order, so stateful effects
 * (Denoise, BeatSync…) see exactly the frame sequence of a single-threaded
 * render; frames without effects never touch the state.
 *
 * Still images (masks, title rasters, photos) are sent once and kept in a
 * per-worker cache whose contents the pool decides (it mirrors the LRU and
 * names the keys to drop), so a 4K mask is not copied for every frame.
 */

import { parentPort } from "node:worker_threads";
import type { FramePlan, KernelAudio, RgbaImage, TextRasterizer } from "@zenvi/engine";
import { compositeFrame, createCompositorState } from "@zenvi/engine/render";
import { nodeTextRasterizer } from "../svg/text.js";

/** An image in a request: inline (copied by postMessage) or a key into the worker's cache. */
export type WireImage = { image: RgbaImage } | { ref: number };

export interface CompositeRequest {
  type: "composite";
  id: number;
  plan: FramePlan;
  layers: (WireImage | null)[];
  images: Array<[string, WireImage]>;
  texts: Array<[string, string]>;
  audio: (KernelAudio | null)[];
  /** The frame needs the font rasterizer (Caption, Timer). */
  text: boolean;
  /** Store these in the cache before compositing. */
  store: Array<{ key: number; image: RgbaImage }>;
  /** Drop these cache keys first. */
  evict: number[];
}

export type CompositeResponse = { id: number; image: RgbaImage } | { id: number; error: string };

const cache = new Map<number, RgbaImage>();
const state = createCompositorState();
let text: Promise<TextRasterizer> | undefined;

function resolveImage(wire: WireImage): RgbaImage {
  if ("image" in wire) return wire.image;
  const hit = cache.get(wire.ref);
  if (!hit) throw new Error(`composite worker: image ${wire.ref} is not cached`);
  return hit;
}

async function handle(request: CompositeRequest): Promise<CompositeResponse> {
  for (const key of request.evict) cache.delete(key);
  for (const entry of request.store) cache.set(entry.key, entry.image);
  const rasterizer = request.text ? await (text ??= nodeTextRasterizer()) : undefined;
  const image = compositeFrame(request.plan, {
    layers: request.layers.map((l) => (l ? resolveImage(l) : null)),
    images: new Map(request.images.map(([path, wire]) => [path, resolveImage(wire)])),
    texts: new Map(request.texts),
    audio: request.audio,
    text: rasterizer,
    state,
  });
  return { id: request.id, image };
}

const port = parentPort;
if (port) {
  // Requests are handled strictly in arrival order (the ordered lane relies on it).
  let chain: Promise<void> = Promise.resolve();
  port.on("message", (request: CompositeRequest) => {
    chain = chain.then(async () => {
      let response: CompositeResponse;
      try {
        response = await handle(request);
      } catch (error) {
        response = { id: request.id, error: error instanceof Error ? (error.stack ?? error.message) : String(error) };
      }
      if ("image" in response) port.postMessage(response, [response.image.data.buffer as ArrayBuffer]);
      else port.postMessage(response);
    });
  });
  port.postMessage({ ready: true });
}
