/**
 * `LayerResources` backed by the media registry: decoded video pictures from
 * a `FrameProvider`, stills and SVG from a `StillCache`, text from the
 * registry.
 */

import type { LayerPlan, RgbaImage } from "@zenvi/engine/render";
import type { MediaRef, MediaRegistry } from "../media/registry.js";
import type { StillCache } from "../media/stills.js";
import type { DecodeMode } from "../video/decode-cursor.js";
import type { FrameProvider } from "../video/frame-provider.js";
import type { FrameImage } from "../video/shared-bitmap.js";
import type { LayerResources } from "./compositor.js";

export interface MediaResourcesOptions {
  media: MediaRegistry;
  frames: FrameProvider;
  stills: StillCache;
}

export function mediaResources({ media, frames, stills }: MediaResourcesOptions): LayerResources {
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
    image(path: string, width: number, height: number): Promise<RgbaImage | null> {
      return stills.rgba({ path }, width, height);
    },
    text(path: string): Promise<string | null> {
      return media.text({ path });
    },
  };
}
