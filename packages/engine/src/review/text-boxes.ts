/**
 * Where a title's words land in the frame, estimated from its SVG (the same
 * rough text widths the title tools fit with) and the clip's scale and
 * location keyframes. An estimate: no font metrics, rotation ignored. Used
 * to flag text outside the safe area, never to move anything.
 */

import type { Clip, Project } from "../model/types.js";
import { ScaleMode } from "../model/types.js";
import { evaluate } from "../keyframe/evaluate.js";
import { artboardSize, estimatedTextWidth, parseTitleSvg, titleFields } from "../titles/title-svg.js";
import { frameWindow } from "../timeline/windows.js";
import type { TextBox } from "./types.js";

/** Text box of one title clip, or none when the SVG has no placed text. */
export function titleTextBoxes(project: Project, clip: Clip, svg: string): TextBox[] {
  let fields;
  let artboard: [number, number];
  try {
    const doc = parseTitleSvg(svg);
    fields = titleFields(doc);
    artboard = artboardSize(doc);
  } catch {
    return [];
  }
  const [aw, ah] = artboard;
  const pw = project.width;
  const ph = project.height;
  const fit = Math.min(pw / aw, ph / ah);
  const [fx, fy] =
    clip.scale === ScaleMode.STRETCH ? [pw / aw, ph / ah] : clip.scale === ScaleMode.NONE ? [1, 1] : clip.scale === ScaleMode.CROP ? [Math.max(pw / aw, ph / ah), Math.max(pw / aw, ph / ah)] : [fit, fit];

  // Keyframes are evaluated halfway through the clip, where an entrance has settled.
  const window = frameWindow(clip, project.fps);
  const middle = Math.round((window.startFrame + window.endFrame) / 2) - window.startFrame + window.localStartFrame;
  const sx = evaluate(clip.scale_x, middle, 1);
  const sy = evaluate(clip.scale_y, middle, 1);
  const lx = evaluate(clip.location_x, middle, 0);
  const ly = evaluate(clip.location_y, middle, 0);

  const boxes: TextBox[] = [];
  for (const field of fields) {
    const size = field.fontSize;
    if (!size || field.y === null || !field.text.trim()) continue;
    const x = field.x ?? aw / 2;
    const width = estimatedTextWidth(field.text.trim(), size);
    const left = field.anchor === "middle" ? x - width / 2 : field.anchor === "end" ? x - width : x;
    const toX = (v: number): number => 0.5 + ((v - aw / 2) * fx * sx) / pw + lx;
    const toY = (v: number): number => 0.5 + ((v - ah / 2) * fy * sy) / ph + ly;
    boxes.push({ clipId: String(clip.id), x0: toX(left), x1: toX(left + width), y0: toY(field.y - size * 0.8), y1: toY(field.y + size * 0.25) });
  }
  return boxes;
}
