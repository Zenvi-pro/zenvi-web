/**
 * Zenvi Cloud REST client (packages/cloud/src/routes/v1.ts, docs/CLOUD_API.md).
 * Authenticates with the signed-in Supabase session or personal token.
 */

import { CliError } from "../output.js";

export interface CloudProjectSummary {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  revision?: string;
  stats?: Record<string, unknown>;
  editorUrl?: string;
}

export interface CloudMediaEntry {
  fileId: string;
  sha256: string;
  name: string;
  contentType?: string;
  size?: number;
  url: string;
  expiresAt?: string;
}

export interface CloudProject extends CloudProjectSummary {
  project: Record<string, unknown>;
  media: CloudMediaEntry[];
  missingMedia: Array<{ fileId: string; name: string; sha256?: string; reason: string }>;
}

export interface UploadTicket {
  sha256: string;
  blobPath: string;
  exists: boolean;
  uploadUrl?: string;
  uploadExpiresAt?: string;
  uploadHeaders?: Record<string, string>;
}

export class CloudError extends CliError {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
    readonly body: unknown,
    hint?: string,
  ) {
    super(message, 1, hint);
    this.name = "CloudError";
  }
}

export class CloudClient {
  constructor(
    readonly baseUrl: string,
    private readonly token: () => Promise<string | undefined>,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly userAgent = "zenvi-cli",
  ) {}

  private async request<T>(method: string, path: string, init: { body?: unknown; headers?: Record<string, string>; allowStatus?: number[] } = {}): Promise<{ status: number; data: T; headers: Headers }> {
    const token = await this.token();
    if (!token) throw new CliError("You are not signed in to Zenvi.", 1, "Run `zenvi login` (or `zenvi login --device` on a machine without a browser).");
    const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${token}`, "User-Agent": this.userAgent, ...init.headers };
    let body: string | undefined;
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers, body, signal: AbortSignal.timeout(120_000) });
    } catch (error) {
      throw new CloudError(`Cannot reach Zenvi Cloud at ${this.baseUrl}: ${(error as Error).message}`, 0, undefined, undefined);
    }
    const text = await response.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      // Non-JSON body.
    }
    if (!response.ok && !(init.allowStatus ?? []).includes(response.status)) {
      const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
      const code = typeof obj.error === "string" ? obj.error : undefined;
      const message = typeof obj.message === "string" ? obj.message : typeof obj.error_description === "string" ? obj.error_description : code ?? response.statusText;
      const hint = response.status === 401 ? "Your Zenvi sign-in expired: run `zenvi login`." : undefined;
      throw new CloudError(`Zenvi Cloud ${response.status}: ${message}`, response.status, code, data, hint);
    }
    return { status: response.status, data: data as T, headers: response.headers };
  }

  async me(): Promise<{ user: { id: string; email: string | null }; auth: string; usage?: Record<string, number> }> {
    return (await this.request<{ user: { id: string; email: string | null }; auth: string; usage?: Record<string, number> }>("GET", "/v1/me")).data;
  }

  async listProjects(): Promise<CloudProjectSummary[]> {
    return (await this.request<{ projects: CloudProjectSummary[] }>("GET", "/v1/projects")).data.projects ?? [];
  }

  async getProject(id: string): Promise<CloudProject> {
    return (await this.request<CloudProject>("GET", `/v1/projects/${encodeURIComponent(id)}`)).data;
  }

  async createProject(name: string, project: unknown): Promise<CloudProjectSummary> {
    return (await this.request<CloudProjectSummary>("POST", "/v1/projects", { body: { name, project } })).data;
  }

  /** PUT with If-Match; throws CloudError 409 (conflict) or 404 (gone). */
  async saveProject(id: string, project: unknown, revision: string): Promise<{ id: string; revision: string; updatedAt?: string }> {
    const ifMatch = revision === "*" ? "*" : `"${revision.replace(/^"|"$/g, "")}"`;
    return (await this.request<{ id: string; revision: string; updatedAt?: string }>("PUT", `/v1/projects/${encodeURIComponent(id)}`, { body: project, headers: { "If-Match": ifMatch } })).data;
  }

  async renameProject(id: string, name: string): Promise<void> {
    await this.request("PATCH", `/v1/projects/${encodeURIComponent(id)}`, { body: { name } });
  }

  async checkMedia(hashes: string[]): Promise<{ existing: string[]; missing: string[] }> {
    if (hashes.length === 0) return { existing: [], missing: [] };
    const out = { existing: [] as string[], missing: [] as string[] };
    for (let i = 0; i < hashes.length; i += 1000) {
      const page = (await this.request<{ existing: string[]; missing: string[] }>("POST", "/v1/media/check", { body: { sha256: hashes.slice(i, i + 1000) } })).data;
      out.existing.push(...page.existing);
      out.missing.push(...page.missing);
    }
    return out;
  }

  async declareMedia(input: { sha256: string; size: number; name: string; contentType: string }): Promise<UploadTicket> {
    return (await this.request<UploadTicket>("POST", "/v1/media", { body: input })).data;
  }

  async completeMedia(sha256: string): Promise<Record<string, unknown>> {
    return (await this.request<Record<string, unknown>>("POST", `/v1/media/${sha256}/complete`, { body: {} })).data;
  }
}
