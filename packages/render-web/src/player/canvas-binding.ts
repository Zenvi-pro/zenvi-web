/**
 * Binding a preview to a canvas. The one DOM-aware part of the player: an
 * `HTMLCanvasElement` is sized to its CSS box in device pixels (so the frame
 * is sharp on HiDPI screens) and watched for layout changes. An
 * `OffscreenCanvas` (Worker) is used at whatever size its owner sets
 * (`resize`).
 */

import type { Size } from "../util/size-bucket.js";

export type PreviewCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface CanvasSurface {
  readonly ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  readonly canvas: PreviewCanvas;
  /** Backing store size in device pixels. */
  size(): Size;
  /** Set the backing store size (an `OffscreenCanvas` follows its page-side element this way). */
  resize(width: number, height: number): void;
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
  const resize = (width: number, height: number) => {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    for (const listener of [...listeners]) listener();
  };
  const unobserve = isElement(canvas) ? observeDeviceSize(canvas, resize) : () => undefined;

  return {
    ctx,
    canvas,
    size: () => ({ width: canvas.width, height: canvas.height }),
    resize,
    onResize(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      unobserve();
      listeners.clear();
    },
  };
}

/**
 * Call `onSize` with `element`'s CSS box in device pixels now and after every
 * layout change. Also used for a canvas whose pixels a Worker draws.
 */
export function observeDeviceSize(element: HTMLCanvasElement, onSize: (width: number, height: number) => void): () => void {
  if (typeof ResizeObserver === "undefined") return () => undefined;
  const observer = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (!entry) return;
    // Exact device pixels where supported; CSS pixels × DPR otherwise.
    const device = entry.devicePixelContentBoxSize?.[0];
    if (device) onSize(device.inlineSize, device.blockSize);
    else onSize(entry.contentRect.width * devicePixelRatio, entry.contentRect.height * devicePixelRatio);
  });
  try {
    observer.observe(element, { box: "device-pixel-content-box" });
  } catch {
    observer.observe(element);
  }
  const rect = element.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) onSize(rect.width * devicePixelRatio, rect.height * devicePixelRatio);
  return () => observer.disconnect();
}
