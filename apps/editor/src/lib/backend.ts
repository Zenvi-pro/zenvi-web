/**
 * Zenvi backend REST (`https://api.zenvi.pro/api/v1/*`). Production calls it
 * directly from zenvi.pro (the only origin its CORS allows); elsewhere it goes
 * through the same-origin proxy `/editor/api/zenvi/*` (`config.backendRestBase`).
 * Like the desktop, REST calls carry no Authorization header unless asked to
 * (`auth: true`).
 */
import { getAccessToken } from "./auth";
import { config } from "./env";

export class BackendError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

export interface BackendRequestInit {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  auth?: boolean;
}

/** Normalize `/api/v1/models`, `api/v1/models` and `/models` to `/models`. */
export function backendPath(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return p.replace(/^\/api\/v1(?=\/|$)/, "") || "/";
}

export async function backendRequest<T = unknown>(path: string, init: BackendRequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  if (init.auth) {
    const token = await getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${config.backendRestBase}${backendPath(path)}`, {
    method: init.method ?? (body ? "POST" : "GET"),
    headers,
    body,
    signal: init.signal,
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  if (!response.ok) {
    const detail = (parsed as { detail?: unknown } | null)?.detail;
    const message = typeof detail === "string" ? detail : `Backend request failed (${response.status})`;
    throw new BackendError(message, response.status, parsed);
  }
  return parsed as T;
}

/**
 * A multipart POST (speech audio for `/transcription`) with the signed-in
 * session. Answers the status and the parsed body instead of throwing on an
 * HTTP error, so the caller can say what each one means.
 */
export async function backendSend(path: string, form: FormData, init: { signal?: AbortSignal } = {}): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = await getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${config.backendRestBase}${backendPath(path)}`, { method: "POST", headers, body: form, signal: init.signal });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  return { status: response.status, body };
}

export interface ModelInfo {
  model_id: string;
  display_name: string;
  provider: string;
  featured: boolean;
  rank: number;
  tags: string[];
  available: boolean;
}

export interface ModelCatalog {
  models: ModelInfo[];
  defaultModelId: string;
}

/** `GET /models`, sorted like the desktop picker: featured, then rank, then name. */
export async function fetchModelCatalog(signal?: AbortSignal): Promise<ModelCatalog> {
  const data = await backendRequest<{ models?: Partial<ModelInfo>[]; default_model_id?: string }>("/models", { signal });
  const models: ModelInfo[] = (data.models ?? [])
    .filter((m): m is Partial<ModelInfo> & { model_id: string } => typeof m.model_id === "string")
    .map((m) => ({
      model_id: m.model_id,
      display_name: m.display_name || m.model_id,
      provider: m.provider ?? "",
      featured: Boolean(m.featured),
      rank: typeof m.rank === "number" ? m.rank : 500,
      tags: Array.isArray(m.tags) ? m.tags : [],
      available: m.available !== false,
    }))
    .sort((a, b) => Number(b.featured) - Number(a.featured) || a.rank - b.rank || a.display_name.localeCompare(b.display_name));
  return { models, defaultModelId: data.default_model_id || models[0]?.model_id || "" };
}
