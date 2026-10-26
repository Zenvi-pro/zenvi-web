/**
 * Where a render with no explicit end stops. The desktop exports to the end
 * of the last item of any kind (`Timeline::GetMaxFrame`), so a sound effect
 * or music bed running past the last clip with a picture adds black frames at
 * the end of the video. Zenvi's video renders end with the last picture
 * instead and say how much sound they cut; audio renders, and timelines with
 * no picture at all, still run to the last item.
 */

import type { Clip, Project } from "../model/types.js";
import { itemEnd } from "./windows.js";
import { timelineEnd } from "./queries.js";

/** zenvi-core `_is_visual`: false for audio-only clips and clips whose picture is switched off. */
export function isVisualClip(clip: Clip): boolean {
  const reader = (clip.reader ?? {}) as Record<string, unknown>;
  if (reader.has_video === false || reader.media_type === "audio") return false;
  const hv = (clip as unknown as Record<string, unknown>).has_video as { Points?: { co?: { Y?: unknown } }[] } | undefined;
  const pts = hv && typeof hv === "object" ? (hv.Points ?? []) : [];
  if (pts.length === 1 && Number(pts[0]?.co?.Y ?? 1) === 0) return false;
  return true;
}

/** Timeline seconds where the last clip with a picture ends (0 when none has one). */
export function pictureEnd(project: Project): number {
  let end = 0;
  for (const clip of project.clips) if (isVisualClip(clip)) end = Math.max(end, itemEnd(clip));
  return end;
}

export interface ExportEnd {
  /** Seconds the render stops at. */
  end: number;
  /** Seconds where the last item of any kind ends (the desktop's export end). */
  contentEnd: number;
  /**
   * Seconds of sound after `end` that the render leaves out (0 when none).
   * Only clips without a picture count: a transition past the last picture is not sound.
   */
  audioCut: number;
}

/** The default end of a render; `picture` is false for audio-only formats. */
export function defaultExportEnd(project: Project, picture: boolean): ExportEnd {
  const contentEnd = timelineEnd(project);
  const visual = picture ? pictureEnd(project) : 0;
  const end = visual > 0 ? visual : contentEnd;
  let soundEnd = end;
  for (const clip of project.clips) if (!isVisualClip(clip)) soundEnd = Math.max(soundEnd, itemEnd(clip));
  // Under one millisecond is rounding, not sound anyone hears.
  const audioCut = soundEnd - end > 1e-3 ? soundEnd - end : 0;
  return { end, contentEnd, audioCut };
}

/**
 * The receipt line for a render that cut sound; `endArgument` names the
 * argument that keeps it on this surface ("end", "end_seconds", "--end").
 */
export function audioCutNote(cut: ExportEnd, endArgument?: string): string | null {
  if (cut.audioCut <= 0) return null;
  const to = (cut.end + cut.audioCut).toFixed(2);
  const keep = endArgument ? `pass ${endArgument}=${to}` : `render with an end of ${to}s`;
  return (
    `the video ends with the last picture at ${cut.end.toFixed(2)}s: ${cut.audioCut.toFixed(2)}s of sound after it ` +
    `(to ${to}s) is left out instead of playing over black; ${keep} to keep it`
  );
}
