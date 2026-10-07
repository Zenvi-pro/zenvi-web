/**
 * OAuth clients. Two kinds, both public (no secret; PKCE + exact redirect
 * URIs authenticate the flow):
 *
 *   - registered: RFC 7591 dynamic client registration, stored in the
 *     `oauthclients` table; id `zc_…`;
 *   - metadata document: the client id is an https URL whose JSON document
 *     describes the client (draft-ietf-oauth-client-id-metadata-document,
 *     "CIMD"; ChatGPT and Claude both use it). Fetched with the SSRF guard and
 *     cached in memory.
 */

import { z } from "zod";
import type { TableEntity, TableStore } from "../storage/types.js";
import type { Clock } from "../util/clock.js";
import { isoAt } from "../util/clock.js";
import { randomId } from "../util/crypto.js";
import { redirectUriMatches, validateRedirectUris } from "./redirect.js";

export interface OAuthClient {
  clientId: string;
  kind: "registered" | "metadata_document";
  name: string;
  redirectUris: string[];
  clientUri?: string;
  logoUri?: string;
  createdAt?: string;
}

export class ClientError extends Error {
  constructor(
    readonly error: "invalid_client_metadata" | "invalid_redirect_uri" | "invalid_client",
    message: string,
  ) {
    super(message);
    this.name = "ClientError";
  }
}

interface ClientRow extends TableEntity {
  name: string;
  redirectUris: string;
  clientUri?: string;
  logoUri?: string;
  softwareId?: string;
  softwareVersion?: string;
  createdAt: string;
}

const TABLE = "oauthclients" as const;
const PK = "c";
const CIMD_TTL_MS = 60 * 60_000;
const CIMD_REFETCH_MS = 60_000;
const CIMD_MAX_BYTES = 64 * 1024;

const optionalUrl = z
  .string()
  .max(2048)
  .optional()
  .transform((value) => (value && /^https:\/\//i.test(value) ? value : undefined));

const registrationSchema = z
  .object({
    redirect_uris: z.array(z.string()).optional(),
    client_name: z.string().max(200).optional(),
    client_uri: optionalUrl,
    logo_uri: optionalUrl,
    grant_types: z.array(z.string()).optional(),
    response_types: z.array(z.string()).optional(),
    token_endpoint_auth_method: z.string().optional(),
    scope: z.string().max(1000).optional(),
    software_id: z.string().max(200).optional(),
    software_version: z.string().max(100).optional(),
  })
  .passthrough();

function cleanName(value: string | undefined, fallback: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = (value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned === "" ? fallback : cleaned.slice(0, 100);
}

/** Is this client id a metadata-document URL we would fetch? */
export function isMetadataDocumentId(clientId: string): boolean {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.pathname !== "/" &&
    url.pathname !== "" &&
    url.hash === "" &&
    !url.username &&
    !url.password &&
    !/\/\.\.?(\/|$)/.test(url.pathname)
  );
}

export type JsonFetcher = (url: string) => Promise<unknown>;

export class ClientRegistry {
  private readonly cimdCache = new Map<string, { client: OAuthClient; until: number; fetchedAt: number }>();

  constructor(
    private readonly tables: TableStore,
    private readonly clock: Clock,
    private readonly fetchDocument: JsonFetcher,
  ) {}

  /** RFC 7591 registration. Returns the registration response body. */
  async register(body: unknown): Promise<Record<string, unknown>> {
    const parsed = registrationSchema.safeParse(body);
    if (!parsed.success) throw new ClientError("invalid_client_metadata", "The registration request is not valid JSON client metadata.");
    const meta = parsed.data;
    const redirect = validateRedirectUris(meta.redirect_uris);
    if ("error" in redirect) throw new ClientError("invalid_redirect_uri", redirect.error);
    const grantTypes = meta.grant_types ?? ["authorization_code", "refresh_token"];
    if (grantTypes.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
      throw new ClientError("invalid_client_metadata", "Only the authorization_code and refresh_token grants are supported.");
    }
    if ((meta.response_types ?? ["code"]).some((r) => r !== "code")) {
      throw new ClientError("invalid_client_metadata", "Only response_type=code is supported.");
    }
    const clientId = randomId("zc_", 20);
    const createdAt = this.clock.now();
    const row: ClientRow = {
      partitionKey: PK,
      rowKey: clientId,
      name: cleanName(meta.client_name, "MCP client"),
      redirectUris: JSON.stringify(redirect.uris),
      clientUri: meta.client_uri,
      logoUri: meta.logo_uri,
      softwareId: meta.software_id,
      softwareVersion: meta.software_version,
      createdAt: isoAt(createdAt),
    };
    await this.tables.create(TABLE, row);
    // Public clients only: whatever auth method was asked for, the client is
    // registered as "none" and told so (RFC 7591 §3.2.1 lets the server
    // replace requested values).
    return {
      client_id: clientId,
      client_id_issued_at: Math.floor(createdAt / 1000),
      client_name: row.name,
      redirect_uris: redirect.uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(meta.client_uri ? { client_uri: meta.client_uri } : {}),
      ...(meta.logo_uri ? { logo_uri: meta.logo_uri } : {}),
      ...(meta.scope ? { scope: meta.scope } : {}),
    };
  }

  /** Look a client up. With `redirectUri`, a cached metadata document that lacks it is refetched once. */
  async get(clientId: string, redirectUri?: string): Promise<OAuthClient | null> {
    if (isMetadataDocumentId(clientId)) return this.fromDocument(clientId, redirectUri);
    if (!/^zc_[a-z0-9]{20}$/.test(clientId)) return null;
    const row = await this.tables.get<ClientRow>(TABLE, PK, clientId);
    if (!row) return null;
    let redirectUris: string[] = [];
    try {
      redirectUris = JSON.parse(row.redirectUris) as string[];
    } catch {
      redirectUris = [];
    }
    return {
      clientId,
      kind: "registered",
      name: row.name,
      redirectUris,
      clientUri: row.clientUri ?? undefined,
      logoUri: row.logoUri ?? undefined,
      createdAt: row.createdAt,
    };
  }

  private async fromDocument(clientId: string, redirectUri?: string): Promise<OAuthClient | null> {
    const now = this.clock.now();
    const cached = this.cimdCache.get(clientId);
    if (cached && cached.until > now) {
      const matches = redirectUri === undefined || redirectUriMatches(cached.client.redirectUris, redirectUri);
      // A redirect URI the cached copy lacks may be new: refetch, at most once a minute.
      if (matches || now - cached.fetchedAt < CIMD_REFETCH_MS) return cached.client;
    }
    let document: unknown;
    try {
      document = await this.fetchDocument(clientId);
    } catch {
      // A document we cannot fetch right now: fall back to a still-cached copy.
      return cached?.client ?? null;
    }
    const client = parseMetadataDocument(clientId, document);
    if (client) {
      this.cimdCache.set(clientId, { client, until: now + CIMD_TTL_MS, fetchedAt: now });
      if (this.cimdCache.size > 1000) {
        for (const [key, entry] of this.cimdCache) if (entry.until <= now) this.cimdCache.delete(key);
      }
    }
    return client;
  }
}

export const CIMD_FETCH_LIMIT = CIMD_MAX_BYTES;

/** Validate a client metadata document. Null when it is not acceptable. */
export function parseMetadataDocument(clientId: string, document: unknown): OAuthClient | null {
  if (typeof document !== "object" || document === null || Array.isArray(document)) return null;
  const doc = document as Record<string, unknown>;
  if (doc.client_id !== clientId) return null;
  if ("client_secret" in doc || "client_secret_expires_at" in doc) return null;
  const redirect = validateRedirectUris(doc.redirect_uris);
  if ("error" in redirect) return null;
  const method = typeof doc.token_endpoint_auth_method === "string" ? doc.token_endpoint_auth_method : undefined;
  const methods = Array.isArray(doc.token_endpoint_auth_methods_supported)
    ? doc.token_endpoint_auth_methods_supported.filter((m): m is string => typeof m === "string")
    : [];
  // We only speak public-client token exchange ("none"). ChatGPT's document
  // prefers private_key_jwt but lists "none" as supported, which is enough.
  if (method !== undefined && method !== "none" && !methods.includes("none")) return null;
  const grantTypes = Array.isArray(doc.grant_types) ? doc.grant_types : ["authorization_code"];
  if (!grantTypes.includes("authorization_code")) return null;
  const host = new URL(clientId).hostname;
  const httpsOrUndefined = (value: unknown): string | undefined =>
    typeof value === "string" && /^https:\/\//i.test(value) && value.length <= 2048 ? value : undefined;
  return {
    clientId,
    kind: "metadata_document",
    name: cleanName(typeof doc.client_name === "string" ? doc.client_name : undefined, host),
    redirectUris: redirect.uris,
    clientUri: httpsOrUndefined(doc.client_uri),
    logoUri: httpsOrUndefined(doc.logo_uri),
  };
}
