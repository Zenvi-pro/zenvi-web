/**
 * Zenvi Cloud client (W7 REST, docs/ARCHITECTURE.md §4).
 *
 * Behind the `CloudClient` interface so the editor works before the service
 * is deployed and without it (`DisabledCloudClient`). Every request carries
 * the Supabase access token; the cloud authorizes by owner.
 */
import type { Project } from "@zenvi/engine";
import { getAccessToken } from "./auth";
import { cloudEnabled, config } from "./env";

export class CloudError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "CloudError";
  }
}

/** 409 on save: someone else saved first. */
export class CloudConflictError extends CloudError {
  constructor(
    readonly currentRevision: string | null,
    body?: unknown,
  ) {
    super("This project was changed somewhere else.", 409, body);
    this.name = "CloudConflictError";
  }
}

export interface CloudProjectSummary {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  revision?: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  duration?: number;
}

export interface CloudMediaEntry {
  sha256: string;
  url?: string;
  name?: string;
  size?: number;
  contentType?: string;
}

export interface CloudProjectDocument {
  id: string;
  name: string;
  revision: string;
  project: Project;
  media: CloudMediaEntry[];
}

export interface UploadTicket {
  exists: boolean;
  uploadUrl?: string;
  blobPath?: string;
  /** Headers the SAS PUT must carry (e.g. `x-ms-blob-type`). */
  uploadHeaders?: Record<string, string>;
}

export type RenderState = "queued" | "running" | "done" | "error";

export interface RenderStatus {
  renderId: string;
  status: RenderState;
  progress?: number;
  url?: string;
  error?: string;
}

export interface ConsentInfo {
  clientName: string;
  /** Host that vouches for the client (client metadata documents only). */
  verifiedHost: string | null;
  logoUri?: string;
  redirectHost: string;
  scopes: { name: string; description: string }[];
}

export interface DeviceInfo {
  userCode: string;
  clientName: string;
  status: string;
  expiresAt?: string;
}

export interface RenderRequest {
  /** Cloud preset name: mp4, mp4-2160p, mp4-1080p, mp4-720p, webm, gif, mp3, wav. */
  preset?: string;
  options?: Record<string, unknown>;
}

export interface CloudClient {
  readonly enabled: boolean;
  listProjects(signal?: AbortSignal): Promise<CloudProjectSummary[]>;
  createProject(name: string, project?: Project): Promise<{ id: string; revision: string | null }>;
  getProject(id: string, signal?: AbortSignal): Promise<CloudProjectDocument>;
  /** Save with `If-Match`; throws `CloudConflictError` when the revision moved. */
  saveProject(id: string, project: Project, revision: string | null): Promise<{ revision: string | null }>;
  renameProject(id: string, name: string): Promise<void>;
  deleteProject(id: string): Promise<void>;
  /** Which of `hashes` the cloud already has. */
  checkMedia(hashes: string[]): Promise<Set<string>>;
  requestUpload(input: { sha256: string; size: number; name: string; contentType: string }): Promise<UploadTicket>;
  completeUpload(sha256: string): Promise<void>;
  mediaUrl(sha256: string): Promise<string>;
  startRender(projectId: string, request: RenderRequest): Promise<RenderStatus>;
  getRender(projectId: string, renderId: string): Promise<RenderStatus>;
  deviceInfo(userCode: string): Promise<DeviceInfo>;
  /** Approve (or deny) a CLI / desktop sign-in. Returns the client's name. */
  approveDevice(userCode: string, approve?: boolean): Promise<{ clientName: string }>;
  consentInfo(requestId: string): Promise<ConsentInfo>;
  consent(requestId: string, approve: boolean): Promise<{ redirect: string }>;
}

type TokenProvider = () => Promise<string | null>;

function pick<T>(obj: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const key of keys) if (obj[key] !== undefined && obj[key] !== null) return obj[key] as T;
  return undefined;
}

export class HttpCloudClient implements CloudClient {
  readonly enabled = true;

  constructor(
    private readonly baseUrl: string,
    private readonly token: TokenProvider = getAccessToken,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal; auth?: boolean } = {},
  ): Promise<{ data: T; response: Response }> {
    const headers: Record<string, string> = { Accept: "application/json", ...init.headers };
    if (init.auth !== false) {
      const token = await this.token();
      if (!token) throw new CloudError("Sign in to use Zenvi Cloud.", 401);
      headers.Authorization = `Bearer ${token}`;
    }
    let body: BodyInit | undefined;
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method ?? (body !== undefined ? "POST" : "GET"),
        headers,
        body,
        signal: init.signal,
      });
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") throw error;
      throw new CloudError("Zenvi Cloud is not reachable. Check your connection.", 0);
    }
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (response.status === 409) {
      const obj = (data ?? {}) as Record<string, unknown>;
      throw new CloudConflictError(pick<string>(obj, "revision", "currentRevision", "current_revision") ?? null, data);
    }
    if (!response.ok) {
      throw new CloudError(errorMessage(data, response.status), response.status, data);
    }
    return { data: data as T, response };
  }

  async listProjects(signal?: AbortSignal): Promise<CloudProjectSummary[]> {
    const { data } = await this.request<unknown>("/v1/projects", { signal });
    const list = Array.isArray(data) ? data : ((data as { projects?: unknown[] } | null)?.projects ?? []);
    return list
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object" && typeof (p as { id?: unknown }).id === "string")
      .map((p) => {
        const stats = (pick<Record<string, unknown>>(p, "stats") ?? {}) as Record<string, unknown>;
        return {
          id: p.id as string,
          name: pick<string>(p, "name") ?? "Untitled",
          createdAt: pick<string>(p, "createdAt", "created_at"),
          updatedAt: pick<string>(p, "updatedAt", "updated_at"),
          revision: pick<string>(p, "revision"),
          thumbnailUrl: pick<string>(p, "thumbnailUrl", "thumbnail_url", "thumbnail"),
          width: pick<number>(stats, "width") ?? pick<number>(p, "width"),
          height: pick<number>(stats, "height") ?? pick<number>(p, "height"),
          duration: pick<number>(stats, "duration") ?? pick<number>(p, "duration"),
        };
      });
  }

  async createProject(name: string, project?: Project): Promise<{ id: string; revision: string | null }> {
    const { data, response } = await this.request<Record<string, unknown>>("/v1/projects", { method: "POST", body: { name, project } });
    return {
      id: String(pick(data ?? {}, "id", "projectId") ?? ""),
      revision: pick<string>(data ?? {}, "revision") ?? response.headers.get("ETag"),
    };
  }

  async getProject(id: string, signal?: AbortSignal): Promise<CloudProjectDocument> {
    const { data, response } = await this.request<Record<string, unknown>>(`/v1/projects/${encodeURIComponent(id)}`, { signal });
    const obj = data ?? {};
    const project = (pick<Project>(obj, "project") ?? obj) as Project;
    const media = (pick<unknown[]>(obj, "media") ?? []).filter(
      (m): m is CloudMediaEntry => !!m && typeof (m as { sha256?: unknown }).sha256 === "string",
    );
    return {
      id,
      name: pick<string>(obj, "name") ?? "Untitled",
      revision: pick<string>(obj, "revision") ?? response.headers.get("ETag") ?? "",
      project,
      media,
    };
  }

  async saveProject(id: string, project: Project, revision: string | null): Promise<{ revision: string | null }> {
    // The cloud requires If-Match; `*` overwrites whatever is there (used after a
    // person chose "keep mine" in a conflict).
    const headers: Record<string, string> = { "If-Match": revision ?? "*" };
    const { data, response } = await this.request<Record<string, unknown>>(`/v1/projects/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: project,
      headers,
    });
    return { revision: pick<string>(data ?? {}, "revision") ?? response.headers.get("ETag") };
  }

  async renameProject(id: string, name: string): Promise<void> {
    await this.request(`/v1/projects/${encodeURIComponent(id)}`, { method: "PATCH", body: { name } });
  }

  async deleteProject(id: string): Promise<void> {
    await this.request(`/v1/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async checkMedia(hashes: string[]): Promise<Set<string>> {
    if (hashes.length === 0) return new Set();
    const { data } = await this.request<Record<string, unknown>>("/v1/media/check", { method: "POST", body: { sha256: hashes } });
    const exists = pick<unknown>(data ?? {}, "exists", "existing", "present");
    if (Array.isArray(exists)) return new Set(exists.filter((h): h is string => typeof h === "string"));
    if (exists && typeof exists === "object") {
      return new Set(Object.entries(exists as Record<string, unknown>).filter(([, v]) => v === true).map(([k]) => k));
    }
    return new Set();
  }

  async requestUpload(input: { sha256: string; size: number; name: string; contentType: string }): Promise<UploadTicket> {
    const { data } = await this.request<Record<string, unknown>>("/v1/media", { method: "POST", body: input });
    const obj = data ?? {};
    return {
      exists: Boolean(pick(obj, "exists")),
      uploadUrl: pick<string>(obj, "uploadUrl", "upload_url"),
      blobPath: pick<string>(obj, "blobPath", "blob_path"),
      uploadHeaders: pick<Record<string, string>>(obj, "uploadHeaders"),
    };
  }

  async completeUpload(sha256: string): Promise<void> {
    await this.request(`/v1/media/${sha256}/complete`, { method: "POST", body: {} });
  }

  async mediaUrl(sha256: string): Promise<string> {
    const { data } = await this.request<Record<string, unknown>>(`/v1/media/${sha256}/url`);
    const url = pick<string>(data ?? {}, "url");
    if (!url) throw new CloudError("Zenvi Cloud returned no media URL.", 500, data);
    return url;
  }

  async startRender(projectId: string, request: RenderRequest): Promise<RenderStatus> {
    const body: Record<string, unknown> = {};
    if (request.preset) body.preset = request.preset;
    if (request.options) body.options = request.options;
    const { data } = await this.request<Record<string, unknown>>(`/v1/projects/${encodeURIComponent(projectId)}/renders`, {
      method: "POST",
      body,
    });
    return toRenderStatus(data ?? {});
  }

  async getRender(projectId: string, renderId: string): Promise<RenderStatus> {
    const { data } = await this.request<Record<string, unknown>>(
      `/v1/projects/${encodeURIComponent(projectId)}/renders/${encodeURIComponent(renderId)}`,
    );
    return toRenderStatus({ renderId, ...(data ?? {}) });
  }

  async deviceInfo(userCode: string): Promise<DeviceInfo> {
    const { data } = await this.request<Record<string, unknown>>(`/v1/device/info?user_code=${encodeURIComponent(userCode)}`);
    const obj = data ?? {};
    return {
      userCode: pick<string>(obj, "userCode", "user_code") ?? userCode,
      clientName: pick<string>(obj, "clientName", "client_name") ?? "A device",
      status: pick<string>(obj, "status") ?? "pending",
      expiresAt: pick<string>(obj, "expiresAt"),
    };
  }

  async approveDevice(userCode: string, approve = true): Promise<{ clientName: string }> {
    const { data } = await this.request<Record<string, unknown>>("/v1/device/approve", { method: "POST", body: { user_code: userCode, approve } });
    return { clientName: pick<string>(data ?? {}, "clientName") ?? "your device" };
  }

  async consentInfo(requestId: string): Promise<ConsentInfo> {
    const { data } = await this.request<Record<string, unknown>>(`/oauth/consent-info?request=${encodeURIComponent(requestId)}`, {
      auth: false,
    });
    const obj = data ?? {};
    const client = (pick<Record<string, unknown>>(obj, "client") ?? {}) as Record<string, unknown>;
    const rawScopes = pick<unknown>(obj, "scopes", "scope");
    const scopes = Array.isArray(rawScopes)
      ? rawScopes.map((s) =>
          typeof s === "string"
            ? { name: s, description: s }
            : { name: String((s as { name?: unknown }).name ?? ""), description: String((s as { description?: unknown }).description ?? (s as { name?: unknown }).name ?? "") },
        )
      : typeof rawScopes === "string"
        ? rawScopes.split(/\s+/).filter(Boolean).map((name) => ({ name, description: name }))
        : [];
    return {
      clientName: pick<string>(client, "name") ?? pick<string>(obj, "clientName", "client_name") ?? "An application",
      verifiedHost: pick<string>(client, "verifiedHost") ?? null,
      logoUri: pick<string>(client, "logoUri"),
      redirectHost: pick<string>(obj, "redirectHost", "redirect_host") ?? "",
      scopes,
    };
  }

  async consent(requestId: string, approve: boolean): Promise<{ redirect: string }> {
    const { data } = await this.request<Record<string, unknown>>("/oauth/consent", { method: "POST", body: { request: requestId, approve } });
    const redirect = pick<string>(data ?? {}, "redirect", "redirect_uri", "redirectUrl");
    if (!redirect) throw new CloudError("Zenvi Cloud returned no redirect.", 500, data);
    return { redirect };
  }
}

/** The cloud's error body is `{ error: { code, message } }`; OAuth/device use RFC shapes. */
function errorMessage(data: unknown, status: number): string {
  const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const nested = obj.error && typeof obj.error === "object" ? (obj.error as Record<string, unknown>) : null;
  const message =
    (nested && typeof nested.message === "string" ? nested.message : undefined) ??
    pick<string>(obj, "message", "error_description") ??
    (typeof obj.error === "string" ? obj.error : undefined);
  if (message) return message;
  if (status === 401) return "Your session expired. Sign in again.";
  if (status === 404) return "Not found in Zenvi Cloud.";
  return `Zenvi Cloud error (${status})`;
}

function toRenderStatus(obj: Record<string, unknown>): RenderStatus {
  const status = pick<string>(obj, "status") ?? "queued";
  return {
    renderId: String(pick(obj, "renderId", "render_id", "id") ?? ""),
    status: (["queued", "running", "done", "error"].includes(status) ? status : "queued") as RenderState,
    progress: pick<number>(obj, "progress"),
    url: pick<string>(obj, "url", "downloadUrl"),
    error: pick<string>(obj, "error"),
  };
}

const disabled = (): never => {
  throw new CloudError("Zenvi Cloud is not configured for this build.", 0);
};

/** Used when `VITE_ZENVI_CLOUD_URL` is empty: every call fails with a clear message. */
export class DisabledCloudClient implements CloudClient {
  readonly enabled = false;
  listProjects = async () => [] as CloudProjectSummary[];
  createProject = async () => disabled();
  getProject = async () => disabled();
  saveProject = async () => disabled();
  renameProject = async () => disabled();
  deleteProject = async () => disabled();
  checkMedia = async () => disabled();
  requestUpload = async () => disabled();
  completeUpload = async () => disabled();
  mediaUrl = async () => disabled();
  startRender = async () => disabled();
  getRender = async () => disabled();
  deviceInfo = async () => disabled();
  approveDevice = async () => disabled();
  consentInfo = async () => disabled();
  consent = async () => disabled();
}

let client: CloudClient | null = null;

export function cloudClient(): CloudClient {
  if (!client) client = cloudEnabled() ? new HttpCloudClient(config.cloudUrl) : new DisabledCloudClient();
  return client;
}

export function setCloudClient(next: CloudClient | null): void {
  client = next;
}

/**
 * Route id for a cloud project. Cloud ids already look like `c_` + 16
 * characters (docs/CLOUD_API.md §1), so the route is `/editor/p/<cloud id>`.
 */
export function cloudRouteId(cloudId: string): string {
  return cloudId.startsWith("c_") ? cloudId : `c_${cloudId}`;
}

/** The cloud project id in a route id (`c_…`), or null for a local id. */
export function parseCloudRouteId(routeId: string): string | null {
  return routeId.startsWith("c_") && routeId.length > 2 ? routeId : null;
}

// ---------------------------------------------------------------------------
// Media upload to a SAS URL (Azure Blob), with progress.
// ---------------------------------------------------------------------------

const SINGLE_PUT_LIMIT = 256 * 1024 * 1024;
const BLOCK_SIZE = 8 * 1024 * 1024;

function xhrPut(url: string, body: Blob | string, headers: Record<string, string>, onProgress?: (loaded: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress?.(e.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new CloudError(`Upload failed (${xhr.status})`, xhr.status)));
    xhr.onerror = () => reject(new CloudError("Upload failed: network error", 0));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

function withQuery(url: string, extra: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${extra}`;
}

/** Upload `blob` to an Azure SAS URL: one PUT for small files, blocks for big ones. */
export async function uploadToSas(
  uploadUrl: string,
  blob: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
  ticketHeaders: Record<string, string> = {},
): Promise<void> {
  if (blob.size <= SINGLE_PUT_LIMIT) {
    await xhrPut(
      uploadUrl,
      blob,
      { "x-ms-blob-type": "BlockBlob", "x-ms-blob-content-type": contentType || "application/octet-stream", ...ticketHeaders },
      (loaded) => onProgress?.(blob.size ? loaded / blob.size : 1),
      signal,
    );
    onProgress?.(1);
    return;
  }
  const ids: string[] = [];
  let offset = 0;
  let index = 0;
  while (offset < blob.size) {
    const end = Math.min(blob.size, offset + BLOCK_SIZE);
    const id = btoa(`block-${String(index).padStart(6, "0")}`);
    ids.push(id);
    const base = offset;
    await xhrPut(withQuery(uploadUrl, `comp=block&blockid=${encodeURIComponent(id)}`), blob.slice(offset, end), {}, (loaded) =>
      onProgress?.((base + loaded) / blob.size),
      signal,
    );
    offset = end;
    index += 1;
  }
  const xml = `<?xml version="1.0" encoding="utf-8"?><BlockList>${ids.map((id) => `<Latest>${id}</Latest>`).join("")}</BlockList>`;
  await xhrPut(withQuery(uploadUrl, "comp=blocklist"), xml, {
    "Content-Type": "application/xml",
    "x-ms-blob-content-type": contentType || "application/octet-stream",
  }, undefined, signal);
  onProgress?.(1);
}
