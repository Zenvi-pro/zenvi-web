/**
 * Tool host capabilities (`@zenvi/engine/tools`) backed by the browser
 * runtime, so the tool catalog can render frames and export in the web editor.
 */

import type { ExportHost, ExportOptions, ExportResult, FrameHost, ToolImage } from "@zenvi/engine/tools";
import type { RenderEngine } from "./engine.js";
import { exportFrame, exportProject } from "./export/export-project.js";
import type { MediaRegistry } from "./media/registry.js";

export interface WebFrameHostOptions {
  engine?: RenderEngine;
  /** Width when the caller does not ask for one (models see this). Default 960, never above the project. */
  defaultWidth?: number;
}

export function createFrameHost(media: MediaRegistry, options: WebFrameHostOptions = {}): FrameHost {
  return {
    async renderFrame(project, seconds, request = {}): Promise<ToolImage> {
      const width = Math.max(16, Math.round(request.width ?? Math.min(options.defaultWidth ?? 960, project.width)));
      const height = Math.max(16, Math.round((width * project.height) / Math.max(1, project.width)));
      const mimeType = request.format === "jpeg" ? "image/jpeg" : "image/png";
      const blob = await exportFrame(project, media, seconds, { width, height }, mimeType, options.engine ? { engine: options.engine } : {});
      return { mimeType, data: await blobToBase64(blob) };
    },
  };
}

export interface WebExportHostOptions {
  engine?: RenderEngine;
  /**
   * Where the finished file goes (save to OPFS, upload, trigger a download).
   * Returns the location to report. Default: an object URL (revoke it when done).
   */
  deliver?: (file: Blob, suggestedName: string) => Promise<string>;
  signal?: AbortSignal;
}

const EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

export function createExportHost(media: MediaRegistry, options: WebExportHostOptions = {}): ExportHost {
  return {
    async export(project, exportOptions: ExportOptions, onProgress): Promise<ExportResult> {
      const blob = await exportProject(project, media, exportOptions, {
        ...(options.engine ? { engine: options.engine } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(onProgress ? { onProgress: (progress) => onProgress(progress.fraction) } : {}),
      });
      const base = (blob.type.split(";")[0] ?? "").trim();
      const extension = EXTENSIONS[base] ?? exportOptions.format;
      const name = `${typeof project.name === "string" && project.name ? project.name : "export"}.${extension}`;
      const location = options.deliver ? await options.deliver(blob, name) : URL.createObjectURL(blob);
      const duration = exportOptions.range ? exportOptions.range.end - exportOptions.range.start : undefined;
      return { location, bytes: blob.size, mimeType: base, ...(duration !== undefined ? { durationSeconds: duration } : {}) };
    },
  };
}

/** Base64 without a `data:` prefix (tool image content). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
