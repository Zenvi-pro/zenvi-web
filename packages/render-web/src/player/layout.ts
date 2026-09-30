/**
 * Preview geometry: where the planned frame sits in the canvas. The plan's
 * own size comes from the planner (`planFrame(…, { preview: true })`).
 */

import type { Viewport } from "../compositor/compositor.js";
import type { Size } from "../util/size-bucket.js";

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
