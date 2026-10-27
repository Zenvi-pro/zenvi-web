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
import { Interpolation, type Clip, type Keyframe } from "../model/types.js";
import { setClipKeyframes } from "../ops/clips.js";
import { patchClip } from "../ops/internal.js";
import type { BedDip } from "../sfx/design.js";
import { curvePoints, evaluateVolumeCurve, timelineToSourceFrame } from "./audio-mix.js";

export const BED_MARK = "zenvi_sfx_bed";

export interface SfxBedMark {
  /** The volume curve before the dips (null: the clip had none). */
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
  patchClip(tx, clip.id, { volume: mark.before ?? { Points: [] }, [BED_MARK]: undefined } as Partial<Clip>);
  return "restored";
}

/** Dip the bed under each window: one frame down, held, one frame back (CRAFT.md §3 suck-out: a 20 ms fall, a 10 ms return). Returns the points written. */
export function applyBedDips(tx: Transaction, clipId: string, dips: readonly BedDip[], fps: { num: number; den: number }): number {
  const clip = tx.project.clips.find((c) => c.id === clipId);
  if (!clip || dips.length === 0) return 0;
  const before = clip.volume && Array.isArray(clip.volume.Points) && clip.volume.Points.length > 0 ? structuredClone(clip.volume) : null;
  const existing = curvePoints(clip);
  const base = (frame: number) => evaluateVolumeCurve(existing, frame, 1);
  const values = new Map<number, number>(existing.map((p) => [Math.round(p.co.X), p.co.Y]));
  const dipped = new Set<number>();
  for (const dip of dips) {
    const gain = 10 ** (dip.db / 20);
    const a = timelineToSourceFrame(dip.from, clip, fps);
    const b = timelineToSourceFrame(dip.to, clip, fps);
    if (b <= a) continue;
    if (!dipped.has(a - 1)) values.set(a - 1, base(a - 1));
    for (const frame of [a, b - 1]) {
      values.set(frame, base(frame) * gain);
      dipped.add(frame);
    }
    if (!dipped.has(b)) values.set(b, base(b));
  }
  const frames = [...values.keys()].filter((f) => f >= 1).sort((x, y) => x - y);
  const updated = setClipKeyframes(tx, clipId, "volume", frames.map((frame) => ({ frame, value: Math.round(values.get(frame)! * 1e6) / 1e6, interpolation: Interpolation.LINEAR })), { mode: "replace" });
  const mark: SfxBedMark = { before, after: structuredClone(updated.volume), dips: [...dips] };
  patchClip(tx, clipId, { [BED_MARK]: mark } as Partial<Clip>);
  return frames.length;
}
