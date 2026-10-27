/**
 * The music bed's part in automatic sound design: the suck-out before the
 * drop and hype's pre-hit ducks (sfx/design.ts BedDip), written as volume
 * keyframes on the bed clip, the libopenshot `volume` curve the desktop
 * already plays (Clip.cpp applies it per frame, ramping across the frame's
 * samples). The clip remembers its curve from before (`zenvi_sfx_bed`), so
 * a rerun puts it back first instead of stacking dips; a curve edited since
 * is left alone.
 */

import type { Transaction } from "../history/document.js";
import { Interpolation, type Clip, type Keyframe, type Project } from "../model/types.js";
import { setClipKeyframes } from "../ops/clips.js";
import { patchClip } from "../ops/internal.js";
import type { BedDip } from "../sfx/design.js";
import { curvePoints, evaluateVolumeCurve, timelineToSourceFrame } from "./audio-mix.js";

export const BED_MARK = "zenvi_sfx_bed";

export interface SfxBedMark {
  /** The volume curve before the dips (null: the clip had no `volume`). */
  before: Keyframe | null;
  /** The curve as written, to tell whether someone edited it since. */
  after: Keyframe;
  dips: BedDip[];
}

export function readBedMark(clip: Clip): SfxBedMark | null {
  const mark = clip[BED_MARK] as Partial<SfxBedMark> | undefined;
  return mark && typeof mark === "object" && mark.after && Array.isArray(mark.dips) ? (mark as SfxBedMark) : null;
}

const sameCurve = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Put back the curve the last run replaced. "edited" when the curve changed
 * since (the dips stay, and new ones are not added on top), "none" when no
 * run left any.
 */
export function restoreBed(tx: Transaction, clip: Clip): "restored" | "edited" | "none" {
  const mark = readBedMark(clip);
  if (!mark) return "none";
  if (!sameCurve(clip.volume, mark.after)) return "edited";
  // A clip that had no curve gets none back, not an empty one.
  patchClip(tx, clip.id, { volume: mark.before ?? undefined, [BED_MARK]: undefined } as Partial<Clip>);
  return "restored";
}

/**
 * Dip the bed under each window: one frame down, held, one frame back
 * (CRAFT.md §3 suck-out: a 20 ms fall, a 10 ms return). Where two windows
 * overlap (a hero's room running into the next one's pre-hit duck) the
 * deeper wins; the curve's own points inside a window come down with it.
 * Returns the points written.
 */
export function applyBedDips(tx: Transaction, clipId: string, dips: readonly BedDip[], fps: { num: number; den: number }): number {
  const clip = tx.project.clips.find((c) => c.id === clipId);
  if (!clip) return 0;
  // Source frames [a, b) each dip holds.
  const windows = dips
    .map((dip) => ({ a: timelineToSourceFrame(dip.from, clip, fps), b: timelineToSourceFrame(dip.to, clip, fps), gain: 10 ** (dip.db / 20) }))
    .filter((w) => w.b > w.a);
  if (windows.length === 0) return 0;
  const before = clip.volume === undefined ? null : structuredClone(clip.volume);
  const existing = curvePoints(clip);
  const gainAt = (frame: number) => windows.reduce((g, w) => (frame >= w.a && frame < w.b ? Math.min(g, w.gain) : g), 1);
  const keys = new Set<number>(existing.map((p) => Math.round(p.co.X)));
  for (const w of windows) for (const frame of [w.a - 1, w.a, w.b - 1, w.b]) keys.add(frame);
  const frames = [...keys].filter((f) => f >= 1).sort((x, y) => x - y);
  const value = (frame: number) => Math.round(evaluateVolumeCurve(existing, frame, 1) * gainAt(frame) * 1e6) / 1e6;
  const updated = setClipKeyframes(tx, clipId, "volume", frames.map((frame) => ({ frame, value: value(frame), interpolation: Interpolation.LINEAR })), { mode: "replace" });
  const mark: SfxBedMark = { before, after: structuredClone(updated.volume), dips: [...dips] };
  patchClip(tx, clipId, { [BED_MARK]: mark } as Partial<Clip>);
  return frames.length;
}

/**
 * The project as it plays without the last run's dips (beds whose curve was
 * edited since keep it): what the mix pass measures under a rerun's cues, so
 * running it again lands the same levels. A copy; the project is untouched.
 */
export function withoutBedDips(project: Project): Project {
  const clips = project.clips.map((c) => {
    const mark = readBedMark(c);
    if (!mark || !sameCurve(c.volume, mark.after)) return c;
    const copy = { ...c, volume: mark.before } as Clip;
    if (mark.before === null) delete (copy as Partial<Clip>).volume;
    return copy;
  });
  return { ...project, clips };
}
