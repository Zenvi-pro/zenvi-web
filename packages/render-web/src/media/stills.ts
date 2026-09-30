/**
 * Still images and SVG at the sizes layers draw them, plus exact-size RGBA
 * copies for kernels (transition masks, effect mask images).
 *
 * SVG follows QtImageReader: the document is rasterized at its own aspect
 * ratio fitted into the target box, and drawing it into the layer's draw rect
 * stretches it (libopenshot-semantics §5.3; the 720×576 transition masks
 * become 16:9).
 */

import type { RgbaImage } from "@zenvi/engine/render";
import { LruCache } from "../util/lru.js";
import { bucketSize, type Size } from "../util/size-bucket.js";
import type { ResizeQuality } from "../video/convert.js";
import { SharedBitmap, type FrameImage } from "../video/shared-bitmap.js";
import type { MediaRef, MediaRegistry } from "./registry.js";
import { createImageElementSvgRasterizer } from "./svg-dom.js";
import { parseSvgSize, svgRasterSize, type SvgRasterizer, type SvgSize } from "./svg.js";

export interface StillRequest {
  ref: MediaRef;
  /** Size the layer draws the still at. */
  width: number;
  height: number;
  /** Natural size (plan `sourceWidth × sourceHeight`), or 0 × 0 when unknown. */
  naturalWidth?: number;
  naturalHeight?: number;
}

export interface StillCacheOptions {
  media: MediaRegistry;
  /** SVG renderer. Default: the browser's, through an `<img>` (main thread). */
  svgRasterizer?: SvgRasterizer;
  /** GPU budget for bitmaps. Default 128 MB. */
  maxBitmapBytes?: number;
  /** CPU budget for RGBA copies. Default 96 MB. */
  maxRgbaBytes?: number;
  quality?: ResizeQuality;
}

export class StillCache {
  private readonly media: MediaRegistry;
  private readonly quality: ResizeQuality;
  private rasterizer: SvgRasterizer | undefined;
  private readonly bitmaps: LruCache<string, SharedBitmap>;
  private readonly rgbaImages: LruCache<string, RgbaImage>;
  private readonly pending = new Map<string, Promise<SharedBitmap>>();
  private readonly svgSizes = new Map<string, Promise<SvgSize | null>>();
  private readonly unsubscribe: () => void;

  constructor(options: StillCacheOptions) {
    this.media = options.media;
    this.quality = options.quality ?? "high";
    this.rasterizer = options.svgRasterizer;
    this.bitmaps = new LruCache({
      maxCost: options.maxBitmapBytes ?? 128 * 1024 * 1024,
      cost: (bitmap) => bitmap.bytes,
      onEvict: (bitmap) => bitmap.drop(),
    });
    this.rgbaImages = new LruCache({ maxCost: options.maxRgbaBytes ?? 96 * 1024 * 1024, cost: (image) => image.data.byteLength });
    this.unsubscribe = this.media.onInvalidate((key) => {
      const prefix = `${key}@`;
      this.bitmaps.deleteWhere((k) => k.startsWith(prefix));
      this.rgbaImages.deleteWhere((k) => k.startsWith(prefix));
      for (const k of [...this.svgSizes.keys()]) if (k.startsWith(prefix)) this.svgSizes.delete(k);
    });
  }

  /** A borrowed bitmap covering the request's draw size (call `release`). */
  async bitmap(request: StillRequest): Promise<FrameImage> {
    const base = this.baseKey(request.ref);
    const svg = this.media.kindOf(request.ref) === "svg";
    const natural = { width: request.naturalWidth ?? 0, height: request.naturalHeight ?? 0 };
    const size = bucketSize({ width: request.width, height: request.height }, natural, { allowUpscale: svg, maxDimension: 8192 });
    const key = `${base}|${size.width}x${size.height}`;
    const cached = this.bitmaps.get(key);
    if (cached && !cached.closed) return cached.retain();
    let pending = this.pending.get(key);
    if (!pending) {
      pending = this.decode(request.ref, size, svg, false).then((image) => {
        const bitmap = new SharedBitmap(image);
        this.bitmaps.set(key, bitmap);
        return bitmap;
      });
      this.pending.set(key, pending);
      const clear = () => this.pending.delete(key);
      pending.then(clear, clear);
    }
    const bitmap = await pending;
    return bitmap.retain();
  }

  /** The still stretched to exactly `width × height`, as straight RGBA (shared; do not mutate). */
  async rgba(ref: MediaRef, width: number, height: number): Promise<RgbaImage> {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const key = `${this.baseKey(ref)}|rgba|${w}x${h}`;
    const cached = this.rgbaImages.get(key);
    if (cached) return cached;
    const svg = this.media.kindOf(ref) === "svg";
    const image = await this.decode(ref, { width: w, height: h }, svg, true);
    try {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("2D canvas context unavailable");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h);
      const rgba: RgbaImage = { width: w, height: h, data: data.data };
      this.rgbaImages.set(key, rgba);
      return rgba;
    } finally {
      image.close();
    }
  }

  dispose(): void {
    this.unsubscribe();
    this.bitmaps.clear();
    this.rgbaImages.clear();
  }

  // -------------------------------------------------------------------------

  private baseKey(ref: MediaRef): string {
    const key = this.media.keyOf(ref);
    if (key === undefined) throw new Error(`No media registered for ${ref.fileId ?? ref.path ?? "?"}`);
    return `${key}@${this.media.versionOf(ref)}`;
  }

  /**
   * Decode at `box`. Rasters are resized to the box (stretching when
   * `exact`); SVG is rendered at its aspect-fitted size inside the box, which
   * drawing then stretches, or (for `exact`) stretched here.
   */
  private async decode(ref: MediaRef, box: Size, svg: boolean, exact: boolean): Promise<ImageBitmap> {
    const blob = await this.media.blob(ref);
    if (!svg) {
      return createImageBitmap(blob, {
        resizeWidth: box.width,
        resizeHeight: box.height,
        resizeQuality: this.quality,
        imageOrientation: "from-image",
      });
    }
    const documentSize = await this.svgSize(ref, blob);
    const raster = documentSize ? svgRasterSize(documentSize, box) : box;
    this.rasterizer ??= createImageElementSvgRasterizer();
    const image = await this.rasterizer(blob, raster.width, raster.height);
    if (!exact || (image.width === box.width && image.height === box.height)) return image;
    try {
      return await createImageBitmap(image, { resizeWidth: box.width, resizeHeight: box.height, resizeQuality: "high" });
    } finally {
      image.close();
    }
  }

  private svgSize(ref: MediaRef, blob: Blob): Promise<SvgSize | null> {
    const key = this.baseKey(ref);
    let pending = this.svgSizes.get(key);
    if (!pending) {
      pending = blob.text().then(parseSvgSize);
      this.svgSizes.set(key, pending);
    }
    return pending;
  }
}
