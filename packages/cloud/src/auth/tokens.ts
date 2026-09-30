/**
 * Zenvi bearer tokens: 32 random bytes (base64url) behind a kind prefix.
 *
 *   zvn_pat_…  personal access token (CLI device login, account page)
 *   zvn_oat_…  OAuth access token (remote MCP connectors), 1 h
 *   zvn_ort_…  OAuth refresh token, rotated on every use
 *
 * Only the SHA-256 of a token is ever stored. The prefix lets us reject
 * foreign tokens without a lookup and lets secret scanners recognise leaks.
 */

import { randomSecret, sha256Hex } from "../util/crypto.js";

export type TokenKind = "pat" | "oauth_access" | "oauth_refresh";

export const TOKEN_PREFIX: Record<TokenKind, string> = {
  pat: "zvn_pat_",
  oauth_access: "zvn_oat_",
  oauth_refresh: "zvn_ort_",
};

const TOKEN_BODY = /^[A-Za-z0-9_-]{43}$/;

export function generateToken(kind: TokenKind): { token: string; hash: string } {
  const token = `${TOKEN_PREFIX[kind]}${randomSecret(32)}`;
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return sha256Hex(token);
}

/** The kind of a well-formed Zenvi token, or null. */
export function tokenKind(token: string): TokenKind | null {
  for (const [kind, prefix] of Object.entries(TOKEN_PREFIX) as [TokenKind, string][]) {
    if (token.startsWith(prefix) && TOKEN_BODY.test(token.slice(prefix.length))) return kind;
  }
  return null;
}

/** `Authorization: Bearer <token>` → token (never from the query string). */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer[ ]+([^\s]+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}
