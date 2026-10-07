/**
 * Decoded video sample → bitmap at the size a layer draws it.
 *
 * Converting right away (instead of keeping the `VideoFrame`) hands the frame
 * back to the decoder's small pool at once; hardware decoders stall when
 * callers hold on to their output.
 */

import type { VideoSample } from "mediabunny";
import type { Size } from "../util/size-bucket.js";

export type ResizeQuality = "pixelated" | "low" | "medium" | "high";

/**
 * Rasterize `sample` at `size`. With `applyRotation` the container rotation
 * and flip are applied (libopenshot "reader" orientation mode); without it the
 * stored picture is used as is (legacy clips rotate with keyframes).
 */
export async function sampleToBitmap(sample: VideoSample, size: Size, applyRotation: boolean, quality: ResizeQuality): Promise<ImageBitmap> {
  const width = Math.max(1, Math.round(size.width));
  const height = Math.max(1, Math.round(size.height));
  if (!applyRotation || (sample.rotation === 0 && !sample.flip)) {
    return createImageBitmap(sample.toCanvasImageSource(), { resizeWidth: width, resizeHeight: height, resizeQuality: quality });
  }
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.imageSmoothingEnabled = quality !== "pixelated";
  if (quality !== "pixelated") ctx.imageSmoothingQuality = quality;
  // VideoSample.draw applies rotation, then flip, into the display-oriented box.
  sample.draw(ctx, 0, 0, width, height);
  return canvas.transferToImageBitmap();
}
