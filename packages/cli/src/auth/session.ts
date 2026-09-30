/**
 * The signed-in identity, with tokens refreshed on demand.
 *
 * - Zenvi Cloud accepts either a Supabase access token or a personal token.
 * - The Zenvi backend (Assistant tools: search, generation, TTS…) only
 *   accepts Supabase sessions, so device login alone cannot use them.
 */

import type { ZenviConfig } from "../config.js";
import { clearAuth, jwtExpiry, readAuth, writeAuth, type StoredAuth, type SupabaseAuth } from "./store.js";
import { refreshSession, RefreshError } from "./supabase.js";

export interface WhoAmI {
  loggedIn: boolean;
  kind?: StoredAuth["kind"];
  email?: string;
  userId?: string;
  /** ISO time the access token expires (Supabase sessions). */
  expiresAt?: string;
  /** The session could not be refreshed; sign in again. */
  expired?: boolean;
}

/** Refresh a Supabase session this many seconds before it expires. */
const REFRESH_MARGIN_S = 60;

export class Auth {
  private cached: StoredAuth | undefined | null = null;
  private refreshing: Promise<StoredAuth | undefined> | undefined;
  private refreshRejected = false;

  constructor(
    readonly config: ZenviConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async current(): Promise<StoredAuth | undefined> {
    if (this.cached === null) this.cached = await readAuth(this.config);
    return this.cached;
  }

  async save(auth: StoredAuth): Promise<void> {
    await writeAuth(this.config, auth);
    this.cached = auth;
    this.refreshRejected = false;
  }

  async logout(): Promise<boolean> {
    this.cached = undefined;
    return clearAuth(this.config);
  }

  private expiresSoon(auth: SupabaseAuth): boolean {
    const exp = auth.expires_at ?? jwtExpiry(auth.access_token);
    return exp !== undefined && exp - REFRESH_MARGIN_S <= this.now() / 1000;
  }

  /** The stored auth with a fresh Supabase access token when possible. */
  async fresh(): Promise<StoredAuth | undefined> {
    const auth = await this.current();
    if (!auth || auth.kind !== "supabase" || !this.expiresSoon(auth)) return auth;
    this.refreshing ??= (async () => {
      // Another zenvi process may have refreshed already.
      const onDisk = await readAuth(this.config);
      if (onDisk?.kind === "supabase" && !this.expiresSoon(onDisk)) {
        this.cached = onDisk;
        return onDisk;
      }
      try {
        const next = await refreshSession(this.config, auth, this.fetchImpl);
        await this.save(next);
        return next;
      } catch (error) {
        if (error instanceof RefreshError && error.rejected) this.refreshRejected = true;
        return auth;
      }
    })().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  /** Bearer for Zenvi Cloud: personal token or Supabase access token. */
  async cloudToken(): Promise<string | undefined> {
    const auth = await this.fresh();
    if (!auth) return undefined;
    return auth.kind === "pat" ? auth.token : auth.access_token;
  }

  /** Bearer for the Zenvi backend: Supabase sessions only. */
  async backendToken(): Promise<string | undefined> {
    const auth = await this.fresh();
    return auth?.kind === "supabase" ? auth.access_token : undefined;
  }

  async whoami(): Promise<WhoAmI> {
    const auth = await this.fresh();
    if (!auth) return { loggedIn: false };
    if (auth.kind === "pat") return { loggedIn: true, kind: "pat", email: auth.user_email, userId: auth.user_id };
    const exp = auth.expires_at ?? jwtExpiry(auth.access_token);
    const expired = this.refreshRejected || (exp !== undefined && exp <= this.now() / 1000);
    return {
      loggedIn: !expired,
      kind: "supabase",
      email: auth.user_email,
      userId: auth.user_id,
      expiresAt: exp !== undefined ? new Date(exp * 1000).toISOString() : undefined,
      ...(expired ? { expired: true } : {}),
    };
  }
}
