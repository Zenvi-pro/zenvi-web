/**
 * The default SVG rasterizer: the browser's own SVG renderer through an
 * `<img>` element. Main thread only (the one DOM dependency of media
 * decoding); a Worker compositor passes its own `SvgRasterizer`.
 */

import { type SvgRasterizer, withGenericFontFallbacks } from "./svg.js";

export function createImageElementSvgRasterizer(): SvgRasterizer {
  return async (svg, width, height) => {
    if (typeof Image === "undefined") {
      throw new Error("SVG rasterization needs the DOM; pass an svgRasterizer when running in a Worker");
    }
    const url = URL.createObjectURL(new Blob([withGenericFontFallbacks(await svg.text())], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      await image.decode();
      const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2D canvas context unavailable");
      // SVG images are re-rasterized at the destination size, so text and
      // edges stay sharp however far a title is scaled.
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.transferToImageBitmap();
    } finally {
      URL.revokeObjectURL(url);
    }
  };
}
