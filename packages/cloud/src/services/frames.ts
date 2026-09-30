/**
 * Preview frames for MCP clients: render one timeline frame, keep it as a
 * blob (so hosts that do not show image content to the model — ChatGPT — can
 * still link it) and return both the image and a short-lived URL.
 */

import type { Project, ToolImage } from "@zenvi/engine";
import { ApiError } from "../http/errors.js";
import type { BlobStore } from "../storage/types.js";
import type { Clock } from "../util/clock.js";
import { isoAt } from "../util/clock.js";
import { sha256Hex } from "../util/crypto.js";
import type { MediaCache } from "../render/cache.js";
import type { Renderer } from "../render/renderer.js";
import { projectPathResolver } from "../render/resolve.js";
import { framePath } from "./paths.js";

const URL_SECONDS = 3600;

export interface FramePreview {
  image: ToolImage;
  url: string;
  urlExpiresAt: string;
  seconds: number;
}

export class FrameService {
  constructor(
    private readonly renderer: Renderer,
    private readonly cache: MediaCache,
    private readonly blobs: BlobStore,
    private readonly clock: Clock,
    private readonly resolveAsset?: (projectPath: string) => string | undefined,
  ) {}

  get available(): boolean {
    return this.renderer.framesAvailable;
  }

  async preview(input: {
    userId: string;
    projectId: string;
    project: Project;
    revision: string;
    seconds: number;
    width?: number;
    signal: AbortSignal;
  }): Promise<FramePreview> {
    if (!this.renderer.framesAvailable) {
      throw new ApiError(503, "unavailable", "Frame previews need the video renderer, which this Zenvi Cloud build does not have yet.");
    }
    const width = input.width ?? Math.min(960, input.project.width);
    const key = sha256Hex(`${input.revision}\n${input.seconds}\n${width}`).slice(0, 32);
    const path = framePath(input.userId, input.projectId, key, "png");
    const cached = await this.blobs.read(path);
    let bytes: Uint8Array;
    if (cached) {
      bytes = cached.data;
    } else {
      try {
        bytes = await this.renderer.frame({
          project: input.project,
          seconds: input.seconds,
          width,
          format: "png",
          resolveMedia: projectPathResolver(input.project, {
            fetchFile: (file) => this.cache.get(input.userId, file),
            resolveAsset: this.resolveAsset,
          }),
          signal: input.signal,
        });
      } catch (error) {
        // Renderer failures (missing media, unsupported effect…) are the person's to act on.
        throw new ApiError(422, "preview_failed", `Could not render that frame: ${error instanceof Error ? error.message : String(error)}`);
      }
      await this.blobs.write(path, bytes, { contentType: "image/png" });
    }
    const url = await this.blobs.signUrl(path, { permission: "read", expiresInSeconds: URL_SECONDS, contentType: "image/png" });
    return {
      image: { mimeType: "image/png", data: Buffer.from(bytes).toString("base64") },
      url,
      urlExpiresAt: isoAt(this.clock.now() + URL_SECONDS * 1000),
      seconds: input.seconds,
    };
  }
}
