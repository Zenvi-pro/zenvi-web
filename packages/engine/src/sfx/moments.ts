/**
 * The moments of an edit that sound design answers (sfx/plan.ts): hard
 * cuts between shots, transitions, title entrances and white flash frames,
 * each with how big it is. Reads the project only.
 */

import { isAudioOnlyMedia } from "../model/media.js";
import type { Clip, Project, ProjectFile } from "../model/types.js";
import { listProjectMotionTransitions } from "../ops/motion-transitions.js";
import { fpsFloat } from "../timeline/time.js";
import { getMotionTransition } from "../transitions/motion/presets.js";
import type { SoundMoment } from "./plan.js";

/** `zenvi_role` of sound-effect files and the clips that play them. */
export const SFX_ROLE = "sfx";

/** What a sound-effect clip records about itself (`clip.zenvi_sfx`). */
export interface SfxClipMark {
  recipe: string;
  /** Placed by auto_sound_design_tool (replaced when it runs again). */
  auto: boolean;
  reason?: string;
}

/** True for a clip a sound-design tool placed. */
export function isSfxClip(clip: Clip): boolean {
  return clip.zenvi_role === SFX_ROLE;
}

/** True for a clip auto_sound_design_tool placed. */
export function isAutoSfxClip(clip: Clip): boolean {
  const mark = clip.zenvi_sfx as Partial<SfxClipMark> | undefined;
  return isSfxClip(clip) && mark?.auto === true;
}

/** Beat grid on the timeline, for weighing cuts. */
export interface BeatGrid {
  beats: readonly number[];
  downbeats: readonly number[];
}

function baseName(file: ProjectFile | undefined, clip: Clip): string {
  return String(file?.path ?? clip.reader?.path ?? "").split(/[\\/]/).pop() ?? "";
}

function isGraphic(file: ProjectFile | undefined, clip: Clip): boolean {
  return /\.svg$/i.test(baseName(file, clip));
}

function isFlash(file: ProjectFile | undefined, clip: Clip): boolean {
  const length = clip.end - clip.start;
  return isGraphic(file, clip) && length <= 0.5 && (/^flash$/i.test(String(clip.title ?? "")) || /flash/i.test(baseName(file, clip)));
}

const near = (list: readonly number[], t: number, within: number) => list.some((x) => Math.abs(x - t) <= within);

/** The last cut before `t` (0 when none): how long the picture has held. */
function lastCutBefore(cuts: readonly number[], t: number): number {
  return cuts.filter((c) => c < t - 1e-6).reduce((a, b) => Math.max(a, b), 0);
}

/** Every moment worth a sound, in time order. */
export function soundMoments(project: Project, grid: BeatGrid | null = null): SoundMoment[] {
  const fps = fpsFloat(project.fps) || 30;
  const frame = 1 / fps;
  const files = new Map(project.files.map((f) => [String(f.id), f]));
  const visual = project.clips.filter((c) => {
    const file = files.get(String(c.file_id));
    if (isSfxClip(c)) return false;
    return file ? !isAudioOnlyMedia(file) : c.reader?.has_video !== false;
  });
  const moments: SoundMoment[] = [];

  const flashes: number[] = [];
  const titles: number[] = [];
  const shots: Clip[] = [];
  for (const clip of visual) {
    const file = files.get(String(clip.file_id));
    if (isFlash(file, clip)) flashes.push(clip.position);
    else if (isGraphic(file, clip)) titles.push(clip.position);
    else shots.push(clip);
  }

  // Transitions: the move peaks halfway through.
  const transitions = project.effects.map((t) => ({ id: String(t.id), from: t.position, to: t.position + (t.end - t.start), layer: t.layer }));
  // Motion transitions that move the frame (whips, slides, zooms) whoosh through the cut; glitches and flashes stay cuts, hit.
  for (const m of listProjectMotionTransitions(project)) {
    if (!getMotionTransition(m.preset)?.sfx.includes("whoosh")) continue;
    const half = m.frames / fps / 2;
    transitions.push({ id: m.id, from: m.cut - half, to: m.cut + half, layer: m.layer });
  }
  for (const t of transitions) {
    moments.push({ kind: "transition", time: (t.from + t.to) / 2, strength: 0.6, duration: t.to - t.from, ids: [t.id] });
  }

  // Cuts: wherever the shot on top changes — a new shot starting, or one ending to reveal the shot under it
  // (back to the A-roll). A cut hidden under a full-frame shot above it changes nothing on screen.
  const end = (c: Clip) => c.position + (c.end - c.start);
  const topShot = (t: number) =>
    shots.filter((c) => c.position <= t && end(c) > t).sort((x, y) => y.layer - x.layer || y.position - x.position)[0];
  const edges = [...new Set(shots.flatMap((c) => [c.position, end(c)]))].sort((x, y) => x - y);
  const seen: number[] = [];
  for (const t of edges) {
    if (t < frame * 1.5 || near(seen, t, frame * 0.6)) continue;
    if (transitions.some((tr) => t > tr.from - frame && t < tr.to + frame)) continue;
    const previous = topShot(t - frame * 0.5);
    const next = topShot(t + frame * 0.5);
    if (!next || next === previous) continue;
    seen.push(t);
    const before = previous ? t - Math.max(previous.position, lastCutBefore(seen, t)) : t;
    const after = end(next) - t;
    let strength = 0.4;
    if (!previous || String(previous.file_id) !== String(next.file_id)) strength += 0.2;
    if (grid) {
      if (near(grid.downbeats, t, 0.06)) strength += 0.3;
      else if (near(grid.beats, t, 0.05)) strength += 0.1;
    }
    if (before >= 1.5) strength += 0.15;
    if (near(flashes, t, frame * 1.5)) strength += 0.2;
    moments.push({ kind: "cut", time: t, strength: Math.min(1, strength), before, after, ids: [String(next.id)] });
  }

  for (const t of flashes) moments.push({ kind: "flash", time: t, strength: 0.75 });
  // A title made of several elements (a motion template) enters once.
  const entrances: number[] = [];
  for (const t of [...titles].sort((a, b) => a - b)) {
    if (near(entrances, t, 0.25) || near(flashes, t, frame * 1.5)) continue;
    entrances.push(t);
    moments.push({ kind: "title", time: t, strength: 0.45 });
  }
  return moments.sort((a, b) => a.time - b.time);
}
