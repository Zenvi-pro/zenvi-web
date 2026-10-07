/**
 * Who is calling. Every authenticated request resolves to exactly one
 * principal; every stored object is keyed by `userId` (the Supabase user id),
 * so authorization is "the object's owner is principal.userId".
 */

import { SCOPE_READ, SCOPE_WRITE } from "./scopes.js";
import type { SupabaseVerifier } from "./supabase.js";
import { looksLikeJwt } from "./supabase.js";
import { tokenKind } from "./tokens.js";
import type { TokenRepo } from "../repos/tokens.js";

export type Principal =
  | { kind: "supabase"; userId: string; email?: string; scopes: string[] }
  | { kind: "pat"; userId: string; email?: string; tokenId: string; name: string; scopes: string[] }
  | {
      kind: "oauth";
      userId: string;
      email?: string;
      tokenId: string;
      clientId: string;
      clientName: string;
      scopes: string[];
      resource: string;
      familyId: string;
      expiresAt?: string;
    };

export type PrincipalKind = Principal["kind"];

export class Authenticator {
  constructor(
    private readonly supabase: SupabaseVerifier,
    private readonly tokens: TokenRepo,
  ) {}

  /** The principal for a bearer token, or null when it is not valid. */
  async authenticate(token: string): Promise<Principal | null> {
    const kind = tokenKind(token);
    if (kind !== null) {
      const record = await this.tokens.verify(token);
      if (!record) return null;
      if (record.kind === "pat") {
        return { kind: "pat", userId: record.userId, email: record.email, tokenId: record.id, name: record.name, scopes: record.scopes };
      }
      if (record.kind === "oauth_access" && record.clientId && record.resource && record.familyId) {
        return {
          kind: "oauth",
          userId: record.userId,
          email: record.email,
          tokenId: record.id,
          clientId: record.clientId,
          clientName: record.name,
          scopes: record.scopes,
          resource: record.resource,
          familyId: record.familyId,
          expiresAt: record.expiresAt,
        };
      }
      return null;
    }
    if (!looksLikeJwt(token)) return null;
    const user = await this.supabase.verify(token);
    return user ? { kind: "supabase", userId: user.id, email: user.email, scopes: [SCOPE_READ, SCOPE_WRITE] } : null;
  }
}

/** A stable key for per-connection state (the MCP "current project"). */
export function connectionKey(principal: Principal): string {
  switch (principal.kind) {
    case "oauth":
      return principal.familyId;
    case "pat":
      return principal.tokenId;
    case "supabase":
      return "web";
  }
}
