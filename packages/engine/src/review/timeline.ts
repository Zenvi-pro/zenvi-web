/**
 * The structure of an edit as a viewer meets it: shots (what is on top of the
 * picture), cuts between them, empty stretches, flashes, titles, and where
 * there is no sound. Read from the clips alone; pixels and the mixed audio
 * are judged elsewhere (problems.ts) when the host can render them.
 */

import type { Clip, Project, ProjectFile } from "../model/types.js";
import { getMediaType, isImagePath } from "../model/media.js";
import { fpsFloat } from "../timeline/time.js";
import { frameWindow } from "../timeline/windows.js";
import type { EmptyStretch, ReviewCut, ReviewShot, ShotStats, TimelineReview } from "./types.js";

/** Colour clips up to this long, over footage, are flash frames. */
const FLASH_SECONDS = 0.35;
/** A gap in the audio shorter than this is not worth a mention. */
const MIN_SILENT_GAP = 0.3;

type Role = "video" | "image" | "title" | "color" | "audio" | "none";

const MOVING = ["location_x", "location_y", "scale_x", "scale_y", "rotation", "shear_x", "shear_y"] as const;

function pointsOf(keyframe: unknown): { x: number; y: number }[] {
  const points = (keyframe as { Points?: { co?: { X?: unknown; Y?: unknown } }[] } | null)?.Points;
  return Array.isArray(points) ? points.map((p) => ({ x: Number(p?.co?.X), y: Number(p?.co?.Y) })) : [];
}

/** A transform keyframe changes value over the clip: it pushes, pans or spins. */
function moves(clip: Clip): boolean {
  return MOVING.some((key) => {
    const points = pointsOf(clip[key]);
    return points.length >= 2 && points.some((p) => p.y !== points[0]!.y);
  });
}

function silent(clip: Clip): boolean {
  const points = pointsOf(clip.volume);
  return points.length > 0 && points.every((p) => p.y === 0);
}

function pathOf(clip: Clip): string {
  return String(clip.reader?.path ?? "");
}

function roleOf(clip: Clip): Role {
  const reader = clip.reader;
  const path = pathOf(clip);
  if (/\.svg$/i.test(path)) return /(^|[\\/])Solid_Color[^\\/]*$/i.test(path) ? "color" : "title";
  const type = getMediaType({ path, has_video: reader?.has_video, has_audio: reader?.has_audio });
  if (type === "audio") return reader?.has_audio === false ? "none" : "audio";
  if (type === "image" || reader?.has_single_image || isImagePath(path)) return "image";
  return "video";
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  return n % 2 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

function round(value: number, digits = 3): number {
  const k = 10 ** digits;
  return Math.round(value * k) / k;
}

export function shotStats(durations: readonly number[]): ShotStats {
  const sorted = [...durations].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    min: round(sorted[0] ?? 0),
    median: round(median(sorted)),
    mean: round(sorted.length ? sum / sorted.length : 0),
    max: round(sorted[sorted.length - 1] ?? 0),
  };
}

interface Placed {
  clip: Clip;
  role: Role;
  /** 0-based frame the clip starts on, and the frame after its last. */
  from: number;
  to: number;
}

/** Union of frame intervals as sorted disjoint [from, to) pairs. */
function union(intervals: readonly [number, number][]): [number, number][] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [from, to] of sorted) {
    const last = out[out.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/** The parts of [from, to) no interval of `covered` (disjoint, sorted) touches. */
function uncovered(from: number, to: number, covered: readonly [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let cursor = from;
  for (const [a, b] of covered) {
    if (b <= cursor) continue;
    if (a >= to) break;
    if (a > cursor) out.push([cursor, Math.min(a, to)]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < to) out.push([cursor, to]);
  return out;
}

export interface ReviewRange {
  start?: number;
  end?: number;
}

/** Shots, cuts and the rest of an edit's structure; `range` limits what is reported (shots are never cut at its edges). */
export function reviewTimeline(project: Project, range: ReviewRange = {}): TimelineReview {
  const rate = fpsFloat(project.fps);
  const files = new Map<string, ProjectFile>((project.files ?? []).map((f) => [String(f.id), f]));
  const placed: Placed[] = [];
  for (const clip of project.clips ?? []) {
    const role = roleOf(clip);
    if (role === "none") continue;
    const window = frameWindow(clip, project.fps);
    const from = window.startFrame - 1;
    const to = window.endFrame;
    if (to > from) placed.push({ clip, role, from, to });
  }
  const sec = (frame: number): number => round(frame / rate);

  const contentEnd = placed.reduce((m, p) => Math.max(m, p.to), 0);
  const rangeFrom = Math.max(0, Math.round((range.start ?? 0) * rate));
  const rangeTo = Math.min(contentEnd, range.end === undefined ? contentEnd : Math.round(range.end * rate));

  // Shots: the topmost footage clip over each stretch between clip edges.
  const base = placed.filter((p) => p.role === "video" || p.role === "image");
  const edges = [...new Set(base.flatMap((p) => [p.from, p.to]))].sort((a, b) => a - b);
  interface Run {
    placed: Placed;
    from: number;
    to: number;
  }
  const runs: Run[] = [];
  for (let i = 0; i + 1 < edges.length; i += 1) {
    const from = edges[i]!;
    const to = edges[i + 1]!;
    let top: Placed | undefined;
    for (const p of base) {
      if (p.from <= from && p.to >= to && (!top || p.clip.layer > top.clip.layer || (p.clip.layer === top.clip.layer && p.from > top.from))) top = p;
    }
    if (!top) continue;
    const last = runs[runs.length - 1];
    if (last && last.to === from && last.placed === top) last.to = to;
    else runs.push({ placed: top, from, to });
  }

  /** Source seconds a run shows (clips play at their own speed unless a time curve says otherwise). */
  const source = (run: Run): [number, number] => {
    const start = Number(run.placed.clip.start) + (run.from - run.placed.from) / rate;
    return [start, start + (run.to - run.from) / rate];
  };
  // A clip split in two plays on: its halves are one shot, not a cut.
  const merged: Run[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.to === run.from) {
      const a = last.placed.clip;
      const b = run.placed.clip;
      const continues = String(a.file_id) === String(b.file_id) && a.layer === b.layer && Math.abs(source(last)[1] - source(run)[0]) <= 1.5 / rate;
      if (continues) {
        last.to = run.to;
        continue;
      }
    }
    merged.push({ ...run });
  }

  const allShots: ReviewShot[] = merged.map((run, index) => {
    const clip = run.placed.clip;
    const file = files.get(String(clip.file_id));
    const [sourceStart, sourceEnd] = source(run);
    return {
      index,
      start: sec(run.from),
      end: sec(run.to),
      duration: round((run.to - run.from) / rate),
      clipId: String(clip.id),
      fileId: String(clip.file_id),
      name: String(file?.name || clip.title || pathOf(clip).split(/[\\/]/).pop() || clip.id),
      kind: run.placed.role === "image" ? "image" : "video",
      sourceStart: round(sourceStart),
      sourceEnd: round(sourceEnd),
      moves: moves(clip),
    };
  });
  const inRange = (shot: ReviewShot): boolean => shot.end * rate > rangeFrom && shot.start * rate < rangeTo;
  const shots = allShots.filter(inRange);

  const transitions = (project.effects ?? []).map((t) => ({ layer: t.layer, ...frameWindow(t, project.fps) }));
  const cuts: ReviewCut[] = [];
  for (let i = 0; i + 1 < allShots.length; i += 1) {
    const a = allShots[i]!;
    const b = allShots[i + 1]!;
    if (Math.abs(a.end - b.start) > 0.5 / rate) continue;
    const frame = Math.round(b.start * rate);
    if (frame < rangeFrom || frame >= rangeTo) continue;
    const layers = new Set(
      [a, b].map((s) => merged[s.index]!.placed.clip.layer),
    );
    const styled = transitions.some((t) => layers.has(t.layer) && t.startFrame - 1 <= frame + 1 && frame <= t.endFrame + 1);
    cuts.push({ time: b.start, from: a.index, to: b.index, style: styled ? "transition" : "cut" });
  }

  // Holes in the picture: no footage and no colour card under the playhead.
  const picture = union(placed.filter((p) => p.role === "video" || p.role === "image" || p.role === "color").map((p) => [p.from, p.to] as [number, number]));
  const titles = placed.filter((p) => p.role === "title");
  const empty: EmptyStretch[] = uncovered(rangeFrom, rangeTo, picture)
    .filter(([a, b]) => b > a)
    .map(([a, b]) => ({ start: sec(a), end: sec(b), title: titles.some((t) => t.from < b && t.to > a) }));

  const colorFlashes = placed
    .filter((p) => p.role === "color" && (p.to - p.from) / rate <= FLASH_SECONDS && p.to > rangeFrom && p.from < rangeTo)
    .map((p) => ({ start: sec(p.from), end: sec(p.to), clipId: String(p.clip.id) }))
    .sort((a, b) => a.start - b.start);

  // Titles on screen.
  const seen = titles.filter((p) => p.to > rangeFrom && p.from < rangeTo);
  const events = seen.flatMap((p) => [
    [Math.max(p.from, rangeFrom), 1],
    [Math.min(p.to, rangeTo), -1],
  ] as [number, number][]);
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let live = 0;
  let peak = 0;
  for (const [, delta] of events) {
    live += delta;
    peak = Math.max(peak, live);
  }
  const span = Math.max(1, rangeTo - rangeFrom);
  const covered = union(seen.map((p) => [Math.max(p.from, rangeFrom), Math.min(p.to, rangeTo)] as [number, number]));
  const onScreen = covered.reduce((sum, [a, b]) => sum + (b - a), 0);

  const holds = shots.map((s) => ({ start: s.start, seconds: s.duration, name: s.name }));
  const stills = shots.filter((s) => s.kind === "image" && !s.moves).map((s) => ({ start: s.start, seconds: s.duration, name: s.name }));
  const longest = (list: { start: number; seconds: number; name: string }[]) => list.reduce<(typeof list)[number] | null>((m, s) => (!m || s.seconds > m.seconds ? s : m), null);

  const reviewedSeconds = shots.length ? Math.min(shots[shots.length - 1]!.end, rangeTo / rate) - Math.max(shots[0]!.start, rangeFrom / rate) : 0;

  // No audio under a stretch of the picture.
  const sounding = placed.filter((p) => (p.role === "audio" || (p.role === "video" && p.clip.reader?.has_audio)) && !silent(p.clip));
  const soundCover = union(sounding.map((p) => [p.from, p.to] as [number, number]));
  const silentGaps = uncovered(rangeFrom, rangeTo, soundCover)
    .filter(([a, b]) => (b - a) / rate >= MIN_SILENT_GAP)
    .map(([a, b]) => ({ start: sec(a), end: sec(b) }));

  return {
    fps: round(rate, 3),
    range: { start: sec(rangeFrom), end: sec(rangeTo) },
    shots,
    cuts,
    empty,
    colorFlashes,
    text: {
      clips: seen.length,
      peak,
      perSecond: round(seen.length / (span / rate)),
      coverage: round(onScreen / span),
    },
    titleClips: seen.map((p) => ({ clipId: String(p.clip.id), start: sec(p.from), end: sec(p.to), path: pathOf(p.clip) })),
    stats: shotStats(shots.map((s) => s.duration)),
    cutsPerSecond: reviewedSeconds > 0 ? round(cuts.length / reviewedSeconds) : 0,
    longestShot: longest(holds),
    longestStaticHold: longest(stills),
    silentGaps,
    audioClips: sounding.length,
  };
}
