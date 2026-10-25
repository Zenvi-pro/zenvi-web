/**
 * Azure Storage implementations of BlobStore and TableStore.
 *
 * One storage account (`zenvicloud`): a private blob container and five
 * tables. Signed URLs are service SAS tokens for exactly one blob, HTTPS only,
 * signed with the account key from the connection string.
 */

import { createHash } from "node:crypto";
import { TableClient, type TableEntityResult } from "@azure/data-tables";
import { BlobSASPermissions, BlobServiceClient, type ContainerClient, SASProtocol } from "@azure/storage-blob";
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
  TableValue,
} from "./types.js";

function unquote(etag: string | undefined): string {
  return (etag ?? "").replace(/^W\//, "").replace(/^"(.*)"$/, "$1");
}

function quote(etag: string): string {
  return etag === "*" ? "*" : `"${unquote(etag)}"`;
}

interface RestErrorLike {
  statusCode?: number;
  code?: string;
}

function statusOf(error: unknown): number | undefined {
  return typeof error === "object" && error !== null ? (error as RestErrorLike).statusCode : undefined;
}

function codeOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null ? (error as RestErrorLike).code : undefined;
}

/** Map Azure REST failures on conditional operations to the storage error types. */
function translate(error: unknown, context: string): never {
  const status = statusOf(error);
  const code = codeOf(error);
  if (status === 412 || code === "ConditionNotMet" || code === "UpdateConditionNotSatisfied") {
    throw new PreconditionFailedError(`${context}: precondition failed`);
  }
  if (status === 409 && (code === "BlobAlreadyExists" || code === "EntityAlreadyExists")) {
    throw code === "BlobAlreadyExists" ? new PreconditionFailedError(`${context}: exists`) : new AlreadyExistsError(context);
  }
  if (status === 404) throw new NotFoundError(context);
  throw error;
}

function conditions(options: { ifMatch?: string; ifNoneMatch?: "*" }): { ifMatch?: string; ifNoneMatch?: string } {
  const out: { ifMatch?: string; ifNoneMatch?: string } = {};
  if (options.ifMatch !== undefined) out.ifMatch = quote(options.ifMatch);
  if (options.ifNoneMatch !== undefined) out.ifNoneMatch = "*";
  return out;
}

export class AzureBlobStore implements BlobStore {
  readonly kind = "azure" as const;
  readonly origin: string;
  private readonly container: ContainerClient;

  constructor(connectionString: string, containerName: string) {
    this.container = BlobServiceClient.fromConnectionString(connectionString).getContainerClient(containerName);
    this.origin = new URL(this.container.url).origin;
  }

  async read(path: string): Promise<{ data: Buffer; properties: BlobProperties } | null> {
    const blob = this.container.getBlobClient(path);
    try {
      const response = await blob.download(0);
      const chunks: Buffer[] = [];
      const body = response.readableStreamBody;
      if (body) {
        for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      }
      const data = Buffer.concat(chunks);
      return {
        data,
        properties: {
          size: data.length,
          etag: unquote(response.etag),
          contentType: response.contentType,
          metadata: response.metadata ?? {},
          lastModified: response.lastModified ?? new Date(0),
        },
      };
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw error;
    }
  }

  async head(path: string): Promise<BlobProperties | null> {
    try {
      const props = await this.container.getBlobClient(path).getProperties();
      return {
        size: props.contentLength ?? 0,
        etag: unquote(props.etag),
        contentType: props.contentType,
        metadata: props.metadata ?? {},
        lastModified: props.lastModified ?? new Date(0),
      };
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw error;
    }
  }

  async write(path: string, data: Uint8Array | string, options: BlobWriteOptions = {}): Promise<{ etag: string }> {
    const body = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    try {
      const response = await this.container.getBlockBlobClient(path).upload(body, body.length, {
        blobHTTPHeaders: {
          blobContentType: options.contentType ?? "application/octet-stream",
          blobContentDisposition: options.contentDisposition,
        },
        metadata: options.metadata,
        conditions: conditions(options),
      });
      return { etag: unquote(response.etag) };
    } catch (error) {
      translate(error, path);
    }
  }

  async writeFile(path: string, filePath: string, options: BlobWriteOptions = {}): Promise<{ etag: string; size: number }> {
    try {
      const client = this.container.getBlockBlobClient(path);
      const response = await client.uploadFile(filePath, {
        blobHTTPHeaders: {
          blobContentType: options.contentType ?? "application/octet-stream",
          blobContentDisposition: options.contentDisposition,
        },
        metadata: options.metadata,
        conditions: conditions(options),
        blockSize: 8 * 1024 * 1024,
        concurrency: 4,
      });
      const props = await client.getProperties();
      return { etag: unquote(response.etag), size: props.contentLength ?? 0 };
    } catch (error) {
      translate(error, path);
    }
  }

  async readToFile(path: string, filePath: string): Promise<BlobProperties> {
    try {
      const response = await this.container.getBlobClient(path).downloadToFile(filePath);
      return {
        size: response.contentLength ?? 0,
        etag: unquote(response.etag),
        contentType: response.contentType,
        metadata: response.metadata ?? {},
        lastModified: response.lastModified ?? new Date(0),
      };
    } catch (error) {
      translate(error, path);
    }
  }

  async sha256(path: string): Promise<{ sha256: string; size: number; etag: string } | null> {
    try {
      // Streamed (bounded memory); the SDK resumes a broken stream from its offset.
      const response = await this.container.getBlobClient(path).download(0, undefined, { maxRetryRequests: 10 });
      const hash = createHash("sha256");
      let size = 0;
      const body = response.readableStreamBody;
      if (body) {
        for await (const chunk of body) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
          size += bytes.length;
          hash.update(bytes);
        }
      }
      return { sha256: hash.digest("hex"), size, etag: unquote(response.etag) };
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw error;
    }
  }

  async setMetadata(path: string, metadata: Record<string, string>, options: { ifMatch?: string } = {}): Promise<{ etag: string }> {
    try {
      const response = await this.container.getBlobClient(path).setMetadata(metadata, { conditions: conditions(options) });
      return { etag: unquote(response.etag) };
    } catch (error) {
      translate(error, path);
    }
  }

  async delete(path: string, options: { ifMatch?: string } = {}): Promise<boolean> {
    try {
      const response = await this.container.getBlobClient(path).deleteIfExists({ conditions: conditions(options) });
      return response.succeeded;
    } catch (error) {
      translate(error, path);
    }
  }

  async *list(prefix: string): AsyncIterable<BlobItem> {
    for await (const item of this.container.listBlobsFlat({ prefix, includeMetadata: true })) {
      yield {
        path: item.name,
        size: item.properties.contentLength ?? 0,
        etag: unquote(item.properties.etag),
        contentType: item.properties.contentType,
        metadata: item.metadata ?? {},
        lastModified: item.properties.lastModified,
      };
    }
  }

  async signUrl(path: string, options: SignOptions): Promise<string> {
    const blob = this.container.getBlobClient(path);
    return blob.generateSasUrl({
      permissions: BlobSASPermissions.parse(options.permission === "read" ? "r" : "cw"),
      expiresOn: new Date(Date.now() + options.expiresInSeconds * 1000),
      protocol: SASProtocol.Https,
      contentType: options.contentType,
      contentDisposition: options.contentDisposition,
    });
  }
}

function literal(value: string | number | boolean): string {
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (!Number.isFinite(value)) throw new TypeError("non-finite number in table filter");
  return String(value);
}

const FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** OData filter for a TableQuery. Field names are code constants; values are escaped. */
export function odataFilter(query: TableQuery): string | undefined {
  const clauses: FilterClause[] = [];
  if (query.partitionKey !== undefined) clauses.push(["PartitionKey", "eq", query.partitionKey]);
  clauses.push(...(query.where ?? []));
  if (clauses.length === 0) return undefined;
  return clauses
    .map(([field, op, value]) => {
      if (!FIELD.test(field)) throw new TypeError(`invalid table field: ${field}`);
      return `${field} ${op} ${literal(value)}`;
    })
    .join(" and ");
}

type AzureRow = TableEntityResult<Record<string, unknown>>;

function fromAzure<T extends TableEntity>(row: AzureRow): Stored<T> {
  const out: Record<string, TableValue | undefined> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "timestamp" || key === "odata.metadata" || key === "etag") continue;
    if (value instanceof Date) out[key] = value.toISOString();
    else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) out[key] = value;
  }
  return { ...(out as T), partitionKey: row.partitionKey ?? "", rowKey: row.rowKey ?? "", etag: row.etag };
}

function toAzure<T extends TableEntity>(entity: T): Record<string, unknown> & { partitionKey: string; rowKey: string } {
  const out: Record<string, unknown> & { partitionKey: string; rowKey: string } = {
    partitionKey: entity.partitionKey,
    rowKey: entity.rowKey,
  };
  for (const [key, value] of Object.entries(entity)) {
    if (value === undefined || key === "etag") continue;
    out[key] = value;
  }
  return out;
}

export class AzureTableStore implements TableStore {
  readonly kind = "azure" as const;
  private readonly clients = new Map<TableName, TableClient>();

  constructor(private readonly connectionString: string) {}

  /** Create every table this service uses. Existing tables are left as they are. */
  async ensure(): Promise<void> {
    const names: TableName[] = ["tokens", "oauthclients", "oauthcodes", "devicecodes", "renders", "backendsessions", "generations"];
    for (const name of names) {
      try {
        await this.client(name).createTable();
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status !== 409) throw error;
      }
    }
  }

  private client(table: TableName): TableClient {
    let client = this.clients.get(table);
    if (!client) {
      client = TableClient.fromConnectionString(this.connectionString, table);
      this.clients.set(table, client);
    }
    return client;
  }

  async get<T extends TableEntity>(table: TableName, partitionKey: string, rowKey: string): Promise<Stored<T> | null> {
    try {
      const row = await this.client(table).getEntity<Record<string, unknown>>(partitionKey, rowKey);
      return fromAzure<T>(row as AzureRow);
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw error;
    }
  }

  async create<T extends TableEntity>(table: TableName, entity: T): Promise<{ etag: string }> {
    try {
      const response = await this.client(table).createEntity(toAzure(entity));
      return { etag: response.etag ?? "" };
    } catch (error) {
      translate(error, `${table}/${entity.partitionKey}/${entity.rowKey}`);
    }
  }

  async upsert<T extends TableEntity>(table: TableName, entity: T, mode: "merge" | "replace" = "merge"): Promise<{ etag: string }> {
    const response = await this.client(table).upsertEntity(toAzure(entity), mode === "merge" ? "Merge" : "Replace");
    return { etag: response.etag ?? "" };
  }

  async update<T extends TableEntity>(
    table: TableName,
    entity: T,
    options: { etag?: string; mode?: "merge" | "replace" } = {},
  ): Promise<{ etag: string }> {
    try {
      const response = await this.client(table).updateEntity(toAzure(entity), (options.mode ?? "merge") === "merge" ? "Merge" : "Replace", {
        etag: options.etag ?? "*",
      });
      return { etag: response.etag ?? "" };
    } catch (error) {
      translate(error, `${table}/${entity.partitionKey}/${entity.rowKey}`);
    }
  }

  async delete(table: TableName, partitionKey: string, rowKey: string, options: { etag?: string } = {}): Promise<boolean> {
    try {
      await this.client(table).deleteEntity(partitionKey, rowKey, { etag: options.etag ?? "*" });
      return true;
    } catch (error) {
      if (statusOf(error) === 404) return false;
      translate(error, `${table}/${partitionKey}/${rowKey}`);
    }
  }

  async *query<T extends TableEntity>(table: TableName, query: TableQuery): AsyncIterable<Stored<T>> {
    const filter = odataFilter(query);
    const iterator = this.client(table).listEntities<Record<string, unknown>>(filter ? { queryOptions: { filter } } : {});
    for await (const row of iterator) yield fromAzure<T>(row as AzureRow);
  }
}
