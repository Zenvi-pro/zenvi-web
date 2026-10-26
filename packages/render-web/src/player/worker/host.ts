/**
 * The worker side of `WorkerPreview`: one `PreviewRenderer` per player on
 * the `OffscreenCanvas` the page transferred, decoding and running effects
 * kernels here. Each renderer has its own `MediaRegistry`, filled on demand
 * from the page's (`source` calls) and dropped entry by entry when the page's
 * bytes change.
 */

import type { RenderEngine } from "../../engine.js";
import { MediaRegistry, type MediaRef } from "../../media/registry.js";
import type { MediaSourceSpec } from "../../media/source.js";
import type { SvgRasterizer } from "../../media/svg.js";
import { bindCanvas } from "../canvas-binding.js";
import { PreviewRenderer, type RenderErrorEvent } from "../preview-renderer.js";
import { cloneableError, type Endpoint, type FromWorker, type ToWorker, type WireRequestInit, type WireResponse, type WireSource, type WireSpec, type WorkerCall } from "./protocol.js";

export interface PreviewWorkerOptions {
  /** Planner and kernels. Default: `@zenvi/engine`. */
  engine?: RenderEngine;
}

type Scope = Endpoint<FromWorker, ToWorker>;

/** Answer `WorkerPreview`s on `scope` (the worker's global scope). */
export function servePreviewWorker(scope: Scope, options: PreviewWorkerOptions = {}): () => void {
  const sessions = new Map<number, Session>();
  // Transferred canvases outlive their first player (a remount draws on the same element).
  const canvases = new Map<number, OffscreenCanvas>();

  const listener = (event: MessageEvent<ToWorker>) => {
    const message = event.data;
    if (message.type === "open") {
      const canvas = message.canvas ?? canvases.get(message.surface);
      if (!canvas) return;
      canvases.set(message.surface, canvas);
      sessions.get(message.id)?.close();
      sessions.set(message.id, new Session(scope, message.id, canvas, message, options));
      return;
    }
    const session = sessions.get(message.id);
    if (!session) return;
    if (message.type === "close") {
      sessions.delete(message.id);
      session.close();
      return;
    }
    session.receive(message);
  };
  scope.addEventListener("message", listener);
  return () => {
    scope.removeEventListener("message", listener);
    for (const session of sessions.values()) session.close();
    sessions.clear();
    canvases.clear();
  };
}

class Session {
  private readonly media: MediaRegistry;
  private readonly renderer: PreviewRenderer;
  private readonly canvas: OffscreenCanvas;
  /** Path-only media the page resolved (transition masks, bundled assets). */
  private readonly paths = new Map<string, MediaSourceSpec>();
  /** Paths the page resolved for refs that also carry a file id, by that id (registering it there wins). */
  private readonly pathsOfFile = new Map<string, Set<string>>();
  private readonly lookups = new Map<string, Promise<void>>();
  private calls = 0;
  private readonly replies = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
  private lastSeq = 0;
  private closed = false;

  constructor(
    private readonly scope: Scope,
    private readonly id: number,
    canvas: OffscreenCanvas,
    open: Extract<ToWorker, { type: "open" }>,
    options: PreviewWorkerOptions,
  ) {
    this.canvas = canvas;
    this.media = new MediaRegistry({ resolvePath: (path) => this.paths.get(path) });
    const surface = bindCanvas(canvas, { transparent: open.look.letterbox === "transparent" });
    surface.resize(open.width, open.height);
    const svgRasterizer: SvgRasterizer = (svg, width, height) => this.call({ method: "svg", svg, width, height }) as Promise<ImageBitmap>;
    this.renderer = new PreviewRenderer(surface, {
      media: this.media,
      ...(options.engine ? { engine: options.engine } : {}),
      ...open.look,
      svgRasterizer,
      ensureMedia: (ref) => this.ensure(ref),
    });
    this.renderer.onBusy((busy) => {
      if (!busy) this.post({ type: "idle", id, seq: this.lastSeq, dropped: this.renderer.droppedFrames });
    });
    this.renderer.onPresent((frame) => this.post({ type: "shown", id, frame, presented: this.renderer.presented, scale: this.renderer.shownScale }));
    this.renderer.onError((key, event) => this.post({ type: "error", id, key, event: cloneableEvent(event) }));
  }

  receive(message: Exclude<ToWorker, { type: "open" | "close" }>): void {
    switch (message.type) {
      case "project":
        this.renderer.setProject(message.project);
        return;
      case "render": {
        // Answered by the next "idle" (rendering already: it waits its turn).
        this.lastSeq = message.seq;
        this.renderer.request(message.frame, message.mode);
        return;
      }
      case "invalidate":
        this.renderer.invalidate();
        return;
      case "resize":
        this.canvas.width = Math.max(1, message.width);
        this.canvas.height = Math.max(1, message.height);
        return;
      case "sweep":
        this.renderer.sweep();
        return;
      case "media-changed":
        this.mediaChanged(message.key);
        return;
      case "snapshot":
        void this.renderer.snapshot(message.maxWidth).then(
          (bitmap) => this.post({ type: "reply", id: this.id, call: message.call, value: bitmap }, bitmap ? [bitmap] : []),
          (error: unknown) => this.post({ type: "reply", id: this.id, call: message.call, error: cloneableError(error) }),
        );
        return;
      case "reply": {
        const pending = this.replies.get(message.call);
        this.replies.delete(message.call);
        if (message.error !== undefined) pending?.reject(message.error);
        else pending?.resolve(message.value);
        return;
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.renderer.dispose();
    this.media.dispose();
    for (const { reject } of this.replies.values()) reject(new Error("PreviewPlayer is disposed"));
    this.replies.clear();
    // Keep the canvas for the next player on this element, without its pixels' memory.
    this.canvas.width = 1;
    this.canvas.height = 1;
  }

  // -------------------------------------------------------------------------

  /** Make `ref` known to this worker's registry, asking the page when it is not. */
  private ensure(ref: MediaRef): Promise<void> {
    if (this.media.has(ref)) return Promise.resolve();
    const key = JSON.stringify([ref.fileId ?? null, ref.path ?? null]);
    let pending = this.lookups.get(key);
    if (!pending) {
      pending = this.call({ method: "source", ref }).then((value) => {
        const source = value as WireSource | null;
        // Unknown on the page too: the read fails with MediaUnavailableError, as it would there.
        if (!source || this.closed) return;
        const spec = this.specFrom(source);
        if (source.key.startsWith("file:")) {
          this.media.register(source.key.slice(5), spec);
          return;
        }
        const path = source.key.slice(5);
        this.paths.set(path, spec);
        if (ref.fileId) {
          const paths = this.pathsOfFile.get(ref.fileId) ?? new Set();
          this.pathsOfFile.set(ref.fileId, paths.add(path));
        }
      });
      // Not cached once settled: media registered on the page later is found next time.
      const settle = () => this.lookups.delete(key);
      pending.then(settle, settle);
      this.lookups.set(key, pending);
    }
    return pending;
  }

  private mediaChanged(key: string): void {
    if (key.startsWith("file:")) {
      // New bytes, newly registered or gone: forget the entry (dropping its
      // caches) and any path that stood in for it; the next read asks again.
      const fileId = key.slice(5);
      this.media.unregister(fileId);
      for (const path of this.pathsOfFile.get(fileId) ?? []) {
        this.paths.delete(path);
        this.media.forgetPath(path);
      }
      this.pathsOfFile.delete(fileId);
      return;
    }
    const path = key.slice(5);
    if (this.paths.has(path)) this.media.invalidate({ path });
  }

  private specFrom(source: WireSource): MediaSourceSpec {
    const wire: WireSpec = source.spec;
    if (wire.kind !== "url") return wire;
    const { refresh, fetch: proxied, requestInit, ...rest } = wire;
    return {
      ...rest,
      ...(requestInit ? { requestInit } : {}),
      ...(refresh ? { refresh: () => this.call({ method: "refresh", key: source.key }) as Promise<string> } : {}),
      ...(proxied ? { fetch: proxiedFetch(source.key, (request, signal) => this.call(request, signal)) } : {}),
    };
  }

  private call(request: WorkerCall, signal?: AbortSignal): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("PreviewPlayer is disposed"));
    const call = ++this.calls;
    const reply = new Promise<unknown>((resolve, reject) => this.replies.set(call, { resolve, reject }));
    this.post({ type: "call", id: this.id, call, ...request }, request.method === "fetch" && request.init.body ? [request.init.body] : []);
    if (signal) {
      const abort = () => {
        const pending = this.replies.get(call);
        if (!pending) return;
        this.replies.delete(call);
        this.post({ type: "abort", id: this.id, call });
        pending.reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      const done = () => signal.removeEventListener("abort", abort);
      reply.then(done, done);
    }
    return reply;
  }

  private post(message: FromWorker, transfer: Transferable[] = []): void {
    if (this.closed) return;
    try {
      this.scope.postMessage(message, transfer);
    } catch (error) {
      // An error whose details cannot be cloned still reaches the page, as text.
      if (message.type !== "error") throw error;
      this.scope.postMessage({ ...message, event: { ...message.event, error: String(message.event.error) } }, []);
    }
  }
}

/**
 * A `fetch` for the media at `key`, run on the page by its custom fetch
 * (auth, tests): method, headers, body and abort cross over.
 */
export function proxiedFetch(key: string, call: (request: WorkerCall, signal: AbortSignal) => Promise<unknown>): typeof fetch {
  return async (input, init) => {
    // A Request normalizes every form of input, body and headers, and follows `init.signal`.
    const request = new Request(input, init);
    request.signal.throwIfAborted();
    const body = request.body ? await request.arrayBuffer() : undefined;
    const wire = (await call({ method: "fetch", key, url: request.url, init: wireRequest(request, body) }, request.signal)) as WireResponse;
    // An opaque response (status 0) cannot be constructed; it reads like the network error it is to us.
    if (wire.status === 0) return Response.error();
    return new Response(wire.body, { status: wire.status, statusText: wire.statusText, headers: wire.headers });
  };
}

function wireRequest(request: Request, body: ArrayBuffer | undefined): WireRequestInit & { body?: ArrayBuffer } {
  return {
    method: request.method,
    headers: [...request.headers],
    credentials: request.credentials,
    mode: request.mode,
    cache: request.cache,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    integrity: request.integrity,
    keepalive: request.keepalive,
    ...(body ? { body } : {}),
  };
}

function cloneableEvent(event: RenderErrorEvent): RenderErrorEvent {
  return { ...event, error: cloneableError(event.error) };
}
