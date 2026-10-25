/**
 * Token storage (`tokens` table). Only SHA-256 hashes are stored.
 *
 * Two row types share the table:
 *   - lookup rows   PK `t:<hash[0..2]>`, RK `<hash>`: everything needed to
 *     authenticate a request with one point read;
 *   - owner index   PK `u:<userId>`, RK `pat:<id>` or `grant:<familyId>`: what
 *     the account page lists (personal tokens and connected OAuth apps).
 *
 * OAuth access and refresh tokens belong to a grant ("family"). Revoking the
 * grant row invalidates every token in the family, including refresh-token
 * reuse detection (OAuth 2.1 §4.3.1 / RFC 9700 §4.14.2).
 */

import type { Clock } from "../util/clock.js";
import { isoAt } from "../util/clock.js";
import { randomId } from "../util/crypto.js";
import { generateToken, hashToken, type TokenKind, tokenKind } from "../auth/tokens.js";
import { NotFoundError, PreconditionFailedError } from "../http/errors.js";
import type { TableEntity, TableStore } from "../storage/types.js";

export interface TokenRecord {
  id: string;
  hash: string;
  kind: TokenKind;
  userId: string;
  email?: string;
  /** PAT name, or the OAuth client's name. */
  name: string;
  clientId?: string;
  scopes: string[];
  /** OAuth audience (RFC 8707 resource) the token was issued for. */
  resource?: string;
  /** OAuth grant id shared by an access/refresh token family. */
  familyId?: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  revoked: boolean;
  /** Refresh tokens: when this token was exchanged for a new pair. */
  rotatedAt?: string;
}

export interface PatInfo {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
}

export interface GrantInfo {
  id: string;
  clientId: string;
  clientName: string;
  scopes: string[];
  resource?: string;
  createdAt: string;
  lastUsedAt?: string;
}

interface LookupRow extends TableEntity {
  id: string;
  kind: string;
  userId: string;
  email?: string;
  name: string;
  clientId?: string;
  scopes: string;
  resource?: string;
  familyId?: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  revoked: boolean;
  rotatedAt?: string;
}

interface IndexRow extends TableEntity {
  kind: "pat" | "grant";
  id: string;
  name: string;
  clientId?: string;
  scopes: string;
  resource?: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  revoked: boolean;
  tokenHash?: string;
}

export interface IssuedPair {
  accessToken: string;
  refreshToken: string;
  access: TokenRecord;
  refresh: TokenRecord;
}

const TABLE = "tokens" as const;
const CACHE_MS = 30_000;
const TOUCH_EVERY_MS = 5 * 60_000;

const lookupPk = (hash: string): string => `t:${hash.slice(0, 2)}`;

/** The `resource` an embed token is bound to: one project. */
export function embedResource(projectId: string): string {
  return `project:${projectId}`;
}

/** The project an embed token's `resource` names, or null. */
export function embedProjectId(resource: string | undefined): string | null {
  return resource?.startsWith("project:") ? resource.slice("project:".length) || null : null;
}

const userPk = (userId: string): string => `u:${userId}`;

function toRecord(row: LookupRow): TokenRecord {
  return {
    id: row.id,
    hash: row.rowKey,
    kind: row.kind as TokenKind,
    userId: row.userId,
    email: row.email ?? undefined,
    name: row.name,
    clientId: row.clientId ?? undefined,
    scopes: parseList(row.scopes),
    resource: row.resource ?? undefined,
    familyId: row.familyId ?? undefined,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt ?? undefined,
    expiresAt: row.expiresAt ?? undefined,
    revoked: row.revoked === true,
    rotatedAt: row.rotatedAt ?? undefined,
  };
}

function toRow(record: TokenRecord): LookupRow {
  return {
    partitionKey: lookupPk(record.hash),
    rowKey: record.hash,
    id: record.id,
    kind: record.kind,
    userId: record.userId,
    email: record.email,
    name: record.name,
    clientId: record.clientId,
    scopes: JSON.stringify(record.scopes),
    resource: record.resource,
    familyId: record.familyId,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    expiresAt: record.expiresAt,
    revoked: record.revoked,
    rotatedAt: record.rotatedAt,
  };
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export class TokenRepo {
  private readonly cache = new Map<string, { record: TokenRecord; until: number }>();
  private readonly grantCache = new Map<string, { revoked: boolean; until: number }>();
  private readonly touched = new Map<string, number>();
  /** Called after a grant is revoked (the account page, or a reused refresh token). */
  onGrantRevoked?: (userId: string) => Promise<void>;

  constructor(
    private readonly tables: TableStore,
    private readonly clock: Clock,
    private readonly log: (message: string) => void = () => {},
  ) {}

  /** Create a personal access token. The token string is returned once and never stored. */
  async createPat(input: { userId: string; email?: string; name: string; scopes: string[]; ttlDays: number | null }): Promise<{
    token: string;
    info: PatInfo;
  }> {
    const { token, hash } = generateToken("pat");
    const now = this.clock.now();
    const record: TokenRecord = {
      id: randomId("tok_", 12),
      hash,
      kind: "pat",
      userId: input.userId,
      email: input.email,
      name: input.name,
      scopes: input.scopes,
      createdAt: isoAt(now),
      expiresAt: input.ttlDays === null ? undefined : isoAt(now + input.ttlDays * 86_400_000),
      revoked: false,
    };
    await this.tables.create(TABLE, toRow(record));
    try {
      await this.tables.create<IndexRow>(TABLE, {
        partitionKey: userPk(record.userId),
        rowKey: `pat:${record.id}`,
        kind: "pat",
        id: record.id,
        name: record.name,
        scopes: JSON.stringify(record.scopes),
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        revoked: false,
        tokenHash: hash,
      });
    } catch (error) {
      await this.tables.delete(TABLE, lookupPk(hash), hash);
      throw error;
    }
    return { token, info: patInfo(record) };
  }

  /**
   * Issue an OAuth access + refresh token pair. A new `familyId` creates the
   * grant row (first authorization); an existing one continues the family
   * (refresh rotation).
   */
  async issuePair(input: {
    userId: string;
    email?: string;
    clientId: string;
    clientName: string;
    scopes: string[];
    resource: string;
    familyId?: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
  }): Promise<IssuedPair & { familyId: string }> {
    const now = this.clock.now();
    const familyId = input.familyId ?? randomId("grant_", 16);
    if (!input.familyId) {
      await this.tables.create<IndexRow>(TABLE, {
        partitionKey: userPk(input.userId),
        rowKey: `grant:${familyId}`,
        kind: "grant",
        id: familyId,
        name: input.clientName,
        clientId: input.clientId,
        scopes: JSON.stringify(input.scopes),
        resource: input.resource,
        createdAt: isoAt(now),
        lastUsedAt: isoAt(now),
        revoked: false,
      });
    }
    const make = (kind: "oauth_access" | "oauth_refresh", ttl: number): { token: string; record: TokenRecord } => {
      const { token, hash } = generateToken(kind);
      return {
        token,
        record: {
          id: randomId(kind === "oauth_access" ? "oat_" : "ort_", 12),
          hash,
          kind,
          userId: input.userId,
          email: input.email,
          name: input.clientName,
          clientId: input.clientId,
          scopes: input.scopes,
          resource: input.resource,
          familyId,
          createdAt: isoAt(now),
          expiresAt: isoAt(now + ttl * 1000),
          revoked: false,
        },
      };
    };
    const access = make("oauth_access", input.accessTtlSeconds);
    const refresh = make("oauth_refresh", input.refreshTtlSeconds);
    await this.tables.create(TABLE, toRow(access.record));
    await this.tables.create(TABLE, toRow(refresh.record));
    return { accessToken: access.token, refreshToken: refresh.token, access: access.record, refresh: refresh.record, familyId };
  }

  /**
   * A token for the editor embedded in a chat (the MCP editor widget): it
   * reads and saves one project and its media, for a few hours. Minted under
   * the connection's OAuth grant (`familyId`), so disconnecting the app ends
   * it too; personal-token connections have no grant and rely on the expiry.
   */
  async issueEmbed(input: {
    userId: string;
    email?: string;
    projectId: string;
    clientName: string;
    scopes: string[];
    familyId?: string;
    ttlSeconds: number;
  }): Promise<{ token: string; record: TokenRecord }> {
    const now = this.clock.now();
    const { token, hash } = generateToken("embed");
    const record: TokenRecord = {
      id: randomId("emb_", 12),
      hash,
      kind: "embed",
      userId: input.userId,
      email: input.email,
      name: input.clientName,
      scopes: input.scopes,
      resource: embedResource(input.projectId),
      familyId: input.familyId,
      createdAt: isoAt(now),
      expiresAt: isoAt(now + input.ttlSeconds * 1000),
      revoked: false,
    };
    await this.tables.create(TABLE, toRow(record));
    return { token, record };
  }

  /** Raw lookup by token string, without validity checks. */
  async lookup(token: string): Promise<{ record: TokenRecord; etag: string } | null> {
    if (tokenKind(token) === null) return null;
    const hash = hashToken(token);
    const row = await this.tables.get<LookupRow>(TABLE, lookupPk(hash), hash);
    return row ? { record: toRecord(row), etag: row.etag } : null;
  }

  /**
   * The record for a currently valid token (not revoked, not expired, grant
   * not revoked), or null. Refresh tokens are never valid bearer credentials.
   */
  async verify(token: string): Promise<TokenRecord | null> {
    const kind = tokenKind(token);
    if (kind === null || kind === "oauth_refresh") return null;
    const hash = hashToken(token);
    const now = this.clock.now();
    const cached = this.cache.get(hash);
    let record: TokenRecord;
    if (cached && cached.until > now) {
      record = cached.record;
    } else {
      const row = await this.tables.get<LookupRow>(TABLE, lookupPk(hash), hash);
      if (!row) return null;
      record = toRecord(row);
      this.cache.set(hash, { record, until: now + CACHE_MS });
      this.trimCache(now);
    }
    if (record.kind !== kind || record.revoked) return null;
    if (record.expiresAt && Date.parse(record.expiresAt) <= now) return null;
    if (record.familyId && (await this.isGrantRevoked(record.userId, record.familyId))) return null;
    this.touch(record);
    return record;
  }

  async isGrantRevoked(userId: string, familyId: string): Promise<boolean> {
    const key = `${userId}/${familyId}`;
    const now = this.clock.now();
    const cached = this.grantCache.get(key);
    if (cached && cached.until > now) return cached.revoked;
    const row = await this.tables.get<IndexRow>(TABLE, userPk(userId), `grant:${familyId}`);
    const revoked = !row || row.revoked === true;
    this.grantCache.set(key, { revoked, until: now + CACHE_MS });
    return revoked;
  }

  /** Mark a refresh token exchanged. False when someone else changed it first. */
  async markRotated(record: TokenRecord, etag: string): Promise<boolean> {
    try {
      await this.tables.update<LookupRow>(
        TABLE,
        { ...toRow(record), revoked: true, rotatedAt: isoAt(this.clock.now()) },
        { etag, mode: "replace" },
      );
      this.cache.delete(record.hash);
      return true;
    } catch (error) {
      if (error instanceof PreconditionFailedError || error instanceof NotFoundError) return false;
      throw error;
    }
  }

  /** Revoke one token by its hash (idempotent). */
  async revokeHash(hash: string): Promise<void> {
    const row = await this.tables.get<LookupRow>(TABLE, lookupPk(hash), hash);
    this.cache.delete(hash);
    if (!row || row.revoked) return;
    await this.tables.update<LookupRow>(TABLE, { partitionKey: row.partitionKey, rowKey: row.rowKey, revoked: true } as LookupRow);
  }

  /** Revoke a whole OAuth grant: every token in the family stops working at once. */
  async revokeGrant(userId: string, familyId: string): Promise<boolean> {
    const row = await this.tables.get<IndexRow>(TABLE, userPk(userId), `grant:${familyId}`);
    this.grantCache.set(`${userId}/${familyId}`, { revoked: true, until: this.clock.now() + CACHE_MS });
    for (const [hash, entry] of this.cache) if (entry.record.familyId === familyId) this.cache.delete(hash);
    if (!row) return false;
    if (!row.revoked) {
      await this.tables.update<IndexRow>(TABLE, { partitionKey: row.partitionKey, rowKey: row.rowKey, revoked: true } as IndexRow);
    }
    await this.onGrantRevoked?.(userId);
    return true;
  }

  /** Revoke a personal access token owned by `userId`. False when not found. */
  async revokePat(userId: string, id: string): Promise<boolean> {
    const row = await this.tables.get<IndexRow>(TABLE, userPk(userId), `pat:${id}`);
    if (!row) return false;
    if (row.tokenHash) await this.revokeHash(row.tokenHash);
    await this.tables.delete(TABLE, row.partitionKey, row.rowKey);
    return true;
  }

  /** Active personal tokens and connected apps for the account page. */
  async listForUser(userId: string): Promise<{ tokens: PatInfo[]; grants: GrantInfo[] }> {
    const now = this.clock.now();
    const tokens: PatInfo[] = [];
    const grants: GrantInfo[] = [];
    for await (const row of this.tables.query<IndexRow>(TABLE, { partitionKey: userPk(userId) })) {
      if (row.revoked) continue;
      if (row.kind === "pat") {
        if (row.expiresAt && Date.parse(row.expiresAt) <= now) continue;
        tokens.push({
          id: row.id,
          name: row.name,
          scopes: parseList(row.scopes),
          createdAt: row.createdAt,
          lastUsedAt: row.lastUsedAt ?? undefined,
          expiresAt: row.expiresAt ?? undefined,
        });
      } else if (row.kind === "grant") {
        grants.push({
          id: row.id,
          clientId: row.clientId ?? "",
          clientName: row.name,
          scopes: parseList(row.scopes),
          resource: row.resource ?? undefined,
          createdAt: row.createdAt,
          lastUsedAt: row.lastUsedAt ?? undefined,
        });
      }
    }
    const byRecent = (a: { createdAt: string }, b: { createdAt: string }): number => b.createdAt.localeCompare(a.createdAt);
    return { tokens: tokens.sort(byRecent), grants: grants.sort(byRecent) };
  }

  /**
   * Housekeeping: delete lookup rows and personal-token index rows that expired
   * more than a day ago. Returns how many rows went.
   */
  async sweepExpired(): Promise<number> {
    const cutoff = isoAt(this.clock.now() - 86_400_000);
    let removed = 0;
    for await (const row of this.tables.query<LookupRow>(TABLE, { where: [["expiresAt", "lt", cutoff]] })) {
      const expiredPatIndex = row.partitionKey.startsWith("u:") && row.rowKey.startsWith("pat:");
      if (!row.partitionKey.startsWith("t:") && !expiredPatIndex) continue;
      if (await this.tables.delete(TABLE, row.partitionKey, row.rowKey)) removed += 1;
    }
    return removed;
  }

  private touch(record: TokenRecord): void {
    const now = this.clock.now();
    const last = this.touched.get(record.hash) ?? (record.lastUsedAt ? Date.parse(record.lastUsedAt) : 0);
    if (now - last < TOUCH_EVERY_MS) return;
    this.touched.set(record.hash, now);
    const at = isoAt(now);
    const writes: Promise<unknown>[] = [
      this.tables.update<LookupRow>(TABLE, { partitionKey: lookupPk(record.hash), rowKey: record.hash, lastUsedAt: at } as LookupRow),
    ];
    const indexKey = record.kind === "pat" ? `pat:${record.id}` : record.familyId ? `grant:${record.familyId}` : null;
    if (indexKey) {
      writes.push(this.tables.update<IndexRow>(TABLE, { partitionKey: userPk(record.userId), rowKey: indexKey, lastUsedAt: at } as IndexRow));
    }
    void Promise.allSettled(writes).then((results) => {
      for (const result of results) {
        if (result.status === "rejected" && !(result.reason instanceof NotFoundError)) {
          this.log(`token touch failed: ${String(result.reason)}`);
        }
      }
    });
  }

  private trimCache(now: number): void {
    if (this.cache.size < 5000) return;
    for (const [hash, entry] of this.cache) if (entry.until <= now) this.cache.delete(hash);
    for (const [hash, at] of this.touched) if (now - at > TOUCH_EVERY_MS) this.touched.delete(hash);
  }
}

function patInfo(record: TokenRecord): PatInfo {
  return {
    id: record.id,
    name: record.name,
    scopes: record.scopes,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    expiresAt: record.expiresAt,
  };
}
