/**
 * Binding a preview to a canvas. The one DOM-aware part of the player: an
 * `HTMLCanvasElement` is sized to its CSS box in device pixels (so the frame
 * is sharp on HiDPI screens) and watched for layout changes. An
 * `OffscreenCanvas` (Worker) is used at whatever size its owner sets.
 */

import type { Size } from "../util/size-bucket.js";

export type PreviewCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface CanvasSurface {
  readonly ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  /** Backing store size in device pixels. */
  size(): Size;
  /** Called after the backing store was resized. */
  onResize(listener: () => void): () => void;
  dispose(): void;
}

export interface BindOptions {
  /** Whether the letterbox area is transparent (otherwise the canvas is opaque, which composites faster). */
  transparent: boolean;
}

function isElement(canvas: PreviewCanvas): canvas is HTMLCanvasElement {
  return typeof HTMLCanvasElement !== "undefined" && canvas instanceof HTMLCanvasElement;
}

export function bindCanvas(canvas: PreviewCanvas, options: BindOptions): CanvasSurface {
  const ctx = canvas.getContext("2d", { alpha: options.transparent }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error("Could not get a 2D context for the preview canvas");
  const listeners = new Set<() => void>();
  let observer: ResizeObserver | null = null;

  if (isElement(canvas) && typeof ResizeObserver !== "undefined") {
    const apply = (width: number, height: number) => {
      const w = Math.max(1, Math.round(width));
      const h = Math.max(1, Math.round(height));
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
      for (const listener of [...listeners]) listener();
    };
    observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      // Exact device pixels where supported; CSS pixels × DPR otherwise.
      const device = entry.devicePixelContentBoxSize?.[0];
      if (device) apply(device.inlineSize, device.blockSize);
      else apply(entry.contentRect.width * devicePixelRatio, entry.contentRect.height * devicePixelRatio);
    });
    try {
      observer.observe(canvas, { box: "device-pixel-content-box" });
    } catch {
      observer.observe(canvas);
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) apply(rect.width * devicePixelRatio, rect.height * devicePixelRatio);
  }

  return {
    ctx,
    size: () => ({ width: canvas.width, height: canvas.height }),
    onResize(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      observer?.disconnect();
      listeners.clear();
    },
  };
}
