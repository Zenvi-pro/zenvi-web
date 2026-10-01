/**
 * OAuth 2.1 authorization server for remote MCP connectors (ChatGPT,
 * Claude.ai, Claude Code, Codex, Cursor…), following the MCP authorization
 * spec (2025-06-18 / 2025-11-25) and what the hosts require
 * (scratchpad/specs/remote-mcp-requirements.md §0, §7):
 *
 *   - authorization code + PKCE S256 only, public clients (`none`);
 *   - clients by dynamic registration (RFC 7591) or metadata document (CIMD);
 *   - exact redirect URI match (loopback: any port, RFC 8252 §7.3);
 *   - `resource` (RFC 8707) bound into the token and checked on every call;
 *   - `iss` in every authorization response (RFC 9207), so ChatGPT can use its
 *     stable redirect URI;
 *   - refresh tokens rotate on every use; a reused one revokes the grant.
 *
 * The person signs in and consents on the web editor (`${editor}/connect`),
 * which shares the zenvi.pro Supabase session; the editor calls
 * `consentInfo` / `consent` and follows the returned redirect.
 */

import { hasScope, grantableScopes, RESOURCE_SCOPES, SCOPE_DESCRIPTIONS, SCOPE_OFFLINE } from "../auth/scopes.js";
import { hashToken, tokenKind } from "../auth/tokens.js";
import { conflict, notFound, PreconditionFailedError } from "../http/errors.js";
import type { TokenRepo } from "../repos/tokens.js";
import type { TableEntity, TableStore } from "../storage/types.js";
import type { Clock } from "../util/clock.js";
import { isoAt } from "../util/clock.js";
import { randomSecret, sha256Hex } from "../util/crypto.js";
import type { ClientRegistry, OAuthClient } from "./clients.js";
import { isValidChallenge, verifyPkce } from "./pkce.js";
import { redirectUriMatches, withParams } from "./redirect.js";

export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status: 400 | 401 = 400,
  ) {
    super(description);
    this.name = "OAuthError";
  }

  body(): { error: string; error_description: string } {
    return { error: this.error, error_description: this.description };
  }
}

const TABLE = "oauthcodes" as const;
const REQUEST_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 5 * 60_000;
/** A refresh token re-presented this soon after rotation is a retry, not an attack. */
const ROTATION_GRACE_MS = 60_000;
const MAX_STATE = 4096;

interface RequestRow extends TableEntity {
  clientId: string;
  clientName: string;
  clientKind: string;
  redirectUri: string;
  redirectUriProvided: boolean;
  state?: string;
  codeChallenge: string;
  scopes: string;
  resource: string;
  issuer: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "approved" | "denied";
}

interface CodeRow extends TableEntity {
  clientId: string;
  clientName: string;
  userId: string;
  email?: string;
  redirectUri: string;
  redirectUriProvided: boolean;
  codeChallenge: string;
  scopes: string;
  resource: string;
  issuer: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  familyId?: string;
}

export interface AuthorizeParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  resource: string[];
}

export type AuthorizeOutcome = { kind: "error_page"; message: string } | { kind: "redirect"; location: string };

export interface ConsentInfo {
  request: string;
  client: {
    id: string;
    name: string;
    /** "metadata_document": identity backed by the client's own https URL; "registered": self-described. */
    type: OAuthClient["kind"];
    /** Host that vouches for the client (metadata documents only). */
    verifiedHost: string | null;
    uri?: string;
    logoUri?: string;
  };
  redirectUri: string;
  redirectHost: string;
  scopes: { name: string; description: string }[];
  resource: string;
  expiresAt: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface OAuthServiceOptions {
  tables: TableStore;
  clients: ClientRegistry;
  tokens: TokenRepo;
  clock: Clock;
  editorUrl: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  documentationUrl: string;
}

export function mcpResource(origin: string): string {
  return `${origin}/mcp`;
}

function parseScopes(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export class OAuthService {
  constructor(private readonly options: OAuthServiceOptions) {}

  authorizationServerMetadata(origin: string): Record<string, unknown> {
    return {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [...RESOURCE_SCOPES, SCOPE_OFFLINE],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      service_documentation: this.options.documentationUrl,
    };
  }

  protectedResourceMetadata(origin: string): Record<string, unknown> {
    return {
      resource: mcpResource(origin),
      authorization_servers: [origin],
      scopes_supported: [...RESOURCE_SCOPES],
      bearer_methods_supported: ["header"],
      resource_name: "Zenvi",
      resource_documentation: this.options.documentationUrl,
    };
  }

  /** Accepts the canonical MCP URL (also with a trailing slash or as the bare origin, for older clients). */
  private resourceFor(origin: string, requested: string[]): string | null {
    const canonical = mcpResource(origin);
    if (requested.length === 0) return canonical;
    for (const value of requested) {
      const normalized = value.replace(/\/+$/, "");
      if (normalized !== canonical && normalized !== origin) return null;
    }
    return canonical;
  }

  async authorize(params: AuthorizeParams, origin: string): Promise<AuthorizeOutcome> {
    const clientId = params.client_id;
    if (!clientId) return { kind: "error_page", message: "The request has no client_id." };
    const client = await this.options.clients.get(clientId, params.redirect_uri);
    if (!client) return { kind: "error_page", message: "This app is not registered with Zenvi (unknown client_id). Try connecting again." };

    let redirectUri: string;
    if (params.redirect_uri !== undefined) {
      if (!redirectUriMatches(client.redirectUris, params.redirect_uri)) {
        return { kind: "error_page", message: "The redirect_uri does not match the ones this app registered, so Zenvi will not send you back to it." };
      }
      redirectUri = params.redirect_uri;
    } else if (client.redirectUris.length === 1 && client.redirectUris[0]) {
      redirectUri = client.redirectUris[0];
    } else {
      return { kind: "error_page", message: "The request has no redirect_uri." };
    }

    const fail = (error: string, description: string): AuthorizeOutcome => ({
      kind: "redirect",
      location: withParams(redirectUri, { error, error_description: description, state: params.state, iss: origin }),
    });
    if (params.response_type !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
    if (!params.code_challenge) return fail("invalid_request", "PKCE is required: send code_challenge with code_challenge_method=S256.");
    if ((params.code_challenge_method ?? "plain") !== "S256") return fail("invalid_request", "Only code_challenge_method=S256 is supported.");
    if (!isValidChallenge(params.code_challenge)) return fail("invalid_request", "code_challenge is not a valid S256 challenge.");
    if (params.state !== undefined && params.state.length > MAX_STATE) return fail("invalid_request", "state is too long.");
    const resource = this.resourceFor(origin, params.resource);
    if (!resource) return fail("invalid_target", `This server only issues tokens for ${mcpResource(origin)}.`);

    const now = this.options.clock.now();
    const id = randomSecret(32);
    const row: RequestRow = {
      partitionKey: "req",
      rowKey: id,
      clientId: client.clientId,
      clientName: client.name,
      clientKind: client.kind,
      redirectUri,
      redirectUriProvided: params.redirect_uri !== undefined,
      state: params.state,
      codeChallenge: params.code_challenge,
      scopes: JSON.stringify(grantableScopes(params.scope)),
      resource,
      issuer: origin,
      createdAt: isoAt(now),
      expiresAt: isoAt(now + REQUEST_TTL_MS),
      status: "pending",
    };
    await this.options.tables.create(TABLE, row);
    return { kind: "redirect", location: `${this.options.editorUrl}/connect?request=${encodeURIComponent(id)}` };
  }

  private async pendingRequest(requestId: string): Promise<RequestRow & { etag: string }> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(requestId)) throw notFound("Authorization request");
    const row = await this.options.tables.get<RequestRow>(TABLE, "req", requestId);
    if (!row || Date.parse(row.expiresAt) <= this.options.clock.now()) throw notFound("Authorization request");
    return row;
  }

  /** Public details of a pending request for the consent page (no secrets). */
  async consentInfo(requestId: string): Promise<ConsentInfo> {
    const row = await this.pendingRequest(requestId);
    if (row.status !== "pending") throw conflict("This authorization request was already answered.", "request_used");
    const client = await this.options.clients.get(row.clientId);
    const redirect = new URL(row.redirectUri);
    return {
      request: requestId,
      client: {
        id: row.clientId,
        name: client?.name ?? row.clientName,
        type: (row.clientKind as OAuthClient["kind"]) ?? "registered",
        verifiedHost: row.clientKind === "metadata_document" ? new URL(row.clientId).hostname : null,
        uri: client?.clientUri,
        logoUri: client?.logoUri,
      },
      redirectUri: row.redirectUri,
      redirectHost: redirect.host || redirect.protocol.replace(":", ""),
      scopes: parseScopes(row.scopes).map((name) => ({ name, description: SCOPE_DESCRIPTIONS[name] ?? name })),
      resource: row.resource,
      expiresAt: row.expiresAt,
    };
  }

  /** The signed-in person's answer. Returns where the browser goes next. */
  async consent(requestId: string, user: { userId: string; email?: string }, approve: boolean): Promise<{ redirect: string }> {
    const row = await this.pendingRequest(requestId);
    if (row.status !== "pending") throw conflict("This authorization request was already answered.", "request_used");
    try {
      await this.options.tables.update<RequestRow>(TABLE, { ...row, status: approve ? "approved" : "denied" }, { etag: row.etag, mode: "replace" });
    } catch (error) {
      if (error instanceof PreconditionFailedError) throw conflict("This authorization request was already answered.", "request_used");
      throw error;
    }
    if (!approve) {
      return {
        redirect: withParams(row.redirectUri, {
          error: "access_denied",
          error_description: "The request was declined.",
          state: row.state ?? undefined,
          iss: row.issuer,
        }),
      };
    }
    const code = randomSecret(32);
    const now = this.options.clock.now();
    const codeRow: CodeRow = {
      partitionKey: "code",
      rowKey: sha256Hex(code),
      clientId: row.clientId,
      clientName: row.clientName,
      userId: user.userId,
      email: user.email,
      redirectUri: row.redirectUri,
      redirectUriProvided: row.redirectUriProvided,
      codeChallenge: row.codeChallenge,
      scopes: row.scopes,
      resource: row.resource,
      issuer: row.issuer,
      createdAt: isoAt(now),
      expiresAt: isoAt(now + CODE_TTL_MS),
    };
    await this.options.tables.create(TABLE, codeRow);
    return { redirect: withParams(row.redirectUri, { code, state: row.state ?? undefined, iss: row.issuer }) };
  }

  async token(params: Record<string, string | undefined>, origin: string): Promise<TokenResponse> {
    let clientId = params.client_id;
    if (!clientId && params.grant_type === "refresh_token" && params.refresh_token) {
      // Some public clients omit client_id on refresh; the refresh token is bound to its client anyway.
      clientId = (await this.options.tokens.lookup(params.refresh_token))?.record.clientId;
    }
    if (!clientId) throw new OAuthError("invalid_client", "client_id is required (public client).", 401);
    const client = await this.options.clients.get(clientId);
    if (!client) throw new OAuthError("invalid_client", "Unknown client.", 401);
    switch (params.grant_type) {
      case "authorization_code":
        return this.exchangeCode(params, client, origin);
      case "refresh_token":
        return this.refresh(params, client, origin);
      default:
        throw new OAuthError("unsupported_grant_type", "Supported grants: authorization_code, refresh_token.");
    }
  }

  private async exchangeCode(params: Record<string, string | undefined>, client: OAuthClient, origin: string): Promise<TokenResponse> {
    const code = params.code;
    if (!code) throw new OAuthError("invalid_request", "code is required.");
    const row = await this.options.tables.get<CodeRow>(TABLE, "code", sha256Hex(code));
    if (!row) throw new OAuthError("invalid_grant", "The authorization code is invalid.");
    if (row.usedAt) {
      // RFC 6749 §4.1.2: a code used twice revokes what it issued.
      if (row.familyId) await this.options.tokens.revokeGrant(row.userId, row.familyId);
      throw new OAuthError("invalid_grant", "The authorization code was already used.");
    }
    if (Date.parse(row.expiresAt) <= this.options.clock.now()) throw new OAuthError("invalid_grant", "The authorization code expired.");
    if (row.clientId !== client.clientId) throw new OAuthError("invalid_grant", "The code was issued to another client.");
    if (row.issuer !== origin) throw new OAuthError("invalid_grant", "The code was issued by another issuer.");
    if (row.redirectUriProvided || params.redirect_uri !== undefined) {
      if (params.redirect_uri !== row.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri does not match the authorization request.");
    }
    if (!verifyPkce(params.code_verifier, row.codeChallenge)) throw new OAuthError("invalid_grant", "PKCE verification failed.");
    if (params.resource !== undefined && this.resourceFor(origin, [params.resource]) !== row.resource) {
      throw new OAuthError("invalid_target", "resource does not match the authorization request.");
    }
    try {
      await this.options.tables.update<CodeRow>(TABLE, { ...row, usedAt: isoAt(this.options.clock.now()) }, { etag: row.etag, mode: "replace" });
    } catch (error) {
      if (error instanceof PreconditionFailedError) throw new OAuthError("invalid_grant", "The authorization code was already used.");
      throw error;
    }
    const scopes = parseScopes(row.scopes);
    const pair = await this.options.tokens.issuePair({
      userId: row.userId,
      email: row.email ?? undefined,
      clientId: client.clientId,
      clientName: client.name,
      scopes,
      resource: row.resource,
      accessTtlSeconds: this.options.accessTtlSeconds,
      refreshTtlSeconds: this.options.refreshTtlSeconds,
    });
    await this.options.tables
      .update<CodeRow>(TABLE, { partitionKey: "code", rowKey: row.rowKey, familyId: pair.familyId } as CodeRow)
      .catch(() => undefined);
    return this.response(pair.accessToken, pair.refreshToken, scopes);
  }

  private async refresh(params: Record<string, string | undefined>, client: OAuthClient, origin: string): Promise<TokenResponse> {
    const presented = params.refresh_token;
    if (!presented || tokenKind(presented) !== "oauth_refresh") throw new OAuthError("invalid_grant", "The refresh token is invalid.");
    const found = await this.options.tokens.lookup(presented);
    if (!found || found.record.kind !== "oauth_refresh" || !found.record.familyId) {
      throw new OAuthError("invalid_grant", "The refresh token is invalid.");
    }
    const { record } = found;
    const familyId = found.record.familyId;
    const now = this.options.clock.now();
    if (record.clientId !== client.clientId) throw new OAuthError("invalid_grant", "The refresh token was issued to another client.");
    if (record.expiresAt && Date.parse(record.expiresAt) <= now) throw new OAuthError("invalid_grant", "The refresh token expired.");
    if (await this.options.tokens.isGrantRevoked(record.userId, familyId)) {
      throw new OAuthError("invalid_grant", "This connection was disconnected. Connect again.");
    }
    const resource = record.resource ?? mcpResource(origin);
    if (params.resource !== undefined && this.resourceFor(origin, [params.resource]) !== resource) {
      throw new OAuthError("invalid_target", "resource does not match the original authorization.");
    }
    let scopes = record.scopes;
    if (params.scope !== undefined && params.scope.trim() !== "") {
      const asked = params.scope.split(/\s+/).filter((s) => s !== "" && s !== SCOPE_OFFLINE);
      if (asked.some((s) => !hasScope(record.scopes, s))) throw new OAuthError("invalid_scope", "Cannot widen the scope on refresh.");
      scopes = record.scopes.filter((s) => asked.includes(s));
    }

    if (record.revoked) {
      const rotatedAt = record.rotatedAt ? Date.parse(record.rotatedAt) : Number.NaN;
      if (!(now - rotatedAt <= ROTATION_GRACE_MS)) {
        // Reuse of a rotated refresh token: assume it leaked and end the grant.
        await this.options.tokens.revokeGrant(record.userId, familyId);
        throw new OAuthError("invalid_grant", "The refresh token was already used. Connect again.");
      }
    } else if (!(await this.options.tokens.markRotated(record, found.etag))) {
      // Someone rotated it a moment ago; treat like a retry within the grace window.
      const again = await this.options.tokens.lookup(presented);
      const rotatedAt = again?.record.rotatedAt ? Date.parse(again.record.rotatedAt) : Number.NaN;
      if (!(now - rotatedAt <= ROTATION_GRACE_MS)) throw new OAuthError("invalid_grant", "The refresh token is no longer valid.");
    }

    const pair = await this.options.tokens.issuePair({
      userId: record.userId,
      email: record.email,
      clientId: client.clientId,
      clientName: client.name,
      scopes,
      resource,
      familyId,
      accessTtlSeconds: this.options.accessTtlSeconds,
      refreshTtlSeconds: this.options.refreshTtlSeconds,
    });
    return this.response(pair.accessToken, pair.refreshToken, scopes);
  }

  private response(accessToken: string, refreshToken: string, scopes: string[]): TokenResponse {
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: this.options.accessTtlSeconds,
      refresh_token: refreshToken,
      scope: scopes.join(" "),
    };
  }

  /** RFC 7009: always succeeds for the caller; revokes only the client's own tokens. */
  async revoke(params: Record<string, string | undefined>): Promise<void> {
    const token = params.token;
    if (!token) throw new OAuthError("invalid_request", "token is required.");
    const kind = tokenKind(token);
    if (kind !== "oauth_access" && kind !== "oauth_refresh") return;
    const found = await this.options.tokens.lookup(token);
    if (!found) return;
    const { record } = found;
    if (params.client_id !== undefined && record.clientId !== params.client_id) return;
    if (kind === "oauth_refresh" && record.familyId) {
      await this.options.tokens.revokeGrant(record.userId, record.familyId);
    } else {
      await this.options.tokens.revokeHash(hashToken(token));
    }
  }

  /** Housekeeping: drop expired requests and codes. */
  async sweepExpired(): Promise<number> {
    const cutoff = isoAt(this.options.clock.now() - 3_600_000);
    let removed = 0;
    for (const partitionKey of ["req", "code"]) {
      for await (const row of this.options.tables.query<RequestRow>(TABLE, { partitionKey, where: [["expiresAt", "lt", cutoff]] })) {
        if (await this.options.tables.delete(TABLE, row.partitionKey, row.rowKey)) removed += 1;
      }
    }
    return removed;
  }
}
