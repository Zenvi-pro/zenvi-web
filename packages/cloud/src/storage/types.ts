/**
 * Storage the service needs, as two small interfaces: a blob store (projects,
 * media, renders) and a table store (tokens, OAuth clients/codes, device codes,
 * render jobs). `azure.ts` implements them on Azure Storage, `memory.ts` in
 * process for tests and local development.
 *
 * Conditional writes carry ETags. A failed precondition throws
 * `PreconditionFailedError`; creating something that exists throws
 * `AlreadyExistsError` (see http/errors.ts).
 */

export interface BlobProperties {
  size: number;
  /** Opaque version tag, without surrounding quotes. */
  etag: string;
  contentType?: string;
  metadata: Record<string, string>;
  lastModified: Date;
}

export interface BlobItem extends BlobProperties {
  path: string;
}

export interface BlobWriteOptions {
  contentType?: string;
  contentDisposition?: string;
  /** Blob metadata. Values must be ASCII (encode anything else). */
  metadata?: Record<string, string>;
  /** Write only if the current ETag matches. */
  ifMatch?: string;
  /** Write only if the blob does not exist yet. */
  ifNoneMatch?: "*";
}

export interface SignOptions {
  permission: "read" | "write";
  expiresInSeconds: number;
  /** Response Content-Type for reads. */
  contentType?: string;
  /** Response Content-Disposition for reads (e.g. `attachment; filename="x.mp4"`). */
  contentDisposition?: string;
}

export interface BlobStore {
  /** Human-readable backend name for /health. */
  readonly kind: "azure" | "memory";
  /** Origin signed URLs point at (for Content-Security-Policy lists). */
  readonly origin: string;
  read(path: string): Promise<{ data: Buffer; properties: BlobProperties } | null>;
  head(path: string): Promise<BlobProperties | null>;
  write(path: string, data: Uint8Array | string, options?: BlobWriteOptions): Promise<{ etag: string }>;
  /** Upload a local file (streamed). */
  writeFile(path: string, filePath: string, options?: BlobWriteOptions): Promise<{ etag: string; size: number }>;
  /** Download a blob to a local file (streamed). Throws NotFoundError when missing. */
  readToFile(path: string, filePath: string): Promise<BlobProperties>;
  /** SHA-256 (hex) of a blob's bytes, streamed; null when missing. */
  sha256(path: string): Promise<{ sha256: string; size: number; etag: string } | null>;
  setMetadata(path: string, metadata: Record<string, string>, options?: { ifMatch?: string }): Promise<{ etag: string }>;
  /** Returns false when the blob did not exist. */
  delete(path: string, options?: { ifMatch?: string }): Promise<boolean>;
  list(prefix: string): AsyncIterable<BlobItem>;
  /** A short-lived signed URL for exactly one blob. */
  signUrl(path: string, options: SignOptions): Promise<string>;
}

/** Scalar values a table entity can hold. Arrays/objects are stored as JSON strings. */
export type TableValue = string | number | boolean | null;

export interface TableEntity {
  partitionKey: string;
  rowKey: string;
  [field: string]: TableValue | undefined;
}

export type Stored<T extends TableEntity> = T & { etag: string };

export type FilterOp = "eq" | "ne" | "lt" | "le" | "gt" | "ge";
export type FilterClause = [field: string, op: FilterOp, value: string | number | boolean];

export interface TableQuery {
  partitionKey?: string;
  /** Clauses joined with `and`. */
  where?: FilterClause[];
}

export type TableName = "tokens" | "oauthclients" | "oauthcodes" | "devicecodes" | "renders";

export interface TableStore {
  readonly kind: "azure" | "memory";
  get<T extends TableEntity>(table: TableName, partitionKey: string, rowKey: string): Promise<Stored<T> | null>;
  /** Insert; throws AlreadyExistsError when the key exists. */
  create<T extends TableEntity>(table: TableName, entity: T): Promise<{ etag: string }>;
  /** Insert or merge/replace unconditionally. */
  upsert<T extends TableEntity>(table: TableName, entity: T, mode?: "merge" | "replace"): Promise<{ etag: string }>;
  /**
   * Update an existing entity. With `etag`, only if unchanged (else
   * PreconditionFailedError). Throws NotFoundError when missing.
   */
  update<T extends TableEntity>(
    table: TableName,
    entity: T,
    options?: { etag?: string; mode?: "merge" | "replace" },
  ): Promise<{ etag: string }>;
  /** Returns false when it did not exist. */
  delete(table: TableName, partitionKey: string, rowKey: string, options?: { etag?: string }): Promise<boolean>;
  query<T extends TableEntity>(table: TableName, query: TableQuery): AsyncIterable<Stored<T>>;
}

export async function collect<T>(items: AsyncIterable<T>, limit = Number.POSITIVE_INFINITY): Promise<T[]> {
  const out: T[] = [];
  for await (const item of items) {
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/** Blob metadata must be ASCII: encode arbitrary strings for it. */
export function encodeMeta(value: string): string {
  return encodeURIComponent(value);
}

export function decodeMeta(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
