/**
 * What to put in place of a repeated shot: the fix a review hands back as a
 * call the agent can make (swap_shot_tool), not "use more footage".
 *
 * A bin clip no shot uses comes first (a new picture beats a new moment of
 * an old one), then a stretch of the shot's own file no shot shows yet,
 * starting a third of the way into the free stretch (stock often opens on a
 * rack focus or a shake, as reels/plan.ts says). Nothing is suggested when
 * neither is left: then the fix is more footage. Pure: the project and its
 * timeline review in, suggestions out.
 */

import type { Project, ProjectFile } from "../model/types.js";
import { getMediaType } from "../model/media.js";
import type { TimelineReview } from "./types.js";

/** Bin files the tools make (mattes, caption drawings, composites, sound effects): not footage to cut to. */
const GENERATED_KEYS = ["zenvi_matte", "zenvi_kinetic_captions", "zenvi_composite_asset", "zenvi_role"] as const;
/** Least distance, source seconds, between a suggested stretch and any stretch already shown. */
const SOURCE_MARGIN = 0.25;

export interface ShotSwap {
  /** The timeline clip to change and where its shot starts. */
  clip_id: string;
  at: number;
  /** What it shows now. */
  file_id: string;
  name: string;
  /** What to show instead: a bin file and its source in-point (the clip keeps its length and place). */
  to_file_id: string;
  to_name: string;
  start_seconds: number;
  why: "unused clip" | "unused part of the same clip";
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** A bin file that is picture someone shot or imported: video or a still, not a generated title, matte or drawing. */
export function isFootageFile(file: ProjectFile): boolean {
  const path = String(file.path ?? "");
  if (/\.(svg|html?)$/i.test(path)) return false;
  if (GENERATED_KEYS.some((key) => (file as Record<string, unknown>)[key] !== undefined)) return false;
  const type = getMediaType({ path, has_video: file.has_video, has_audio: file.has_audio }, String(file.name ?? ""));
  return type === "video" || type === "image";
}

/** A file as the reviews name it: its name, else its path's last part. */
export function fileLabel(file: ProjectFile): string {
  return String(file.name || String(file.path ?? "").split(/[\\/]/).pop() || file.id);
}

function isStill(file: ProjectFile): boolean {
  return getMediaType({ path: file.path, has_video: file.has_video, has_audio: file.has_audio }, String(file.name ?? "")) === "image" || file.has_single_image === true;
}

/**
 * The in-point of a `length`-second stretch of a `duration`-second file that
 * keeps SOURCE_MARGIN clear of every `used` stretch, a third of the way into
 * the first free gap long enough; null when there is none.
 */
export function freeInPoint(duration: number, used: readonly [number, number][], length: number): number | null {
  const taken = [...used].map(([a, b]): [number, number] => [a - SOURCE_MARGIN, b + SOURCE_MARGIN]).sort((x, y) => x[0] - y[0]);
  let from = 0;
  for (const [a, b] of [...taken, [duration, duration] as [number, number]]) {
    const to = Math.min(a, duration);
    if (to - from >= length) return round3(from + (to - from - length) * 0.3);
    from = Math.max(from, b);
  }
  return null;
}

/**
 * One swap per shot in `toFix` (`ReviewShot.index`es), in time order,
 * each with a different replacement. Shots with nothing left to swap in are
 * left out.
 */
export function swapSuggestions(project: Project, review: TimelineReview, toFix: readonly number[]): ShotSwap[] {
  const files = new Map((project.files ?? []).map((f) => [String(f.id), f]));
  const onTimeline = new Set((project.clips ?? []).map((c) => String(c.file_id)));
  const unused = (project.files ?? []).filter((f) => isFootageFile(f) && !onTimeline.has(String(f.id)));
  // Source stretches each file shows, growing as suggestions take more.
  const shown = new Map<string, [number, number][]>();
  for (const s of review.shots) shown.set(s.fileId, [...(shown.get(s.fileId) ?? []), [s.sourceStart, s.sourceEnd]]);

  const out: ShotSwap[] = [];
  const wanted = new Set(toFix);
  const shots = review.shots.filter((s) => wanted.has(s.index)).sort((a, b) => a.start - b.start);
  for (const shot of shots) {
    // The swap changes the whole clip, which may run on under other shots.
    const clip = (project.clips ?? []).find((c) => String(c.id) === shot.clipId);
    const length = clip ? Number(clip.end) - Number(clip.start) : shot.sourceEnd - shot.sourceStart;
    let swap: Pick<ShotSwap, "to_file_id" | "to_name" | "start_seconds" | "why"> | null = null;
    const fresh = unused.findIndex((f) => isStill(f) || (Number(f.duration) || 0) >= length);
    if (fresh >= 0) {
      const file = unused.splice(fresh, 1)[0]!;
      const start = isStill(file) ? 0 : (freeInPoint(Number(file.duration), [], length) ?? 0);
      swap = { to_file_id: String(file.id), to_name: fileLabel(file), start_seconds: start, why: "unused clip" };
    } else {
      const file = files.get(shot.fileId);
      const start = file && !isStill(file) ? freeInPoint(Number(file.duration) || 0, shown.get(shot.fileId) ?? [], length) : null;
      if (start !== null) swap = { to_file_id: shot.fileId, to_name: shot.name, start_seconds: start, why: "unused part of the same clip" };
    }
    if (!swap) continue;
    shown.set(swap.to_file_id, [...(shown.get(swap.to_file_id) ?? []), [swap.start_seconds, swap.start_seconds + length]]);
    out.push({ clip_id: shot.clipId, at: shot.start, file_id: shot.fileId, name: shot.name, ...swap });
  }
  return out;
}
