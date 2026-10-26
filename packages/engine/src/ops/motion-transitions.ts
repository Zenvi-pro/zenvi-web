/**
 * Motion transitions on the timeline: splice a preset's frames into the two
 * clips of a seamless cut, and take them out again.
 *
 * What a transition owns is recorded on both clips under the unknown key
 * `zenvi_motion_transitions` (the engine and the desktop keep unknown keys;
 * libopenshot ignores them): preset, partner clip, the clip-frame window,
 * each transform curve before and after, and the effects it added. Removing
 * merges the curves back point by point (transitions/motion/splice.ts), so a
 * curve nobody touched since comes back byte for byte and later edits outside
 * the window survive.
 */

import type { Transaction } from "../history/document.js";
import { createEffect } from "../effects/registry.js";
import type { Clip, Effect, Keyframe, Project } from "../model/types.js";
import { findClip } from "../model/query.js";
import { deliveredSource } from "../render/plan/reader.js";
import { frameWindow, localFrame } from "../timeline/windows.js";
import {
  EFFECT_CHANNELS,
  MOTION_NEUTRAL,
  TRANSFORM_CHANNELS,
  getMotionTransition,
  planMotionTransition,
  type MotionChannel,
  type EffectChannel,
  type MotionDirection,
  type MotionTransitionPlan,
  type MotionTransitionId,
  type SfxKind,
  type TransformChannel,
} from "../transitions/motion/presets.js";
import { spliceFrames, unspliceKeyframe, curveValueAt } from "../transitions/motion/splice.js";
import { OpError, invalid, requireUnlocked } from "./errors.js";
import { ids, rateOf } from "./internal.js";

/** The unknown clip key holding the records. */
export const MOTION_TRANSITIONS_KEY = "zenvi_motion_transitions";

export type MotionRole = "out" | "in";

/** What one transition owns on one clip. */
export interface MotionTransitionRecord {
  id: string;
  role: MotionRole;
  preset: MotionTransitionId;
  direction: MotionDirection | null;
  intensity: number;
  /** Moving frames in all (both clips). */
  frames: number;
  focus?: { x: number; y: number };
  /** The other clip of the cut. */
  partner: string;
  /** Timeline seconds of the cut when applied. */
  cut: number;
  /** Clip frames owned, inclusive: the rest frame and the moving frames. */
  window: [number, number];
  /** Transform curves: as they were before, and as the transition wrote them (null: the key was absent). */
  props: Partial<Record<TransformChannel, { before: Keyframe | null; after: Keyframe }>>;
  /** Effects the transition added to the clip. */
  effects: string[];
}

export interface MotionTransitionInput {
  outClipId: string;
  inClipId: string;
  preset: MotionTransitionId;
  /** `auto`: keep the track's current (the direction of the last motion transition before this cut), else the preset's default. */
  direction?: MotionDirection | "auto";
  /** Moving frames in all; default the preset's length at the project frame rate. */
  frames?: number;
  intensity?: number;
  focus?: { x: number; y: number };
}

export interface SfxCue {
  /** Timeline seconds. */
  time: number;
  kind: SfxKind;
  /** Seconds. */
  duration: number;
}

export interface MotionClipReceipt {
  id: string;
  role: MotionRole;
  /** Clip frames written (rest frame first for the outgoing clip, last for the incoming one). */
  frames: [number, number];
  properties: TransformChannel[];
  effectIds: string[];
}

export interface MotionTransitionResult {
  id: string;
  preset: MotionTransitionId;
  direction: MotionDirection | null;
  intensity: number;
  frames: number;
  layer: number;
  /** Timeline seconds of the cut. */
  cut: number;
  clips: MotionClipReceipt[];
  sfxCues: SfxCue[];
  /** The transition this one replaced on the same cut. */
  replaced?: string;
}

export interface MotionCut {
  outClip: Clip;
  inClip: Clip;
  /** Timeline seconds of the incoming clip's first frame. */
  cut: number;
  layer: number;
}

export function motionRecords(clip: Clip): MotionTransitionRecord[] {
  const value = (clip as Record<string, unknown>)[MOTION_TRANSITIONS_KEY];
  return Array.isArray(value) ? (value as MotionTransitionRecord[]) : [];
}

/** Every motion transition in the project, once each (from its outgoing clip's record). */
export function listProjectMotionTransitions(project: Project): (MotionTransitionRecord & { outClipId: string; inClipId: string; layer: number })[] {
  const out: (MotionTransitionRecord & { outClipId: string; inClipId: string; layer: number })[] = [];
  for (const clip of project.clips) {
    for (const r of motionRecords(clip)) if (r.role === "out") out.push({ ...r, outClipId: clip.id, inClipId: r.partner, layer: clip.layer });
  }
  return out.sort((a, b) => a.layer - b.layer || a.cut - b.cut);
}

/**
 * The seamless cuts on a track: clips whose frames touch (the incoming
 * clip's first timeline frame is the frame after the outgoing clip's last).
 */
export function trackCuts(project: Project, layer: number): MotionCut[] {
  const fps = project.fps;
  const clips = project.clips
    .filter((c) => c.layer === layer)
    .map((c) => ({ c, w: frameWindow(c, fps) }))
    .filter((e) => e.w.endFrame >= e.w.startFrame)
    .sort((a, b) => a.w.startFrame - b.w.startFrame);
  const cuts: MotionCut[] = [];
  for (let i = 0; i + 1 < clips.length; i += 1) {
    const a = clips[i]!;
    const b = clips[i + 1]!;
    if (b.w.startFrame === a.w.endFrame + 1) cuts.push({ outClip: a.c, inClip: b.c, cut: (b.w.startFrame - 1) / rateOf(project), layer });
  }
  return cuts;
}

/** The cut between two clips, or why they do not make one. */
export function cutBetween(project: Project, outClipId: string, inClipId: string): MotionCut {
  let a = findClip(project, outClipId);
  let b = findClip(project, inClipId);
  if (!a) throw new OpError("not_found", `No clip with id ${outClipId}.`, { id: outClipId });
  if (!b) throw new OpError("not_found", `No clip with id ${inClipId}.`, { id: inClipId });
  if (a.id === b.id) throw invalid("Give two different clips.");
  if (a.layer !== b.layer) throw invalid(`Clips ${a.id} and ${b.id} are on different tracks (${a.layer}, ${b.layer}); a motion transition joins two clips cut back to back on one track.`);
  if (frameWindow(b, project.fps).startFrame < frameWindow(a, project.fps).startFrame) [a, b] = [b, a];
  const wa = frameWindow(a, project.fps);
  const wb = frameWindow(b, project.fps);
  const gap = wb.startFrame - (wa.endFrame + 1);
  if (gap !== 0) {
    throw new OpError(
      "conflict",
      gap > 0
        ? `Clips ${a.id} and ${b.id} are not cut back to back: ${gap} frame(s) of gap between them. Close the gap first (motion transitions work on a seamless cut).`
        : `Clips ${a.id} and ${b.id} overlap by ${-gap} frame(s); motion transitions work on a seamless cut (use apply_transition_tool for an overlapping dissolve).`,
    );
  }
  return { outClip: a, inClip: b, cut: (wb.startFrame - 1) / rateOf(project), layer: a.layer };
}

/** The cut on `layer` nearest `seconds` (within half a second). */
export function cutNear(project: Project, layer: number, seconds: number): MotionCut {
  const cuts = trackCuts(project, layer);
  let best: MotionCut | undefined;
  for (const c of cuts) if (!best || Math.abs(c.cut - seconds) < Math.abs(best.cut - seconds)) best = c;
  if (!best || Math.abs(best.cut - seconds) > 0.5) {
    throw new OpError("not_found", `No cut on track ${layer} near ${seconds.toFixed(2)}s${cuts.length ? ` (cuts at ${cuts.map((c) => c.cut.toFixed(2)).join(", ")}s)` : " (no clips cut back to back there)"}.`);
  }
  return best;
}

/**
 * `auto`: keep the sequence's current, the "one dominant direction" of
 * HyperFrames' motion doctrine (Apache-2.0, motion-doctrine/SKILL.md, "The
 * Current"): the direction of the nearest earlier motion transition on the
 * track that this preset can take, else the preset's default (left; spins
 * clockwise). Never alternates: ping-pong across consecutive cuts reads as an
 * error.
 */
function autoDirection(project: Project, preset: MotionTransitionId, layer: number, cut: number): MotionDirection | undefined {
  const info = getMotionTransition(preset)!;
  if (info.directions.length === 0) return undefined;
  const earlier = listProjectMotionTransitions(project)
    .filter((r) => r.layer === layer && r.cut < cut - 1e-6 && r.direction !== null && info.directions.includes(r.direction))
    .sort((x, y) => y.cut - x.cut)[0];
  return earlier?.direction ?? info.defaultDirection ?? undefined;
}

const SCALE_CHANNELS = new Set<TransformChannel>(["scale_x", "scale_y"]);

function effectClass(channel: EffectChannel): string {
  return channel.slice(0, channel.indexOf("."));
}

/** Blur radii are planned as fractions of the frame width; libopenshot wants pixels of the decoded frame (<= the slider's 100). */
function effectValue(channel: EffectChannel, v: number, width: number): number {
  if (channel.startsWith("Blur.")) return Math.min(100, Math.round(v * width * 100) / 100);
  return v;
}

/** Take transition `id` out of one clip. Other records on the clip are rebased so they stay exact. */
function withoutRecord(clip: Clip, id: string): Clip {
  const records = motionRecords(clip);
  const mine = records.find((r) => r.id === id);
  if (!mine) return clip;
  const next: Record<string, unknown> = { ...clip };
  const [lo, hi] = mine.window;
  const others = records.filter((r) => r.id !== id).map((r) => structuredClone(r));
  for (const [prop, change] of Object.entries(mine.props) as [TransformChannel, { before: Keyframe | null; after: Keyframe }][]) {
    const restored = unspliceKeyframe(next[prop] as Keyframe | undefined, change.before, change.after, lo, hi);
    if (restored === null) delete next[prop];
    else next[prop] = restored;
    for (const r of others) {
      const theirs = r.props[prop];
      if (!theirs) continue;
      theirs.before = theirs.before === null ? null : unspliceKeyframe(theirs.before, change.before, change.after, lo, hi);
      theirs.after = unspliceKeyframe(theirs.after, change.before, change.after, lo, hi) ?? theirs.after;
    }
  }
  const owned = new Set(mine.effects);
  next.effects = (clip.effects ?? []).filter((e) => !owned.has(String(e.id)));
  if (others.length > 0) next[MOTION_TRANSITIONS_KEY] = others;
  else delete next[MOTION_TRANSITIONS_KEY];
  return next as Clip;
}

interface SidePlan {
  clip: Clip;
  role: MotionRole;
  /** Clip frames of the moving frames, ascending. */
  frames: number[];
  rest: number;
  values: MotionTransitionPlan["out"]["frames"];
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** How far a peak may be raised to make its box whole: on canvases whose sides share a small factor (854x480: 1.04 -> 1.5) the next whole box is a different move, and there a hairline (1 px) is the lesser fault. */
const MAX_BOX_SNAP = 0.1;

/**
 * The smallest scale >= `s` (by at most MAX_BOX_SNAP) at which the reader's
 * max box (W·s × H·s, truncated per axis in float: QtImageReader/FFmpegReader
 * calculate_max_size) is whole pixels on both axes, else `s`. Any other peak
 * can lose a pixel of aspect, and the clip then fits the canvas a pixel short
 * for its whole length (a dark hairline at the edges). Both axes even when the
 * scales differ (squash, a one-axis Ken Burns): the box is limited by the
 * axis with the smaller peak, and the picture is fitted to it at the source aspect.
 */
export function boxSafeScale(s: number, width: number, height: number): number {
  const f32 = Math.fround;
  const whole = (extent: number, v: number): boolean => {
    const exact = Math.round(extent * v);
    return Math.abs(extent * v - exact) < 1e-9 && Math.trunc(f32(extent * f32(v))) === exact;
  };
  const step = gcd(width, height);
  for (let n = Math.ceil(s * step - 1e-9); n / step <= s + MAX_BOX_SNAP; n += 1) {
    const v = n / step;
    if (whole(width, v) && whole(height, v)) return v;
  }
  return s;
}

function curveMax(kf: Keyframe | undefined): number {
  const ys = (kf?.Points ?? []).map((p) => Number(p.co.Y));
  return ys.length ? Math.max(...ys) : 1;
}

function writeSide(side: SidePlan, record: Omit<MotionTransitionRecord, "role" | "partner" | "window" | "props" | "effects">, partner: string, project: Project, nextId: () => string): { clip: Clip; receipt: MotionClipReceipt } {
  const width = Math.round(Number(project.width)) || 1920;
  const height = Math.round(Number(project.height)) || 1080;
  const next: Record<string, unknown> = { ...side.clip };
  const channels = new Set<MotionChannel>();
  for (const f of side.values) for (const ch of Object.keys(f) as MotionChannel[]) channels.add(ch);
  const props: MotionTransitionRecord["props"] = {};
  const written: TransformChannel[] = [];
  const scaled = new Map<TransformChannel, number[]>();
  for (const ch of TRANSFORM_CHANNELS) {
    if (!channels.has(ch)) continue;
    const before = (side.clip as Record<string, unknown>)[ch] as Keyframe | undefined;
    const fallback = MOTION_NEUTRAL[ch];
    scaled.set(
      ch,
      side.frames.map((f, i) => {
        const base = before === undefined ? fallback : curveValueAt(before, f, fallback);
        const v = side.values[i]![ch] ?? MOTION_NEUTRAL[ch];
        return Math.round((SCALE_CHANNELS.has(ch) ? base * v : base + v) * 1e6) / 1e6;
      }),
    );
  }
  // A peak above the clip's own largest scale sets the reader's decode box: keep that box whole pixels.
  for (const ch of ["scale_x", "scale_y"] as const) {
    const values = scaled.get(ch);
    if (!values) continue;
    const peak = Math.max(...values);
    if (peak <= curveMax((side.clip as Record<string, unknown>)[ch] as Keyframe | undefined)) continue;
    values[values.indexOf(peak)] = boxSafeScale(peak, width, height);
  }
  for (const [ch, values] of scaled) {
    const before = (side.clip as Record<string, unknown>)[ch] as Keyframe | undefined;
    const fallback = MOTION_NEUTRAL[ch];
    const after = spliceFrames(before, side.rest, side.frames, values, before === undefined ? fallback : curveValueAt(before, side.rest, fallback));
    next[ch] = after;
    props[ch] = { before: before === undefined ? null : structuredClone(before), after: structuredClone(after) };
    written.push(ch);
  }
  // Blur radii are pixels of the frame the reader delivers (decoded at the clip's largest scale) when exporting at the project size.
  const decodeWidth = deliveredSource(next as Clip, { previewWidth: width, previewHeight: height, timelineWidth: width }).width || width;
  // One effect per class, stacked in EFFECT_CHANNELS order, every parameter we use pinned (class defaults like Blur's 6 px are not neutral).
  const classes: string[] = [];
  for (const ch of EFFECT_CHANNELS) if (channels.has(ch) && !classes.includes(effectClass(ch))) classes.push(effectClass(ch));
  const effects: Effect[] = [];
  for (const cls of classes) {
    const effect = createEffect(cls, {}, { id: nextId() }) as Record<string, unknown>;
    for (const ch of EFFECT_CHANNELS) {
      if (effectClass(ch) !== cls) continue;
      const param = ch.slice(cls.length + 1);
      const values = side.frames.map((_, i) => effectValue(ch, side.values[i]![ch] ?? MOTION_NEUTRAL[ch], decodeWidth));
      effect[param] = spliceFrames(null, side.rest, side.frames, values, MOTION_NEUTRAL[ch]);
    }
    effects.push(effect as Effect);
  }
  next.effects = [...(side.clip.effects ?? []), ...effects];
  const lo = Math.min(side.rest, side.frames[0]!);
  const hi = Math.max(side.rest, side.frames[side.frames.length - 1]!);
  const full: MotionTransitionRecord = { ...record, role: side.role, partner, window: [lo, hi], props, effects: effects.map((e) => String(e.id)) };
  next[MOTION_TRANSITIONS_KEY] = [...motionRecords(side.clip), full];
  return { clip: next as Clip, receipt: { id: side.clip.id, role: side.role, frames: [lo, hi], properties: written, effectIds: full.effects } };
}

/** Records on `clip` (other than `except`) whose window overlaps [lo, hi]. */
function clash(clip: Clip, lo: number, hi: number, except?: string): MotionTransitionRecord | undefined {
  return motionRecords(clip).find((r) => r.id !== except && r.window[0] <= hi && lo <= r.window[1]);
}

/** The transition already on this cut (same clips, same roles). */
function existingOnCut(outClip: Clip, inClip: Clip): string | undefined {
  return motionRecords(outClip).find((r) => r.role === "out" && r.partner === inClip.id)?.id;
}

/**
 * Plan a motion transition on a cut against the current project without
 * recording anything: the clips as they would be after it, or an OpError.
 * Re-applying on a cut that already has one replaces it.
 */
export function planMotionTransitionEdit(project: Project, input: MotionTransitionInput, newId?: string): { clips: Clip[]; result: MotionTransitionResult } {
  const info = getMotionTransition(input.preset);
  if (!info) throw new OpError("not_found", `Unknown motion transition '${input.preset}'.`);
  const cut = cutBetween(project, input.outClipId, input.inClipId);
  requireUnlocked(project, cut.layer, "Track");
  const replaced = existingOnCut(cut.outClip, cut.inClip);
  const outClip = replaced ? withoutRecord(cut.outClip, replaced) : cut.outClip;
  const inClip = replaced ? withoutRecord(cut.inClip, replaced) : cut.inClip;

  const fps = project.fps;
  const rate = rateOf(project);
  const wa = frameWindow(outClip, fps);
  const wb = frameWindow(inClip, fps);
  const lastA = localFrame(wa, wa.endFrame);
  const firstA = wa.localStartFrame;
  const firstB = wb.localStartFrame;
  const lastB = localFrame(wb, wb.endFrame);

  let direction: MotionDirection | undefined;
  if (input.direction === "auto" || input.direction === undefined) {
    direction = autoDirection(project, input.preset, cut.layer, cut.cut);
  } else {
    if (!info.directions.includes(input.direction)) {
      throw invalid(info.directions.length ? `${input.preset} goes ${info.directions.join(", ")} or auto (got ${input.direction}).` : `${input.preset} has no direction (got ${input.direction}).`);
    }
    direction = input.direction;
  }
  if (input.frames !== undefined && !(Number.isInteger(input.frames) && input.frames >= 2 && input.frames <= 120)) {
    throw invalid(`frames must be a whole number 2-120 (got ${input.frames}).`);
  }
  const width = Number(project.width) || 1920;
  const height = Number(project.height) || 1080;
  const plan = planMotionTransition({ preset: input.preset, frames: input.frames, fps: rate, direction, intensity: input.intensity, aspect: width / height, focus: input.focus });
  const nOut = plan.out.frames.length;
  const nIn = plan.in.frames.length;
  // Each clip needs its moving frames plus a rest frame of its own.
  if (lastA - firstA + 1 < nOut + 1) throw invalid(`Clip ${outClip.id} is too short (${lastA - firstA + 1} frames) for ${plan.frames} frames of ${input.preset}; it needs ${nOut + 1}. Use fewer frames.`);
  if (lastB - firstB + 1 < nIn + 1) throw invalid(`Clip ${inClip.id} is too short (${lastB - firstB + 1} frames) for ${plan.frames} frames of ${input.preset}; it needs ${nIn + 1}. Use fewer frames.`);
  const outSide: SidePlan = { clip: outClip, role: "out", rest: lastA - nOut, frames: Array.from({ length: nOut }, (_, i) => lastA - nOut + 1 + i), values: plan.out.frames };
  const inSide: SidePlan = { clip: inClip, role: "in", rest: firstB + nIn, frames: Array.from({ length: nIn }, (_, i) => firstB + i), values: plan.in.frames };
  const otherA = clash(outClip, outSide.rest, lastA);
  if (otherA) throw new OpError("conflict", `Clip ${outClip.id} is too short for two motion transitions: this one would overlap ${otherA.preset} (${otherA.id}). Use fewer frames or remove that one first.`);
  const otherB = clash(inClip, firstB, inSide.rest);
  if (otherB) throw new OpError("conflict", `Clip ${inClip.id} is too short for two motion transitions: this one would overlap ${otherB.preset} (${otherB.id}). Use fewer frames or remove that one first.`);

  const nextId = ids(project);
  const id = newId ?? replaced ?? `MT${nextId()}`;
  const base = { id, preset: plan.preset, direction: plan.direction, intensity: plan.intensity, frames: plan.frames, cut: Math.round(cut.cut * 1e6) / 1e6, ...(input.preset === "zoom_through" ? { focus: { x: input.focus?.x ?? 0.5, y: input.focus?.y ?? 0.5 } } : {}) };
  const a = writeSide(outSide, base, inClip.id, project, nextId);
  const b = writeSide(inSide, base, outClip.id, project, nextId);
  const round = (t: number): number => Math.round(t * 1000) / 1000;
  const result: MotionTransitionResult = {
    id,
    preset: plan.preset,
    direction: plan.direction,
    intensity: plan.intensity,
    frames: plan.frames,
    layer: cut.layer,
    cut: round(cut.cut),
    clips: [a.receipt, b.receipt],
    sfxCues: plan.sfx.map((s) => ({ time: round(Math.max(0, cut.cut + s.offset / rate)), kind: s.kind, duration: round(s.frames / rate) })),
  };
  if (replaced) result.replaced = replaced;
  return { clips: [a.clip, b.clip], result };
}

/** Apply (or replace) a motion transition on one cut. */
export function applyMotionTransition(tx: Transaction, input: MotionTransitionInput): MotionTransitionResult {
  const { clips, result } = planMotionTransitionEdit(tx.project, input);
  for (const clip of clips) tx.replace(["clips", { id: clip.id }], clip);
  return result;
}

/** Remove a motion transition from both its clips. Returns the clip ids changed. */
export function removeMotionTransition(tx: Transaction, id: string): string[] {
  const clips = tx.project.clips.filter((c) => motionRecords(c).some((r) => r.id === id));
  if (clips.length === 0) throw new OpError("not_found", `No motion transition with id ${id}.`, { id });
  for (const clip of clips) requireUnlocked(tx.project, clip.layer, "Track");
  const changed: string[] = [];
  for (const clip of clips) {
    tx.replace(["clips", { id: clip.id }], withoutRecord(clip, id));
    changed.push(clip.id);
  }
  return changed;
}
