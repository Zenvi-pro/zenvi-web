/**
 * `BackendHost`: JSON requests to the Zenvi backend (`/api/v1/…`), with the
 * user's Supabase access token when they are signed in.
 */

import type { BackendHost } from "@zenvi/engine";

export class BackendError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

export interface BackendHostOptions {
  baseUrl: string;
  /** Current access token, refreshed by the caller; undefined when signed out. */
  token?: () => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
}

function detail(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const d = b.detail ?? b.message ?? b.error;
    if (typeof d === "string") return d;
    if (d !== undefined) return JSON.stringify(d);
  }
  return typeof body === "string" && body ? body.slice(0, 300) : fallback;
}

export function createBackendHost(options: BackendHostOptions): BackendHost {
  const base = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? fetch;
  return {
    baseUrl: base,
    async request<T = unknown>(requestPath: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
      const url = `${base}${requestPath.startsWith("/") ? requestPath : `/${requestPath}`}`;
      const headers: Record<string, string> = { Accept: "application/json" };
      if (options.userAgent) headers["User-Agent"] = options.userAgent;
      const token = await options.token?.();
      if (token) headers.Authorization = `Bearer ${token}`;
      let body: string | undefined;
      if (init.body !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(init.body);
      }
      const timeout = AbortSignal.timeout(options.timeoutMs ?? 120_000);
      const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      let response: Response;
      try {
        response = await doFetch(url, { method: init.method ?? (body ? "POST" : "GET"), headers, body, signal });
      } catch (error) {
        if (init.signal?.aborted) throw error;
        throw new BackendError(`Cannot reach the Zenvi backend at ${base}: ${(error as Error).message}`, 0, undefined);
      }
      const text = await response.text();
      let parsed: unknown = text;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          // Plain-text body.
        }
      }
      if (!response.ok) {
        const hint = response.status === 401 || response.status === 403 ? " Sign in with `zenvi login`." : "";
        throw new BackendError(`Zenvi backend ${response.status}: ${detail(parsed, response.statusText)}.${hint}`, response.status, parsed);
      }
      return parsed as T;
    },
  };
}
