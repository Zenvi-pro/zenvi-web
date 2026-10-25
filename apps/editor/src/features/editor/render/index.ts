/**
 * The editor's only door to `@zenvi/render-web`: probing, the media registry,
 * the preview engine, thumbnails, waveforms, frames and export.
 */
import { builtinLutForPath, type ExportOptions, type Project, type ToolImage } from "@zenvi/engine";
import {
  createFrameHost,
  ExportError,
  exportProject,
  generateThumbnails as rwThumbnails,
  generateWaveform as rwWaveform,
  MediaRegistry,
  PreviewPlayer,
  probeMedia,
  type ExportProgress,
} from "@zenvi/render-web";
import { browserSupport } from "@/lib/capabilities";
import { resolveTransitionAsset } from "../catalog";
import type { MediaLibrary, MediaSourceSpec, ProbeFn } from "../session/media";
import type { PreviewEngine } from "../session/playback";

export const probe: ProbeFn = (spec, options) => probeMedia(spec, { path: options.path });

// One render-web registry per media library (per open project).
const registries = new WeakMap<MediaLibrary, MediaRegistry>();
let current: MediaRegistry | null = null;

// The built-in colour LUTs (`@colors/<category>/<name>.cube`), bundled from the engine's assets.
const lutFiles = import.meta.glob("../../../../../../packages/engine/assets/colors/*/*.cube", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const lutUrls = new Map(Object.entries(lutFiles).map(([file, url]) => [file.slice(file.indexOf("/assets/") + "/assets/".length), url]));

/** Where bundled assets live when a project refers to them by path. */
function resolvePath(path: string): MediaSourceSpec | undefined {
  if (path.startsWith("@transitions/") || path.includes("/transitions/")) {
    const url = resolveTransitionAsset(path);
    if (url) return { kind: "url", url, name: path.split("/").pop() ?? path };
  }
  const lut = builtinLutForPath(path);
  const lutUrl = lut ? lutUrls.get(lut.assetPath) : undefined;
  if (lut && lutUrl) return { kind: "url", url: lutUrl, name: `${lut.id.split("/").pop()}.cube` };
  return undefined;
}

/** Create and attach the registry for a media library. */
export function bindRegistry(media: MediaLibrary): void {
  const registry = new MediaRegistry({ resolvePath });
  registries.set(media, registry);
  current = registry;
  media.setRegistry(registry);
}

function registryOf(media: MediaLibrary): MediaRegistry {
  const registry = registries.get(media);
  if (!registry) throw new Error("Media registry not ready");
  return registry;
}

export interface PreviewEngineOptions {
  canvas: HTMLCanvasElement;
  media: MediaLibrary;
}

class PlayerEngine implements PreviewEngine {
  readonly renders = true;
  private readonly player: PreviewPlayer;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    registry: MediaRegistry,
  ) {
    this.player = new PreviewPlayer(canvas, { media: registry });
  }

  setProject(project: Project): void {
    this.player.setProject(project);
  }

  seek(seconds: number): void {
    void this.player.seek(seconds).catch(() => undefined);
  }

  play(): void {
    this.player.play();
  }

  pause(): void {
    this.player.pause();
  }

  setRate(rate: number): void {
    this.player.rate = Math.max(0.0625, Math.abs(rate));
  }

  setLoop(loop: boolean): void {
    this.player.loop = loop;
  }

  resize(): void {
    // The player follows the canvas's device-pixel size itself.
  }

  onTime(listener: (seconds: number) => void): () => void {
    return this.player.onTime(listener);
  }

  onState(listener: (state: { playing: boolean }) => void): () => void {
    return this.player.onState((s) => listener({ playing: s.playing }));
  }

  captureThumbnail(maxWidth: number): string | null {
    const { width, height } = this.canvas;
    if (width < 2 || height < 2) return null;
    const scale = Math.min(1, maxWidth / width);
    const thumb = document.createElement("canvas");
    thumb.width = Math.round(width * scale);
    thumb.height = Math.round(height * scale);
    const ctx = thumb.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(this.canvas, 0, 0, thumb.width, thumb.height);
    try {
      return thumb.toDataURL("image/jpeg", 0.72);
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.player.dispose();
  }
}

export function createPreviewEngine(options: PreviewEngineOptions): PreviewEngine {
  return new PlayerEngine(options.canvas, registryOf(options.media));
}

export interface Thumbnail {
  /** Source time, seconds. */
  time: number;
  bitmap: ImageBitmap;
}

export async function generateThumbnails(fileId: string, times: number[], height: number): Promise<Thumbnail[] | null> {
  if (!current) return null;
  const bitmaps = await rwThumbnails(current, fileId, { times, height });
  return bitmaps.map((bitmap, i) => ({ time: times[i] ?? 0, bitmap }));
}

export async function generateWaveform(fileId: string, buckets: number): Promise<Float32Array | null> {
  if (!current) return null;
  return rwWaveform(current, fileId, { buckets });
}

export interface ExportJob {
  promise: Promise<Blob>;
  cancel(): void;
}

/** In-browser export needs WebCodecs encoders; without them export offers a cloud render. */
export const exportAvailable = browserSupport().canExport;

export interface StartExportOptions {
  /** Export without sound when the browser cannot encode audio (else ExportError "no-audio-encoder"). */
  allowVideoOnly?: boolean;
  /** How the file differs from what was asked (container, codecs, size). */
  onNotes?: (notes: string[]) => void;
}

export function startExport(
  project: Project,
  options: ExportOptions,
  onProgress: (fraction: number, stage?: ExportProgress["stage"]) => void,
  media: MediaLibrary,
  run: StartExportOptions = {},
): ExportJob {
  const controller = new AbortController();
  const promise = exportProject(project, registryOf(media), options, {
    signal: controller.signal,
    onProgress: (p) => onProgress(p.fraction, p.stage),
    onNotes: (notes) => run.onNotes?.(notes),
    ...(run.allowVideoOnly ? { allowVideoOnly: true } : {}),
  });
  return { promise, cancel: () => controller.abort() };
}

/** File extension for an exported file's MIME type (the exporter may change container). */
export function extensionForMime(type: string): string {
  if (type.includes("webm")) return "webm";
  if (type.includes("quicktime")) return "mov";
  if (type.includes("matroska")) return "mkv";
  if (type.includes("wav")) return "wav";
  return "mp4";
}

export type ExportFailure = "no-audio-encoder" | "no-encoder" | "unsupported-format" | "empty-range" | "aborted" | "other";

/** What went wrong with a browser export, for the dialog to offer the right way out. */
export function exportFailure(error: unknown): ExportFailure {
  if ((error as { name?: string } | null)?.name === "AbortError") return "aborted";
  return error instanceof ExportError ? error.code : "other";
}

export async function renderFrame(project: Project, seconds: number, options: { width?: number; format?: "png" | "jpeg" }, media: MediaLibrary): Promise<ToolImage> {
  return createFrameHost(registryOf(media)).renderFrame(project, seconds, options);
}
