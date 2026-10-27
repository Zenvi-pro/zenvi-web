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

/** A Worker as the page sees it: messages, plus the events that say it is broken. */
export type WorkerEndpoint = Endpoint<ToWorker, FromWorker> & {
  addEventListener(type: "error" | "messageerror", listener: (event: Event) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: (event: Event) => void): void;
};

/**
 * The preview Worker failed to start, stopped answering or lost a message.
 * The player then renders on the page.
 */
export class PreviewWorkerError extends Error {
  override readonly name = "PreviewWorkerError";
}

/**
 * No answer to `open` in this long: the worker never started (a module that
 * hangs loading; a 404 or a syntax error fire `error` sooner).
 */
const OPEN_TIMEOUT_MS = 15_000;
/** Waiting on a started worker and silent this long: ask whether it is still there. */
const PING_AFTER_MS = 2_000;
/**
 * Waiting on a started worker and silent this long, pings unanswered: it is
 * gone (terminated, crashed: browsers fire no event for either).
 */
const DEAD_AFTER_MS = 8_000;
const CHECK_EVERY_MS = 1_000;

/**
 * A canvas can be transferred once. Players created later on the same canvas
 * and worker (a remount; React StrictMode mounts twice) reuse the worker's copy.
 */
const surfaces = new WeakMap<object, { worker: WorkerEndpoint; surface: number }>();
/** Workers that have sent anything: their module loaded, so an `error` is an uncaught exception, not a failed start. */
const started = new WeakSet<object>();
/** Workers that failed, and why: players created on them later render on the page. */
const failed = new WeakMap<object, PreviewWorkerError>();
let nextId = 1;

/** Why `worker` cannot preview any more, if it failed. */
export function workerFailure(worker: object): PreviewWorkerError | undefined {
  return failed.get(worker);
}

/** Whether `canvas`'s pixels were handed to a worker (it cannot draw on the page again). */
export function isTransferred(canvas: object): boolean {
  return surfaces.has(canvas);
}

/**
 * A canvas standing in for a transferred one: the same attributes (classes,
 * style, label), right after it; the original is hidden until `remove`.
 */
export function standInCanvas(canvas: HTMLCanvasElement): { canvas: HTMLCanvasElement; remove(): void } {
  const fresh = canvas.ownerDocument.createElement("canvas");
  for (const { name, value } of [...canvas.attributes]) if (name !== "id" && name !== "width" && name !== "height") fresh.setAttribute(name, value);
  canvas.after(fresh);
  const display = canvas.style.display;
  canvas.style.display = "none";
  return {
    canvas: fresh,
    remove() {
      fresh.remove();
      canvas.style.display = display;
    },
  };
}

export class WorkerPreview implements PreviewTarget {
  private readonly id = nextId++;
  private seq = 0;
  private idleSeq = 0;
  private requested: number | null = null;
  private shown = 0;
  private presentedCount = 0;
  private scaleShown = 1;
  private dropped = 0;
  private calls = 0;
  private readonly replies = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
  private idle: { resolve: () => void; reject: (error: unknown) => void }[] = [];
  private readonly busyListeners = new Set<(busy: boolean) => void>();
  private readonly errorListeners = new Set<(key: string, event: RenderErrorEvent) => void>();
  private readonly resizeListeners = new Set<() => void>();
  private readonly failListeners = new Set<(error: PreviewWorkerError) => void>();
  private readonly cleanup: (() => void)[] = [];
  /** The page's answers to the worker's `fetch` calls, abortable by the worker. */
  private readonly aborts = new Map<number, AbortController>();
  private svgRasterizer: ReturnType<typeof createImageElementSvgRasterizer> | null = null;
  private opened = false;
  /** When the worker last said anything (or when we started waiting on it). */
  private heard = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private failure: PreviewWorkerError | null = null;
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
    const onError = (event: Event) => this.workerError(event);
    const onMessageError = () => this.fail(new PreviewWorkerError("A message from the preview worker could not be read"));
    worker.addEventListener("message", listener);
    worker.addEventListener("error", onError);
    worker.addEventListener("messageerror", onMessageError);
    this.cleanup.push(() => {
      worker.removeEventListener("message", listener);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("messageerror", onMessageError);
    });
    const size = { width: canvas.width, height: canvas.height };
    this.post({ type: "open", id: this.id, surface: known.surface, ...(offscreen ? { canvas: offscreen } : {}), ...size, look }, offscreen ? [offscreen] : []);
    this.watch();

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
    this.watch();
    if (!wasBusy) this.emitBusy(true);
  }

  wants(frame: number): boolean {
    return frame !== this.shown && frame !== this.requested;
  }

  /** Rejects with a `PreviewWorkerError` when the worker fails first. */
  whenIdle(): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (!this.busy || this.disposed) return Promise.resolve();
    return new Promise((resolve, reject) => this.idle.push({ resolve, reject }));
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

  get shownScale(): number {
    return this.scaleShown;
  }

  get droppedFrames(): number {
    return this.dropped;
  }

  sweep(): void {
    this.post({ type: "sweep", id: this.id });
  }

  async snapshot(maxWidth: number): Promise<ImageBitmap | null> {
    if (this.failure) throw this.failure;
    const call = ++this.calls;
    const reply = new Promise<unknown>((resolve, reject) => this.replies.set(call, { resolve, reject }));
    this.post({ type: "snapshot", id: this.id, call, maxWidth });
    this.watch();
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

  /** The worker failed (once): nothing more renders here; pending waits reject with the same error. */
  onFail(listener: (error: PreviewWorkerError) => void): () => void {
    this.failListeners.add(listener);
    return () => this.failListeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.post({ type: "close", id: this.id });
    this.disposed = true;
    this.stopWatching();
    for (const fn of this.cleanup.splice(0)) fn();
    for (const controller of this.aborts.values()) controller.abort();
    this.aborts.clear();
    for (const { reject } of this.replies.values()) reject(new Error("PreviewPlayer is disposed"));
    this.replies.clear();
    this.busyListeners.clear();
    this.errorListeners.clear();
    this.resizeListeners.clear();
    this.failListeners.clear();
    for (const { resolve } of this.idle.splice(0)) resolve();
  }

  // -------------------------------------------------------------------------

  private post(message: ToWorker, transfer: Transferable[] = []): void {
    if (this.disposed || this.failure) return;
    const known = failed.get(this.worker);
    if (known) {
      // Another player found this worker dead; fail after the caller's own bookkeeping.
      queueMicrotask(() => this.fail(known));
      return;
    }
    this.worker.postMessage(message, transfer);
  }

  /** Something waits on the worker: watch that it answers. */
  private watch(): void {
    if (this.watchdog !== null || this.disposed || this.failure) return;
    this.heard = performance.now();
    this.watchdog = setInterval(() => this.check(), CHECK_EVERY_MS);
  }

  private stopWatching(): void {
    if (this.watchdog !== null) clearInterval(this.watchdog);
    this.watchdog = null;
  }

  private check(): void {
    if (this.opened && !this.busy && this.replies.size === 0) {
      this.stopWatching();
      return;
    }
    const silent = performance.now() - this.heard;
    if (!this.opened) {
      if (silent >= OPEN_TIMEOUT_MS) this.fail(new PreviewWorkerError(`The preview worker did not start within ${OPEN_TIMEOUT_MS / 1000} s`));
      return;
    }
    if (silent >= DEAD_AFTER_MS) this.fail(new PreviewWorkerError(`The preview worker stopped answering for ${DEAD_AFTER_MS / 1000} s`));
    else if (silent >= PING_AFTER_MS) this.post({ type: "ping", id: this.id });
  }

  private workerError(event: Event): void {
    const detail = "message" in event && typeof event.message === "string" && event.message ? event.message : "";
    // Before its first message the module itself failed (404, syntax error, a throwing import).
    if (!started.has(this.worker)) {
      this.fail(new PreviewWorkerError(`The preview worker failed to start${detail ? `: ${detail}` : ""}`));
      return;
    }
    // Later, an uncaught exception: the worker lives on (the watchdog notices if it does not).
    const error = new Error(`Uncaught in the preview worker${detail ? `: ${detail}` : ""}`);
    for (const listener of [...this.errorListeners]) listener(`worker:${detail}`, { kind: "render", error });
  }

  private fail(error: PreviewWorkerError): void {
    if (this.failure || this.disposed) return;
    // A worker that ran may still be alive (a lost message, one frame past the watchdog): free this
    // player's session there (its renderer, caches, decoders), since nothing will post to it again.
    if (started.has(this.worker)) {
      try {
        this.worker.postMessage({ type: "close", id: this.id } satisfies ToWorker, []);
      } catch {
        // The worker is gone; so is the session.
      }
    }
    this.failure = error;
    if (!failed.has(this.worker)) {
      failed.set(this.worker, error);
      console.warn(`${error.message}; the preview renders on the page instead.`);
    }
    this.stopWatching();
    for (const controller of this.aborts.values()) controller.abort();
    this.aborts.clear();
    for (const { reject } of this.replies.values()) reject(error);
    this.replies.clear();
    for (const { reject } of this.idle.splice(0)) reject(error);
    for (const listener of [...this.failListeners]) listener(error);
  }

  private receive(message: FromWorker): void {
    started.add(this.worker);
    // Any word from the worker (to any player) proves it is alive.
    this.heard = performance.now();
    if (message.id !== this.id || this.disposed || this.failure) return;
    switch (message.type) {
      case "opened":
        if (message.error !== undefined) {
          this.fail(new PreviewWorkerError(`The preview worker could not open this canvas: ${String(message.error)}`));
          return;
        }
        this.opened = true;
        return;
      case "pong":
        return;
      case "abort":
        this.aborts.get(message.call)?.abort();
        return;
      case "shown":
        this.shown = message.frame;
        this.presentedCount = message.presented;
        this.scaleShown = message.scale;
        return;
      case "idle":
        this.dropped = message.dropped;
        this.idleSeq = Math.max(this.idleSeq, message.seq);
        if (this.busy) return;
        for (const { resolve } of this.idle.splice(0)) resolve();
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
      const { value, transfer } = await this.handle(call, request);
      this.post({ type: "reply", id: this.id, call, value }, transfer);
    } catch (error) {
      this.post({ type: "reply", id: this.id, call, error: cloneableError(error) });
    }
  }

  private async handle(call: number, request: WorkerCall): Promise<{ value: unknown; transfer: Transferable[] }> {
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
        const controller = new AbortController();
        this.aborts.set(call, controller);
        try {
          const response = await (spec.fetch ?? fetch)(request.url, { ...request.init, signal: controller.signal });
          // Opaque responses (status 0) have no readable body; null-body statuses cannot carry one.
          const body = response.status === 0 || NULL_BODY_STATUS.has(response.status) ? null : await response.arrayBuffer();
          const value: WireResponse = { status: response.status, statusText: response.statusText, headers: [...response.headers], body };
          return { value, transfer: body ? [body] : [] };
        } finally {
          this.aborts.delete(call);
        }
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

const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

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
  if (init.redirect) out.redirect = init.redirect;
  if (init.integrity !== undefined) out.integrity = init.integrity;
  if (init.keepalive !== undefined) out.keepalive = init.keepalive;
  return out;
}
