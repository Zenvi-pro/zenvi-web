/**
 * `TextRasterizer` on Canvas2D, for the engine's Caption and Timer kernels.
 *
 * The engine does all layout (wrapping, alignment, backgrounds, fades) and
 * asks only for metrics and glyphs. Glyphs come from the browser's font
 * engine, so text matches the desktop in layout, not pixel for pixel
 * (libopenshot-semantics §8.1). Works in Workers (OffscreenCanvas).
 */

import type { RGBA, RgbaImage, TextFont, TextRasterizer, TextRect } from "@zenvi/engine/render";
import { createCanvas, type Scratch } from "./scratch.js";

const GENERIC: Record<string, string> = {
  sans: "sans-serif",
  "sans-serif": "sans-serif",
  serif: "serif",
  mono: "monospace",
  monospace: "monospace",
  cursive: "cursive",
  fantasy: "fantasy",
};

/** A CSS font shorthand for a Qt family name and pixel size. */
export function cssFont(font: TextFont): string {
  const size = Math.max(1, font.pixelSize);
  const family = font.family.trim();
  const generic = GENERIC[family.toLowerCase()];
  const families = generic ?? `"${family.replace(/["\\]/g, "")}", sans-serif`;
  return `${size}px ${families}`;
}

function css(color: RGBA): string {
  const [r, g, b, a] = color;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(255, a)) / 255})`;
}

export class CanvasTextRasterizer implements TextRasterizer {
  private readonly measure: Scratch = createCanvas(1, 1, false);
  private readonly draw: Scratch = createCanvas(1, 1, true);

  fontMetrics(font: TextFont): { ascent: number; descent: number; lineSpacing: number } {
    const m = this.metricsOf("Hg", font);
    const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent;
    const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent;
    return { ascent, descent, lineSpacing: ascent + descent };
  }

  advance(text: string, font: TextFont): number {
    return this.metricsOf(text, font).width;
  }

  bounds(text: string, font: TextFont): TextRect {
    const m = this.metricsOf(text, font);
    const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent;
    const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent;
    return { x: Math.min(0, -m.actualBoundingBoxLeft), y: -ascent, width: Math.max(m.width, m.actualBoundingBoxRight), height: ascent + descent };
  }

  inkBounds(text: string, font: TextFont): TextRect {
    const m = this.metricsOf(text, font);
    return {
      x: -m.actualBoundingBoxLeft,
      y: -m.actualBoundingBoxAscent,
      width: m.actualBoundingBoxLeft + m.actualBoundingBoxRight,
      height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
    };
  }

  drawText(target: RgbaImage, text: string, x: number, y: number, font: TextFont, fill: RGBA, stroke: RGBA | null, strokeWidth: number, clip?: TextRect): void {
    if (!text) return;
    // Only the pixels the glyphs can touch round-trip through the canvas.
    const ink = this.inkBounds(text, font);
    const pad = Math.ceil(Math.max(0, strokeWidth)) + 2;
    let left = Math.floor(x + ink.x) - pad;
    let top = Math.floor(y + ink.y) - pad;
    let right = Math.ceil(x + ink.x + ink.width) + pad;
    let bottom = Math.ceil(y + ink.y + ink.height) + pad;
    if (clip) {
      left = Math.max(left, Math.floor(clip.x));
      top = Math.max(top, Math.floor(clip.y));
      right = Math.min(right, Math.ceil(clip.x + clip.width));
      bottom = Math.min(bottom, Math.ceil(clip.y + clip.height));
    }
    left = Math.max(0, left);
    top = Math.max(0, top);
    right = Math.min(target.width, right);
    bottom = Math.min(target.height, bottom);
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) return;

    const { canvas, ctx } = this.draw;
    if (canvas.width < width || canvas.height < height) {
      canvas.width = Math.max(canvas.width, width);
      canvas.height = Math.max(canvas.height, height);
    }
    const region = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row += 1) {
      const from = ((top + row) * target.width + left) * 4;
      region.set(target.data.subarray(from, from + width * 4), row * width * 4);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(new ImageData(region, width, height), 0, 0);
    // The region is already inside `clip`; copying back only the region clips.
    ctx.font = cssFont(font);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = css(fill);
    ctx.fillText(text, x - left, y - top);
    if (stroke && strokeWidth > 0) {
      ctx.lineWidth = strokeWidth;
      ctx.lineJoin = "bevel";
      ctx.lineCap = "square";
      ctx.strokeStyle = css(stroke);
      ctx.strokeText(text, x - left, y - top);
    }
    const drawn = ctx.getImageData(0, 0, width, height).data;
    for (let row = 0; row < height; row += 1) {
      const to = ((top + row) * target.width + left) * 4;
      target.data.set(drawn.subarray(row * width * 4, (row + 1) * width * 4), to);
    }
  }

  private metricsOf(text: string, font: TextFont): TextMetrics {
    const { ctx } = this.measure;
    ctx.font = cssFont(font);
    return ctx.measureText(text);
  }
}
