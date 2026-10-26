/**
 * WorkerPreview: the page side of a preview rendered in a Worker. The canvas
 * is handed to the worker (`transferControlToOffscreen`); this side follows
 * the element's size, forwards projects and frame requests, and answers the
 * worker's questions about media (the page's `MediaRegistry` stays the one
 * place that knows where bytes are) and SVG (an `<img>` needs the DOM).
 */

import type { Project } from "@zenvi/engine";
import type { MediaRegistry } from "../../media/registry.js";
import type { MediaSourceSpec } from "../../media/source.js";
import { createImageElementSvgRasterizer } from "../../media/svg-dom.js";
import type { DecodeMode } from "../../video/decode-cursor.js";
import { observeDeviceSize } from "../canvas-binding.js";
import type { PreviewTarget, RenderErrorEvent } from "../preview-renderer.js";
import { cloneableError, type Endpoint, type FromWorker, type RendererLook, type ToWorker, type WireRequestInit, type WireResponse, type WireSource, type WorkerCall } from "./protocol.js";

/**
 * Whether this browser can preview in a Worker: OffscreenCanvas with a
 * transferable `<canvas>`, and WebCodecs (exposed to workers wherever it
 * exists on the page).
 */
export function canPreviewInWorker(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.transferControlToOffscreen === "function" &&
    typeof VideoDecoder !== "undefined"
  );
}

type WorkerEndpoint = Endpoint<ToWorker, FromWorker>;

/**
 * A canvas can be transferred once. Players created later on the same canvas
 * and worker (a remount; React StrictMode mounts twice) reuse the worker's copy.
 */
const surfaces = new WeakMap<object, { worker: WorkerEndpoint; surface: number }>();
let nextId = 1;

export class WorkerPreview implements PreviewTarget {
  private readonly id = nextId++;
  private seq = 0;
  private idleSeq = 0;
  private requested: number | null = null;
  private shown = 0;
  private presentedCount = 0;
  private dropped = 0;
  private calls = 0;
  private readonly replies = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
  private idle: (() => void)[] = [];
  private readonly busyListeners = new Set<(busy: boolean) => void>();
  private readonly errorListeners = new Set<(key: string, event: RenderErrorEvent) => void>();
  private readonly resizeListeners = new Set<() => void>();
  private readonly cleanup: (() => void)[] = [];
  private svgRasterizer: ReturnType<typeof createImageElementSvgRasterizer> | null = null;
  private disposed = false;

  constructor(
    private readonly worker: WorkerEndpoint,
    canvas: HTMLCanvasElement,
    private readonly media: MediaRegistry,
    look: RendererLook,
  ) {
    let known = surfaces.get(canvas);
    let offscreen: OffscreenCanvas | undefined;
    if (!known || known.worker !== worker) {
      offscreen = canvas.transferControlToOffscreen();
      known = { worker, surface: this.id };
      surfaces.set(canvas, known);
    }
    const listener = (event: MessageEvent<FromWorker>) => this.receive(event.data);
    worker.addEventListener("message", listener);
    this.cleanup.push(() => worker.removeEventListener("message", listener));
    const size = { width: canvas.width, height: canvas.height };
    this.post({ type: "open", id: this.id, surface: known.surface, ...(offscreen ? { canvas: offscreen } : {}), ...size, look }, offscreen ? [offscreen] : []);

    // The element keeps its layout; its backing store now lives in the worker.
    this.cleanup.push(
      observeDeviceSize(canvas, (width, height) => {
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));
        if (w === size.width && h === size.height) return;
        size.width = w;
        size.height = h;
        this.post({ type: "resize", id: this.id, width: w, height: h });
        for (const fn of [...this.resizeListeners]) fn();
      }),
      media.onInvalidate((key) => this.post({ type: "media-changed", id: this.id, key })),
    );
  }

  setProject(project: Project): void {
    this.post({ type: "project", id: this.id, project });
  }

  invalidate(): void {
    this.post({ type: "invalidate", id: this.id });
  }

  request(frame: number, mode: DecodeMode): void {
    if (this.disposed) return;
    const wasBusy = this.busy;
    this.seq += 1;
    this.requested = frame;
    this.post({ type: "render", id: this.id, seq: this.seq, frame, mode });
    if (!wasBusy) this.emitBusy(true);
  }

  wants(frame: number): boolean {
    return frame !== this.shown && frame !== this.requested;
  }

  whenIdle(): Promise<void> {
    if (!this.busy || this.disposed) return Promise.resolve();
    return new Promise((resolve) => this.idle.push(resolve));
  }

  get busy(): boolean {
    return this.idleSeq < this.seq;
  }

  get shownFrame(): number {
    return this.shown;
  }

  get presented(): number {
    return this.presentedCount;
  }

  get droppedFrames(): number {
    return this.dropped;
  }

  sweep(): void {
    this.post({ type: "sweep", id: this.id });
  }

  async snapshot(maxWidth: number): Promise<ImageBitmap | null> {
    const call = ++this.calls;
    const reply = new Promise<unknown>((resolve, reject) => this.replies.set(call, { resolve, reject }));
    this.post({ type: "snapshot", id: this.id, call, maxWidth });
    return (await reply) as ImageBitmap | null;
  }

  onBusy(listener: (busy: boolean) => void): () => void {
    this.busyListeners.add(listener);
    return () => this.busyListeners.delete(listener);
  }

  onError(listener: (key: string, event: RenderErrorEvent) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onResize(listener: () => void): () => void {
    this.resizeListeners.add(listener);
    return () => this.resizeListeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.post({ type: "close", id: this.id });
    this.disposed = true;
    for (const fn of this.cleanup.splice(0)) fn();
    for (const { reject } of this.replies.values()) reject(new Error("PreviewPlayer is disposed"));
    this.replies.clear();
    this.busyListeners.clear();
    this.errorListeners.clear();
    this.resizeListeners.clear();
    for (const resolve of this.idle.splice(0)) resolve();
  }

  // -------------------------------------------------------------------------

  private post(message: ToWorker, transfer: Transferable[] = []): void {
    if (!this.disposed) this.worker.postMessage(message, transfer);
  }

  private receive(message: FromWorker): void {
    if (message.id !== this.id || this.disposed) return;
    switch (message.type) {
      case "shown":
        this.shown = message.frame;
        this.presentedCount = message.presented;
        return;
      case "idle":
        this.dropped = message.dropped;
        this.idleSeq = Math.max(this.idleSeq, message.seq);
        if (this.busy) return;
        for (const resolve of this.idle.splice(0)) resolve();
        this.emitBusy(false);
        return;
      case "error":
        for (const listener of [...this.errorListeners]) listener(message.key, message.event);
        return;
      case "reply": {
        const pending = this.replies.get(message.call);
        this.replies.delete(message.call);
        if (message.error !== undefined) pending?.reject(message.error);
        else pending?.resolve(message.value);
        return;
      }
      case "call":
        void this.answer(message.call, message);
        return;
    }
  }

  private async answer(call: number, request: WorkerCall): Promise<void> {
    try {
      const { value, transfer } = await this.handle(request);
      this.post({ type: "reply", id: this.id, call, value }, transfer);
    } catch (error) {
      this.post({ type: "reply", id: this.id, call, error: cloneableError(error) });
    }
  }

  private async handle(request: WorkerCall): Promise<{ value: unknown; transfer: Transferable[] }> {
    switch (request.method) {
      case "source": {
        const key = this.media.keyOf(request.ref);
        const spec = this.media.spec(request.ref);
        const value: WireSource | null = key && spec ? { key, spec: wireSpec(spec) } : null;
        return { value, transfer: [] };
      }
      case "refresh": {
        const spec = this.urlSpec(request.key);
        if (!spec.refresh) throw new Error(`No way to refresh ${request.key}`);
        return { value: await spec.refresh(), transfer: [] };
      }
      case "fetch": {
        const spec = this.urlSpec(request.key);
        const response = await (spec.fetch ?? fetch)(request.url, { ...request.init, headers: request.init.headers ?? [] });
        const body = response.status === 204 || response.status === 304 ? null : await response.arrayBuffer();
        const value: WireResponse = { status: response.status, statusText: response.statusText, headers: [...response.headers], body };
        return { value, transfer: body ? [body] : [] };
      }
      case "svg": {
        this.svgRasterizer ??= createImageElementSvgRasterizer();
        const bitmap = await this.svgRasterizer(request.svg, request.width, request.height);
        return { value: bitmap, transfer: [bitmap] };
      }
    }
  }

  private urlSpec(key: string): Extract<MediaSourceSpec, { kind: "url" }> {
    const ref = key.startsWith("file:") ? { fileId: key.slice(5) } : { path: key.slice(5) };
    const spec = this.media.spec(ref);
    if (spec?.kind !== "url") throw new Error(`${key} is not URL media`);
    return spec;
  }

  private emitBusy(busy: boolean): void {
    for (const listener of [...this.busyListeners]) listener(busy);
  }
}

function wireSpec(spec: MediaSourceSpec): WireSource["spec"] {
  switch (spec.kind) {
    case "blob":
      return { kind: "blob", blob: spec.blob, ...(spec.name !== undefined ? { name: spec.name } : {}) };
    case "opfs":
      return { kind: "opfs", handle: spec.handle, ...(spec.name !== undefined ? { name: spec.name } : {}) };
    case "url":
      return {
        kind: "url",
        url: spec.url,
        ...(spec.name !== undefined ? { name: spec.name } : {}),
        ...(spec.requestInit ? { requestInit: wireInit(spec.requestInit) } : {}),
        refresh: Boolean(spec.refresh),
        fetch: Boolean(spec.fetch),
      };
  }
}

function wireInit(init: Omit<RequestInit, "signal">): WireRequestInit {
  const out: WireRequestInit = {};
  if (init.method) out.method = init.method;
  if (init.headers) out.headers = [...new Headers(init.headers)];
  if (init.credentials) out.credentials = init.credentials;
  if (init.mode) out.mode = init.mode;
  if (init.cache) out.cache = init.cache;
  if (init.referrer !== undefined) out.referrer = init.referrer;
  if (init.referrerPolicy) out.referrerPolicy = init.referrerPolicy;
  return out;
}
