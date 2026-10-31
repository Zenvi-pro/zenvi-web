/**
 * Cuts on audio transients: every cut of a track, how far a roll edit can
 * move it, the transient it should land on, and the roll itself.
 *
 * A roll moves a cut without moving any footage on the timeline: the
 * outgoing clip's out point and the incoming clip's in point (and position)
 * move together, so the sequence keeps its length and every frame on either
 * side stays where it was. That is why an onset found in either clip's own
 * sound is still where it was after the move. The move is limited by the
 * media handles: the outgoing clip cannot play past the end of its file, the
 * incoming one cannot start before its first frame, and neither may shrink
 * below one frame.
 */

import type { Transaction } from "../history/document.js";
import type { Onset } from "../analysis/beats.js";
import { findFile } from "../model/query.js";
import type { Clip, Project } from "../model/types.js";
import { isAudioOnlyMedia } from "../model/media.js";
import { isRetimed } from "../tools/speech.js";
import { setClipTiming } from "./clips.js";
import { transitionsBetween } from "./sequence.js";

export interface Cut {
  outgoing: Clip;
  incoming: Clip;
  layer: number;
  /** Timeline seconds where the incoming clip starts. */
  at: number;
}

const fps = (project: Project) => (Number(project.fps?.num) || 30) / (Number(project.fps?.den) || 1);

/** Butt cuts between picture clips on `layers` (all tracks when absent), in time order per track. */
export function listCuts(project: Project, layers?: ReadonlySet<number>): Cut[] {
  const tol = 0.5 / fps(project);
  const byLayer = new Map<number, Clip[]>();
  for (const clip of project.clips) {
    if (layers && !layers.has(clip.layer)) continue;
    if (isAudioOnlyMedia(findFile(project, String(clip.file_id ?? "")))) continue;
    byLayer.set(clip.layer, [...(byLayer.get(clip.layer) ?? []), clip]);
  }
  const cuts: Cut[] = [];
  for (const [layer, clips] of [...byLayer].sort((a, b) => b[0] - a[0])) {
    clips.sort((a, b) => a.position - b.position);
    for (let i = 1; i < clips.length; i += 1) {
      const a = clips[i - 1]!;
      const b = clips[i]!;
      if (Math.abs(a.position + (a.end - a.start) - b.position) <= tol) cuts.push({ outgoing: a, incoming: b, layer, at: b.position });
    }
  }
  return cuts;
}

export type RollRange = { earliest: number; latest: number } | { blocked: string };

/**
 * How far (seconds, negative = earlier) a roll can move `cut`, or why it
 * cannot move. `outgoingTrim` is how much a roll of the cut before has
 * already moved the outgoing clip's in point later (it is shorter by that).
 */
export function rollRange(project: Project, cut: Cut, outgoingTrim = 0): RollRange {
  const frame = 1 / fps(project);
  const { outgoing: a, incoming: b } = cut;
  if (project.layers.some((l) => l.number === cut.layer && l.lock)) return { blocked: "the track is locked" };
  if (isRetimed(a as unknown as Record<string, unknown>) || isRetimed(b as unknown as Record<string, unknown>)) return { blocked: "a clip at the cut is retimed (speed or time curve)" };
  if (transitionsBetween(project, [a.id, b.id], frame / 2).length > 0) return { blocked: "a transition covers the cut" };
  const fileEnd = (clip: Clip) => {
    const file = findFile(project, String(clip.file_id ?? ""));
    const kind = String((file as { media_type?: unknown } | undefined)?.media_type ?? "");
    const duration = Number(file?.duration);
    return kind === "image" || !(duration > 0) ? Infinity : duration;
  };
  const earliest = Math.max(-b.start, -(a.end - a.start - outgoingTrim - frame));
  const latest = Math.min(fileEnd(a) - a.end, b.end - b.start - frame);
  return { earliest: Math.min(0, earliest), latest: Math.max(0, latest) };
}

/** Onsets as timeline seconds, given where their source plays: `position` shows source second `start`. */
export function onsetsOnTimeline(onsets: readonly Onset[], placement: { position: number; start: number }): Onset[] {
  return onsets.map((o) => ({ timeSec: placement.position + o.timeSec - placement.start, strength: o.strength }));
}

export interface SnapChoice {
  onset: Onset;
  /** Seconds the cut moves (negative = earlier), on the frame grid. */
  delta: number;
}

/**
 * The transient a cut lands on: the strongest onset within `tolerance`
 * seconds that the roll can reach (ties: the nearest), placed `lead` seconds
 * before the hit and snapped to the frame grid. Null when none qualifies.
 */
export function chooseOnset(
  project: Project,
  cut: Cut,
  onsets: readonly Onset[],
  range: { earliest: number; latest: number },
  options: { tolerance: number; minStrength: number; lead: number },
): SnapChoice | null {
  const rate = fps(project);
  let best: SnapChoice | null = null;
  for (const onset of onsets) {
    if (onset.strength < options.minStrength) continue;
    const target = Math.round((onset.timeSec - options.lead) * rate) / rate;
    const delta = Math.round((target - cut.at) * rate) / rate;
    if (Math.abs(delta) > options.tolerance + 1e-9 || delta < range.earliest - 1e-9 || delta > range.latest + 1e-9) continue;
    if (!best || onset.strength > best.onset.strength || (onset.strength === best.onset.strength && Math.abs(delta) < Math.abs(best.delta))) best = { onset, delta };
  }
  return best;
}

/** Roll `cut` by `delta` seconds: the outgoing out point and the incoming in point and position move together. */
export function rollCut(tx: Transaction, cut: Cut, delta: number): void {
  const a = tx.project.clips.find((c) => c.id === cut.outgoing.id)!;
  const b = tx.project.clips.find((c) => c.id === cut.incoming.id)!;
  setClipTiming(tx, a.id, { end: a.end + delta });
  setClipTiming(tx, b.id, { position: b.position + delta, start: b.start + delta });
}
