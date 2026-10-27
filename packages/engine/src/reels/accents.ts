/**
 * Accents on a planned reel's cuts: which cuts flash white, which carry a
 * motion transition, and which shot ramps into the drop. Pure, like
 * plan.ts, so the edit is testable without a project.
 *
 * From the hype references (Dc_2Y1qI0ZH, Dc_iT1AqlyB, DcfH_-aRlVg,
 * DdNDNt0PxMb): flashes are punctuation that open a section (the body, the
 * drop, the payoff), not a strobe; the drop hits with a glitch; the climax's
 * bar lines alternate negative and glitch hits; the body whips on every
 * other bar line; everything else is a hard cut. Moves keep one direction for the whole reel and the pull-back (an
 * arrival) is spent once, on the last cut: the vector law of HeyGen
 * HyperFrames' motion doctrine (Apache-2.0, .claude/skills/motion-doctrine/
 * SKILL.md), as in transitions/motion/styles.ts. Directions themselves are
 * resolved when the transitions are applied (`direction: "auto"` keeps the
 * track's current).
 */

import { defaultFrames, type MotionTransitionId } from "../transitions/motion/presets.js";
import type { PlannedShot, ReelPlan } from "./plan.js";
import type { ReelStyle } from "./styles.js";

export interface AccentTransition {
  /** The shot the cut leads into (the cut is at its start). */
  shot: number;
  preset: MotionTransitionId;
  /** Moving frames: the preset's length, shortened to fit both shots. */
  frames: number;
}

export interface ReelAccents {
  /** Shots whose cut flashes white. */
  flashes: number[];
  transitions: AccentTransition[];
  /** The shot that ramps from slow motion into a rush, ending on the drop, or null. */
  ramp: number | null;
}

/** Shortest a shot may be, frames, for a transition to take frames of it (a moving frame and a rest frame). */
const MIN_FRAMES = 2;

/** Moving frames for `preset` on the cut into shot `index`: its default, at most what leaves both shots a rest frame. */
function fitFrames(preset: MotionTransitionId, shots: readonly PlannedShot[], index: number, fps: number): number | null {
  const frames = (s: PlannedShot) => Math.round((s.end - s.start) * fps);
  const room = Math.min(frames(shots[index - 1]!), frames(shots[index]!));
  if (room < MIN_FRAMES) return null;
  const fit = Math.min(defaultFrames(preset, fps), 2 * (room - 1));
  return fit >= 2 ? fit : null;
}

/** The accents of a planned reel; none for a style without them (beyond its flashes). */
export function planAccents(style: ReelStyle, plan: Pick<ReelPlan, "shots" | "drop">, fps: number): ReelAccents {
  const { shots } = plan;
  const last = shots.length - 1;
  const dropIndex = plan.drop === null ? -1 : shots.findIndex((s) => Math.abs(s.start - plan.drop!) < 1e-6);
  const climaxStart = dropIndex > 0 ? dropIndex : shots.findIndex((s, i) => i > 0 && s.climax);
  // The first downbeat cut of each section: the body (after the opening shot), the climax, the payoff.
  const sectionStarts = new Set<number>();
  const bodyStart = shots.findIndex((s, i) => i > 0 && s.onDownbeat && !s.climax);
  if (bodyStart > 0) sectionStarts.add(bodyStart);
  const climaxDownbeat = dropIndex > 0 ? dropIndex : shots.findIndex((s, i) => i > 0 && i < last && s.climax && s.onDownbeat);
  if (climaxDownbeat > 0) sectionStarts.add(climaxDownbeat);
  if (last > 0 && shots[last]!.onDownbeat) sectionStarts.add(last);

  const flashes: number[] = [];
  let lastFlash = -Infinity;
  shots.forEach((shot, index) => {
    if (index === 0 || style.flash === "none") return;
    if (style.flash === "sections") {
      if (sectionStarts.has(index)) flashes.push(index);
      return;
    }
    if (!shot.onDownbeat || (style.flash === "climax_downbeats" && !shot.climax)) return;
    // At most one flash every 3 s: a flash on every bar strobes.
    if (shot.start - lastFlash < 3) return;
    flashes.push(index);
    lastFlash = shot.start;
  });

  const accents = style.accents;
  if (!accents || shots.length < 3) return { flashes, transitions: [], ramp: null };
  const wanted: { shot: number; preset: MotionTransitionId }[] = [];
  let climaxHits = 0;
  let bodyDownbeats = 0;
  for (let index = 1; index <= last; index += 1) {
    const shot = shots[index]!;
    if (index === last) {
      if (accents.landing) wanted.push({ shot: index, preset: accents.landing });
    } else if (index === climaxDownbeat) {
      wanted.push({ shot: index, preset: accents.drop });
    } else if (shot.onDownbeat && climaxStart > 0 && index > climaxStart) {
      if (accents.climax.length > 0) wanted.push({ shot: index, preset: accents.climax[climaxHits++ % accents.climax.length]! });
    } else if (shot.onDownbeat && !shot.climax && accents.body) {
      // Every other bar line, from the second: a move on every bar reads as a template.
      if (bodyDownbeats++ % 2 === 1) wanted.push({ shot: index, preset: accents.body });
    }
  }
  const transitions: AccentTransition[] = [];
  for (const w of wanted) {
    const frames = fitFrames(w.preset, shots, w.shot, fps);
    if (frames !== null) transitions.push({ ...w, frames });
  }
  const windup = accents.windupBeats > 0 && dropIndex > 0 ? dropIndex - 1 : -1;
  const ramp = windup > 0 && shots[windup]!.windup && shots[windup]!.kind === "video" && shots[windup]!.speed >= 0.999 ? windup : null;
  return { flashes, transitions, ramp };
}
