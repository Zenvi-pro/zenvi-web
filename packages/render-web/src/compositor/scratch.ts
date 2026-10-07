/**
 * Reusable offscreen canvases for per-layer pixel work.
 *
 * Canvases that are read back (`getImageData`) are created with
 * `willReadFrequently`, which keeps them in CPU memory: readback then costs a
 * copy instead of a GPU pipeline stall. They are reused across frames; only a
 * size change reallocates.
 */

export type Context2D = OffscreenCanvasRenderingContext2D;

export interface Scratch {
  canvas: OffscreenCanvas;
  ctx: Context2D;
}

export function createCanvas(width: number, height: number, readback: boolean): Scratch {
  if (typeof OffscreenCanvas === "undefined") throw new Error("OffscreenCanvas is required");
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  const ctx = canvas.getContext("2d", readback ? { willReadFrequently: true } : {});
  if (!ctx) throw new Error("2D canvas context unavailable");
  return { canvas, ctx };
}

export class ScratchPool {
  private readonly canvases = new Map<string, Scratch>();

  /** A cleared canvas of exactly `width × height` for `role`, with an identity transform. */
  get(role: string, width: number, height: number): Scratch {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    let scratch = this.canvases.get(role);
    if (!scratch) {
      scratch = createCanvas(w, h, true);
      this.canvases.set(role, scratch);
    } else if (scratch.canvas.width !== w || scratch.canvas.height !== h) {
      // Resizing resets the context state and clears the bitmap.
      scratch.canvas.width = w;
      scratch.canvas.height = h;
    }
    const { ctx } = scratch;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, w, h);
    return scratch;
  }

  clear(): void {
    for (const { canvas } of this.canvases.values()) {
      canvas.width = 1;
      canvas.height = 1;
    }
    this.canvases.clear();
  }
}
