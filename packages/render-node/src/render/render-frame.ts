/**
 * Render one timeline frame to PNG or JPEG, for a person or a model to look
 * at (preview_frame, inspect tools, `zenvi frame`).
 */

import { frameContaining, type FrameOverlay, type Project, type RgbaImage } from "@zenvi/engine";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { runBinary } from "../ffmpeg/process.js";
import { encodePng } from "../image/png.js";
import { flattenOver } from "../image/rgba.js";
import { SourceManager, type MediaResolver } from "../decode/sources.js";
import type { ScaleQuality } from "../decode/video.js";
import { defaultRenderEngine, type RenderEngine } from "./engine.js";
import { applyOverlay } from "./overlay.js";

export interface RenderFrameOptions {
  resolveMedia: MediaResolver;
  /** Output width; height follows the project aspect. Default: the project width. */
  width?: number;
  format?: "png" | "jpeg";
  /** JPEG quality 1..100 (desktop inspect uses 70). */
  jpegQuality?: number;
  overlay?: FrameOverlay;
  engine?: RenderEngine;
  /** Reuse decoders across calls (an MCP session previewing several frames). */
  sources?: SourceManager;
  scaleQuality?: ScaleQuality;
  signal?: AbortSignal;
}

export function previewSize(project: Project, width?: number): { width: number; height: number } {
  const w = Math.max(16, Math.min(8192, Math.round(width ?? project.width)));
  const h = Math.max(16, Math.round((w * project.height) / Math.max(1, project.width)));
  return { width: w, height: h };
}

/** The composited frame shown at `seconds` (the frame whose interval contains it). */
export async function renderFrameImage(project: Project, seconds: number, options: RenderFrameOptions): Promise<RgbaImage> {
  const engine = options.engine ?? (await defaultRenderEngine());
  const size = previewSize(project, options.width);
  const frame = frameContaining(Math.max(0, seconds), project.fps);
  const own = options.sources === undefined;
  const sources =
    options.sources ?? new SourceManager(project, { resolveMedia: options.resolveMedia, quality: options.scaleQuality ?? "export", signal: options.signal });
  try {
    const plan = engine.planFrame(project, frame, size);
    const prepared = await sources.prepare(plan);
    return await applyOverlay(engine.composite(plan, prepared), options.overlay);
  } finally {
    if (own) await sources.close();
  }
}

/** JPEG via ffmpeg's MJPEG encoder (full-range 4:2:0). */
export async function encodeJpeg(image: RgbaImage, quality = 70, signal?: AbortSignal): Promise<Buffer> {
  const flat = flattenOver(image, [0, 0, 0]);
  // ffmpeg -q:v 2 (best) … 31 (worst); map 1..100 onto it.
  const q = Math.round(2 + ((100 - Math.max(1, Math.min(100, quality))) / 99) * 29);
  const { stdout } = await runBinary(
    resolveBinary("ffmpeg"),
    [
      "-hide_banner", "-loglevel", "error", "-nostdin",
      "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${image.width}x${image.height}`, "-i", "pipe:0",
      "-frames:v", "1", "-vf", "scale=out_range=pc,format=yuvj420p", "-c:v", "mjpeg", "-q:v", String(q),
      "-f", "image2pipe", "pipe:1",
    ],
    { input: Buffer.from(flat.data.buffer, flat.data.byteOffset, flat.data.byteLength), signal, timeoutMs: 60_000, what: "JPEG encoding failed" },
  );
  return stdout;
}

/** Render the frame at `seconds` and encode it. */
export async function renderFrame(project: Project, seconds: number, options: RenderFrameOptions): Promise<Buffer> {
  const image = await renderFrameImage(project, seconds, options);
  return options.format === "jpeg" ? encodeJpeg(image, options.jpegQuality, options.signal) : encodePng(image);
}
