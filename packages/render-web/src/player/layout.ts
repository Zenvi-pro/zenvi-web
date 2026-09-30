/**
 * Preview geometry: the plan size for a canvas, and where the frame sits.
 */

import type { Viewport } from "../compositor/compositor.js";
import type { Size } from "../util/size-bucket.js";

/**
 * libopenshot `Timeline::SetMaxSize` (`Timeline.cpp:1860-1871`): the project
 * size scaled into the box with Qt's integer KeepAspectRatio math, never
 * larger than the project itself.
 */
export function previewPlanSize(project: Size, box: Size): Size {
  const W = Math.max(1, Math.round(project.width));
  const H = Math.max(1, Math.round(project.height));
  const w = Math.max(1, Math.min(Math.floor(box.width), W));
  const h = Math.max(1, Math.min(Math.floor(box.height), H));
  // QSize(W, H).scaled(w, h, Qt::KeepAspectRatio), libopenshot-semantics §0.
  const rw = Math.trunc((h * W) / H);
  if (rw <= w) return { width: Math.max(1, rw), height: h };
  return { width: w, height: Math.max(1, Math.trunc((w * H) / W)) };
}

/** The project frame fitted into the canvas, centered (letterboxed), as a plan → canvas viewport. */
export function fitViewport(canvas: Size, project: Size, plan: Size): Viewport {
  const byWidth = canvas.width / project.width;
  const byHeight = canvas.height / project.height;
  if (byWidth <= byHeight) {
    // Full width; bars above and below.
    return { x: 0, y: (canvas.height - project.height * byWidth) / 2, scale: canvas.width / plan.width };
  }
  return { x: (canvas.width - project.width * byHeight) / 2, y: 0, scale: canvas.height / plan.height };
}
