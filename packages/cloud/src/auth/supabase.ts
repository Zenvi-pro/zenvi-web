/**
 * Supabase access-token verification (the same user pool as zenvi.pro and the
 * desktop app). Tokens are ES256 JWTs signed by the project's key; the public
 * keys come from the project's JWKS. We check signature, `iss`, `aud`
 * ("authenticated"), `exp`/`nbf` and a non-empty `sub`, and refuse anonymous
 * sessions (Supabase anonymous sign-ins also carry aud "authenticated").
 *
 * Mirrors zenvi-backend api/auth.py `_verify_jwt` (asymmetric path).
 */

import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface SupabaseUser {
  id: string;
  email?: string;
  /** Seconds since epoch. */
  expiresAt: number;
}

export interface SupabaseVerifier {
  /** The user, or null when the token is not a valid Supabase access token. */
  verify(token: string): Promise<SupabaseUser | null>;
}

export interface SupabaseVerifierOptions {
  supabaseUrl: string;
  /** Key source; defaults to the project's remote JWKS. Tests pass a local JWKS. */
  keys?: JWTVerifyGetKey;
  log?: (message: string) => void;
}

/** Cheap shape check so opaque Zenvi tokens never reach the JWT parser. */
export function looksLikeJwt(token: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
}

export function createSupabaseVerifier(options: SupabaseVerifierOptions): SupabaseVerifier {
  const issuer = `${options.supabaseUrl}/auth/v1`;
  const keys =
    options.keys ??
    createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
      cacheMaxAge: 10 * 60_000,
      cooldownDuration: 30_000,
      timeoutDuration: 5_000,
    });

  return {
    async verify(token) {
      if (!looksLikeJwt(token)) return null;
      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer,
          audience: "authenticated",
          algorithms: ["ES256"],
          requiredClaims: ["sub", "exp"],
          clockTolerance: 30,
        });
        if (typeof payload.sub !== "string" || payload.sub === "") return null;
        if (payload.is_anonymous === true) return null;
        const email = typeof payload.email === "string" && payload.email !== "" ? payload.email : undefined;
        return { id: payload.sub, email, expiresAt: payload.exp ?? 0 };
      } catch (error) {
        // Bad tokens are expected traffic; infrastructure failures (JWKS
        // unreachable) are worth a log line but still fail closed.
        if (!(error instanceof joseErrors.JOSEError) || error instanceof joseErrors.JWKSTimeout) {
          options.log?.(`supabase verify failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        return null;
      }
    },
  };
}
