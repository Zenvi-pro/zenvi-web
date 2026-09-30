/**
 * In-process storage for tests and local development. Mirrors the Azure
 * semantics the service relies on: ETags change on every write, conditional
 * writes fail with PreconditionFailedError, creates fail on existing keys,
 * queries return entities ordered by (partitionKey, rowKey).
 *
 * Signed URLs look like `memory://blob/<path>?sp=r&se=<ms>&sig=<hmac>`;
 * `acceptSignedWrite` plays the part of a client PUT to such a URL.
 */

import { createHmac, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { AlreadyExistsError, NotFoundError, PreconditionFailedError } from "../http/errors.js";
import type {
  BlobItem,
  BlobProperties,
  BlobStore,
  BlobWriteOptions,
  FilterClause,
  SignOptions,
  Stored,
  TableEntity,
  TableName,
  TableQuery,
  TableStore,
} from "./types.js";

let etagCounter = 0;
function nextEtag(): string {
  etagCounter += 1;
  return `0x${Date.now().toString(16)}${etagCounter.toString(16).padStart(6, "0")}`;
}

interface MemoryBlob {
  data: Buffer;
  properties: BlobProperties;
}

export class MemoryBlobStore implements BlobStore {
  readonly kind = "memory" as const;
  readonly origin = "https://blob.memory.invalid";
  private readonly blobs = new Map<string, MemoryBlob>();
  private readonly key = randomBytes(32);

  constructor(private readonly now: () => number = Date.now) {}

  async read(path: string): Promise<{ data: Buffer; properties: BlobProperties } | null> {
    const blob = this.blobs.get(path);
    return blob ? { data: Buffer.from(blob.data), properties: { ...blob.properties, metadata: { ...blob.properties.metadata } } } : null;
  }

  async head(path: string): Promise<BlobProperties | null> {
    const blob = this.blobs.get(path);
    return blob ? { ...blob.properties, metadata: { ...blob.properties.metadata } } : null;
  }

  async write(path: string, data: Uint8Array | string, options: BlobWriteOptions = {}): Promise<{ etag: string }> {
    const existing = this.blobs.get(path);
    if (options.ifNoneMatch === "*" && existing) throw new PreconditionFailedError("blob exists");
    if (options.ifMatch !== undefined && options.ifMatch !== "*") {
      if (!existing || existing.properties.etag !== options.ifMatch) throw new PreconditionFailedError("etag mismatch");
    }
    if (options.ifMatch === "*" && !existing) throw new PreconditionFailedError("blob missing");
    const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
    const etag = nextEtag();
    this.blobs.set(path, {
      data: bytes,
      properties: {
        size: bytes.length,
        etag,
        contentType: options.contentType ?? "application/octet-stream",
        metadata: { ...(options.metadata ?? {}) },
        lastModified: new Date(this.now()),
      },
    });
    return { etag };
  }

  async writeFile(path: string, filePath: string, options: BlobWriteOptions = {}): Promise<{ etag: string; size: number }> {
    const data = await readFile(filePath);
    const { etag } = await this.write(path, data, options);
    return { etag, size: data.length };
  }

  async readToFile(path: string, filePath: string): Promise<BlobProperties> {
    const blob = this.blobs.get(path);
    if (!blob) throw new NotFoundError(`blob not found: ${path}`);
    await writeFile(filePath, blob.data);
    return { ...blob.properties };
  }

  async setMetadata(path: string, metadata: Record<string, string>, options: { ifMatch?: string } = {}): Promise<{ etag: string }> {
    const blob = this.blobs.get(path);
    if (!blob) throw new NotFoundError(`blob not found: ${path}`);
    if (options.ifMatch !== undefined && blob.properties.etag !== options.ifMatch) {
      throw new PreconditionFailedError("etag mismatch");
    }
    blob.properties.metadata = { ...metadata };
    blob.properties.etag = nextEtag();
    return { etag: blob.properties.etag };
  }

  async delete(path: string, options: { ifMatch?: string } = {}): Promise<boolean> {
    const blob = this.blobs.get(path);
    if (!blob) return false;
    if (options.ifMatch !== undefined && blob.properties.etag !== options.ifMatch) {
      throw new PreconditionFailedError("etag mismatch");
    }
    this.blobs.delete(path);
    return true;
  }

  async *list(prefix: string): AsyncIterable<BlobItem> {
    const paths = [...this.blobs.keys()].filter((p) => p.startsWith(prefix)).sort();
    for (const path of paths) {
      const blob = this.blobs.get(path);
      if (blob) yield { path, ...blob.properties, metadata: { ...blob.properties.metadata } };
    }
  }

  async signUrl(path: string, options: SignOptions): Promise<string> {
    const expires = this.now() + options.expiresInSeconds * 1000;
    const sp = options.permission === "read" ? "r" : "cw";
    const sig = this.sign(path, sp, expires);
    const params = new URLSearchParams({ sp, se: String(expires), sig });
    if (options.contentType) params.set("rsct", options.contentType);
    if (options.contentDisposition) params.set("rscd", options.contentDisposition);
    return `memory://blob/${path}?${params.toString()}`;
  }

  /** Simulate a client PUT to a signed write URL. Throws when the URL is not valid for writing. */
  async acceptSignedWrite(url: string, data: Uint8Array | string, contentType?: string): Promise<void> {
    const { path, params } = this.parseSigned(url);
    if (params.get("sp") !== "cw") throw new Error("signed URL does not allow writes");
    await this.write(path, data, contentType ? { contentType } : {});
  }

  /** Simulate a client GET of a signed read URL. */
  async acceptSignedRead(url: string): Promise<Buffer> {
    const { path, params } = this.parseSigned(url);
    if (params.get("sp") !== "r") throw new Error("signed URL does not allow reads");
    const blob = this.blobs.get(path);
    if (!blob) throw new NotFoundError(path);
    return Buffer.from(blob.data);
  }

  /** Test helper: every stored path. */
  paths(): string[] {
    return [...this.blobs.keys()].sort();
  }

  private parseSigned(url: string): { path: string; params: URLSearchParams } {
    const parsed = new URL(url);
    if (parsed.protocol !== "memory:") throw new Error("not a memory URL");
    const path = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    const params = parsed.searchParams;
    const sp = params.get("sp") ?? "";
    const expires = Number(params.get("se"));
    if (!Number.isFinite(expires) || expires < this.now()) throw new Error("signed URL expired");
    if (params.get("sig") !== this.sign(path, sp, expires)) throw new Error("bad signature");
    return { path, params };
  }

  private sign(path: string, sp: string, expires: number): string {
    return createHmac("sha256", this.key).update(`${path}\n${sp}\n${expires}`).digest("base64url");
  }
}

function matchesClause(entity: TableEntity, [field, op, value]: FilterClause): boolean {
  const actual = entity[field];
  if (actual === undefined || actual === null) return op === "ne";
  switch (op) {
    case "eq":
      return actual === value;
    case "ne":
      return actual !== value;
    case "lt":
      return actual < value;
    case "le":
      return actual <= value;
    case "gt":
      return actual > value;
    case "ge":
      return actual >= value;
  }
}

export class MemoryTableStore implements TableStore {
  readonly kind = "memory" as const;
  private readonly tables = new Map<TableName, Map<string, Stored<TableEntity>>>();

  private table(name: TableName): Map<string, Stored<TableEntity>> {
    let table = this.tables.get(name);
    if (!table) {
      table = new Map();
      this.tables.set(name, table);
    }
    return table;
  }

  private static key(pk: string, rk: string): string {
    return `${pk}\u0000${rk}`;
  }

  async get<T extends TableEntity>(table: TableName, partitionKey: string, rowKey: string): Promise<Stored<T> | null> {
    const entity = this.table(table).get(MemoryTableStore.key(partitionKey, rowKey));
    return entity ? ({ ...entity } as Stored<T>) : null;
  }

  async create<T extends TableEntity>(table: TableName, entity: T): Promise<{ etag: string }> {
    const key = MemoryTableStore.key(entity.partitionKey, entity.rowKey);
    const rows = this.table(table);
    if (rows.has(key)) throw new AlreadyExistsError(`${table}: ${entity.partitionKey}/${entity.rowKey}`);
    const etag = nextEtag();
    rows.set(key, { ...stripUndefined(entity), etag });
    return { etag };
  }

  async upsert<T extends TableEntity>(table: TableName, entity: T, mode: "merge" | "replace" = "merge"): Promise<{ etag: string }> {
    const key = MemoryTableStore.key(entity.partitionKey, entity.rowKey);
    const rows = this.table(table);
    const existing = rows.get(key);
    const etag = nextEtag();
    const base = mode === "merge" && existing ? existing : {};
    rows.set(key, { ...base, ...stripUndefined(entity), etag } as Stored<TableEntity>);
    return { etag };
  }

  async update<T extends TableEntity>(
    table: TableName,
    entity: T,
    options: { etag?: string; mode?: "merge" | "replace" } = {},
  ): Promise<{ etag: string }> {
    const key = MemoryTableStore.key(entity.partitionKey, entity.rowKey);
    const rows = this.table(table);
    const existing = rows.get(key);
    if (!existing) throw new NotFoundError(`${table}: ${entity.partitionKey}/${entity.rowKey}`);
    if (options.etag !== undefined && options.etag !== existing.etag) throw new PreconditionFailedError("etag mismatch");
    const etag = nextEtag();
    const base = (options.mode ?? "merge") === "merge" ? existing : {};
    rows.set(key, { ...base, ...stripUndefined(entity), etag } as Stored<TableEntity>);
    return { etag };
  }

  async delete(table: TableName, partitionKey: string, rowKey: string, options: { etag?: string } = {}): Promise<boolean> {
    const key = MemoryTableStore.key(partitionKey, rowKey);
    const rows = this.table(table);
    const existing = rows.get(key);
    if (!existing) return false;
    if (options.etag !== undefined && options.etag !== existing.etag) throw new PreconditionFailedError("etag mismatch");
    rows.delete(key);
    return true;
  }

  async *query<T extends TableEntity>(table: TableName, query: TableQuery): AsyncIterable<Stored<T>> {
    const rows = [...this.table(table).values()]
      .filter((e) => query.partitionKey === undefined || e.partitionKey === query.partitionKey)
      .filter((e) => (query.where ?? []).every((clause) => matchesClause(e, clause)))
      .sort((a, b) =>
        a.partitionKey === b.partitionKey ? (a.rowKey < b.rowKey ? -1 : a.rowKey > b.rowKey ? 1 : 0) : a.partitionKey < b.partitionKey ? -1 : 1,
      );
    for (const row of rows) yield { ...row } as Stored<T>;
  }
}

function stripUndefined<T extends TableEntity>(entity: T): TableEntity {
  const out: TableEntity = { partitionKey: entity.partitionKey, rowKey: entity.rowKey };
  for (const [k, v] of Object.entries(entity)) {
    if (v !== undefined && k !== "etag") out[k] = v;
  }
  return out;
}
