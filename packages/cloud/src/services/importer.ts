/**
 * Server-side media import from a URL (MCP `import_media_from_url`, and the
 * engine's `MediaHost.importUrl` on the cloud host).
 *
 * Downloads with the SSRF guard (https only, public addresses only, pinned
 * connection, redirects re-checked), a size cap and a time budget that keeps
 * the whole tool call under ChatGPT's ~60 s limit; checks the content type;
 * hashes while streaming and stores the file content-addressed, so importing
 * the same bytes twice is free and idempotent.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ImportedMedia } from "@zenvi/engine";
import { ApiError } from "../http/errors.js";
import { downloadToFile, FetchError, safeGet } from "../net/fetch.js";
import type { Resolver, UrlPolicy } from "../net/ssrf.js";
import { PUBLIC_HTTPS, SsrfError } from "../net/ssrf.js";
import type { MediaProber } from "../render/renderer.js";
import type { MediaService } from "./media.js";
import { cleanFileName, normalizeContentType } from "./media.js";

const EXTENSION_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  flac: "audio/flac",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

const TYPE_EXTENSIONS: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSION_TYPES)
    .filter(([ext]) => !["m4v", "oga", "jpeg"].includes(ext))
    .map(([ext, type]) => [type, ext]),
);

function extensionOf(name: string): string | undefined {
  return /\.([a-z0-9]{2,5})$/i.exec(name)?.[1]?.toLowerCase();
}

function nameFromDisposition(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // fall through to the plain filename
    }
  }
  return /filename\s*=\s*"?([^";]+)"?/i.exec(header)?.[1]?.trim();
}

export interface ImportResult extends ImportedMedia {
  name: string;
  sha256: string;
  size: number;
  contentType: string;
  /** True when these bytes were already in the user's library. */
  reused: boolean;
}

export interface ImporterOptions {
  media: MediaService;
  prober: MediaProber;
  tmpDir: string;
  maxBytes: number;
  timeoutMs?: number;
  policy?: UrlPolicy;
  resolver?: Resolver;
}

export class MediaImporter {
  constructor(private readonly options: ImporterOptions) {}

  get available(): boolean {
    return this.options.prober.available;
  }

  async importUrl(userId: string, url: string, opts: { filename?: string; signal?: AbortSignal } = {}): Promise<ImportResult> {
    if (!this.options.prober.available) {
      throw new ApiError(503, "unavailable", "Importing from a URL needs media probing, which this Zenvi Cloud build does not have yet.");
    }
    const tmp = await mkdtemp(join(this.options.tmpDir, "zenvi-import-"));
    try {
      let response;
      try {
        response = await safeGet(url, {
          timeoutMs: this.options.timeoutMs ?? 45_000,
          signal: opts.signal,
          policy: this.options.policy ?? PUBLIC_HTTPS,
          resolver: this.options.resolver,
          headers: { accept: "video/*, audio/*, image/*;q=0.9, */*;q=0.1" },
        });
      } catch (error) {
        throw this.translate(error);
      }
      if (response.status !== 200) {
        response.body.resume();
        response.done();
        throw new ApiError(422, "download_failed", `The URL answered HTTP ${response.status}. Use a direct, public link to the file.`);
      }
      const urlName = decodeURIComponent(new URL(response.url).pathname.split("/").pop() ?? "");
      const declaredType = (response.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
      if (declaredType === "text/html" || declaredType === "application/xhtml+xml") {
        response.body.resume();
        response.done();
        throw new ApiError(415, "unsupported_media_type", "That URL is a web page, not a media file. Use a direct link to the video, audio or image file.");
      }
      const candidateName = opts.filename ?? nameFromDisposition(response.headers["content-disposition"]) ?? urlName;
      let contentType = normalizeContentType(declaredType);
      if (!contentType || contentType === "application/octet-stream") {
        const ext = extensionOf(candidateName) ?? extensionOf(urlName);
        contentType = ext ? (EXTENSION_TYPES[ext] ?? null) : null;
      }
      if (!contentType || contentType === "application/octet-stream") {
        response.body.resume();
        response.done();
        throw new ApiError(415, "unsupported_media_type", "That URL is not a video, audio or image file.");
      }
      let name = cleanFileName(candidateName);
      if (!extensionOf(name) && TYPE_EXTENSIONS[contentType]) name = `${name === "media" ? "import" : name}.${TYPE_EXTENSIONS[contentType]}`;

      const declaredSize = Number(response.headers["content-length"]);
      await this.options.media.assertFits(userId, Number.isFinite(declaredSize) ? declaredSize : 0);
      const file = join(tmp, `download${extensionOf(name) ? `.${extensionOf(name)}` : ""}`);
      let downloaded;
      try {
        downloaded = await downloadToFile(response, file, this.options.maxBytes);
      } catch (error) {
        throw this.translate(error);
      }
      const info = await this.options.prober.probe(file).catch((error: unknown) => {
        throw new ApiError(422, "unreadable_media", `Zenvi could not read that file as media (${error instanceof Error ? error.message : String(error)}).`);
      });
      const existing = await this.options.media.get(userId, downloaded.sha256);
      const stored =
        existing ??
        (await this.options.media.storeFile(userId, {
          sha256: downloaded.sha256,
          filePath: file,
          size: downloaded.size,
          name,
          contentType,
        }));
      return {
        path: name,
        name,
        info: { ...info, path: name },
        fingerprint: { size: downloaded.size, sha256: downloaded.sha256 },
        cloud: { sha256: downloaded.sha256, size: downloaded.size, content_type: stored.contentType, name },
        sha256: downloaded.sha256,
        size: downloaded.size,
        contentType: stored.contentType,
        reused: existing !== null,
      };
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  private translate(error: unknown): Error {
    if (error instanceof ApiError) return error;
    if (error instanceof SsrfError) return new ApiError(422, "url_not_allowed", error.message);
    if (error instanceof FetchError) return new ApiError(422, "download_failed", error.message);
    const message = error instanceof Error ? error.message : String(error);
    return new ApiError(422, "download_failed", `The download failed: ${message}`);
  }
}
