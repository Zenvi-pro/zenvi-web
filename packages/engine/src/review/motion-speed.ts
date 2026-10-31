/**
 * How fast things move on screen, from the clips' own keyframes (location,
 * scale): cinetic's speed measurement (scripts/measure-speed.py, MIT,
 * (c) 2026 Leonxlnx) read off the timeline instead of the pixels. Its
 * numbers are pixels per frame at 1920x1080 and 60 fps:
 *
 * - over 12 px/f a move strobes without true motion blur (the finish pass);
 * - over 80 px/f it smears into stepped copies even with blur: redesign it
 *   as a cut, a match cut, a mask wipe or a shorter move (frame-filling
 *   edges and motion transitions are allowed more);
 * - readable text travels at most 20 px/f.
 *
 * Speeds here are those numbers, whatever the project's size and rate.
 */

import { readFxLink } from "../fx/link.js";
import { evaluate } from "../keyframe/evaluate.js";
import { isAudioOnlyMedia } from "../model/media.js";
import type { Clip, Project } from "../model/types.js";
import { listProjectMotionTransitions } from "../ops/motion-transitions.js";
import { fpsFloat } from "../timeline/time.js";
import { frameWindow } from "../timeline/windows.js";

export const BLUR_PX_PER_FRAME = 12;
export const CEILING_PX_PER_FRAME = 80;
export const TEXT_PX_PER_FRAME = 20;
/** cinetic's reference raster: speeds are reported in its pixels and frames. */
const REF_HEIGHT = 1080;
const REF_FPS = 60;

export interface ClipSpeed {
  clipId: string;
  /** Fastest edge speed, px per frame at 1080p / 60 fps. */
  peak: number;
  /** Timeline seconds of the peak. */
  at: number;
  text: boolean;
  /** Motion blur is baked into its picture (apply_fx_tool directional_blur / radial_blur). */
  blurred: boolean;
}

const MOVING = ["location_x", "location_y", "scale_x", "scale_y"] as const;

function animated(clip: Clip): boolean {
  return MOVING.some((k) => ((clip[k] as { Points?: unknown[] } | undefined)?.Points?.length ?? 0) >= 2);
}

/**
 * The peak speed of every visual clip whose own keyframes move it, fastest
 * first. Location is a fraction of the frame (libopenshot), so a step of
 * 0.01 is 1 % of the width; a scale step moves the frame's edges by half
 * of it. Moves inside a motion transition's window are its own and left out.
 */
export function clipSpeeds(project: Project, textClipIds: ReadonlySet<string> = new Set()): ClipSpeed[] {
  const rate = fpsFloat(project.fps);
  if (!(rate > 0)) return [];
  const files = new Map(project.files.map((f) => [String(f.id), f]));
  const transitions = listProjectMotionTransitions(project).map((t) => ({ from: t.cut - t.frames / rate / 2, to: t.cut + t.frames / rate / 2 }));
  // A step of 1 px per frame here, in reference pixels per reference frame.
  const perFrame = (REF_HEIGHT / Math.max(1, project.height)) * (rate / REF_FPS);
  const out: ClipSpeed[] = [];
  for (const clip of project.clips) {
    const file = files.get(String(clip.file_id));
    if ((file && isAudioOnlyMedia(file)) || !animated(clip)) continue;
    // A clip whose picture is a Zenvi FX render with motion blur baked in has had its finish pass.
    const blurred = ((readFxLink(file)?.effects ?? []) as { effect?: string }[]).some((e) => e.effect === "directional_blur" || e.effect === "radial_blur");
    const w = frameWindow(clip, project.fps);
    let peak = 0;
    let at = 0;
    const sample = (frame: number) => {
      const local = frame - w.startFrame + w.localStartFrame;
      return MOVING.map((k) => evaluate(clip[k], local, k.startsWith("scale") ? 1 : 0));
    };
    let prev = sample(w.startFrame);
    for (let f = w.startFrame + 1; f <= w.endFrame; f += 1) {
      const cur = sample(f);
      const t = (f - 1) / rate;
      if (!transitions.some((x) => t >= x.from && t <= x.to)) {
        const px = Math.max(Math.abs(cur[0]! - prev[0]!) * project.width, Math.abs(cur[1]! - prev[1]!) * project.height, (Math.abs(cur[2]! - prev[2]!) * project.width) / 2, (Math.abs(cur[3]! - prev[3]!) * project.height) / 2);
        const speed = px * perFrame;
        if (speed > peak) {
          peak = speed;
          at = t;
        }
      }
      prev = cur;
    }
    if (peak > 0) out.push({ clipId: String(clip.id), peak: Math.round(peak * 10) / 10, at: Math.round(at * 100) / 100, text: textClipIds.has(String(clip.id)), blurred });
  }
  return out.sort((a, b) => b.peak - a.peak);
}
