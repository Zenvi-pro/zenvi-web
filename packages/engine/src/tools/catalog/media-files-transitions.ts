/**
 * Transitions on the timeline: list_timeline_transitions_tool,
 * update_transition_tool, reverse_transition_tool, remove_transition_tool,
 * copy_transition_tool and add_transitions_between_clips_tool.
 *
 * Ports of zenvi-core develop 1f80cb3d0
 * src/classes/editor_tools/media_files_transitions.py. The Mask rules the
 * desktop keeps in transition_ops.py (direction, curves following a new
 * length, Reverse, mask defaults, a new Mask) are the engine's
 * ops/transitions.ts, and mask names resolve with the catalog's
 * `lookupTransition`. Each tool plans on copies, validates everything, then
 * records one `call.commit` (one undo step); a refusal records nothing.
 *
 * A Mask transition sits on a track over the overlap of two clips (a
 * crossfade or wipe from the earlier clip to the later one) or over one
 * clip's edge (a fade in or out). It only shows where clips overlap, so a
 * crossfade's new length moves the later clip (and, with ripple, what follows
 * it on that track).
 *
 * Web differences: a mask given as an image file path is read only where
 * the host has local files (the CLI; elsewhere pass mask_file_id with a
 * project image); duration_seconds=0 is the engine's default transition
 * length, since the web has no preferences.
 */

import type { Clip, Fraction, Interpolation, Keyframe, Project, ReaderInfo, Transition } from "../../model/types.js";
import { DEFAULT_TRANSITION_LENGTH } from "../../model/defaults.js";
import { setClipTiming, moveClip } from "../../ops/clips.js";
import {
  addMaskTransition,
  maskDefaultCurves,
  maskReader,
  moveTransition,
  removeTransition,
  rescaledTransitionCurves,
  reversedTransitionCurves,
  transitionDirection,
  transitionMaskReader,
  usesStaticMask,
  writeTransition,
} from "../../ops/transitions.js";
import { sameJson } from "../../ops/internal.js";
import { TRANSITIONS, lookupTransition, transitionKey } from "../../transitions/catalog.js";
import { contractTool, type CatalogTool, type ToolCall } from "../define.js";
import { pyFixed, pyRepr, pyReprString, pyStr } from "../pyfmt.js";
import type { ContractInput } from "../schemas.gen.js";
import { BEZIER, interpolationCode, keyframePoint, pyTruthy } from "./effect-values.js";
import { ToolError, editorRun, gridOf, nothingChanged, ok, r3, resolveLayer, uiTrack } from "./timeline-edit-common.js";

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } as const;
const EDIT = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const REMOVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

const EPS = 1e-4;

type Data = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Reading transitions
// ---------------------------------------------------------------------------

/** `_span`: [position, position + max(0, end - start)). */
function span(data: Data): [number, number] {
  const position = Number(data.position) || 0;
  return [position, position + Math.max(0, (Number(data.end) || 0) - (Number(data.start) || 0))];
}

/** `_layer_of`: int(layer or 0), 0 for junk. */
function layerOf(data: Data): number {
  const n = Math.trunc(Number(data.layer) || 0);
  return Number.isFinite(n) ? n : 0;
}

/** `_clips_on`: the clips of a track, by position (ties in project order). */
function clipsOn(project: Project, layer: number): Clip[] {
  return project.clips
    .filter((c) => layerOf(c) === layer)
    .map((c, i) => ({ c, i }))
    .sort((x, y) => (Number(x.c.position) || 0) - (Number(y.c.position) || 0) || x.i - y.i)
    .map(({ c }) => c);
}

/** `_transitions`: the Mask transitions (every transition the timeline draws). */
function maskTransitions(project: Project): Transition[] {
  return project.effects.filter((t) => String(t.type || "Mask") === "Mask" || "brightness" in t);
}

function byStart(items: readonly Transition[]): Transition[] {
  return items
    .map((t, i) => ({ t, i }))
    .sort((x, y) => span(x.t)[0] - span(y.t)[0] || layerOf(x.t) - layerOf(y.t) || x.i - y.i)
    .map(({ t }) => t);
}

function stem(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** `mask_name`: the mask image's file name without extension ('' when it has none). */
function maskName(data: Data): string {
  const path = String(transitionMaskReader(data).path || data.resource || "");
  return path ? stem(path) : "";
}

/** `_first_value`: the Y of a keyframe's earliest point, or null. */
function firstValue(kf: unknown): number | null {
  const points = kf && typeof kf === "object" && Array.isArray((kf as Keyframe).Points) ? (kf as Keyframe).Points : [];
  if (points.length === 0) return null;
  const x = (p: unknown) => Number((p as { co?: { X?: unknown } })?.co?.X);
  const sorted = points.map((p, i) => ({ p, i })).sort((a, b) => x(a.p) - x(b.p) || a.i - b.i);
  const y = Number(sorted[0]!.p?.co?.Y);
  return Number.isFinite(y) ? y : null;
}

/** `joined_pair`: (earlier, later) when the transition covers the overlap of two clips on its track. */
function joinedPair(project: Project, data: Data): [Clip, Clip] | null {
  const [t0, t1] = span(data);
  const over = clipsOn(project, layerOf(data)).filter((c) => span(c)[0] < t1 - EPS && span(c)[1] > t0 + EPS);
  let best: [number, Clip, Clip] | null = null;
  for (let i = 0; i < over.length; i += 1) {
    let a = over[i]!;
    for (let b of over.slice(i + 1)) {
      let [a0, a1] = span(a);
      let [b0, b1] = span(b);
      if (b0 < a0) [a, b, a0, a1, b0, b1] = [b, a, b0, b1, a0, a1];
      const lo = Math.max(a0, b0);
      const hi = Math.min(a1, b1);
      if (hi - lo <= EPS || b0 <= a0 + EPS) continue;
      const cover = Math.min(hi, t1) - Math.max(lo, t0);
      if (best === null || cover > best[0]) best = [cover, a, b];
    }
  }
  return best ? [best[1], best[2]] : null;
}

/** `_edge`: which clip edge the transition fades, when it sits on one clip's first or last part. */
function clipEdge(project: Project, data: Data): ["start" | "end", Clip] | null {
  const [t0, t1] = span(data);
  const tol = gridOf(project).frame * 1.5;
  for (const c of clipsOn(project, layerOf(data))) {
    const [c0, c1] = span(c);
    if (Math.abs(c0 - t0) <= tol && t1 <= c1 + tol) return ["start", c];
    if (Math.abs(c1 - t1) <= tol && t0 >= c0 - tol) return ["end", c];
  }
  return null;
}

/** `describe_transition`: one transition as the receipts list it. */
function describeTransition(project: Project, data: Data): Record<string, unknown> {
  const [t0, t1] = span(data);
  const layer = layerOf(data);
  const direction = transitionDirection(data) ?? "custom";
  const out: Record<string, unknown> = {
    transition_id: String(data.id),
    mask: maskName(data),
    title: String(data.title || ""),
    track: uiTrack(project, layer),
    layer,
    position: r3(t0),
    end: r3(t1),
    duration: r3(t1 - t0),
    direction,
    contrast: firstValue(data.contrast),
    audio_crossfade: pyTruthy(data.fade_audio_hint),
    invert_mask: pyTruthy(data.mask_invert),
  };
  if (pyTruthy(data.replace_image)) out.replace_image = true;
  const pair = joinedPair(project, data);
  if (pair) {
    out.between_clip_ids = [pair[0].id, pair[1].id];
    // Reversing OR inverting alone makes the later clip show first and the earlier one
    // flash back before the cut; both together wipe from the other side, in order.
    const forward = (direction === "default") !== out.invert_mask;
    out.order = forward ? "earlier_to_later" : "later_first";
    out.clip_overlap = r3(Math.max(0, span(pair[0])[1] - span(pair[1])[0]));
  } else {
    const edge = clipEdge(project, data);
    if (edge) out[`on_clip_${edge[0]}`] = edge[1].id;
  }
  return out;
}

function described(call: ToolCall, transitions: readonly Transition[]): Record<string, unknown>[] {
  const project = call.doc.project;
  return transitions.map((t) => describeTransition(project, project.effects.find((x) => x.id === t.id) ?? t));
}

// ---------------------------------------------------------------------------
// Which transitions a call means
// ---------------------------------------------------------------------------

interface TransitionTarget {
  transition_ids?: string[];
  between_clip_ids?: string[];
  track?: string;
  at_seconds?: number | null;
  scope?: string;
}

/** Transitions selected in the host's timeline (desktop `window.selected_transitions`). */
function selectedTransitionIds(call: ToolCall): string[] {
  const ui = call.host.ui;
  const fromSelection = ui?.selection?.().transitions;
  if (fromSelection) return [...fromSelection];
  const known = new Set(call.doc.project.effects.map((t) => t.id));
  return (ui?.selectedIds?.() ?? []).filter((id) => known.has(id));
}

/** `resolve_transitions`: by ids, clip pair, selection, track, all or time. Never empty. */
function resolveTransitions(call: ToolCall, target: TransitionTarget): Transition[] {
  const project = call.doc.project;
  const scope = (target.scope ?? "").trim().toLowerCase();
  if (target.transition_ids && target.transition_ids.length > 0) {
    const out: Transition[] = [];
    for (const tid of target.transition_ids) {
      const t = project.effects.find((x) => x.id === String(tid).trim());
      if (!t) throw new ToolError(`no transition with id=${pyRepr(tid)} (list_timeline_transitions_tool lists them)`);
      if (!out.includes(t)) out.push(t);
    }
    return out;
  }
  if (target.between_clip_ids && target.between_clip_ids.length > 0) {
    const ids = target.between_clip_ids.map((i) => String(i).trim()).filter(Boolean);
    if (ids.length !== 2) throw new ToolError("between_clip_ids takes exactly two timeline clip ids");
    const clips = ids.map((cid) => {
      const c = project.clips.find((x) => x.id === cid);
      if (!c) throw new ToolError(`no timeline clip with id=${pyReprString(cid)}`);
      return c;
    });
    const wanted = new Set(clips.map((c) => c.id));
    const found = maskTransitions(project).filter((t) => {
      const pair = joinedPair(project, t);
      return pair !== null && wanted.size === 2 && wanted.has(pair[0].id) && wanted.has(pair[1].id);
    });
    if (found.length === 0) throw new ToolError("no transition joins those two clips (add one with add_transitions_between_clips_tool)");
    return found;
  }
  const track = target.track ?? "";
  const layer = track.trim() ? resolveLayer(project, track) : null;
  if (scope === "selected") {
    const ids = selectedTransitionIds(call);
    if (ids.length === 0) throw new ToolError("no transitions are selected in the timeline");
    return resolveTransitions(call, { transition_ids: ids });
  }
  const candidates = byStart(maskTransitions(project).filter((t) => layer === null || layerOf(t) === layer));
  if (scope === "track" || scope === "all") {
    if (scope === "track" && layer === null) throw new ToolError("scope='track' needs track");
    if (candidates.length === 0) throw new ToolError(scope === "all" ? "the timeline has no transitions" : `track ${pyStr(track)} has no transitions`);
    return candidates;
  }
  const where = layer !== null ? ` on track ${pyStr(track)}` : "";
  if (target.at_seconds !== undefined && target.at_seconds !== null) {
    const t = Number(target.at_seconds);
    const half = gridOf(project).frame / 2;
    let under = candidates.filter((x) => span(x)[0] - half <= t && t <= span(x)[1] + half);
    if (under.length === 0) {
      const gap = (x: Transition) => Math.min(Math.abs(span(x)[0] - t), Math.abs(span(x)[1] - t));
      const near = candidates.map((x, i) => ({ x, i })).sort((a, b) => gap(a.x) - gap(b.x) || a.i - b.i)[0]?.x;
      under = near && gap(near) <= 0.5 ? [near] : [];
    }
    if (under.length === 0) throw new ToolError(`no transition at ${pyFixed(t, 2)}s${where}`);
    if (under.length > 1) {
      throw new ToolError(
        `${under.length} transitions at ${pyFixed(t, 2)}s on different tracks (${under.map((x) => x.id).join(", ")}); pass track or transition_ids`,
      );
    }
    return under;
  }
  if (candidates.length === 1) return candidates;
  if (candidates.length === 0) throw new ToolError(`the timeline has no transitions${where}`);
  throw new ToolError(`${candidates.length} transitions match; say which with transition_ids, between_clip_ids, at_seconds or scope`);
}

/** `_ensure_unlocked`: refuse when any of these items sits on a locked track. */
function ensureUnlocked(project: Project, items: readonly Data[]): void {
  const lockedLayers = new Set(project.layers.filter((l) => l.lock).map((l) => l.number));
  const locked = [...new Set(items.filter((i) => lockedLayers.has(layerOf(i))).map((i) => uiTrack(project, layerOf(i)) || layerOf(i)))].sort((a, b) => a - b);
  if (locked.length > 0) throw new ToolError(`track(s) ${pyRepr(locked)} are locked; unlock them first`);
}

// ---------------------------------------------------------------------------
// Masks and curves
// ---------------------------------------------------------------------------

interface PickedMask {
  reader: ReaderInfo;
  title: string;
}

/** `os.path.isabs` on either platform. */
function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

/**
 * `_pick_mask` + `_mask_reader_json`: a mask by name, alias or catalog path;
 * an existing image or video file path comes first, as on the desktop, where
 * the host reads local files (the CLI).
 */
async function pickMask(call: ToolCall, name: string): Promise<PickedMask> {
  const raw = name.trim();
  if (isAbsolutePath(raw) && call.host.media?.importPath) {
    const probed = await call.host.media.probe(raw).catch(() => null);
    if (probed) {
      const { media_type: _mediaType, ...reader } = probed as ReaderInfo & { media_type?: unknown };
      return { reader: reader as ReaderInfo, title: stem(raw).toLowerCase() };
    }
  }
  const { entry, candidates } = lookupTransition(name);
  if (!entry) {
    const hint = candidates.length > 0 ? `; did you mean ${candidates.join(", ")}` : "";
    throw new ToolError(`unknown transition ${pyReprString(name)}${hint} (list_transitions_tool / search_transitions_tool)`);
  }
  return { reader: maskReader(entry.storedPath), title: transitionKey(entry) };
}

/** `_base.keyframe`: [(frame, value, interpolation)] as keyframe JSON, sorted by frame. */
function keyframeOf(points: readonly [number, number, number][]): Keyframe {
  const sorted = points.map((p, i) => ({ p, i })).sort((a, b) => a.p[0] - b.p[0] || a.i - b.i);
  return { Points: sorted.map(({ p }) => keyframePoint(p[0], p[1], p[2])) } as unknown as Keyframe;
}

interface KeyframeItem {
  seconds: number;
  value: number;
  interpolation?: string;
}

/** `_curve_from_points`: keyframes in seconds from the transition's start, as frames of the transition. */
function curveFromPoints(project: Project, points: readonly KeyframeItem[], duration: number): Keyframe {
  const fps = gridOf(project).fps;
  const out: [number, number, number][] = [];
  for (const p of points) {
    const sec = Number(p.seconds);
    if (sec > duration + 1e-6) {
      throw new ToolError(`keyframe at ${pyFixed(sec, 3)}s is past the end of the ${pyFixed(duration, 3)}s transition`);
    }
    out.push([pyRoundInt(sec * fps) + 1, Number(p.value), interpolationCode(p.interpolation || "bezier")]);
  }
  if (out.length === 0) throw new ToolError("a keyframe list needs at least one point");
  return keyframeOf(out);
}

/** Python `int(round(x))`. */
function pyRoundInt(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  const r = diff > 0.5 ? f + 1 : diff < 0.5 ? f : f % 2 === 0 ? f : f + 1;
  return r === 0 ? 0 : r;
}

/** `f"{x:+.2f}"`. */
function signed2(x: number): string {
  const text = pyFixed(x, 2);
  return text.startsWith("-") ? text : `+${text}`;
}

function projectFps(project: Project): Fraction {
  const num = Math.trunc(Number(project.fps?.num)) || 30;
  const den = Math.trunc(Number(project.fps?.den)) || 1;
  return { num, den };
}

function isClipId(project: Project, id: string): boolean {
  return project.clips.some((c) => c.id === id);
}

// ---------------------------------------------------------------------------
// list_timeline_transitions_tool
// ---------------------------------------------------------------------------

function listTimelineTransitions(call: ToolCall, input: ContractInput<"list_timeline_transitions_tool">) {
  const project = call.doc.project;
  const track = input.track ?? "";
  const layer = track.trim() ? resolveLayer(project, track) : null;
  let items = maskTransitions(project).filter((t) => layer === null || layerOf(t) === layer);
  if (input.at_seconds !== undefined && input.at_seconds !== null) {
    const at = Number(input.at_seconds);
    const half = gridOf(project).frame / 2;
    items = items.filter((t) => span(t)[0] - half <= at && at <= span(t)[1] + half);
  }
  let rows = byStart(items).map((t) => describeTransition(project, t));
  if (input.timeline_clip_id) {
    const cid = input.timeline_clip_id.trim();
    rows = rows.filter((r) => ((r.between_clip_ids as string[] | undefined) ?? []).includes(cid) || r.on_clip_start === cid || r.on_clip_end === cid);
  }
  const where = layer !== null ? ` on track ${track}` : "";
  return ok(call, `${rows.length} transition(s)${where}.`, { transitions: rows });
}

// ---------------------------------------------------------------------------
// update_transition_tool
// ---------------------------------------------------------------------------

async function updateTransition(call: ToolCall, input: ContractInput<"update_transition_tool">) {
  let targets = resolveTransitions(call, input);
  ensureUnlocked(call.doc.project, targets);
  const g = gridOf(call.doc.project);
  let newDur = Number(input.duration_seconds ?? 0) || 0;
  if (newDur) {
    newDur = g.snap(newDur);
    if (newDur < g.frame) throw new ToolError("duration_seconds must be at least one frame");
  }
  const flip = input.flip_wipe_side ?? false;
  const invert = input.invert_mask ?? null;
  const position = input.position_seconds ?? null;
  const mask = input.mask ?? "";
  const maskFileId = input.mask_file_id ?? "";
  const contrast = input.contrast ?? null;
  const brightnessKeyframes = input.brightness_keyframes ?? [];
  const contrastKeyframes = input.contrast_keyframes ?? [];
  const interpolation = input.interpolation ?? "";
  const audio = input.audio_crossfade ?? null;
  const replaceImage = input.replace_image ?? null;
  const keepOverlap = input.keep_overlap ?? false;
  const ripple = input.ripple ?? true;
  if (flip && invert !== null) throw new ToolError("pass flip_wipe_side or invert_mask, not both");
  if (
    !(
      newDur ||
      position !== null ||
      mask ||
      maskFileId ||
      flip ||
      invert !== null ||
      contrast !== null ||
      brightnessKeyframes.length > 0 ||
      contrastKeyframes.length > 0 ||
      interpolation ||
      audio !== null ||
      replaceImage !== null
    )
  ) {
    throw new ToolError(
      "nothing to change: pass duration_seconds, position_seconds, mask, flip_wipe_side, contrast, " +
        "keyframes, interpolation, audio_crossfade or replace_image",
    );
  }
  if (mask && maskFileId) throw new ToolError("pass mask or mask_file_id, not both");
  if (position !== null && targets.length > 1) throw new ToolError("position_seconds moves one transition; several were chosen");

  let newReader: Data | null = null;
  let newTitle: string | null = null;
  if (mask) {
    const picked = await pickMask(call, mask);
    newReader = picked.reader;
    newTitle = picked.title;
    // A file probe can take a moment: plan against the project as it is now.
    targets = targets.map((t) => call.doc.project.effects.find((x) => x.id === t.id) ?? t);
  } else if (maskFileId) {
    const file = call.doc.project.files.find((f) => f.id === maskFileId.trim());
    if (!file) throw new ToolError(`no project file with id=${pyReprString(maskFileId)}`);
    if (!["image", "video"].includes(String(file.media_type || ""))) throw new ToolError("the mask must be an image or video file");
    const { ai_metadata: _ai, ...reader } = structuredClone(file) as Data;
    newReader = reader;
    newTitle = stem(String(file.path || ""));
  }
  const project = call.doc.project;
  const fps = projectFps(project);

  // Plan every change on copies first; nothing is saved until all targets validate.
  // Ripples add up left to right, so positions are tracked live while planning.
  const ordered = targets
    .map((t, i) => ({ t, i }))
    .sort((a, b) => layerOf(a.t) - layerOf(b.t) || span(a.t)[0] - span(b.t)[0] || a.i - b.i)
    .map(({ t }) => t);
  const live = new Map<string, number>();
  const lpos = (item: Data): number => live.get(String(item.id)) ?? (Number(item.position) || 0);
  const lspan = (item: Data): [number, number] => {
    const [s0, s1] = span(item);
    return [lpos(item), lpos(item) + (s1 - s0)];
  };

  const plans: [Transition, Data][] = [];
  const notes: string[] = [];
  for (const t of ordered) {
    const old = structuredClone(t) as Data;
    const data = structuredClone(t) as Data;
    const [t0, t1] = lspan(t);
    data.position = t0;
    const dur = t1 - t0;
    if (newDur && Math.abs(newDur - dur) > EPS) {
      const pair = joinedPair(project, old);
      const side = pair ? null : (clipEdge(project, old)?.[0] ?? null);
      if (pair && !keepOverlap) {
        const [a, b] = pair;
        const [a0, a1] = lspan(a);
        const [b0, b1] = lspan(b);
        const shorter = Math.min(a1 - a0, b1 - b0);
        if (newDur >= shorter - EPS) {
          throw new ToolError(`a ${pyFixed(newDur, 2)}s crossfade needs both clips to be longer; the shorter clip is ${pyFixed(shorter, 2)}s`);
        }
        // Move the later clip so the overlap is exactly the new length.
        const delta = a1 - newDur - b0;
        if (b0 + delta < a0 + EPS) throw new ToolError("the later clip cannot start before the earlier one");
        const layer = layerOf(b);
        if (ripple) {
          const items: Data[] = [...clipsOn(project, layer), ...maskTransitions(project).filter((x) => layerOf(x) === layer)];
          for (const item of items) {
            if (item.id !== t.id && item.id !== a.id && lpos(item) >= b0 - EPS) live.set(String(item.id), lpos(item) + delta);
          }
        } else {
          if (delta > EPS) {
            const blocked = clipsOn(project, layer).filter((c) => c.id !== a.id && c.id !== b.id && b1 - EPS <= lspan(c)[0] && lspan(c)[0] < b1 + delta - EPS);
            if (blocked.length > 0) throw new ToolError("moving only the later clip would overlap the next clip; use ripple=true");
          }
          live.set(b.id, b0 + delta);
        }
        data.position = g.snap(a1 - newDur);
        notes.push(`moved clip ${b.id}${ripple ? " and later items" : ""} by ${signed2(delta)}s`);
      } else if (side === "end") {
        data.position = Math.max(0, g.snap(t1 - newDur));
      }
      data.start = usesStaticMask(data) ? 0.0 : Number(data.start) || 0;
      data.end = Number(data.start) + newDur;
      Object.assign(data, rescaledTransitionCurves(data, dur, newDur, fps));
    }
    if (position !== null) data.position = g.snap(Number(position));
    if (newReader !== null) {
      const wasStatic = usesStaticMask(old);
      data.reader = structuredClone(newReader);
      delete data.mask_reader;
      delete data.resource;
      if (newTitle) data.title = newTitle;
      if (wasStatic !== usesStaticMask(data)) {
        // Still <-> animated masks use different curves: start from that kind's defaults.
        const direction = transitionDirection(old);
        Object.assign(data, maskDefaultCurves(data, fps));
        if (direction === "reversed") Object.assign(data, reversedTransitionCurves(data));
      }
    }
    const length = span(data)[1] - span(data)[0];
    if (brightnessKeyframes.length > 0) data.brightness = curveFromPoints(project, brightnessKeyframes, length);
    if (contrastKeyframes.length > 0) data.contrast = curveFromPoints(project, contrastKeyframes, length);
    if (contrast !== null) data.contrast = keyframeOf([[1, Number(contrast), BEZIER]]);
    if (interpolation) {
      const code = interpolationCode(interpolation);
      const points = (data.brightness as Keyframe | undefined)?.Points ?? [];
      for (const p of points) p.interpolation = code as Interpolation;
    }
    if (invert !== null) data.mask_invert = invert;
    if (flip) {
      data.mask_invert = !pyTruthy(data.mask_invert);
      Object.assign(data, reversedTransitionCurves(data));
    }
    if (audio !== null) data.fade_audio_hint = audio;
    if (replaceImage !== null) data.replace_image = replaceImage;
    live.set(t.id, Number(data.position));
    if (!sameJson(data, old)) plans.push([t, data]);
  }

  const moved: [Data, number][] = [];
  for (const [id, pos] of live) {
    const item: Data | undefined = project.clips.find((c) => c.id === id) ?? project.effects.find((x) => x.id === id);
    if (item && Math.abs((Number(item.position) || 0) - pos) > EPS) moved.push([item, pos]);
  }
  ensureUnlocked(project, moved.map(([item]) => item));
  if (moved.some(([, pos]) => pos < -EPS)) throw new ToolError("that would move a clip before the start of the timeline");
  if (plans.length === 0 && moved.length === 0) {
    return nothingChanged(call, "No change: the transition(s) already have those settings.", { transitions: described(call, ordered) });
  }

  const planned = new Set(plans.map(([t]) => t.id));
  call.commit((tx) => {
    for (const [item, pos] of moved) {
      const id = String(item.id);
      if (planned.has(id)) continue;
      if (isClipId(tx.project, id)) moveClip(tx, id, { position: Math.max(0, pos) });
      else moveTransition(tx, id, { position: Math.max(0, pos) });
    }
    for (const [t, data] of plans) writeTransition(tx, t.id, data);
  });
  let summary = `Updated ${plans.length} transition(s)`;
  if (notes.length > 0) summary += "; " + [...new Set(notes)].join("; ");
  return ok(call, summary + ".", {
    changed: true,
    transitions: described(call, ordered),
    moved_ids: moved.map(([item]) => String(item.id)).filter((id) => !planned.has(id)),
  });
}

// ---------------------------------------------------------------------------
// reverse_transition_tool / remove_transition_tool
// ---------------------------------------------------------------------------

function reverseTransitions(call: ToolCall, input: ContractInput<"reverse_transition_tool">) {
  const targets = resolveTransitions(call, input);
  ensureUnlocked(call.doc.project, targets);
  const plans: [Transition, Data][] = [];
  for (const t of targets) {
    const data = { ...(structuredClone(t) as Data), ...reversedTransitionCurves(t) };
    if (!sameJson(data, t)) plans.push([t, data]);
  }
  if (plans.length === 0) {
    return nothingChanged(call, "No change: those transitions have constant curves, so reversing does nothing.", { transitions: described(call, targets) });
  }
  call.commit((tx) => {
    for (const [t, data] of plans) writeTransition(tx, t.id, data);
  });
  return ok(call, `Reversed ${plans.length} transition(s).`, { changed: true, transitions: described(call, plans.map(([t]) => t)) });
}

function removeTransitions(call: ToolCall, input: ContractInput<"remove_transition_tool">) {
  const targets = resolveTransitions(call, input);
  ensureUnlocked(call.doc.project, targets);
  const removed = described(call, targets);
  call.commit((tx) => {
    for (const t of targets) removeTransition(tx, t.id);
  });
  return ok(call, `Removed ${removed.length} transition(s); the clips were not changed.`, {
    removed_transition_ids: removed.map((r) => r.transition_id),
    removed,
  });
}

// ---------------------------------------------------------------------------
// copy_transition_tool
// ---------------------------------------------------------------------------

const PASTE_EXCLUDED = new Set(["id", "position", "layer", "start", "end", "duration"]);
const COPY_KEYS: Readonly<Record<string, readonly string[]>> = {
  keyframes: ["brightness", "contrast"],
  brightness: ["brightness"],
  contrast: ["contrast"],
  mask: ["reader", "mask_reader", "title", "mask_invert"],
};

function copyTransition(call: ToolCall, input: ContractInput<"copy_transition_tool">) {
  const project = call.doc.project;
  const source = project.effects.find((t) => t.id === String(input.source_transition_id).trim());
  if (!source) throw new ToolError(`no transition with id=${pyReprString(String(input.source_transition_id))}`);
  const targets = resolveTransitions(call, input).filter((t) => t.id !== source.id);
  if (targets.length === 0) throw new ToolError("choose at least one other transition to paste onto");
  ensureUnlocked(project, targets);
  const what = input.what ?? "all";
  const fit = input.fit_duration ?? true;
  const fps = projectFps(project);
  const src = structuredClone(source) as Data;
  const [s0, s1] = span(src);
  const keys = what === "all" ? Object.keys(src).filter((k) => !PASTE_EXCLUDED.has(k)) : COPY_KEYS[what]!.filter((k) => k in src);
  const curves = keys.filter((k): k is "brightness" | "contrast" => k === "brightness" || k === "contrast");
  const plans: [Transition, Data][] = [];
  for (const t of targets) {
    const data = structuredClone(t) as Data;
    for (const k of keys) data[k] = structuredClone(src[k]);
    if ((what === "all" || what === "mask") && "reader" in src && !("mask_reader" in src)) delete data.mask_reader;
    const [t0, t1] = span(data);
    if (fit && curves.length > 0) {
      // Only the pasted curves are fitted; the desktop also rescales the target's other curve in place.
      const fitted = rescaledTransitionCurves(data, s1 - s0, t1 - t0, fps);
      for (const k of curves) if (fitted[k]) data[k] = fitted[k];
    }
    if (!sameJson(data, t)) plans.push([t, data]);
  }
  if (plans.length === 0) return nothingChanged(call, "No change: the targets already match.", {});
  call.commit((tx) => {
    for (const [t, data] of plans) writeTransition(tx, t.id, data);
  });
  return ok(call, `Copied ${what} from transition ${source.id} onto ${plans.length} transition(s).`, {
    changed: true,
    transitions: described(call, plans.map(([t]) => t)),
  });
}

// ---------------------------------------------------------------------------
// add_transitions_between_clips_tool
// ---------------------------------------------------------------------------

/** `_clip_media_length`: the clip's media length (reader duration, else the clip's). */
function clipMediaLength(clip: Clip): number {
  const reader = clip.reader && typeof clip.reader === "object" ? (clip.reader as unknown as Data) : {};
  return Number(reader.duration || clip.duration || 0) || 0;
}

/** `_retimed`: the clip's speed is keyframed (a time curve with several points). */
function retimed(clip: Clip): boolean {
  const points = (clip.time as Keyframe | undefined)?.Points;
  return Array.isArray(points) && points.length > 1;
}

interface Join {
  a: Clip;
  b: Clip;
  position: number;
  duration: number;
  replaces: Transition[];
}

async function addTransitionsBetweenClips(call: ToolCall, input: ContractInput<"add_transitions_between_clips_tool">) {
  const track = input.track ?? "";
  const chosenIds = input.timeline_clip_ids ?? [];
  let layer: number;
  let chosen: Set<string> | null = null;
  {
    const project = call.doc.project;
    if (chosenIds.length > 0) {
      const clips = chosenIds.map((cid) => {
        const c = project.clips.find((x) => x.id === String(cid).trim());
        if (!c) throw new ToolError(`no timeline clip with id=${pyRepr(cid)}`);
        return c;
      });
      const layers = new Set(clips.map((c) => layerOf(c)));
      if (layers.size !== 1) throw new ToolError("timeline_clip_ids must all be on one track");
      layer = [...layers][0]!;
      if (track.trim() && resolveLayer(project, track) !== layer) throw new ToolError("timeline_clip_ids are not on that track");
      chosen = new Set(clips.map((c) => c.id));
    } else {
      if (!track.trim()) throw new ToolError("say which track (track) or which clips (timeline_clip_ids)");
      layer = resolveLayer(project, track);
    }
    if (project.layers.some((l) => l.number === layer && l.lock)) {
      throw new ToolError(`track ${uiTrack(project, layer) || layer} is locked; unlock it first`);
    }
  }
  const g = gridOf(call.doc.project);
  // The desktop's Default Transition Length preference; the web uses the engine's default.
  const length = g.snap((input.duration_seconds ?? 1.0) || DEFAULT_TRANSITION_LENGTH);
  const frame = g.frame;
  const fps = g.fps;
  if (length < frame) throw new ToolError("duration_seconds must be at least one frame");
  const name = input.transition ?? "fade";
  const randomize = name.trim().toLowerCase() === "random";
  if (randomize && TRANSITIONS.length === 0) throw new ToolError("no transition images are installed");
  const mask = randomize ? null : await pickMask(call, name || "fade");

  const project = call.doc.project;
  const clips = clipsOn(project, layer);
  if (chosen) {
    const onTrack = new Set(clips.map((c) => c.id));
    const missing = [...chosen].filter((id) => !onTrack.has(id)).sort();
    if (missing.length > 0) throw new ToolError(`clips ${pyRepr(missing)} are not on that track`);
  }
  if (clips.length < 2) throw new ToolError(`track ${uiTrack(project, layer) || layer} has fewer than two clips to join`);
  const existing = maskTransitions(project).filter((t) => layerOf(t) === layer);
  const method = input.method ?? "ripple";
  const maxGap = input.max_gap_seconds ?? 0.05;

  // Live positions as the plan shifts clips (ripple).
  const pos = new Map(clips.map((c) => [c.id, Number(c.position) || 0]));
  const start = new Map(clips.map((c) => [c.id, Number(c.start) || 0]));
  const end = new Map(clips.map((c) => [c.id, Number(c.end) || 0]));
  const tpos = new Map(existing.map((t) => [t.id, Number(t.position) || 0]));
  const joins: Join[] = [];
  const skipped: { join: string; reason: string }[] = [];
  for (let i = 0; i + 1 < clips.length; i += 1) {
    const a = clips[i]!;
    const b = clips[i + 1]!;
    if (chosen && !(chosen.has(a.id) && chosen.has(b.id))) continue;
    const aLen = end.get(a.id)! - start.get(a.id)!;
    const bLen = end.get(b.id)! - start.get(b.id)!;
    const aEnd = pos.get(a.id)! + aLen;
    const gap = pos.get(b.id)! - aEnd;
    const label = `${a.id}->${b.id}`;
    const overlap = Math.max(0, -gap);
    const lo = Math.min(aEnd, pos.get(b.id)!);
    const hi = Math.max(aEnd, pos.get(b.id)!);
    const onJoin = existing.filter((t) => {
      const [x0, x1] = span(t);
      const s = tpos.get(t.id)!;
      return s < hi + frame && s + (x1 - x0) > lo - frame;
    });
    if (onJoin.length > 0 && !input.replace_existing) {
      skipped.push({ join: label, reason: "already has a transition" });
      continue;
    }
    let d = Math.min(length, 0.5 * aLen, 0.5 * bLen);
    d = Math.max(frame, pyRoundInt(d * fps) / fps);
    if (aLen < 2 * frame || bLen < 2 * frame) {
      skipped.push({ join: label, reason: "clip too short" });
      continue;
    }
    if (overlap > frame / 2) {
      // Already overlapping: use that overlap as it is.
      joins.push({ a, b, position: pos.get(b.id)!, duration: Math.min(overlap, aLen, bLen), replaces: onJoin });
      continue;
    }
    if (method === "existing_overlaps") {
      skipped.push({ join: label, reason: "clips do not overlap" });
      continue;
    }
    if (gap > maxGap + EPS) {
      skipped.push({ join: label, reason: `${pyFixed(gap, 2)}s gap` });
      continue;
    }
    if (method === "handles") {
      const half = d / 2;
      if (retimed(a) || retimed(b)) {
        skipped.push({ join: label, reason: "speed-changed clip" });
        continue;
      }
      // The cut sits mid-gap; a plays on past it and b starts earlier, each by its
      // spare media, so both keep their frames at the same timeline times.
      const cut = aEnd + Math.max(0, gap) / 2;
      const extendA = cut + half - aEnd;
      // b's new start lands on the frame grid, so position and in-point move together.
      const pullB = pos.get(b.id)! - g.snap(cut - half);
      if (clipMediaLength(a) - end.get(a.id)! < extendA - EPS || start.get(b.id)! < pullB - EPS) {
        skipped.push({ join: label, reason: "not enough spare media around the cut" });
        continue;
      }
      end.set(a.id, end.get(a.id)! + extendA);
      pos.set(b.id, pos.get(b.id)! - pullB);
      start.set(b.id, start.get(b.id)! - pullB);
      joins.push({ a, b, position: pos.get(b.id)!, duration: d, replaces: onJoin });
      continue;
    }
    // ripple: pull b and everything after it earlier so the overlap is d.
    const shift = -(d + gap);
    const bPos = pos.get(b.id)!;
    for (const c of clips) if (pos.get(c.id)! >= bPos - EPS && c.id !== a.id) pos.set(c.id, pos.get(c.id)! + shift);
    for (const t of existing) if (tpos.get(t.id)! >= bPos - EPS) tpos.set(t.id, tpos.get(t.id)! + shift);
    for (const j of joins) if (j.position >= bPos - EPS) j.position += shift;
    joins.push({ a, b, position: pos.get(b.id)!, duration: d, replaces: onJoin });
  }

  if (joins.length === 0) {
    const why = skipped.slice(0, 8).map((s) => `${s.join}: ${s.reason}`).join("; ");
    throw new ToolError(why ? `no join to add a transition to (${why})` : "no consecutive clips to join");
  }
  if ([...pos.values()].some((p) => p < -EPS)) throw new ToolError("that would move a clip before the start of the timeline");

  const moved: Record<string, unknown>[] = [];
  const clipChanges: [string, { position?: number; start?: number; end?: number }][] = [];
  for (const c of clips) {
    const newPos = g.snap(Math.max(0, pos.get(c.id)!));
    const changes: { position?: number; start?: number; end?: number } = {};
    if (Math.abs(newPos - (Number(c.position) || 0)) > EPS) changes.position = newPos;
    if (Math.abs(start.get(c.id)! - (Number(c.start) || 0)) > EPS) changes.start = start.get(c.id)!;
    if (Math.abs(end.get(c.id)! - (Number(c.end) || 0)) > EPS) changes.end = end.get(c.id)!;
    if (Object.keys(changes).length > 0) {
      clipChanges.push([c.id, changes]);
      moved.push({ timeline_clip_id: c.id, ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, r3(v)])) });
    }
  }
  const replacedIds = new Set(joins.flatMap((j) => j.replaces.map((t) => t.id)));
  const replaced = existing.filter((t) => replacedIds.has(t.id)).map((t) => t.id);
  const picks = joins.map(() => {
    if (mask) return mask;
    const entry = TRANSITIONS[Math.floor(Math.random() * TRANSITIONS.length)]!;
    return { reader: maskReader(entry.storedPath), title: transitionKey(entry) };
  });
  const added = call.commit((tx) => {
    for (const [id, changes] of clipChanges) setClipTiming(tx, id, changes);
    for (const t of existing) {
      if (replacedIds.has(t.id)) removeTransition(tx, t.id);
      else if (Math.abs(tpos.get(t.id)! - (Number(t.position) || 0)) > EPS) moveTransition(tx, t.id, { position: Math.max(0, tpos.get(t.id)!) });
    }
    return joins.map((j, i) => {
      const picked = picks[i]!;
      const t = addMaskTransition(tx, {
        layer,
        position: Math.max(0, j.position),
        duration: j.duration,
        reader: picked.reader,
        title: picked.title,
        fadeAudio: input.audio_crossfade ?? true,
      });
      return { transition_id: t.id, mask: picked.title, between_clip_ids: [j.a.id, j.b.id], position: t.position, duration: t.end };
    });
  });
  let summary = `Added ${added.length} transition(s) on track ${uiTrack(project, layer) || layer}`;
  if (moved.length > 0 && method === "ripple") summary += `; moved ${moved.length} clip(s) earlier to make the overlaps`;
  else if (moved.length > 0) summary += `; extended ${moved.length} clip(s) into their spare media`;
  if (skipped.length > 0) summary += `; skipped ${skipped.length} join(s)`;
  return ok(call, summary + ".", { changed: true, added, skipped, moved_clips: moved, replaced_transition_ids: replaced });
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const mediaFilesTransitionTools: CatalogTool[] = [
  contractTool("list_timeline_transitions_tool", {
    annotations: READ,
    run: (call, input) => editorRun(() => listTimelineTransitions(call, input)),
  }),
  contractTool("update_transition_tool", {
    annotations: EDIT,
    run: (call, input) => editorRun(() => updateTransition(call, input)),
  }),
  contractTool("reverse_transition_tool", {
    annotations: EDIT,
    run: (call, input) => editorRun(() => reverseTransitions(call, input)),
  }),
  contractTool("remove_transition_tool", {
    annotations: REMOVE,
    run: (call, input) => editorRun(() => removeTransitions(call, input)),
  }),
  contractTool("copy_transition_tool", {
    annotations: EDIT,
    run: (call, input) => editorRun(() => copyTransition(call, input)),
  }),
  contractTool("add_transitions_between_clips_tool", {
    annotations: EDIT,
    run: (call, input) => editorRun(() => addTransitionsBetweenClips(call, input)),
  }),
];
