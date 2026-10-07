/**
 * `LayerResources` backed by the media registry: decoded video pictures from
 * a `FrameProvider`, stills and SVG from a `StillCache`, text from the
 * registry, kernel audio from a `KernelAudioSource`.
 */

import type { KernelAudio, LayerAudioRequest, LayerPlan, RgbaImage } from "@zenvi/engine/render";
import type { KernelAudioSource } from "../audio/kernel-audio.js";
import type { MediaRef, MediaRegistry } from "../media/registry.js";
import type { StillCache } from "../media/stills.js";
import type { DecodeMode } from "../video/decode-cursor.js";
import type { FrameProvider } from "../video/frame-provider.js";
import type { FrameImage } from "../video/shared-bitmap.js";
import type { LayerResources } from "./compositor.js";
import { createCanvas } from "./scratch.js";

export interface MediaResourcesOptions {
  media: MediaRegistry;
  frames: FrameProvider;
  stills: StillCache;
  /** Audio for kernels that read it (waveform clips, AudioVisualization, BeatSync). */
  audio?: KernelAudioSource;
}

export function mediaResources({ media, frames, stills, audio }: MediaResourcesOptions): LayerResources {
  const still = (layer: LayerPlan, ref: MediaRef): Promise<FrameImage> =>
    stills.bitmap({
      ref,
      width: layer.drawWidth,
      height: layer.drawHeight,
      naturalWidth: layer.sourceWidth,
      naturalHeight: layer.sourceHeight,
    });

  return {
    async picture(layer: LayerPlan, mode: DecodeMode): Promise<FrameImage | null> {
      const source = layer.source;
      if (source.kind === "color") return null;
      const ref: MediaRef = { fileId: source.fileId, path: source.path };
      if (source.kind !== "video" || media.kindOf(ref) !== "av") {
        // Stills, SVG, and "video" the browser can only read as a still (GIF).
        return still(layer, ref);
      }
      return frames.frame({
        ref,
        sourceTime: source.time,
        width: layer.drawWidth,
        height: layer.drawHeight,
        applyRotation: source.applyRotation ?? true,
        lane: layer.clipId,
        mode,
      });
    },

    async image(path: string, width: number, height: number, time: number | undefined, mode: DecodeMode): Promise<RgbaImage | null> {
      const ref: MediaRef = { path };
      if (media.kindOf(ref) !== "av") return stills.rgba(ref, width, height);
      // A video mask or displacement map: this frame's picture, stretched.
      const picture = await frames.frame({ ref, sourceTime: time ?? 0, width, height, lane: `image:${path}`, mode });
      if (!picture) return null;
      try {
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));
        const { ctx } = createCanvas(w, h, true);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(picture.image, 0, 0, w, h);
        return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
      } finally {
        picture.release();
      }
    },

    text(path: string): Promise<string | null> {
      return media.text({ path });
    },

    ...(audio ? { audio: (request: LayerAudioRequest, lane: string): Promise<KernelAudio | null> => audio.read(request, lane) } : {}),
  };
}
