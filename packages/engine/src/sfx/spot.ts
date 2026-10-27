/**
 * Spotting: the cue sheet of an edit, every hit point the eye registers
 * (CRAFT.md §1) with how big it is, where it is on screen and whether it
 * should get a sound at all. Sources:
 *   - cuts, transitions, title entrances and flash frames (sfx/moments.ts);
 *   - kinetic caption words: emphasis words only, connectors stay dry;
 *   - keyframed moves: velocity peaks of position, scale and rotation,
 *     and the landing when a move stops hard;
 *   - speed-ramp hits: where a ramp brakes from a rush into slow motion;
 *   - motion block and 3D scene event timelines (sfx/events.ts): clicks,
 *     toggles, typing, card lands, counter ticks, logo reveals, bursts;
 *   - the music's climax.
 * Rules: one cue per event (sources within a frame merge), flash runs (cuts
 * under 150 ms apart) are one hit point with accents every 3-4 cuts, heroes
 * at least 250 ms apart (400 ms under speech). Pure: reads the project.
 */

import { isAudioOnlyMedia } from "../model/media.js";
import type { Clip, Project, ProjectFile } from "../model/types.js";
import { evaluate } from "../keyframe/evaluate.js";
import { readMotionEvents } from "../links/zenvi-link.js";
import { listProjectMotionTransitions } from "../ops/motion-transitions.js";
import { remappedClipFrame } from "../render/plan/frame-plan.js";
import { readScene3dEvents } from "../scenes3d/events.js";
import { fpsFloat } from "../timeline/time.js";
import { clipFrameAtTime, timeOfClipFrame } from "../timeline/windows.js";
import type { PictureEvent, PictureEventKind } from "./events.js";
import { isSfxClip, soundMoments, KINETIC_CAPTIONS_KEY, type BeatGrid } from "./moments.js";

export const HIT_KINDS = ["cut", "transition", "title", "word", "flash", "move", "land", "ramp", "block", "scene3d", "climax"] as const;
export type HitKind = (typeof HIT_KINDS)[number];

/** CRAFT.md §1 priority when cues collide, highest first. */
export const HIT_ROLES = ["hero", "slam", "transition", "impact", "ui", "move", "micro"] as const;
export type HitRole = (typeof HIT_ROLES)[number];

export interface HitPoint {
  /** Timeline seconds the sound's hit belongs on. */
  t: number;
  kind: HitKind;
  /** Blocks, 3D scenes and keyframed moves: what happens. */
  event?: PictureEventKind;
  /** 0..1. */
  weight: number;
  role: HitRole;
  /** Screen x, -1 (left) .. 1 (right). */
  x: number;
  /** False when the doctrine leaves it dry; `dry` says why. */
  needsCue: boolean;
  dry?: string;
  /** Someone is speaking at `t`. */
  speech: boolean;
  /** Seconds of movement leading into `t` (a whoosh's pre-roll), when known. */
  lead?: number;
  /** Runs (typing, counter ticks): timeline seconds the run ends, and its rate per second. */
  until?: number;
  rate?: number;
  ids: string[];
  label: string;
  /** The edit's climax: the music's, landed on the picture event that sells it. */
  climax?: true;
}

export interface SpotInput {
  grid?: BeatGrid | null;
  climax?: number | null;
  /** Timeline windows where someone speaks. */
  speech?: readonly (readonly [number, number])[];
  /** Picture events by file id, for files whose project record has none (read from the motion host). */
  events?: ReadonlyMap<string, readonly PictureEvent[]>;
}

/** Cuts closer than this are one flash run (CRAFT.md §1). */
export const FLASH_RUN_GAP = 0.15;
/** In a flash run, one accent every this many cuts. */
const RUN_ACCENT_EVERY = 3;
/** Heroes closer than this merge (CRAFT.md §1 spacing); under speech the wider gap. */
export const HERO_GAP = 0.25;
const HERO_GAP_SPEECH = 0.4;
/** A picture hero this close to the music's climax takes it, seconds. */
const CLIMAX_SNAP = 0.35;
/** A move travels at least this much of the frame (per second, at its peak) to count. */
const MOVE_SPEED_FLOOR = 0.6;
/** A move travelling at least a third of the frame gets a whoosh (CRAFT.md §1). */
const MOVE_TRAVEL = 1 / 3;

const ROLE_RANK: Readonly<Record<HitRole, number>> = Object.fromEntries(HIT_ROLES.map((r, i) => [r, i])) as Record<HitRole, number>;

const EVENT_ROLE: Readonly<Record<PictureEventKind, HitRole>> = {
  click: "ui",
  toggle: "ui",
  type: "ui",
  pop: "ui",
  tick: "ui",
  swap: "ui",
  glint: "micro",
  land: "impact",
  burst: "impact",
  impact: "slam",
  whoosh: "move",
  reveal: "hero",
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const end = (c: Clip) => c.position + (c.end - c.start);

function inSpeech(speech: SpotInput["speech"], t: number): boolean {
  return (speech ?? []).some(([a, b]) => t >= a - 0.05 && t <= b + 0.05);
}

interface Context {
  project: Project;
  fps: number;
  files: Map<string, ProjectFile>;
  visual: Clip[];
  /** Timeline windows motion transitions animate (their keyframes are not moves of their own). */
  transitionWindows: [number, number][];
}

function point(t: number, kind: HitKind, weight: number, role: HitRole, rest: Partial<HitPoint> & { label: string }): HitPoint {
  return { t, kind, weight: clamp(weight, 0, 1), role, x: 0, needsCue: true, speech: false, ids: [], ...rest };
}

/** Cuts, transitions, titles and flashes, from the moments sound design has always answered. */
function editPoints(ctx: Context, grid: BeatGrid | null): HitPoint[] {
  return soundMoments(ctx.project, grid).map((m) => {
    if (m.kind === "transition") return point(m.time, "transition", m.strength, "transition", { lead: (m.duration ?? 0.5) / 2, ids: m.ids ?? [], label: "transition" });
    if (m.kind === "flash") return point(m.time, "flash", m.strength, "impact", { label: "flash frame" });
    if (m.kind === "title") return point(m.time, "title", m.strength, "slam", { label: "title entrance" });
    // A cut to a new shot after a hold, on a downbeat, is a section change: a hero.
    const hero = m.strength >= 0.85;
    return point(m.time, "cut", m.strength, hero ? "hero" : "transition", { lead: Math.min(m.before ?? 0.4, 0.4), ids: m.ids ?? [], label: hero ? "cut (section change)" : "cut" });
  });
}

/** Kinetic caption words: emphasis words slam, connectors stay dry (CRAFT.md §1). */
function wordPoints(ctx: Context): HitPoint[] {
  // A word drawn letter by letter is several clips ("g2w1", "g2w1l0"…): it enters once, with its first.
  const firstOfWord = new Map<string, Clip>();
  for (const c of [...ctx.project.clips].sort((a, b) => a.position - b.position)) {
    const tag = c[KINETIC_CAPTIONS_KEY] as { role?: unknown; said?: unknown } | undefined;
    if (tag?.role !== "caption") continue;
    const key = `${JSON.stringify(tag.said ?? null)}:${/g\d+w\d+/.exec(String(c.title ?? ""))?.[0] ?? c.id}`;
    if (!firstOfWord.has(key)) firstOfWord.set(key, c);
  }
  const words = [...firstOfWord.values()];
  // Projects from before the tag recorded emphasis: an emphasis word is drawn 1.4x taller than its group's median.
  const groupOf = (c: Clip) => JSON.stringify((c[KINETIC_CAPTIONS_KEY] as { said?: unknown }).said ?? null);
  const heights = new Map<string, number[]>();
  for (const c of words) {
    const h = Number(ctx.files.get(String(c.file_id))?.height) || 0;
    heights.set(groupOf(c), [...(heights.get(groupOf(c)) ?? []), h]);
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  return words.map((c) => {
    const tag = c[KINETIC_CAPTIONS_KEY] as { emphasis?: unknown; word?: unknown };
    const h = Number(ctx.files.get(String(c.file_id))?.height) || 0;
    const m = median(heights.get(groupOf(c)) ?? []);
    const emphasis = tag.emphasis === true || (tag.emphasis === undefined && m > 0 && h >= m * 1.4);
    const label = typeof tag.word === "string" ? `word '${tag.word}'` : "caption word";
    return emphasis
      ? point(c.position, "word", 0.5, "slam", { ids: [c.id], label: `${label} (emphasis)`, x: screenX(ctx, c, c.position) })
      : point(c.position, "word", 0.15, "micro", { ids: [c.id], label, needsCue: false, dry: "connector word" });
  });
}

/** Screen x of a clip's centre at `t`, -1..1 (libopenshot location_x is a share of the canvas width). */
function screenX(ctx: Context, clip: Clip, t: number): number {
  const frame = clipFrameAtTime(clip, t, ctx.project.fps);
  return clamp(2 * evaluate(clip.location_x, frame, 0), -1, 1);
}

/**
 * Keyframed moves of picture clips: a whoosh at each velocity peak that
 * travels a third of the frame or more, and a land where a move stops hard
 * (a slam-in decelerating to rest within two frames).
 */
function movePoints(ctx: Context): HitPoint[] {
  const out: HitPoint[] = [];
  const { fps } = ctx;
  for (const clip of ctx.visual) {
    if (clip[KINETIC_CAPTIONS_KEY]) continue;
    const curves = [clip.location_x, clip.location_y, clip.scale_x, clip.rotation];
    if (!curves.some((k) => Array.isArray(k?.Points) && k.Points.length >= 2)) continue;
    const first = clipFrameAtTime(clip, clip.position, ctx.project.fps);
    const last = clipFrameAtTime(clip, end(clip), ctx.project.fps);
    if (last - first < 2) continue;
    const at = (f: number) => [evaluate(clip.location_x, f, 0), evaluate(clip.location_y, f, 0), Math.max(1e-3, evaluate(clip.scale_x, f, 1)), evaluate(clip.rotation, f, 0)] as const;
    // Screen travel per frame: position in frame widths, scale as log change (a 2x zoom ≈ half a frame), rotation in turns.
    const speeds: number[] = [];
    let prev = at(first);
    for (let f = first + 1; f <= last; f += 1) {
      const cur = at(f);
      speeds.push((Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) + Math.abs(Math.log(cur[2] / prev[2])) * 0.7 + Math.abs(cur[3] - prev[3]) / 360) * fps);
      prev = cur;
    }
    let i = 0;
    while (i < speeds.length) {
      if (speeds[i]! < MOVE_SPEED_FLOOR) {
        i += 1;
        continue;
      }
      const from = i;
      while (i < speeds.length && speeds[i]! >= MOVE_SPEED_FLOOR * 0.25) i += 1;
      const seg = speeds.slice(from, i);
      const peakAt = from + seg.indexOf(Math.max(...seg));
      const travel = seg.reduce((s, v) => s + v, 0) / fps;
      const tPeak = timeOfClipFrame(clip, first + peakAt + 1, ctx.project.fps);
      const tStop = timeOfClipFrame(clip, first + i, ctx.project.fps);
      const tStart = timeOfClipFrame(clip, first + from, ctx.project.fps);
      if (ctx.transitionWindows.some(([a, b]) => tPeak >= a && tPeak <= b)) continue;
      const x = screenX(ctx, clip, tPeak);
      if (travel >= MOVE_TRAVEL * 0.5) {
        out.push(
          point(tPeak, "move", clamp(travel, 0.2, 1), "move", {
            event: "whoosh",
            x,
            lead: tPeak - tStart,
            ids: [clip.id],
            label: `move (${Math.round(travel * 100)} % of the frame)`,
            ...(travel < MOVE_TRAVEL ? { needsCue: false, dry: "travels under a third of the frame" } : {}),
          }),
        );
      }
      // A hard stop: the speed two frames before rest is still at least half the peak.
      const tail = seg[seg.length - 2] ?? 0;
      if (travel >= 0.15 && tail >= Math.max(...seg) * 0.5) {
        out.push(point(tStop, "land", clamp(travel, 0.3, 0.9), "impact", { event: "land", x: screenX(ctx, clip, tStop), ids: [clip.id], label: "move lands" }));
      }
    }
  }
  return out;
}

/**
 * Speed-ramp hits: where a ramp brakes from a rush (≥ 1.5x) into slow
 * motion (≤ 0.6x), and the rush out of slow motion past 1.2x (a whoosh
 * peaking where it is fastest). Speeds are smoothed over 5 frames: the `time` curve holds
 * whole source frames, so frame-to-frame steps alternate 0, 1, 2.
 */
const RUSH = 1.2;

function rampPoints(ctx: Context): HitPoint[] {
  const out: HitPoint[] = [];
  for (const clip of ctx.visual) {
    const points = Array.isArray(clip.time?.Points) ? clip.time.Points : [];
    if (points.length <= 2) continue;
    const first = clipFrameAtTime(clip, clip.position, ctx.project.fps);
    const last = clipFrameAtTime(clip, end(clip), ctx.project.fps);
    const raw: number[] = [];
    for (let f = first; f < last; f += 1) raw.push(evaluate(clip.time, f + 1, f + 1) - evaluate(clip.time, f, f));
    const speeds = raw.map((_, i) => {
      const w = raw.slice(Math.max(0, i - 2), i + 3);
      return w.reduce((a, b) => a + b, 0) / w.length;
    });
    const at = (i: number) => timeOfClipFrame(clip, first + i, ctx.project.fps);
    let fastest = 0;
    let slowest = Infinity;
    let slowEnd = -1;
    for (let i = 1; i < speeds.length; i += 1) {
      const v = speeds[i]!;
      fastest = Math.max(fastest, speeds[i - 1]!);
      slowest = Math.min(slowest, speeds[i - 1]!);
      if (speeds[i - 1]! <= 0.7) slowEnd = i;
      if (fastest >= 1.5 && v <= 0.6 && speeds[i - 1]! > 0.6) {
        const t = at(i);
        out.push(point(t, "ramp", clamp((fastest - v) / 4, 0.4, 1), "impact", { x: screenX(ctx, clip, t), ids: [clip.id], label: `speed ramp brakes (${fastest.toFixed(1)}x to ${v.toFixed(2)}x)` }));
        fastest = 0;
      }
      if (slowest <= 0.7 && v >= RUSH && speeds[i - 1]! < RUSH) {
        // The rush peaks where the speed tops out after the crossing.
        let k = i;
        while (k + 1 < speeds.length && speeds[k + 1]! >= speeds[k]!) k += 1;
        const t = at(k);
        out.push(point(t, "ramp", clamp((speeds[k]! - slowest) / 4, 0.3, 0.9), "move", { event: "whoosh", x: screenX(ctx, clip, t), lead: Math.max(0.1, t - at(slowEnd)), ids: [clip.id], label: `speed ramp rushes (${slowest.toFixed(2)}x to ${speeds[k]!.toFixed(1)}x)` }));
        slowest = Infinity;
      }
    }
  }
  return out;
}

/**
 * The timeline seconds at which a clip shows source time `seconds`, through
 * its `time` curve when it has one (a speed ramp, a freeze, a reverse:
 * libopenshot shows source frame `time.GetLong(n)` on clip frame n,
 * Clip.cpp:749-765, frame-plan.ts remappedClipFrame): every output frame
 * where the shown source frame reaches the event's, forwards or backwards.
 * A rush that skips past it still fires on the frame that passes it; a
 * reverse plays it again; a stretch that never shows it gives nothing.
 */
function showsSourceAt(ctx: Context, clip: Clip, seconds: number): number[] {
  const fps = ctx.fps;
  const first = clipFrameAtTime(clip, clip.position, ctx.project.fps, false);
  const last = clipFrameAtTime(clip, end(clip), ctx.project.fps, false) - 1;
  const target = seconds * fps + 1;
  const out: number[] = [];
  let prev = remappedClipFrame(clip, first);
  if (Math.abs(prev - target) < 0.5) out.push(clip.position);
  for (let n = first + 1; n <= last; n += 1) {
    const cur = remappedClipFrame(clip, n);
    if ((prev < target && cur >= target) || (prev > target && cur <= target)) out.push(timeOfClipFrame(clip, n, ctx.project.fps));
    prev = cur;
  }
  return out;
}

/** Motion block and 3D scene events, mapped from the block's own clock onto the timeline through the clip's trim and time curve. */
function eventPoints(ctx: Context, given: SpotInput["events"]): HitPoint[] {
  const out: HitPoint[] = [];
  for (const clip of ctx.visual) {
    const file = ctx.files.get(String(clip.file_id));
    if (!file) continue;
    const scene = readScene3dEvents(file);
    const events = given?.get(String(file.id)) ?? readMotionEvents(file) ?? scene;
    if (!events) continue;
    const kind: HitKind = scene ? "scene3d" : "block";
    const name = String(file.name ?? file.id);
    for (const e of events) {
      for (const t of showsSourceAt(ctx, clip, e.t)) {
        // The block's own x, moved by the clip's position on the canvas.
        const x = clamp(2 * (e.x - 0.5) + screenX(ctx, clip, t), -1, 1);
        // A run ends where its end is shown next (or with the clip).
        const until = e.until !== undefined ? (showsSourceAt(ctx, clip, e.until).find((u) => u > t) ?? end(clip)) : undefined;
        const run = until !== undefined ? { until, rate: e.rate ?? 10 } : {};
        out.push(point(t, kind, e.weight, EVENT_ROLE[e.kind], { event: e.kind, x, ids: [clip.id], label: `${name}: ${e.kind}`, ...run }));
      }
    }
  }
  return out;
}

/** Flash runs: cuts under 150 ms apart are one hit point; its first and last cut and an accent every few cuts keep a sound. */
function groupFlashRuns(points: HitPoint[]): void {
  const cuts = points.filter((p) => p.kind === "cut" || p.kind === "flash").sort((a, b) => a.t - b.t);
  let run: HitPoint[] = [];
  const close = () => {
    if (run.length >= 3) {
      run.forEach((p, i) => {
        if (i === 0 || i === run.length - 1) return;
        if (i % RUN_ACCENT_EVERY === 0) {
          p.label += " (flash run accent)";
          p.role = "micro";
          return;
        }
        p.needsCue = false;
        p.dry = "inside a flash run";
      });
      run[run.length - 1]!.role = "hero";
      run[run.length - 1]!.label += " (flash run ends)";
    }
    run = [];
  };
  for (const p of cuts) {
    if (run.length > 0 && p.t - run[run.length - 1]!.t >= FLASH_RUN_GAP) close();
    run.push(p);
  }
  close();
}

/** A block's staggered events of one kind closer than this are one event (word-by-word slams, a burst of pops): they blur into one at < 100 ms (CRAFT.md §1 precedence). */
const STAGGER_GAP = 0.15;

/** Staggered runs of one block's events merge into their first, as strong as the strongest. */
function mergeStaggers(points: HitPoint[]): HitPoint[] {
  const out: HitPoint[] = [];
  const last = new Map<string, { point: HitPoint; t: number }>();
  for (const p of [...points].sort((a, b) => a.t - b.t)) {
    const staggered = (p.kind === "block" || p.kind === "scene3d") && p.until === undefined;
    const key = `${p.ids[0]}:${p.event}`;
    const run = staggered ? last.get(key) : undefined;
    if (run && p.t - run.t < STAGGER_GAP) {
      run.point.weight = Math.max(run.point.weight, p.weight);
      run.t = p.t;
      continue;
    }
    out.push(p);
    if (staggered) last.set(key, { point: p, t: p.t });
  }
  return out;
}

/** One cue per event: points within a frame merge into the highest-priority one. */
function mergeSameEvent(points: HitPoint[], frame: number): HitPoint[] {
  const sorted = [...points].sort((a, b) => a.t - b.t || ROLE_RANK[a.role] - ROLE_RANK[b.role]);
  const out: HitPoint[] = [];
  for (const p of sorted) {
    const twin = out.find((q) => Math.abs(q.t - p.t) <= frame * 1.01 && q.until === undefined && p.until === undefined);
    if (!twin) {
      out.push({ ...p, ids: [...p.ids] });
      continue;
    }
    const keep = ROLE_RANK[p.role] < ROLE_RANK[twin.role] || (p.role === twin.role && p.weight > twin.weight) ? p : twin;
    const other = keep === p ? twin : p;
    Object.assign(twin, { ...keep, weight: Math.max(p.weight, twin.weight), needsCue: p.needsCue || twin.needsCue, ids: [...new Set([...twin.ids, ...p.ids])], label: keep.label === other.label ? keep.label : `${keep.label} + ${other.label}`, ...(p.climax || twin.climax ? { climax: true as const } : {}) });
    if (twin.needsCue) delete twin.dry;
  }
  return out;
}

/** Heroes at least 250 ms apart (400 ms under speech): the weaker of two close heroes steps down to an impact. */
function spaceHeroes(points: HitPoint[]): void {
  const heroes = points.filter((p) => p.role === "hero" && p.needsCue).sort((a, b) => Number(b.climax ?? false) - Number(a.climax ?? false) || b.weight - a.weight || a.t - b.t);
  const kept: HitPoint[] = [];
  for (const h of heroes) {
    const gap = h.speech ? HERO_GAP_SPEECH : HERO_GAP;
    if (kept.some((k) => Math.abs(k.t - h.t) < gap)) {
      h.role = "impact";
      h.label += " (a hero just played)";
    } else kept.push(h);
  }
}

/** The cue sheet of the edit, in time order. */
export function spotHitPoints(project: Project, input: SpotInput = {}): HitPoint[] {
  const fps = fpsFloat(project.fps) || 30;
  const files = new Map(project.files.map((f) => [String(f.id), f]));
  const visual = project.clips.filter((c) => {
    if (isSfxClip(c)) return false;
    const file = files.get(String(c.file_id));
    return file ? !isAudioOnlyMedia(file) : c.reader?.has_video !== false;
  });
  const clips = new Map(project.clips.map((c) => [c.id, c]));
  const transitionWindows = listProjectMotionTransitions(project).flatMap((m): [number, number][] => {
    const incoming = clips.get(m.inClipId);
    if (!incoming) return [];
    const half = m.frames / fps / 2 + 1 / fps;
    return [[incoming.position - half, incoming.position + half]];
  });
  const ctx: Context = { project, fps, files, visual, transitionWindows };
  const points = [...editPoints(ctx, input.grid ?? null), ...wordPoints(ctx), ...movePoints(ctx), ...rampPoints(ctx), ...eventPoints(ctx, input.events)];
  if (input.climax !== undefined && input.climax !== null) {
    // The drop lands on the picture: a hero cut or reveal within 350 ms takes the climax (move the sound to the picture, CRAFT.md §3).
    const near = points.filter((p) => Math.abs(p.t - input.climax!) <= CLIMAX_SNAP && (p.role === "hero" || p.event === "reveal")).sort((a, b) => b.weight - a.weight || Math.abs(a.t - input.climax!) - Math.abs(b.t - input.climax!))[0];
    if (near) Object.assign(near, { role: "hero", weight: 1, climax: true, label: `${near.label} + the music's climax` });
    else points.push(point(input.climax, "climax", 1, "hero", { label: "the music's climax", climax: true }));
  }
  const duration = visual.reduce((e, c) => Math.max(e, end(c)), 0);
  const inside = points.filter((p) => p.t >= 0 && p.t < duration);
  for (const p of inside) {
    p.t = Math.round(p.t * fps) / fps;
    p.speech = inSpeech(input.speech, p.t);
    p.weight = Math.round(p.weight * 100) / 100;
    p.x = Math.round(p.x * 100) / 100;
  }
  groupFlashRuns(inside);
  const merged = mergeSameEvent(mergeStaggers(inside), 1 / fps);
  spaceHeroes(merged);
  return merged.sort((a, b) => a.t - b.t || ROLE_RANK[a.role] - ROLE_RANK[b.role]);
}
