/**
 * Messages between a `WorkerPreview` (page) and the preview worker. Each
 * player has an `id`; one worker can serve several. Calls (`call` → `reply`)
 * carry a number unique per sender.
 */

import type { Project } from "@zenvi/engine";
import type { MediaRef } from "../../media/registry.js";
import type { DecodeMode } from "../../video/decode-cursor.js";
import type { RenderErrorEvent } from "../preview-renderer.js";

export interface RendererLook {
  resolution?: number;
  letterbox: string;
  frameCacheBytes?: number;
  adaptive?: boolean;
}

/**
 * A `MediaSourceSpec` that survives `postMessage`: functions stay on the
 * page, and the worker calls back for them (`refresh`, `fetch`).
 */
export type WireSpec =
  | { kind: "blob"; blob: Blob; name?: string }
  | { kind: "opfs"; handle: FileSystemFileHandle; name?: string }
  | { kind: "url"; url: string; name?: string; requestInit?: WireRequestInit; refresh: boolean; fetch: boolean };

/** The cloneable part of a `RequestInit`. */
export interface WireRequestInit {
  method?: string;
  headers?: [string, string][];
  credentials?: RequestCredentials;
  mode?: RequestMode;
  cache?: RequestCache;
  referrer?: string;
  referrerPolicy?: ReferrerPolicy;
  redirect?: RequestRedirect;
  integrity?: string;
  keepalive?: boolean;
}

/** A page registry entry: its cache key (`file:…` or `path:…`) and where the bytes are. */
export interface WireSource {
  key: string;
  spec: WireSpec;
}

export interface WireResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: ArrayBuffer | null;
}

/** What the worker asks the page for. */
export type WorkerCall =
  | { method: "source"; ref: MediaRef }
  | { method: "refresh"; key: string }
  | { method: "fetch"; key: string; url: string; init: WireRequestInit & { body?: ArrayBuffer } }
  | { method: "svg"; svg: Blob; width: number; height: number };

export type ToWorker =
  /** `canvas` is sent once per page canvas (`surface`); later players on it reuse the worker's copy. */
  | { type: "open"; id: number; surface: number; canvas?: OffscreenCanvas; width: number; height: number; look: RendererLook }
  | { type: "project"; id: number; project: Project }
  | { type: "render"; id: number; seq: number; frame: number; mode: DecodeMode }
  | { type: "invalidate"; id: number }
  | { type: "resize"; id: number; width: number; height: number }
  | { type: "sweep"; id: number }
  /** The page registry's bytes for `key` changed or went away. */
  | { type: "media-changed"; id: number; key: string }
  | { type: "snapshot"; id: number; call: number; maxWidth: number }
  | { type: "reply"; id: number; call: number; value?: unknown; error?: unknown }
  | { type: "ping"; id: number }
  | { type: "close"; id: number };

export type FromWorker =
  /** The player's renderer is up (`error`: it could not be). */
  | { type: "opened"; id: number; error?: unknown }
  | { type: "pong"; id: number }
  | { type: "shown"; id: number; frame: number; presented: number; scale: number }
  /** Nothing waits to render; `seq` is the last render request the worker had received. */
  | { type: "idle"; id: number; seq: number; dropped: number }
  | { type: "error"; id: number; key: string; event: RenderErrorEvent }
  | ({ type: "call"; id: number; call: number } & WorkerCall)
  /** The worker no longer wants the answer to `call` (its `fetch` was aborted). */
  | { type: "abort"; id: number; call: number }
  | { type: "reply"; id: number; call: number; value?: unknown; error?: unknown };

/** The `postMessage` side of a Worker or a worker's global scope. */
export interface Endpoint<Out, In> {
  postMessage(message: Out, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<In>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<In>) => void): void;
}

/** Errors cross as themselves when cloneable (Error, DOMException), else as text. */
export function cloneableError(error: unknown): unknown {
  if (error instanceof Error) return error;
  try {
    return structuredClone(error);
  } catch {
    return String(error);
  }
}
