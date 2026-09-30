/**
 * Still images (QtImageReader media, static GIFs, transition masks, effect
 * mask images) decoded once at the size a plan draws them.
 *
 * Raster images go through ffmpeg with the EXIF orientation applied (the
 * desktop's QImageReader uses autoTransform); SVGs are rasterized by resvg.
 */

import path from "node:path";
import type { RgbaImage } from "@zenvi/engine";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { runBinary } from "../ffmpeg/process.js";
import { rgbaView } from "../image/rgba.js";
import { imageOrientation, orientationFilters } from "../probe/exif.js";
import { rasterizeSvgFile } from "../svg/rasterize.js";
import type { ScaleQuality } from "./video.js";

export function isSvgPath(file: string): boolean {
  return /\.svgz?$/i.test(file);
}

/** Decode the first frame of an image (or any media) to RGBA at `width`×`height`. */
export async function decodeStill(
  file: string,
  size: { width: number; height: number },
  options: { quality?: ScaleQuality; signal?: AbortSignal } = {},
): Promise<RgbaImage> {
  const width = Math.max(1, Math.round(size.width));
  const height = Math.max(1, Math.round(size.height));
  if (isSvgPath(file)) return rasterizeSvgFile(file, { width, height });
  const orientation = await imageOrientation(file).catch(() => 1 as const);
  const flags = options.quality === "preview" ? "fast_bilinear" : "bicubic+accurate_rnd+full_chroma_int";
  const filters = [...orientationFilters(orientation), `scale=${width}:${height}:flags=${flags}`, "format=rgba"];
  const { stdout } = await runBinary(
    resolveBinary("ffmpeg"),
    ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", file, "-frames:v", "1", "-vf", filters.join(","), "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"],
    { signal: options.signal, timeoutMs: 120_000, maxStdout: width * height * 4 + 1024, what: `Decoding ${path.basename(file)} failed` },
  );
  if (stdout.length < width * height * 4) throw new Error(`Decoding ${file} produced no image.`);
  return rgbaView(new Uint8Array(stdout.buffer, stdout.byteOffset, width * height * 4), width, height);
}

/** Cache of decoded stills keyed by path and size, bounded by bytes. */
export class StillCache {
  private readonly entries = new Map<string, Promise<RgbaImage>>();
  private readonly sizes = new Map<string, number>();
  private bytes = 0;

  constructor(private readonly maxBytes = 256 * 1024 * 1024) {}

  get(file: string, size: { width: number; height: number }, load: () => Promise<RgbaImage>): Promise<RgbaImage> {
    const key = `${file}\0${Math.round(size.width)}x${Math.round(size.height)}`;
    const hit = this.entries.get(key);
    if (hit) {
      // Refresh recency.
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    const promise = load();
    this.entries.set(key, promise);
    const cost = Math.round(size.width) * Math.round(size.height) * 4;
    this.sizes.set(key, cost);
    this.bytes += cost;
    promise.catch(() => this.drop(key));
    while (this.bytes > this.maxBytes && this.entries.size > 1) {
      const oldest = this.entries.keys().next().value as string;
      if (oldest === key) break;
      this.drop(oldest);
    }
    return promise;
  }

  private drop(key: string): void {
    if (!this.entries.delete(key)) return;
    this.bytes -= this.sizes.get(key) ?? 0;
    this.sizes.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.sizes.clear();
    this.bytes = 0;
  }
}
