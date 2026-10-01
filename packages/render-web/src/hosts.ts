/**
 * Tool host capabilities (`@zenvi/engine/tools`) backed by the browser
 * runtime, so the tool catalog can render frames and export in the web editor.
 */

import type { ExportHost, ExportOptions, ExportResult, FrameHost, ToolImage } from "@zenvi/engine/tools";
import type { RenderEngine } from "./engine.js";
import type { StreamTargetChunk } from "mediabunny";
import { exportFrame, exportProject, exportProjectTo } from "./export/export-project.js";
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
  /**
   * Stream long exports to disk instead of memory: return a writable (an
   * OPFS `FileSystemWritableFileStream`) and the location to report. Wins
   * over `deliver`.
   */
  stream?: (suggestedName: string) => Promise<{ writable: WritableStream<StreamTargetChunk>; location: string }>;
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
      const run = {
        ...(options.engine ? { engine: options.engine } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(onProgress ? { onProgress: (progress: { fraction: number }) => onProgress(progress.fraction) } : {}),
      };
      const stem = typeof project.name === "string" && project.name ? project.name : "export";
      const duration = exportOptions.range ? exportOptions.range.end - exportOptions.range.start : undefined;
      const extra = duration !== undefined ? { durationSeconds: duration } : {};
      if (options.stream) {
        // The container may change (MP4 → WebM without H.264): name it for the requested format.
        const { writable, location } = await options.stream(`${stem}.${exportOptions.format}`);
        const result = await exportProjectTo(writable, project, media, exportOptions, run);
        return { location, bytes: result.bytes, mimeType: (result.mimeType.split(";")[0] ?? "").trim(), ...extra };
      }
      const blob = await exportProject(project, media, exportOptions, run);
      const base = (blob.type.split(";")[0] ?? "").trim();
      const name = `${stem}.${EXTENSIONS[base] ?? exportOptions.format}`;
      const location = options.deliver ? await options.deliver(blob, name) : URL.createObjectURL(blob);
      return { location, bytes: blob.size, mimeType: base, ...extra };
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
