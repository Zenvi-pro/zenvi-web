/**
 * Browser sign-in, exactly like the desktop (zenvi-core
 * src/classes/auth_manager.py `start_auth_flow` / `poll_for_session`):
 * open `<website>/login?state=<uuid>`, then poll the Supabase RPC
 * `poll_desktop_auth_session` every 2 s until the website marks that state
 * authenticated and hands back the session. Refresh uses the standard
 * Supabase `grant_type=refresh_token` endpoint (`_refresh_session`).
 */

import { randomUUID } from "node:crypto";
import type { ZenviConfig } from "../config.js";
import { CliError } from "../output.js";
import { jwtExpiry, jwtIdentity, type SupabaseAuth } from "./store.js";

export interface BrowserLoginOptions {
  /** Show the sign-in URL (the CLI also prints it for copy/paste). */
  onUrl?: (url: string) => void;
  /** Try to open the URL in a browser. */
  openUrl?: (url: string) => Promise<boolean> | boolean;
  signal?: AbortSignal;
  /** Default 5 minutes (the desktop falls back to a password form after 45 s). */
  timeoutMs?: number;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
  /** Test hook: fixed state. */
  state?: string;
}

function anonHeaders(config: ZenviConfig): Record<string, string> {
  return { apikey: config.supabaseAnonKey, "Content-Type": "application/json" };
}

function sessionFrom(row: Record<string, unknown>, previous?: Partial<SupabaseAuth>): SupabaseAuth {
  const access = String(row.access_token ?? "");
  const user = (row.user && typeof row.user === "object" ? row.user : {}) as Record<string, unknown>;
  const identity = jwtIdentity(access);
  const expiresAt = typeof row.expires_at === "number" ? row.expires_at : jwtExpiry(access);
  return {
    kind: "supabase",
    access_token: access,
    refresh_token: String(row.refresh_token ?? previous?.refresh_token ?? ""),
    expires_at: expiresAt,
    user_id: (row.user_id as string | undefined) ?? (user.id as string | undefined) ?? identity.sub ?? previous?.user_id,
    user_email: (row.user_email as string | undefined) ?? (user.email as string | undefined) ?? identity.email ?? previous?.user_email,
    saved_at: new Date().toISOString(),
  };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new CliError("Sign-in cancelled."));
      },
      { once: true },
    );
  });

export async function browserLogin(config: ZenviConfig, options: BrowserLoginOptions = {}): Promise<SupabaseAuth> {
  const doFetch = options.fetchImpl ?? fetch;
  const state = options.state ?? randomUUID();
  const url = `${config.websiteUrl}/login?state=${encodeURIComponent(state)}`;
  options.onUrl?.(url);
  await Promise.resolve(options.openUrl?.(url)).catch(() => false);

  const deadline = Date.now() + (options.timeoutMs ?? 5 * 60_000);
  const interval = options.intervalMs ?? 2000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (options.signal?.aborted) throw new CliError("Sign-in cancelled.");
    try {
      const response = await doFetch(`${config.supabaseUrl}/rest/v1/rpc/poll_desktop_auth_session`, {
        method: "POST",
        headers: anonHeaders(config),
        body: JSON.stringify({ session_state: state }),
        signal: AbortSignal.timeout(8000),
      });
      if (response.status === 200) {
        const rows = (await response.json()) as unknown;
        const row = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
        if (row?.authenticated && typeof row.access_token === "string") return sessionFrom(row);
      } else if (response.status === 404 || response.status === 405) {
        throw new CliError(
          "Browser sign-in is not available on this Zenvi account service (poll_desktop_auth_session missing).",
          1,
          "Use `zenvi login --device` instead.",
        );
      } else {
        lastError = `HTTP ${response.status}`;
      }
    } catch (error) {
      if (error instanceof CliError) throw error;
      lastError = (error as Error).message;
    }
    await sleep(interval, options.signal);
  }
  throw new CliError(
    `Timed out waiting for the browser sign-in${lastError ? ` (last error: ${lastError})` : ""}.`,
    1,
    "On a machine without a browser, run `zenvi login --device`.",
  );
}

export class RefreshError extends Error {
  constructor(
    message: string,
    /** True when the refresh token itself was rejected (sign in again). */
    readonly rejected: boolean,
  ) {
    super(message);
    this.name = "RefreshError";
  }
}

export async function refreshSession(config: ZenviConfig, auth: SupabaseAuth, fetchImpl: typeof fetch = fetch): Promise<SupabaseAuth> {
  let response: Response;
  try {
    response = await fetchImpl(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: anonHeaders(config),
      body: JSON.stringify({ refresh_token: auth.refresh_token }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new RefreshError(`Could not reach Zenvi sign-in: ${(error as Error).message}`, false);
  }
  if (response.status !== 200) {
    const rejected = response.status === 400 || response.status === 401 || response.status === 403;
    throw new RefreshError(`Session refresh failed (HTTP ${response.status}).`, rejected);
  }
  const data = (await response.json()) as Record<string, unknown>;
  if (typeof data.access_token !== "string") throw new RefreshError("Session refresh returned no access token.", true);
  return sessionFrom(data, auth);
}
