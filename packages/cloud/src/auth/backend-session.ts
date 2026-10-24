/**
 * How the remote MCP server calls api.zenvi.pro as the connected person, so
 * search, narration and AI video spend that person's credits. Any person with
 * a connector grant may use it; nothing is stored at consent.
 *
 *   assertion  a five-minute HS256 JWT (iss zenvi-cloud, aud zenvi-backend,
 *              sub = user id) signed with a secret the backend shares. The
 *              backend verifies it and bills through a session it owns.
 *   session    a Supabase session this server mints for the person with the
 *              admin API and alone refreshes. Never the browser's session:
 *              Supabase refresh tokens rotate, so a shared one breaks once
 *              the web editor refreshes twice before this server does.
 *   off        no backend tools.
 *
 * Tokens are never logged.
 */

import { SignJWT } from "jose";
import type { BackendAuth } from "../config.js";
import type { TableEntity, TableStore } from "../storage/types.js";
import type { Clock } from "../util/clock.js";
import { isoAt } from "../util/clock.js";
import { randomId } from "../util/crypto.js";

const TABLE = "backendsessions" as const;
const ROW = "supabase";
/** Refresh a minute before the access token expires. */
const SKEW_MS = 60_000;
const ASSERTION_TTL_SECONDS = 300;
export const ASSERTION_ISSUER = "zenvi-cloud";
export const ASSERTION_AUDIENCE = "zenvi-backend";

interface SessionRow extends TableEntity {
  refreshToken: string;
  accessToken: string;
  /** ISO time the access token expires. */
  expiresAt: string;
  /** "minted" for sessions this server created. Rows without it held a browser's token and are replaced. */
  source?: string;
  updatedAt: string;
}

interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

class SessionRejected extends Error {}

export interface BackendSessionsOptions {
  supabaseUrl: string;
  backendUrl: string;
  auth: BackendAuth;
  fetchImpl?: typeof fetch;
}

export class BackendSessions {
  /** One refresh or mint at a time per user, so a rotated token is not presented twice. */
  private readonly inflight = new Map<string, Promise<string>>();
  fetchImpl: typeof fetch;

  constructor(
    private readonly tables: TableStore,
    private readonly clock: Clock,
    private readonly options: BackendSessionsOptions,
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Search, stock, TTS and AI video are offered only when the backend and a way to reach it are configured. */
  get enabled(): boolean {
    return this.options.backendUrl !== "" && this.options.auth.kind !== "off";
  }

  /** Forget the person's minted session (their last connector was disconnected). */
  async delete(userId: string): Promise<void> {
    await this.tables.delete(TABLE, userId, ROW);
  }

  /** A bearer token for api.zenvi.pro on behalf of this person. Throws a user-facing Error. */
  accessToken(userId: string): Promise<string> {
    const auth = this.options.auth;
    if (auth.kind === "assertion") return this.assertion(userId, auth.secret);
    if (auth.kind === "off") return Promise.reject(new Error("The Zenvi backend is not configured on this server."));
    const pending = this.inflight.get(userId);
    if (pending) return pending;
    const run = this.resolve(userId, auth).finally(() => {
      if (this.inflight.get(userId) === run) this.inflight.delete(userId);
    });
    this.inflight.set(userId, run);
    return run;
  }

  /** Authenticated JSON call to the Zenvi backend. Throws a user-facing Error. */
  async request<T>(userId: string, path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
    if (!this.enabled) throw new Error("The Zenvi backend is not configured on this server.");
    const token = await this.accessToken(userId);
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

  private async assertion(userId: string, secret: string): Promise<string> {
    const now = Math.floor(this.clock.now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(ASSERTION_ISSUER)
      .setAudience(ASSERTION_AUDIENCE)
      .setSubject(userId)
      .setIssuedAt(now)
      .setExpirationTime(now + ASSERTION_TTL_SECONDS)
      .setJti(randomId("a_"))
      .sign(new TextEncoder().encode(secret));
  }

  private async resolve(userId: string, auth: Extract<BackendAuth, { kind: "session" }>): Promise<string> {
    const row = await this.tables.get<SessionRow>(TABLE, userId, ROW);
    if (row?.source === "minted") {
      if (row.accessToken && stillValid(row.expiresAt, this.clock.now())) return row.accessToken;
      try {
        return await this.store(userId, await this.refresh(row.refreshToken, auth));
      } catch (error) {
        // A rejected refresh token (revoked, or the session ended) gets a new session below.
        if (!(error instanceof SessionRejected)) throw error;
      }
    }
    return this.store(userId, await this.mint(userId, auth));
  }

  private async store(userId: string, session: Session): Promise<string> {
    await this.tables.upsert<SessionRow>(
      TABLE,
      { partitionKey: userId, rowKey: ROW, ...session, source: "minted", updatedAt: isoAt(this.clock.now()) },
      "replace",
    );
    return session.accessToken;
  }

  /**
   * A new session for this person: a recovery link from the admin API (it
   * sends no email and works only for existing accounts), redeemed at once.
   */
  private async mint(userId: string, auth: Extract<BackendAuth, { kind: "session" }>): Promise<Session> {
    const admin = { apikey: auth.serviceRoleKey, Authorization: `Bearer ${auth.serviceRoleKey}`, Accept: "application/json" };
    const user = await this.supabase<{ email?: string }>(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers: admin });
    if (!user.email) throw new Error("This Zenvi account has no email address, so Zenvi Cloud cannot use the Zenvi backend for it.");
    const link = await this.supabase<{ hashed_token?: string; properties?: { hashed_token?: string } }>("/auth/v1/admin/generate_link", {
      method: "POST",
      headers: { ...admin, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "recovery", email: user.email }),
    });
    const hashed = link.hashed_token ?? link.properties?.hashed_token;
    if (!hashed) throw new Error("Could not start a Zenvi session for this account (no link token).");
    const data = await this.supabase<Record<string, unknown>>("/auth/v1/verify", {
      method: "POST",
      headers: { apikey: auth.anonKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ type: "recovery", token_hash: hashed }),
    });
    const session = sessionFrom(data, this.clock.now());
    const minted = (data.user as { id?: unknown } | undefined)?.id;
    if (!session || minted !== userId) throw new Error("Could not start a Zenvi session for this account.");
    return session;
  }

  private async refresh(refreshToken: string, auth: Extract<BackendAuth, { kind: "session" }>): Promise<Session> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { apikey: auth.anonKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      if (isAbort(error)) throw error;
      throw new Error(`Could not refresh the Zenvi session (${error instanceof Error ? error.message : String(error)}).`);
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) throw new SessionRejected();
    if (!response.ok) throw new Error(`Could not refresh the Zenvi session (HTTP ${response.status}).`);
    const session = sessionFrom((await response.json()) as Record<string, unknown>, this.clock.now(), refreshToken);
    if (!session) throw new SessionRejected();
    return session;
  }

  private async supabase<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.supabaseUrl}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
    } catch (error) {
      throw new Error(`Could not reach Zenvi sign-in (${error instanceof Error ? error.message : String(error)}).`);
    }
    if (!response.ok) throw new Error(`Zenvi sign-in refused the server's request (HTTP ${response.status}).`);
    return (await response.json()) as T;
  }
}

function sessionFrom(data: Record<string, unknown>, now: number, previousRefresh = ""): Session | null {
  if (typeof data.access_token !== "string" || data.access_token === "") return null;
  const refreshToken = typeof data.refresh_token === "string" && data.refresh_token !== "" ? data.refresh_token : previousRefresh;
  if (!refreshToken) return null;
  return { accessToken: data.access_token, refreshToken, expiresAt: expiryIso(data, now) };
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
