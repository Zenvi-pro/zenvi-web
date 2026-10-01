/**
 * Content-addressed media per user (`u/{userId}/media/{sha256}`).
 *
 * Upload flow: `declare` (quota + type checks, pending record, SAS write URL
 * for exactly that blob, 1 h) → client PUTs the bytes straight to Azure →
 * `complete` (size check, hash check for small files, metadata). Only
 * completed blobs count as existing, so an interrupted upload is simply
 * retried. Reads go through 1 h SAS URLs with a forced content type and
 * `attachment` disposition, so a blob can never be served as a web page.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { ApiError, badRequest, notFound, PreconditionFailedError, tooLarge } from "../http/errors.js";
import type { BlobStore } from "../storage/types.js";
import { decodeMeta, encodeMeta } from "../storage/types.js";
import type { Clock } from "../util/clock.js";
import { isoAt } from "../util/clock.js";
import type { Limits } from "../config.js";
import { isSha256 } from "../projects/model.js";
import { mediaPath, mediaPrefix, uploadPath, userPrefix, VERIFY_PREFIX, verifyJobPath } from "./paths.js";

const UPLOAD_URL_SECONDS = 3600;
const READ_URL_SECONDS = 3600;
const USAGE_CACHE_MS = 60_000;

const EXTRA_TYPES = new Set([
  "application/ogg",
  "application/mp4",
  "application/mxf",
  "application/x-subrip",
  "text/vtt",
  "application/octet-stream",
]);

/** Media and asset types we store. Anything else (HTML, scripts, archives…) is refused. */
export function normalizeContentType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const type = value.split(";")[0]?.trim().toLowerCase() ?? "";
  if (/^(video|audio|image)\/[a-z0-9.+-]{1,100}$/.test(type)) return type;
  return EXTRA_TYPES.has(type) ? type : null;
}

/** Content-Disposition for downloads: always an attachment, ASCII-safe name. */
export function attachmentDisposition(name: string): string {
  const safe = name.replace(/[^\w.\- ]+/g, "_").slice(0, 150) || "download";
  return `attachment; filename="${safe}"`;
}

export function cleanFileName(name: unknown): string {
  if (typeof name !== "string") return "media";
  // eslint-disable-next-line no-control-regex
  const base = name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim() ?? "";
  return base === "" ? "media" : base.slice(0, 255);
}

export interface MediaInfo {
  sha256: string;
  size: number;
  name: string;
  contentType: string;
  verified: boolean;
  uploadedAt?: string;
}

export interface CompleteResult extends MediaInfo {
  /** "verifying": a large upload whose SHA-256 is being checked; poll /v1/media/check until it exists. */
  status: "complete" | "verifying";
}

interface VerifyJob {
  userId: string;
  sha256: string;
  /** Blob version `complete` handed to the verifier. */
  etag: string;
  createdAt: string;
}

export interface UploadTicket {
  sha256: string;
  blobPath: string;
  exists: boolean;
  /** The bytes are uploaded and their hash is being checked; nothing to upload. */
  verifying?: boolean;
  uploadUrl?: string;
  uploadExpiresAt?: string;
  /** Headers the PUT must carry (single-shot Put Blob). */
  uploadHeaders?: Record<string, string>;
}

interface PendingUpload {
  sha256: string;
  size: number;
  name: string;
  contentType: string;
  createdAt: string;
}

function infoFrom(sha256: string, item: { size: number; metadata: Record<string, string>; contentType?: string }): MediaInfo {
  return {
    sha256,
    size: item.size,
    name: decodeMeta(item.metadata.name) ?? sha256,
    contentType: normalizeContentType(item.metadata.contenttype) ?? normalizeContentType(item.contentType) ?? "application/octet-stream",
    verified: item.metadata.verified === "1",
    uploadedAt: item.metadata.uploadedat,
  };
}

export class MediaService {
  private readonly usageCache = new Map<string, { bytes: number; until: number }>();
  /** Called when a large upload needs background verification (set by the container). */
  onVerify?: (userId: string, sha256: string) => void;

  constructor(
    private readonly blobs: BlobStore,
    private readonly clock: Clock,
    private readonly limits: Limits,
  ) {}

  /** Completed media of a user, by hash. One listing call per 5000 blobs. */
  async inventory(userId: string): Promise<Map<string, MediaInfo>> {
    const prefix = mediaPrefix(userId);
    const out = new Map<string, MediaInfo>();
    for await (const item of this.blobs.list(prefix)) {
      const sha256 = item.path.slice(prefix.length);
      if (isSha256(sha256) && item.metadata.complete === "1") out.set(sha256, infoFrom(sha256, item));
    }
    return out;
  }

  async check(userId: string, hashes: string[]): Promise<{ existing: string[]; missing: string[] }> {
    const unique = [...new Set(hashes.map((h) => h.toLowerCase()))];
    if (unique.some((h) => !isSha256(h))) throw badRequest("sha256 values must be 64 lowercase hex characters.");
    const inventory = await this.inventory(userId);
    return { existing: unique.filter((h) => inventory.has(h)), missing: unique.filter((h) => !inventory.has(h)) };
  }

  async get(userId: string, sha256: string): Promise<MediaInfo | null> {
    const head = await this.blobs.head(mediaPath(userId, sha256));
    if (!head || head.metadata.complete !== "1") return null;
    return infoFrom(sha256, head);
  }

  /** Bytes stored under the user's prefix (media, projects, renders), cached briefly. */
  async usage(userId: string): Promise<number> {
    const now = this.clock.now();
    const cached = this.usageCache.get(userId);
    if (cached && cached.until > now) return cached.bytes;
    let bytes = 0;
    for await (const item of this.blobs.list(userPrefix(userId))) bytes += item.size;
    this.usageCache.set(userId, { bytes, until: now + USAGE_CACHE_MS });
    return bytes;
  }

  invalidateUsage(userId: string): void {
    this.usageCache.delete(userId);
  }

  /** Check that `size` more bytes fit the user's quota (and the per-file cap). */
  async assertFits(userId: string, size: number, replacing = 0): Promise<void> {
    if (size > this.limits.maxFileBytes) {
      throw tooLarge(`Files can be at most ${formatBytes(this.limits.maxFileBytes)}.`, "file_too_large");
    }
    const used = await this.usage(userId);
    if (used - replacing + size > this.limits.maxUserBytes) {
      throw new ApiError(413, "quota_exceeded", `This upload would exceed your ${formatBytes(this.limits.maxUserBytes)} Zenvi Cloud storage.`, {
        usedBytes: used,
        quotaBytes: this.limits.maxUserBytes,
      });
    }
  }

  async declare(userId: string, input: { sha256: string; size: number; name: unknown; contentType: unknown }): Promise<UploadTicket> {
    const sha256 = input.sha256.toLowerCase();
    if (!isSha256(sha256)) throw badRequest("sha256 must be 64 lowercase hex characters.");
    if (!Number.isSafeInteger(input.size) || input.size < 0) throw badRequest("size must be a non-negative integer.");
    const contentType = normalizeContentType(input.contentType);
    if (!contentType) {
      throw new ApiError(415, "unsupported_media_type", "Only video, audio, image and subtitle files can be stored in Zenvi Cloud.");
    }
    const path = mediaPath(userId, sha256);
    const head = await this.blobs.head(path);
    if (head && head.metadata.complete === "1") return { sha256, blobPath: path, exists: true };
    if (head && head.metadata.verification === "pending") return { sha256, blobPath: path, exists: false, verifying: true };
    await this.assertFits(userId, input.size, head?.size ?? 0);

    const pending: PendingUpload = {
      sha256,
      size: input.size,
      name: cleanFileName(input.name),
      contentType,
      createdAt: isoAt(this.clock.now()),
    };
    await this.blobs.write(uploadPath(userId, sha256), JSON.stringify(pending), { contentType: "application/json" });
    const uploadUrl = await this.blobs.signUrl(path, { permission: "write", expiresInSeconds: UPLOAD_URL_SECONDS });
    return {
      sha256,
      blobPath: path,
      exists: false,
      uploadUrl,
      uploadExpiresAt: isoAt(this.clock.now() + UPLOAD_URL_SECONDS * 1000),
      uploadHeaders: { "x-ms-blob-type": "BlockBlob", "Content-Type": contentType },
    };
  }

  /**
   * Finish an upload: the blob must exist with the declared size, and its
   * bytes must hash to the claimed SHA-256 — the hash is the content address,
   * so an unchecked blob could poison every project that names it.
   *
   * Up to `verifyHashMaxBytes` the blob is hashed here. Larger blobs are
   * hashed in the background (`verifyLarge`, streamed, bounded memory): until
   * then the blob is "verifying" — not complete, so it is never listed as
   * existing, deduplicated, signed for reading or resolved by renders — and a
   * mismatch deletes it.
   */
  async complete(userId: string, sha256Input: string): Promise<CompleteResult> {
    const sha256 = sha256Input.toLowerCase();
    const path = mediaPath(userId, sha256);
    const head = await this.blobs.head(path);
    if (!head) throw notFound("Uploaded media");
    if (head.metadata.complete === "1") return { ...infoFrom(sha256, head), status: "complete" };

    const pending = await this.pendingUpload(userId, sha256);
    if (pending && pending.size !== head.size) {
      await this.blobs.delete(path);
      throw new ApiError(422, "size_mismatch", `Uploaded ${head.size} bytes but declared ${pending.size}. Upload the file again.`);
    }
    await this.assertFits(userId, 0);
    const contentType = pending?.contentType ?? normalizeContentType(head.metadata.contenttype ?? head.contentType) ?? "application/octet-stream";
    const name = pending?.name ?? decodeMeta(head.metadata.name) ?? sha256;
    const uploadedAt = isoAt(this.clock.now());
    const changed = (): ApiError => new ApiError(409, "upload_changed", "The file was overwritten while it was being checked. Call complete again.");

    if (head.size <= this.limits.verifyHashMaxBytes) {
      const hashed = await this.blobs.sha256(path);
      if (!hashed) throw notFound("Uploaded media");
      if (hashed.sha256 !== sha256) {
        await this.blobs.delete(path);
        throw new ApiError(422, "hash_mismatch", "The uploaded bytes do not match the declared sha256. Upload the file again.");
      }
      if (!(await this.finalize(userId, sha256, hashed.etag, { name, contentType, uploadedAt }))) throw changed();
      return { sha256, size: head.size, name, contentType, verified: true, uploadedAt, status: "complete" };
    }

    let etag: string;
    try {
      ({ etag } = await this.blobs.setMetadata(
        path,
        { name: encodeMeta(name), contenttype: contentType, complete: "0", verification: "pending", uploadedat: uploadedAt },
        { ifMatch: head.etag },
      ));
    } catch (error) {
      if (error instanceof PreconditionFailedError) throw changed();
      throw error;
    }
    const job: VerifyJob = { userId, sha256, etag, createdAt: uploadedAt };
    await this.blobs.write(verifyJobPath(userId, sha256), JSON.stringify(job), { contentType: "application/json" });
    this.onVerify?.(userId, sha256);
    return { sha256, size: head.size, name, contentType, verified: false, uploadedAt, status: "verifying" };
  }

  /**
   * The background half of `complete` for large uploads: stream the blob
   * through SHA-256, then mark it complete or delete it.
   */
  async verifyLarge(userId: string, sha256: string): Promise<"verified" | "mismatch" | "changed" | "gone"> {
    const jobPath = verifyJobPath(userId, sha256);
    const jobBlob = await this.blobs.read(jobPath);
    if (!jobBlob) return "gone";
    const job = JSON.parse(jobBlob.data.toString("utf8")) as VerifyJob;
    const path = mediaPath(userId, sha256);
    const done = async (outcome: "verified" | "mismatch" | "changed" | "gone") => {
      await this.blobs.delete(jobPath);
      return outcome;
    };
    const hashed = await this.blobs.sha256(path);
    if (!hashed) return done("gone");
    // Overwritten since complete: the client has to call complete again.
    if (hashed.etag !== job.etag) return done("changed");
    if (hashed.sha256 !== sha256) {
      await this.blobs.delete(path, { ifMatch: hashed.etag }).catch(() => false);
      await this.blobs.delete(uploadPath(userId, sha256));
      this.invalidateUsage(userId);
      return done("mismatch");
    }
    const head = await this.blobs.head(path);
    if (!head) return done("gone");
    const ok = await this.finalize(userId, sha256, hashed.etag, {
      name: decodeMeta(head.metadata.name) ?? sha256,
      contentType: normalizeContentType(head.metadata.contenttype) ?? "application/octet-stream",
      uploadedAt: head.metadata.uploadedat ?? isoAt(this.clock.now()),
    });
    return done(ok ? "verified" : "changed");
  }

  /** Users and hashes with a verification still to run (restart recovery). */
  async *pendingVerifications(): AsyncIterable<{ userId: string; sha256: string }> {
    for await (const item of this.blobs.list(VERIFY_PREFIX)) {
      const match = /^verify\/([A-Za-z0-9-]{1,64})\/([0-9a-f]{64})\.json$/.exec(item.path);
      if (match) yield { userId: match[1]!, sha256: match[2]! };
    }
  }

  /** Mark a hash-checked blob complete (only if it is still the version that was hashed). */
  private async finalize(userId: string, sha256: string, etag: string, info: { name: string; contentType: string; uploadedAt: string }): Promise<boolean> {
    try {
      await this.blobs.setMetadata(
        mediaPath(userId, sha256),
        { name: encodeMeta(info.name), contenttype: info.contentType, complete: "1", verified: "1", uploadedat: info.uploadedAt },
        { ifMatch: etag },
      );
    } catch (error) {
      if (error instanceof PreconditionFailedError) return false;
      throw error;
    }
    await this.blobs.delete(uploadPath(userId, sha256));
    this.invalidateUsage(userId);
    return true;
  }

  private async pendingUpload(userId: string, sha256: string): Promise<PendingUpload | null> {
    const blob = await this.blobs.read(uploadPath(userId, sha256));
    if (!blob) return null;
    try {
      return JSON.parse(blob.data.toString("utf8")) as PendingUpload;
    } catch {
      return null;
    }
  }

  /** Store bytes the server generated (title SVGs…), content-addressed; a no-op when already stored. */
  async storeBytes(userId: string, input: { sha256: string; bytes: Uint8Array; name: string; contentType: string }): Promise<MediaInfo> {
    const existing = await this.get(userId, input.sha256);
    if (existing) return existing;
    await this.assertFits(userId, input.bytes.byteLength);
    const uploadedAt = isoAt(this.clock.now());
    const name = cleanFileName(input.name);
    await this.blobs.write(mediaPath(userId, input.sha256), input.bytes, {
      contentType: input.contentType,
      metadata: { name: encodeMeta(name), contenttype: input.contentType, complete: "1", verified: "1", uploadedat: uploadedAt },
    });
    this.invalidateUsage(userId);
    return { sha256: input.sha256, size: input.bytes.byteLength, name, contentType: input.contentType, verified: true, uploadedAt };
  }

  /** Store a local file the server produced or downloaded (hash already known). */
  async storeFile(userId: string, input: { sha256: string; filePath: string; size: number; name: string; contentType: string }): Promise<MediaInfo> {
    const existing = await this.get(userId, input.sha256);
    if (existing) return existing;
    await this.assertFits(userId, input.size);
    const uploadedAt = isoAt(this.clock.now());
    await this.blobs.writeFile(mediaPath(userId, input.sha256), input.filePath, {
      contentType: input.contentType,
      metadata: {
        name: encodeMeta(cleanFileName(input.name)),
        contenttype: input.contentType,
        complete: "1",
        verified: "1",
        uploadedat: uploadedAt,
      },
    });
    this.invalidateUsage(userId);
    return { sha256: input.sha256, size: input.size, name: cleanFileName(input.name), contentType: input.contentType, verified: true, uploadedAt };
  }

  async readUrl(userId: string, sha256: string, info?: MediaInfo): Promise<{ url: string; expiresAt: string }> {
    const media = info ?? (await this.get(userId, sha256));
    if (!media) throw notFound("Media");
    const url = await this.blobs.signUrl(mediaPath(userId, sha256), {
      permission: "read",
      expiresInSeconds: READ_URL_SECONDS,
      contentType: media.contentType,
      contentDisposition: attachmentDisposition(media.name),
    });
    return { url, expiresAt: isoAt(this.clock.now() + READ_URL_SECONDS * 1000) };
  }

  /** Download a media blob to a local file (render worker, frame previews). */
  async download(userId: string, sha256: string, filePath: string): Promise<void> {
    await this.blobs.readToFile(mediaPath(userId, sha256), filePath);
  }
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${units[unit]}`;
}

