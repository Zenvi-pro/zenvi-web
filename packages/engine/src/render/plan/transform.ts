/**
 * `Clip::get_transform` (libopenshot src/Clip.cpp:1544-1739): the QTransform
 * that draws a clip's source image onto the timeline canvas. float locals
 * and the Qt call order are kept so the matrix is bit-identical to the
 * desktop's (spec §2.3.2).
 */

import { evaluate } from "../../keyframe/evaluate.js";
import { resolvePoints } from "../../keyframe/points.js";
import type { Clip, Fraction } from "../../model/types.js";
import { Gravity, ScaleMode } from "../../model/types.js";
import { fmaf } from "../qt/fma.js";
import { QTransform } from "../qt/transform.js";
import { scaleSize } from "./reader.js";

const f32 = Math.fround;

function isNear(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.000001;
}

/**
 * A clip keyframe at clip frame `n`. Missing keys use the Clip constructor
 * default (Clip.cpp:79-138); `repairEmpty` restores the default for an empty
 * keyframe like `ensure_default_keyframe` (Clip.cpp:1156-1164) — other empty
 * keyframes evaluate to 0, as in libopenshot.
 */
export function clipValue(clip: Clip, key: string, n: number, fallback: number, repairEmpty = false): number {
  const kf = clip[key];
  if (kf === undefined || kf === null) return fallback;
  if (repairEmpty && resolvePoints(kf as never).length === 0) return fallback;
  return evaluate(kf as never, n);
}

const REPAIRED = new Set(["scale_x", "scale_y", "location_x", "location_y", "origin_x", "origin_y", "rotation", "corner_radius", "margin"]);

/** Transform keyframes with their constructor defaults. */
export function clipKeyframe(clip: Clip, key: string, n: number): number {
  const defaults: Record<string, number> = {
    scale_x: 1,
    scale_y: 1,
    location_x: 0,
    location_y: 0,
    origin_x: 0.5,
    origin_y: 0.5,
    rotation: 0,
    shear_x: 0,
    shear_y: 0,
    alpha: 1,
    corner_radius: 0,
    margin: 0,
  };
  return clipValue(clip, key, n, defaults[key] ?? 0, REPAIRED.has(key));
}

export interface ParentClip {
  clip: Clip;
}

/**
 * Build the clip transform for a source image of `srcW`×`srcH` on a
 * `width`×`height` canvas at clip frame `n`. `parent` is the clip named by
 * `parentObjectId`, if it resolves to a clip (tracked objects need OpenCV
 * data and are ignored).
 */
export function clipTransform(
  clip: Clip,
  n: number,
  srcW: number,
  srcH: number,
  width: number,
  height: number,
  fps: Fraction,
  parent?: Clip,
): QTransform {
  const margin = Math.max(0, Math.min(0.5, clipKeyframe(clip, "margin", n)));
  const marginPx = margin * Math.min(width, height);
  const layoutX = marginPx;
  const layoutY = marginPx;
  const layoutW = Math.max(1, width - marginPx * 2);
  const layoutH = Math.max(1, height - marginPx * 2);
  const scale = clip.scale ?? ScaleMode.FIT;
  const size = scaleSize(srcW, srcH, scale, Math.trunc(layoutW), Math.trunc(layoutH));

  let pLx = 0;
  let pLy = 0;
  let pSx = 1;
  let pSy = 1;
  let pShx = 0;
  let pShy = 0;
  let pR = 0;
  if (parent) {
    // `long parent_start_offset = Start() * info.fps.ToDouble()` truncates.
    const offset = Math.trunc(f32(parent.start) * (fps.num / fps.den));
    const pf = n + offset;
    pLx = f32(clipKeyframe(parent, "location_x", pf));
    pLy = f32(clipKeyframe(parent, "location_y", pf));
    pSx = f32(clipKeyframe(parent, "scale_x", pf));
    pSy = f32(clipKeyframe(parent, "scale_y", pf));
    pShx = f32(clipKeyframe(parent, "shear_x", pf));
    pShy = f32(clipKeyframe(parent, "shear_y", pf));
    pR = f32(clipKeyframe(parent, "rotation", pf));
  }

  let sx = f32(clipKeyframe(clip, "scale_x", n));
  let sy = f32(clipKeyframe(clip, "scale_y", n));
  if (pSx !== 0 && pSy !== 0) {
    sx = f32(sx * pSx);
    sy = f32(sy * pSy);
  }
  const ssw = f32(size.width * sx);
  const ssh = f32(size.height * sy);

  let x = 0;
  let y = 0;
  const cx = (): number => f32(layoutX + (layoutW - ssw) / 2);
  const cy = (): number => f32(layoutY + (layoutH - ssh) / 2);
  const rx = (): number => f32(layoutX + layoutW - ssw);
  const by = (): number => f32(layoutY + (layoutH - ssh));
  switch (clip.gravity ?? Gravity.CENTER) {
    case Gravity.TOP_LEFT:
      x = f32(layoutX);
      y = f32(layoutY);
      break;
    case Gravity.TOP:
      x = cx();
      y = f32(layoutY);
      break;
    case Gravity.TOP_RIGHT:
      x = rx();
      y = f32(layoutY);
      break;
    case Gravity.LEFT:
      x = f32(layoutX);
      y = cy();
      break;
    case Gravity.CENTER:
      x = cx();
      y = cy();
      break;
    case Gravity.RIGHT:
      x = rx();
      y = cy();
      break;
    case Gravity.BOTTOM_LEFT:
      x = f32(layoutX);
      y = by();
      break;
    case Gravity.BOTTOM:
      x = cx();
      y = by();
      break;
    case Gravity.BOTTOM_RIGHT:
      x = rx();
      y = by();
      break;
  }

  const r = f32(clipKeyframe(clip, "rotation", n) + pR);
  const lx = f32(clipKeyframe(clip, "location_x", n) + pLx);
  const ly = f32(clipKeyframe(clip, "location_y", n) + pLy);
  const locationOffset = (location: number, anchored: number, canvas: number, clipSize: number): number =>
    location < 0 ? f32(location * f32(anchored + clipSize)) : f32(location * f32(canvas - anchored));
  if (scale === ScaleMode.CROP) {
    x = f32(x + locationOffset(lx, f32(x - layoutX), f32(layoutW), ssw));
    y = f32(y + locationOffset(ly, f32(y - layoutY), f32(layoutH), ssh));
  } else {
    // `x += width * lx` in float, contracted to one fmadd (Clip.cpp get_transform).
    x = fmaf(width, lx, x);
    y = fmaf(height, ly, y);
  }
  const shx = f32(clipKeyframe(clip, "shear_x", n) + pShx);
  const shy = f32(clipKeyframe(clip, "shear_y", n) + pShy);
  const ox = f32(clipKeyframe(clip, "origin_x", n));
  const oy = f32(clipKeyframe(clip, "origin_y", n));

  const t = new QTransform();
  if (!isNear(x, 0) || !isNear(y, 0)) t.translate(x, y);
  if (!isNear(r, 0) || !isNear(shx, 0) || !isNear(shy, 0)) {
    const oxo = f32(ssw * ox);
    const oyo = f32(ssh * oy);
    t.translate(oxo, oyo);
    t.rotate(r);
    t.shear(shx, shy);
    t.translate(-oxo, -oyo);
  }
  const sws = f32(f32(f32(size.width) / f32(srcW)) * sx);
  const shs = f32(f32(f32(size.height) / f32(srcH)) * sy);
  if (!isNear(sws, 1) || !isNear(shs, 1)) t.scale(sws, shs);
  return t;
}
