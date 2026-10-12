/**
 * The Supabase session a connector approval leaves behind, so ChatGPT's
 * cloud token can call api.zenvi.pro as that person (credits stay on their
 * account). One row per user. The refresh token is never logged.
 */

import type { TableEntity, TableStore } from "../storage/types.js";
import type { Clock } from "../util/clock.js";
import { isoAt } from "../util/clock.js";

const TABLE = "backendsessions" as const;
const ROW = "supabase";
/** Refresh a minute before the access token expires. */
const SKEW_MS = 60_000;

export const RECONNECT_MESSAGE =
  "Reconnect Zenvi from ChatGPT (or Claude) and choose Allow, so search, stock, narration and AI video can use your Zenvi account.";

interface SessionRow extends TableEntity {
  refreshToken: string;
  accessToken: string;
  /** ISO time the access token expires, or "" when it has not been refreshed yet. */
  expiresAt: string;
  updatedAt: string;
}

interface Refreshed {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export class SessionRejected extends Error {
  constructor() {
    super(RECONNECT_MESSAGE);
    this.name = "SessionRejected";
  }
}

export interface BackendSessionsOptions {
  supabaseUrl: string;
  anonKey: string;
  backendUrl: string;
  fetchImpl?: typeof fetch;
}

export class BackendSessions {
  /** One refresh at a time per user, so a rotated token is not presented twice. */
  private readonly inflight = new Map<string, Promise<string | null>>();
  fetchImpl: typeof fetch;

  constructor(
    private readonly tables: TableStore,
    private readonly clock: Clock,
    private readonly options: BackendSessionsOptions,
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Search, stock, TTS and AI video are offered only when both endpoints are configured. */
  get enabled(): boolean {
    return this.options.backendUrl !== "" && this.options.anonKey !== "" && this.options.supabaseUrl !== "";
  }

  async save(userId: string, refreshToken: string): Promise<void> {
    const token = refreshToken.trim();
    if (!token) return;
    await this.tables.upsert<SessionRow>(
      TABLE,
      {
        partitionKey: userId,
        rowKey: ROW,
        refreshToken: token,
        accessToken: "",
        expiresAt: "",
        updatedAt: isoAt(this.clock.now()),
      },
      "replace",
    );
  }

  async delete(userId: string): Promise<void> {
    await this.tables.delete(TABLE, userId, ROW);
  }

  /**
   * A current Supabase access token, or null when this person has not allowed
   * a connector (or the stored session was rejected).
   */
  accessToken(userId: string): Promise<string | null> {
    const pending = this.inflight.get(userId);
    if (pending) return pending;
    const run = this.resolve(userId).finally(() => {
      if (this.inflight.get(userId) === run) this.inflight.delete(userId);
    });
    this.inflight.set(userId, run);
    return run;
  }

  /** Authenticated JSON call to the Zenvi backend. Throws a user-facing Error. */
  async request<T>(userId: string, path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
    if (!this.enabled) throw new Error("The Zenvi backend is not configured on this server.");
    const token = await this.accessToken(userId);
    if (!token) throw new Error(RECONNECT_MESSAGE);
    const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${token}` };
    let body: string | undefined;
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.backendUrl}${path}`, {
        method: init.method ?? (body !== undefined ? "POST" : "GET"),
        headers,
        body,
        signal: init.signal,
      });
    } catch (error) {
      if (isAbort(error)) throw error;
      throw new Error(`Could not reach the Zenvi backend (${error instanceof Error ? error.message : String(error)}).`);
    }
    const text = await response.text();
    if (!response.ok) throw new Error(httpError(response.status, text));
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error("The Zenvi backend returned a response that was not JSON.");
    }
  }

  private async resolve(userId: string): Promise<string | null> {
    const row = await this.tables.get<SessionRow>(TABLE, userId, ROW);
    if (!row?.refreshToken) return null;
    if (row.accessToken && stillValid(row.expiresAt, this.clock.now())) return row.accessToken;
    try {
      const next = await this.refresh(row.refreshToken);
      await this.tables.upsert<SessionRow>(
        TABLE,
        { ...row, refreshToken: next.refreshToken, accessToken: next.accessToken, expiresAt: next.expiresAt, updatedAt: isoAt(this.clock.now()) },
        "replace",
      );
      return next.accessToken;
    } catch (error) {
      if (!(error instanceof SessionRejected)) throw error;
      const again = await this.tables.get<SessionRow>(TABLE, userId, ROW);
      if (again && again.refreshToken !== row.refreshToken && again.accessToken && stillValid(again.expiresAt, this.clock.now())) {
        return again.accessToken;
      }
      if (again && again.refreshToken === row.refreshToken) await this.delete(userId);
      return null;
    }
  }

  private async refresh(refreshToken: string): Promise<Refreshed> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { apikey: this.options.anonKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      if (isAbort(error)) throw error;
      throw new Error(`Could not refresh the Zenvi session (${error instanceof Error ? error.message : String(error)}).`);
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) throw new SessionRejected();
    if (!response.ok) throw new Error(`Could not refresh the Zenvi session (HTTP ${response.status}).`);
    const data = (await response.json()) as Record<string, unknown>;
    if (typeof data.access_token !== "string" || data.access_token === "") throw new SessionRejected();
    const nextRefresh = typeof data.refresh_token === "string" && data.refresh_token !== "" ? data.refresh_token : refreshToken;
    return { accessToken: data.access_token, refreshToken: nextRefresh, expiresAt: expiryIso(data, this.clock.now()) };
  }
}

function stillValid(expiresAt: string, now: number): boolean {
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) && at - SKEW_MS > now;
}

function expiryIso(data: Record<string, unknown>, now: number): string {
  if (typeof data.expires_at === "number" && Number.isFinite(data.expires_at)) return isoAt(data.expires_at * 1000);
  const seconds = typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : 3600;
  return isoAt(now + seconds * 1000);
}

function httpError(status: number, body: string): string {
  let detail = "";
  try {
    const parsed = JSON.parse(body) as { error?: unknown; detail?: unknown; message?: unknown };
    const raw = parsed.detail ?? parsed.message ?? parsed.error;
    if (typeof raw === "string") detail = raw;
  } catch {
    detail = body.replace(/\s+/g, " ").trim();
  }
  const clipped = detail.slice(0, 180);
  return clipped ? `Zenvi backend returned HTTP ${status}: ${clipped}` : `Zenvi backend returned HTTP ${status}.`;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
