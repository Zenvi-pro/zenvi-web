/**
 * The flashes an edit already has, as WCAG luminance changes (review/flashing.ts):
 * flash motion transitions and the short white/colour cards build_reel_tool
 * and match_cut_montage_tool lay over a cut. A tool that adds flashes counts
 * them first, so two calls cannot strobe together where neither does alone.
 */

import type { Project } from "../model/types.js";
import { listProjectMotionTransitions } from "../ops/motion-transitions.js";
import { rateOf } from "../ops/internal.js";
import type { MotionTransitionId } from "../transitions/motion/presets.js";

/** Motion transitions that flash the frame (white, black, inverted). */
export const FLASH_PRESETS: ReadonlySet<MotionTransitionId> = new Set<MotionTransitionId>(["flash_white", "flash_black", "flash_invert"]);

/** A colour card this short or shorter over the edit is a flash frame (review/timeline.ts FLASH_SECONDS). */
const CARD_SECONDS = 0.35;

/** The two changes of one flash: into it at `start`, back out `seconds` later. */
export function flashChanges(start: number, seconds: number): [number, number] {
  return [start, start + Math.max(seconds, 1e-3)];
}

/** The changes of a flash motion transition on a cut: it peaks on the cut and settles over the incoming half. */
export function transitionFlashChanges(cut: number, frames: number, fps: number): [number, number] {
  return flashChanges(cut, frames / 2 / fps);
}

/**
 * The flash changes on the timeline: flash motion transitions (but those on
 * cuts out of the clips in `skipOutClipIds`, which the caller is replacing)
 * and flash cards.
 */
export function timelineFlashChanges(project: Project, skipOutClipIds: ReadonlySet<string> = new Set()): number[] {
  const fps = rateOf(project);
  const out: number[] = [];
  for (const r of listProjectMotionTransitions(project)) {
    if (FLASH_PRESETS.has(r.preset) && !skipOutClipIds.has(r.outClipId)) out.push(...transitionFlashChanges(r.cut, r.frames, fps));
  }
  const files = new Map(project.files.map((f) => [String(f.id), String(f.path ?? "")]));
  for (const clip of project.clips) {
    const seconds = Number(clip.end) - Number(clip.start);
    if (!(seconds > 0 && seconds <= CARD_SECONDS)) continue;
    const path = files.get(String(clip.file_id)) ?? "";
    if (/(^|[\\/])Solid_Color[^\\/]*\.svg$|flash\.svg$/i.test(path)) out.push(...flashChanges(Number(clip.position), seconds));
  }
  return out.sort((a, b) => a - b);
}
