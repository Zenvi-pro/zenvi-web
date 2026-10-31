/**
 * Every hit has a visible cause: cinetic's AV-sync audit (scripts/av-audit.py
 * and sound.md, MIT, (c) 2026 Leonxlnx) on Zenvi's sound effects. A hit is
 * where a sound-effect clip's transient plays (its file's recorded hit
 * point); a cause is something the eye sees change on that frame: a cut, a
 * clip arriving or leaving, a keyframe, a motion block's own event, or (on
 * a render) a jump in the picture. A hit more than one frame from every
 * cause reads as "sound first" or as a sound with nothing making it.
 */

import { isAudioOnlyMedia } from "../model/media.js";
import type { Project } from "../model/types.js";
import { readMotionEvents } from "../links/zenvi-link.js";
import { markOf } from "../tools/sfx-media.js";
import { fpsFloat } from "../timeline/time.js";
import type { PictureSeries } from "../tools/types.js";

export interface SfxHit {
  clipId: string;
  recipe: string;
  /** Timeline seconds of the transient. */
  time: number;
}

export interface SyncMiss extends SfxHit {
  /** Seconds to the nearest cause (positive: the picture comes after the sound); null when there is none. */
  offset: number | null;
}

/** Where every sound effect on the timeline hits. */
export function sfxHits(project: Project): SfxHit[] {
  const files = new Map(project.files.map((f) => [String(f.id), f]));
  const out: SfxHit[] = [];
  for (const clip of project.clips) {
    const file = files.get(String(clip.file_id));
    const mark = file ? markOf(file) : undefined;
    if (!mark || typeof mark.hit !== "number") continue;
    if (mark.hit < clip.start || mark.hit > clip.end) continue;
    out.push({ clipId: String(clip.id), recipe: String(mark.recipe ?? "sound"), time: clip.position + (mark.hit - clip.start) });
  }
  return out.sort((a, b) => a.time - b.time);
}

const KEYED = ["location_x", "location_y", "scale_x", "scale_y", "alpha", "rotation"] as const;

/** Timeline seconds where the picture visibly changes: clip edges, keyframes, motion block events. */
export function timelineCauses(project: Project): number[] {
  const rate = fpsFloat(project.fps);
  const files = new Map(project.files.map((f) => [String(f.id), f]));
  const out: number[] = [];
  for (const clip of project.clips) {
    const file = files.get(String(clip.file_id));
    if (file && isAudioOnlyMedia(file)) continue;
    out.push(clip.position, clip.position + (clip.end - clip.start));
    for (const k of KEYED) {
      const points = (clip[k] as { Points?: { co?: { X?: number } }[] } | undefined)?.Points ?? [];
      // Keyframe X is the clip's own frame, 1 at its first frame of source.
      if (points.length >= 2) for (const p of points) if (typeof p.co?.X === "number" && rate > 0) out.push(clip.position + (p.co.X - 1) / rate - clip.start);
    }
    const events = file ? readMotionEvents(file as unknown as Record<string, unknown>) : null;
    for (const e of events ?? []) if (e.t >= clip.start && e.t <= clip.end) out.push(clip.position + e.t - clip.start);
  }
  return out.sort((a, b) => a - b);
}

/** Seconds of a rendered file where the picture jumps: frames whose change stands well above the film's usual change. */
export function renderCauses(picture: PictureSeries, cuts: readonly number[] = []): number[] {
  const sorted = [...picture.motion].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const floor = Math.max(0.01, median * 3);
  const out = [...cuts];
  for (let i = 1; i < picture.motion.length - 1; i += 1) {
    const m = picture.motion[i]!;
    if (m >= floor && m >= picture.motion[i - 1]! && m >= picture.motion[i + 1]!) out.push(picture.t[i]!);
  }
  return out.sort((a, b) => a - b);
}

/** The hits with no cause within `tolerance` seconds (one frame by default). */
export function syncMisses(hits: readonly SfxHit[], causes: readonly number[], tolerance: number): SyncMiss[] {
  const out: SyncMiss[] = [];
  for (const h of hits) {
    let best: number | null = null;
    for (const c of causes) if (best === null || Math.abs(c - h.time) < Math.abs(best)) best = c - h.time;
    if (best === null || Math.abs(best) > tolerance + 1e-6) out.push({ ...h, offset: best === null ? null : Math.round(best * 1000) / 1000 });
  }
  return out;
}
