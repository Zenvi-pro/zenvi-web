/**
 * Clip look and motion: get_clip_properties_tool, set_clip_properties_tool,
 * remove_keyframes_tool, copy_clip_keyframes_tool and apply_clip_preset_tool.
 *
 * Ports of zenvi-core develop 1f80cb3d0 src/classes/editor_tools/clip_props.py
 * and clip_props_presets.py. Property names, units, ranges and choices come
 * from the clip property model (tools/clip-props-model.ts, libopenshot's own
 * clip schema); the edits are engine ops (ops/clip-props.ts, the clip menu's
 * presets in ops/presets.ts). Each call validates everything first, records
 * its change in one `call.commit`, and answers the desktop's summary line
 * with its receipt object as `data`.
 */

import { COPY_KEYFRAME_GROUPS, curvePoints, pointY, type CopyKeyframeGroup } from "../../keyframe/rules.js";
import type { Clip, Project } from "../../model/types.js";
import { Interpolation } from "../../model/types.js";
import {
  curveWithoutPoints,
  retimeCurvePoints,
  sameValue,
  setColorCurveValue,
  setCurveValue,
  updateClipValues,
  type RetimeMode,
} from "../../ops/clip-props.js";
import { clampTimingToMedia } from "../../model/timing.js";
import { applyClipPreset, layoutShowAll, type ClipPresetId, type ClipPresetOptions, type PresetRange } from "../../ops/presets.js";
import {
  COLOR_CHANNELS,
  ClipTime,
  coerceValue,
  describeInfo,
  describePoints,
  displayValue,
  isAnimated,
  isChoice,
  mirrorBlocker,
  mirrorWarnings,
  propertyInfo,
  resolveKey,
  roundTo,
  settableKeys,
  storedStatic,
  valueAt,
  GRAVITY_NAMES,
} from "../clip-props-model.js";
import { contractTool, type CatalogTool, type ToolCall, type ToolOutcome } from "../define.js";
import { projectFps } from "../frame-time.js";
import { pyFixed, pyFloat, pyG, pyRepr, pyReprString, pyStr } from "../pyfmt.js";
import { TextToolError } from "../titles-text.js";
import type { ContractInput } from "../schemas.gen.js";
import { playheadSeconds } from "./common.js";
import {
  ToolError,
  clipById,
  describeClip,
  failText,
  nothingChanged,
  ok,
  resolveLayer,
  selectedClipIds,
  targetClip,
  uiTrack,
  type ClipsTarget,
} from "./timeline-edit-common.js";

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } as const;
const EDIT = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

/** A tool body; the desktop's ToolError (and a colour refusal) become "Error: …". */
async function run(body: () => Promise<ToolOutcome> | ToolOutcome): Promise<ToolOutcome> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof ToolError || error instanceof TextToolError) return failText(error.message);
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `_num`: floats rounded to 4 places for receipts. */
function num4(value: unknown): unknown {
  return typeof value === "number" && !Number.isInteger(value) ? roundTo(value, 4) : value;
}

/** `_short`: a float as `.4g`, anything else as `str()`. */
function short(value: unknown): string {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : pyG(value, 4);
  return pyStr(value);
}

// ---------------------------------------------------------------------------
// Targets (clip_props.resolve_targets over _base.resolve_clips)
// ---------------------------------------------------------------------------

export interface SkipRow {
  timeline_clip_id: string;
  reason: string;
}

function isLocked(project: Project, layer: number): boolean {
  return project.layers.some((l) => Math.trunc(Number(l.number) || 0) === layer && Boolean(l.lock));
}

/** _base.resolve_clips: explicit ids, the selection, a whole track, everything, or one described clip. */
async function resolveClips(call: ToolCall, ids: readonly string[], clipQuery: string, track: string, scopeArg: string): Promise<Clip[]> {
  const project = call.doc.project;
  const scope = scopeArg.trim().toLowerCase();
  if (ids.length > 0) {
    return ids.map((id) => {
      const clip = clipById(project, String(id).trim());
      if (!clip) throw new ToolError(`no timeline clip with id=${pyReprString(String(id))}`);
      return clip;
    });
  }
  if (scope === "selected") {
    const selected = selectedClipIds(call);
    if (selected.length === 0) throw new ToolError("no clips are selected in the timeline");
    return resolveClips(call, selected, "", "", "");
  }
  if (scope === "track" || scope === "all") {
    let clips = [...project.clips];
    if (scope === "track") {
      const layer = resolveLayer(project, track);
      clips = clips.filter((c) => Math.trunc(Number(c.layer) || 0) === layer);
    }
    clips.sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0) || (Number(a.layer) || 0) - (Number(b.layer) || 0));
    if (clips.length === 0) throw new ToolError(scope === "all" ? "the timeline has no clips" : `track ${track} has no clips`);
    return clips;
  }
  return [await targetClip(call, { clip_query: clipQuery, track })];
}

/**
 * The clips a batch tool acts on, and the ones it skips. Clips named by id
 * or query are refused when their track is locked; a scope skips locked
 * clips and reports them.
 */
async function resolveTargets(call: ToolCall, target: ClipsTarget): Promise<{ clips: Clip[]; skipped: SkipRow[] }> {
  const project = call.doc.project;
  const ids: string[] = [];
  for (const raw of target.timeline_clip_ids ?? []) {
    const id = String(raw).trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  const explicit = ids.length > 0 || !String(target.scope ?? "").trim();
  const clips = await resolveClips(call, ids, target.clip_query ?? "", target.track ?? "", target.scope ?? "");
  const kept: Clip[] = [];
  const skipped: SkipRow[] = [];
  const seen = new Set<string>();
  for (const clip of clips) {
    if (seen.has(clip.id)) continue;
    seen.add(clip.id);
    const layer = Math.trunc(Number(clip.layer) || 0);
    if (isLocked(project, layer)) {
      const label = uiTrack(project, layer) || layer;
      if (explicit) throw new ToolError(`clip ${clip.id} is on locked track ${label}; unlock the track first`);
      skipped.push({ timeline_clip_id: clip.id, reason: `track ${label} is locked` });
      continue;
    }
    kept.push(clip);
  }
  if (kept.length === 0) throw new ToolError("every matching clip is on a locked track; unlock it first");
  return { clips: kept, skipped };
}

function outsideClip(atSeconds: number, clip: Clip, time: ClipTime): ToolError {
  return new ToolError(
    `at_seconds=${pyFloat(atSeconds)} is outside clip ${clip.id} ` +
      `(timeline ${pyFixed(time.position, 3)}-${pyFixed(time.position + time.duration, 3)} s)`,
  );
}

// ---------------------------------------------------------------------------
// get_clip_properties_tool (clip.properties_get)
// ---------------------------------------------------------------------------

const SUMMARY_KEYS = ["alpha", "scale", "gravity", "scale_x", "scale_y", "location_x", "location_y", "rotation", "volume", "composite"];

async function getClipProperties(call: ToolCall, input: ContractInput<"get_clip_properties_tool">): Promise<ToolOutcome> {
  const project = call.doc.project;
  const clip = await targetClip(call, input);
  const time = ClipTime.of(clip, project);
  let frame: number;
  if (input.at_seconds === undefined || input.at_seconds === null) {
    const atPlayhead = time.fromTimelineSeconds(playheadSeconds(call));
    frame = time.contains(atPlayhead) ? atPlayhead : time.firstFrame;
  } else {
    frame = time.fromTimelineSeconds(input.at_seconds);
    if (!time.contains(frame)) throw outsideClip(input.at_seconds, clip, time);
  }
  const names = input.properties ?? [];
  const keys = names.length > 0 ? names.map(resolveKey) : settableKeys();
  const includeKeyframes = input.include_keyframes ?? true;
  const data = clip as Record<string, unknown>;
  const out: Record<string, Record<string, unknown>> = {};
  const animatedKeys: string[] = [];
  for (const key of keys) {
    const info = propertyInfo(key, clip, project);
    const entry: Record<string, unknown> = { value: displayValue(info, num4(valueAt(info, clip, frame))), ...describeInfo(info) };
    if (info.keyframable) {
      const animated = isAnimated(info, clip);
      entry.animated = animated;
      if (animated) {
        animatedKeys.push(key);
        if (includeKeyframes) {
          if (info.kind === "color") {
            const curves = isRecord(data[key]) ? (data[key] as Record<string, unknown>) : {};
            entry.keyframes = Object.fromEntries(COLOR_CHANNELS.map((ch) => [ch, describePoints(curves[ch], time)]));
          } else {
            entry.keyframes = describePoints(data[key], time);
          }
        }
      }
    }
    out[key] = entry;
  }
  const effects = (clip.effects ?? [])
    .filter(isRecord)
    .map((e) => ({ id: e.id ?? null, class_name: e.class_name ?? null, name: e.name ?? null }));
  const head = describeClip(project, clip);
  const shown = SUMMARY_KEYS.filter((k) => k in out)
    .map((k) => `${k} ${short(out[k]!.value)}`)
    .join(", ");
  const summary =
    `Clip ${clip.id} ${pyReprString(head.title)} (track ${pyStr(head.track)}, ${pyFixed(head.position, 2)}-${pyFixed(head.end, 2)} s) ` +
    `at ${pyFixed(time.timelineSeconds(frame), 2)} s: ${shown || "see receipt"}. ` +
    `Animated: ${animatedKeys.join(", ") || "nothing"}.` +
    (effects.length > 0 ? ` Effects: ${effects.map((e) => pyStr(e.class_name)).join(", ")}.` : "");
  return ok(call, summary, {
    ...head,
    frame,
    at_seconds: time.timelineSeconds(frame),
    clip_seconds: time.clipSeconds(frame),
    first_frame: time.firstFrame,
    end_frame: time.endFrame,
    properties: out,
    effects,
  });
}

// ---------------------------------------------------------------------------
// set_clip_properties_tool (clip.properties_set)
// ---------------------------------------------------------------------------

interface PropertyPlan {
  clip: Clip;
  values: Record<string, unknown>;
  changed: Record<string, { before: unknown; after: unknown }>;
  flattened: Record<string, number>;
  warnings: string[];
}

async function setClipProperties(call: ToolCall, input: ContractInput<"set_clip_properties_tool">): Promise<ToolOutcome> {
  const properties = input.properties;
  if (!isRecord(properties) || Object.keys(properties).length === 0) {
    throw new ToolError('properties must be an object such as {"alpha": 0.5}');
  }
  const keys = new Map<string, string>();
  for (const name of Object.keys(properties)) {
    const key = resolveKey(name);
    if ([...keys.values()].includes(key)) throw new ToolError(`${pyReprString(name)} sets ${key}, which is already in properties`);
    if (key === "time") {
      throw new ToolError(
        "time maps clip frames to source frames (speed); change speed with the speed tools, or animate it with set_keyframes_tool(property='time')",
      );
    }
    keys.set(name, key);
  }
  const { clips, skipped } = await resolveTargets(call, input);
  const project = call.doc.project;
  const atSeconds = input.at_seconds ?? null;

  const plans: PropertyPlan[] = [];
  for (const clip of clips) {
    const data = clip as Record<string, unknown>;
    const time = ClipTime.of(clip, project);
    let frame: number | null = null;
    if (atSeconds !== null) {
      frame = time.fromTimelineSeconds(atSeconds);
      if (!time.contains(frame)) throw outsideClip(atSeconds, clip, time);
    }
    const plan: PropertyPlan = { clip, values: {}, changed: {}, flattened: {}, warnings: [] };
    for (const [name, raw] of Object.entries(properties)) {
      const key = keys.get(name)!;
      const info = propertyInfo(key, clip, project);
      const value = coerceValue(info, raw, project, clip.id);
      const before = valueAt(info, clip, frame ?? time.firstFrame);
      if (info.keyframable) {
        const edit =
          info.kind === "color"
            ? setColorCurveValue(data[key], value as number[], frame)
            : setCurveValue(data[key], Number(value), frame, isChoice(info) ? Interpolation.CONSTANT : Interpolation.BEZIER);
        if (!edit.changed) continue;
        if (edit.flattened) plan.flattened[key] = edit.flattened;
        plan.values[key] = edit.curve;
      } else {
        if (frame !== null) throw new ToolError(`${key} cannot be animated, so it takes no at_seconds; set it without one`);
        const stored = storedStatic(info, value, data[key]);
        if (sameValue(stored, data[key])) continue;
        plan.values[key] = stored;
      }
      plan.changed[key] = {
        before: displayValue(info, num4(before)),
        after: displayValue(info, num4(typeof value === "boolean" ? Number(value) : value)),
      };
    }
    if (Object.keys(plan.values).length > 0) {
      plan.warnings = mirrorWarnings(clip, plan.values);
      plans.push(plan);
    }
  }

  const names = Object.entries(properties)
    .map(([name, value]) => `${keys.get(name)}=${short(value)}`)
    .join(", ");
  if (plans.length === 0) {
    return nothingChanged(call, `Nothing to change: ${names} already set on ${clips.length} clip(s).`, {
      timeline_clip_ids: clips.map((c) => c.id),
      skipped,
    });
  }
  call.commit((tx) => {
    for (const plan of plans) updateClipValues(tx, plan.clip.id, plan.values);
  });
  const rows = plans.map((p) => ({
    timeline_clip_id: p.clip.id,
    changed: p.changed,
    ...(Object.keys(p.flattened).length > 0 ? { flattened_animation: p.flattened } : {}),
    ...(p.warnings.length > 0 ? { warnings: p.warnings } : {}),
  }));
  const flatKeys = [...new Set(plans.flatMap((p) => Object.keys(p.flattened)))].sort();
  const flatNote = flatKeys.length > 0 ? ` Replaced an animation with a static value on: ${flatKeys.join(", ")}.` : "";
  const warnNote = plans.flatMap((p) => p.warnings.map((w) => ` Warning (${p.clip.id}): ${w}.`)).join("");
  const when = atSeconds !== null ? ` at ${pyFixed(atSeconds, 3)} s (keyframe)` : "";
  return ok(call, `Set ${names}${when} on ${plans.length} clip(s).${flatNote}${warnNote}`, { changed: true, clips: rows, skipped });
}

// ---------------------------------------------------------------------------
// remove_keyframes_tool (clip.keyframes)
// ---------------------------------------------------------------------------

async function removeKeyframes(call: ToolCall, input: ContractInput<"remove_keyframes_tool">): Promise<ToolOutcome> {
  const names = (input.properties ?? []).map((p) => String(p).trim()).filter(Boolean);
  if (names.length === 0) throw new ToolError('properties must list at least one property, or ["all"]');
  const wantAll = names.some((n) => n.toLowerCase() === "all");
  const keys = wantAll ? [] : [...new Set(names.map(resolveKey))];
  if (keys.includes("time")) throw new ToolError("removing time keyframes changes the clip's speed; use the speed tools to reset it");
  const { clips, skipped } = await resolveTargets(call, input);
  const project = call.doc.project;
  const start = input.start_seconds ?? null;
  const end = input.end_seconds ?? null;

  const plans: { clip: Clip; values: Record<string, unknown>; report: Record<string, Record<string, number>> }[] = [];
  for (const clip of clips) {
    const data = clip as Record<string, unknown>;
    const time = ClipTime.of(clip, project);
    const lo = start !== null ? time.fromTimelineSeconds(start) : null;
    const hi = end !== null ? time.fromTimelineSeconds(end) : null;
    const clipKeys = wantAll
      ? settableKeys().filter((k) => {
          if (k === "time") return false;
          const info = propertyInfo(k, clip, project);
          return info.keyframable && isAnimated(info, clip);
        })
      : keys;
    const values: Record<string, unknown> = {};
    const report: Record<string, Record<string, number>> = {};
    for (const key of clipKeys) {
      const info = propertyInfo(key, clip, project);
      if (!info.keyframable) throw new ToolError(`${key} holds a single value and has no keyframes; set it with set_clip_properties_tool`);
      if (info.kind === "color") {
        const curves: Record<string, unknown> = isRecord(data[key]) ? structuredClone(data[key] as Record<string, unknown>) : {};
        let removed = 0;
        for (const ch of COLOR_CHANNELS) {
          const result = curveWithoutPoints(curves[ch], lo, hi, key, ch);
          curves[ch] = result.curve;
          removed = Math.max(removed, result.removed);
        }
        if (removed) {
          values[key] = curves;
          report[key] = { removed };
        }
        continue;
      }
      const result = curveWithoutPoints(data[key], lo, hi, key);
      if (result.removed) {
        values[key] = result.curve;
        report[key] = { removed: result.removed, remaining: result.curve.Points.length };
        if (result.resetTo !== undefined) report[key].reset_to = result.resetTo;
      }
    }
    if (Object.keys(values).length > 0) plans.push({ clip, values, report });
  }
  if (plans.length === 0) {
    const where = start === null && end === null ? "" : " in that time range";
    throw new ToolError(`no keyframes to remove${where} on ${clips.length} clip(s) for ${wantAll ? "any animated property" : keys.join(", ")}`);
  }
  call.commit((tx) => {
    for (const plan of plans) updateClipValues(tx, plan.clip.id, plan.values);
  });
  const total = plans.reduce((sum, p) => sum + Object.values(p.report).reduce((s, r) => s + (r.removed ?? 0), 0), 0);
  return ok(call, `Removed ${total} keyframe(s) from ${plans.length} clip(s).`, {
    clips: plans.map((p) => ({ timeline_clip_id: p.clip.id, properties: p.report })),
    skipped,
  });
}

// ---------------------------------------------------------------------------
// copy_clip_keyframes_tool (clip.copy_attributes)
// ---------------------------------------------------------------------------

async function copyClipKeyframes(call: ToolCall, input: ContractInput<"copy_clip_keyframes_tool">): Promise<ToolOutcome> {
  const source = await targetClip(call, { timeline_clip_id: input.source_clip_id, clip_query: input.source_query, track: input.source_track });
  const timing: RetimeMode = input.timing ?? "stretch";
  const wanted = [...new Set((input.groups ?? ["all"]).map((g) => String(g).trim().toLowerCase()).filter(Boolean))];
  const unknown = wanted.filter((g) => !(g in COPY_KEYFRAME_GROUPS));
  if (unknown.length > 0) throw new ToolError(`unknown keyframe group(s) ${pyRepr(unknown)}; choose from ${pyRepr(Object.keys(COPY_KEYFRAME_GROUPS))}`);
  if (wanted.includes("time") && timing !== "exact") throw new ToolError("the time (speed) curve can only be copied with timing='exact'");
  let keys = [...new Set(wanted.flatMap((g) => COPY_KEYFRAME_GROUPS[g as CopyKeyframeGroup] as readonly string[]))];
  const notCopied: string[] = [];
  if (keys.includes("time") && timing !== "exact") {
    keys = keys.filter((k) => k !== "time");
    notCopied.push("time");
  }
  const given = input.timeline_clip_ids ?? [];
  const ids = given.map((id) => String(id).trim()).filter((id) => id && id !== source.id);
  if (given.length > 0 && ids.length === 0) {
    throw new ToolError("the only target given is the source clip itself; name other clips to copy onto");
  }
  if (ids.length === 0 && !input.clip_query && !input.scope) throw new ToolError("name the target clips (timeline_clip_ids, clip_query or scope)");
  const resolved = await resolveTargets(call, { ...input, timeline_clip_ids: ids });
  const targets = resolved.clips.filter((c) => c.id !== source.id);
  if (targets.length === 0) throw new ToolError("no target clips other than the source");

  const project = call.doc.project;
  const src = source as Record<string, unknown>;
  const srcTime = ClipTime.of(source, project);
  const plans: { clip: Clip; values: Record<string, unknown> }[] = [];
  for (const clip of targets) {
    const data = clip as Record<string, unknown>;
    const dstTime = ClipTime.of(clip, project);
    let values: Record<string, unknown> = {};
    for (const key of keys) {
      if (!(key in src)) continue;
      let value = src[key];
      if (isRecord(value) && Array.isArray(value.Points)) {
        value = {
          Points: retimeCurvePoints(
            value.Points,
            { first: srcTime.firstFrame, end: srcTime.endFrame },
            { first: dstTime.firstFrame, end: dstTime.endFrame },
            timing,
          ),
        };
      } else {
        value = structuredClone(value);
      }
      if (!sameValue(data[key], value)) values[key] = value;
    }
    if ("time" in values) {
      // A new speed curve may run past the media: clamp the timing like the speed tools do.
      const trial: Record<string, unknown> = { ...structuredClone(data), ...values };
      const timing = clampTimingToMedia(trial, projectFps(project), data);
      values = { ...values, time: timing.time ?? trial.time, start: timing.start, end: timing.end, duration: timing.duration };
    }
    if (Object.keys(values).length > 0) plans.push({ clip, values });
  }
  const note = notCopied.length > 0 ? ` (${notCopied.join(", ")} not copied: only with timing='exact')` : "";
  if (plans.length === 0) {
    return nothingChanged(call, `Nothing to change: the targets already have clip ${source.id}'s ${wanted.join(", ")} keyframes${note}.`, {
      source_clip_id: source.id,
      timeline_clip_ids: targets.map((c) => c.id),
      skipped: resolved.skipped,
    });
  }
  call.commit((tx) => {
    for (const plan of plans) updateClipValues(tx, plan.clip.id, plan.values);
  });
  return ok(call, `Copied ${wanted.join(", ")} keyframes from clip ${source.id} to ${plans.length} clip(s) (timing=${timing})${note}.`, {
    changed: true,
    source_clip_id: source.id,
    timing,
    clips: plans.map((p) => ({ timeline_clip_id: p.clip.id, properties: Object.keys(p.values).sort() })),
    skipped: resolved.skipped,
    not_copied: notCopied,
  });
}

// ---------------------------------------------------------------------------
// apply_clip_preset_tool (clip_props_presets.py)
// ---------------------------------------------------------------------------

type PresetCall = "fade" | "animate" | "rotate" | "crop" | "layout" | "no_transform" | "volume" | "flip";
type PresetZone = "" | "in" | "out" | "emphasis" | "whole";

export interface ClipMenuPreset {
  name: string;
  category: "fade" | "motion" | "transform" | "volume";
  /** Where a person finds it. */
  menu: string;
  call: PresetCall;
  args: readonly string[];
  /** What duration_seconds / at_seconds mean for it. */
  zone: PresetZone;
}

/** The Clip menu's Fade, Motion, Transform and Volume presets (clip_props_presets.PRESETS), in the desktop's order. */
export const CLIP_MENU_PRESETS: ReadonlyMap<string, ClipMenuPreset> = (() => {
  const out = new Map<string, ClipMenuPreset>();
  const add = (name: string, category: ClipMenuPreset["category"], menu: string, call: PresetCall, args: string[] = [], zone: PresetZone = ""): void => {
    out.set(name, { name, category, menu, call, args, zone });
  };
  const title = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
  add("fade_none", "fade", "Fade > No Fade", "fade", ["NONE", "Entire Clip"]);
  add("fade_in", "fade", "Fade > Fade In (duration_seconds, default 1 s)", "fade", ["IN_FAST", "Start of Clip"], "in");
  add("fade_in_fast", "fade", "Fade > Fade In > Fast (1 s)", "fade", ["IN_FAST", "Start of Clip"], "in");
  add("fade_in_slow", "fade", "Fade > Fade In > Slow (3 s)", "fade", ["IN_SLOW", "Start of Clip"], "in");
  add("fade_out", "fade", "Fade > Fade Out (duration_seconds, default 1 s)", "fade", ["OUT_FAST", "End of Clip"], "out");
  add("fade_out_fast", "fade", "Fade > Fade Out > Fast (1 s)", "fade", ["OUT_FAST", "End of Clip"], "out");
  add("fade_out_slow", "fade", "Fade > Fade Out > Slow (3 s)", "fade", ["OUT_SLOW", "End of Clip"], "out");
  add("fade_in_out", "fade", "Fade > Fade In and Out (duration_seconds, default 1 s)", "fade", ["IN_OUT_FAST", "Entire Clip"], "in");
  add("fade_in_out_fast", "fade", "Fade > Fade In and Out > Fast (1 s)", "fade", ["IN_OUT_FAST", "Entire Clip"], "in");
  add("fade_in_out_slow", "fade", "Fade > Fade In and Out > Slow (3 s)", "fade", ["IN_OUT_SLOW", "Entire Clip"], "in");

  add("motion_none", "motion", "Motion > No Motion", "animate", ["NONE"]);
  const inDirs: [string, string][] = [["bottom", "UP"], ["left", "LEFT"], ["right", "RIGHT"], ["top", "DOWN"]];
  const outDirs: [string, string][] = [["bottom", "DOWN"], ["left", "LEFT"], ["right", "RIGHT"], ["top", "UP"]];
  const sides = ["bottom", "left", "right", "top"];
  for (const [dir, e] of inDirs) add(`back_in_from_${dir}`, "motion", `Motion > In > Back In > From ${title(dir)}`, "animate", [`BACK_IN_${e}`], "in");
  add("blur_in", "motion", "Motion > In > Blur In", "animate", ["BLUR_IN"], "in");
  add("bounce_in", "motion", "Motion > In > Bounce In > Center", "animate", ["BOUNCE_IN"], "in");
  for (const [dir, e] of inDirs) add(`bounce_in_from_${dir}`, "motion", `Motion > In > Bounce In > From ${title(dir)}`, "animate", [`BOUNCE_IN_${e}`], "in");
  add("pop_in", "motion", "Motion > In > Pop In", "animate", ["POP_IN"], "in");
  for (const dir of sides) add(`slide_in_from_${dir}`, "motion", `Motion > In > Slide In > From ${title(dir)}`, "animate", [`SLIDE_IN_${dir.toUpperCase()}`], "in");
  add("spiral_in", "motion", "Motion > In > Spiral In", "animate", ["SPIRAL_IN"], "in");
  for (const [prefix, label, e] of [["wipe_in", "Wipe In", "WIPE_IN"], ["blur_wipe_in", "Blur Wipe In", "BLUR_WIPE_IN"]] as const) {
    add(`${prefix}_circle_expand`, "motion", `Motion > In > ${label} > Circle Expand`, "animate", [`${e}_CIRCLE_EXPAND`], "in");
    add(`${prefix}_circle_shrink`, "motion", `Motion > In > ${label} > Circle Shrink`, "animate", [`${e}_CIRCLE_SHRINK`], "in");
    for (const dir of sides) add(`${prefix}_from_${dir}`, "motion", `Motion > In > ${label} > From ${title(dir)}`, "animate", [`${e}_${dir.toUpperCase()}`], "in");
  }
  for (const [dir, e] of outDirs) add(`back_out_to_${dir}`, "motion", `Motion > Out > Back Out > To ${title(dir)}`, "animate", [`BACK_OUT_${e}`], "out");
  add("blur_out", "motion", "Motion > Out > Blur Out", "animate", ["BLUR_OUT"], "out");
  add("bounce_out", "motion", "Motion > Out > Bounce Out > Center", "animate", ["BOUNCE_OUT"], "out");
  for (const [dir, e] of outDirs) add(`bounce_out_to_${dir}`, "motion", `Motion > Out > Bounce Out > To ${title(dir)}`, "animate", [`BOUNCE_OUT_${e}`], "out");
  add("pop_out", "motion", "Motion > Out > Pop Out", "animate", ["POP_OUT"], "out");
  for (const dir of sides) add(`slide_out_to_${dir}`, "motion", `Motion > Out > Slide Out > To ${title(dir)}`, "animate", [`SLIDE_OUT_${dir.toUpperCase()}`], "out");
  add("spiral_out", "motion", "Motion > Out > Spiral Out", "animate", ["SPIRAL_OUT"], "out");
  for (const [prefix, label, e] of [["wipe_out", "Wipe Out", "WIPE_OUT"], ["blur_wipe_out", "Blur Wipe Out", "BLUR_WIPE_OUT"]] as const) {
    add(`${prefix}_circle_expand`, "motion", `Motion > Out > ${label} > Circle Expand`, "animate", [`${e}_CIRCLE_EXPAND`], "out");
    add(`${prefix}_circle_shrink`, "motion", `Motion > Out > ${label} > Circle Shrink`, "animate", [`${e}_CIRCLE_SHRINK`], "out");
    for (const dir of sides) add(`${prefix}_to_${dir}`, "motion", `Motion > Out > ${label} > To ${title(dir)}`, "animate", [`${e}_${dir.toUpperCase()}`], "out");
  }
  for (const [name, label, e] of [
    ["bounce", "Bounce", "BOUNCE"],
    ["flash", "Flash", "FLASH"],
    ["heartbeat", "Heartbeat", "HEART_BEAT"],
    ["jello", "Jello", "JELLO"],
    ["pulse", "Pulse", "PULSE"],
    ["rubber_band", "Rubber Band", "RUBBER_BAND"],
    ["shake_x", "Shake X", "SHAKE_X"],
    ["shake_y", "Shake Y", "SHAKE_Y"],
    ["swing", "Swing", "SWING"],
    ["tada", "Tada", "TADA"],
    ["wobble", "Wobble", "WOBBLE"],
  ] as const) {
    add(name, "motion", `Motion > Emphasis > ${label}`, "animate", [e], "emphasis");
  }
  add("zoom_in", "motion", "Motion > Camera > Zoom > In (100% -> 120%)", "animate", ["CAM_PUSH_IN"], "whole");
  add("zoom_out", "motion", "Motion > Camera > Zoom > Out (120% -> 100%)", "animate", ["CAM_PULL_OUT"], "whole");
  for (const [name, label, e] of [
    ["pan_auto", "Auto Direction", "CAM_PAN_AUTO"],
    ["pan_left_to_right", "Left to Right", "CAM_PAN_RIGHT"],
    ["pan_right_to_left", "Right to Left", "CAM_PAN_LEFT"],
    ["pan_top_to_bottom", "Top to Bottom", "CAM_PAN_DOWN"],
    ["pan_bottom_to_top", "Bottom to Top", "CAM_PAN_UP"],
  ] as const) {
    add(name, "motion", `Motion > Camera > Pan > ${label}`, "animate", [e], "whole");
  }
  for (const [io, ioLabel] of [["in", "In"], ["out", "Out"]] as const) {
    add(`ken_burns_${io}`, "motion", `Motion > Camera > Zoom & Pan > ${ioLabel} > Auto Direction`, "animate", [`KEN_BURNS_${io.toUpperCase()}`], "whole");
    for (const [dir, label] of [
      ["left_to_right", "Left to Right"],
      ["right_to_left", "Right to Left"],
      ["top_to_bottom", "Top to Bottom"],
      ["bottom_to_top", "Bottom to Top"],
    ] as const) {
      add(`ken_burns_${io}_${dir}`, "motion", `Motion > Camera > Zoom & Pan > ${ioLabel} > ${label}`, "animate", [`KEN_BURNS_${io.toUpperCase()}_${dir.toUpperCase()}`], "whole");
    }
  }
  add("credits_scroll_up", "motion", "Motion > Credits > Scroll Up", "animate", ["CREDITS_UP"], "whole");
  add("credits_scroll_down", "motion", "Motion > Credits > Scroll Down", "animate", ["CREDITS_DOWN"], "whole");

  add("transform_none", "transform", "Transform > No Transform (no rotation, no crop, reset layout)", "no_transform");
  add("rotate_none", "transform", "Transform > Rotate > No Rotation", "rotate", ["NONE"]);
  add("rotate_90_right", "transform", "Transform > Rotate > Rotate 90 (Right)", "rotate", ["RIGHT_90"]);
  add("rotate_90_left", "transform", "Transform > Rotate > Rotate 90 (Left)", "rotate", ["LEFT_90"]);
  add("rotate_180", "transform", "Transform > Rotate > Rotate 180 (Flip)", "rotate", ["FLIP_180"]);
  add("flip_horizontal", "transform", "Mirror left-right (scale_x sign; not in the menu)", "flip", ["scale_x"]);
  add("flip_vertical", "transform", "Mirror top-bottom (scale_y sign; not in the menu)", "flip", ["scale_y"]);
  add("crop_none", "transform", "Transform > Crop > No Crop", "crop", ["none"]);
  add("crop", "transform", "Transform > Crop > Crop (No Resize)", "crop", ["crop"]);
  add("crop_resize", "transform", "Transform > Crop > Crop (Resize)", "crop", ["resize"]);
  add("layout_reset", "transform", "Transform > Layout > Reset Layout", "layout", ["NONE"]);
  for (const [name, label, e] of [
    ["center", "Center", "CENTER"],
    ["top_left", "Top Left", "TOP_LEFT"],
    ["top_right", "Top Right", "TOP_RIGHT"],
    ["bottom_left", "Bottom Left", "BOTTOM_LEFT"],
    ["bottom_right", "Bottom Right", "BOTTOM_RIGHT"],
  ] as const) {
    add(`layout_quarter_${name}`, "transform", `Transform > Layout > 1/4 Size - ${label}`, "layout", [e]);
  }
  add("layout_grid", "transform", "Transform > Layout > Show All (Maintain Ratio)", "layout", ["ALL_WITH_ASPECT"]);
  add("layout_grid_stretch", "transform", "Transform > Layout > Show All (Distort)", "layout", ["ALL_WITHOUT_ASPECT"]);

  add("volume_reset", "volume", "Audio > Volume > Reset Volume", "volume", ["NONE", "Entire Clip"]);
  add("volume_level", "volume", "Audio > Volume > Level (level_percent 0-130)", "volume", ["LEVEL", "Entire Clip"]);
  add("volume_fade_in", "volume", "Audio > Volume > Fade In (duration_seconds, default 1 s)", "volume", ["FADE_IN_FAST", "Start of Clip"], "in");
  add("volume_fade_in_fast", "volume", "Audio > Volume > Fade In > Fast", "volume", ["FADE_IN_FAST", "Start of Clip"], "in");
  add("volume_fade_in_slow", "volume", "Audio > Volume > Fade In > Slow", "volume", ["FADE_IN_SLOW", "Start of Clip"], "in");
  add("volume_fade_out", "volume", "Audio > Volume > Fade Out (duration_seconds, default 1 s)", "volume", ["FADE_OUT_FAST", "End of Clip"], "out");
  add("volume_fade_out_fast", "volume", "Audio > Volume > Fade Out > Fast", "volume", ["FADE_OUT_FAST", "End of Clip"], "out");
  add("volume_fade_out_slow", "volume", "Audio > Volume > Fade Out > Slow", "volume", ["FADE_OUT_SLOW", "End of Clip"], "out");
  add("volume_fade_in_out", "volume", "Audio > Volume > Fade In and Out (duration_seconds, default 1 s)", "volume", ["FADE_IN_OUT_FAST", "Entire Clip"], "in");
  add("volume_fade_in_out_fast", "volume", "Audio > Volume > Fade In and Out > Fast", "volume", ["FADE_IN_OUT_FAST", "Entire Clip"], "in");
  add("volume_fade_in_out_slow", "volume", "Audio > Volume > Fade In and Out > Slow", "volume", ["FADE_IN_OUT_SLOW", "Entire Clip"], "in");
  return out;
})();

const RANGES: Readonly<Record<string, PresetRange>> = { "Entire Clip": "entire", "Start of Clip": "start", "End of Clip": "end" };

/** The engine preset (ops/presets.ts) a menu preset runs: one clip at a time, or the Show All grid. */
export function enginePreset(spec: ClipMenuPreset): { id: ClipPresetId; range?: PresetRange } | { grid: "aspect" | "stretch" } {
  const [arg = "", position] = spec.args;
  const lower = arg.toLowerCase();
  const range = position ? RANGES[position] : undefined;
  switch (spec.call) {
    case "fade":
      return { id: `fade.${lower}` as ClipPresetId, range };
    case "volume":
      return { id: `volume.${lower}` as ClipPresetId, range };
    case "animate":
      return { id: `animate.${lower}` as ClipPresetId };
    case "rotate":
      return { id: `rotate.${lower}` as ClipPresetId };
    case "crop":
      return { id: `crop.${lower}` as ClipPresetId };
    case "no_transform":
      return { id: "transform.none" };
    case "flip":
      return { id: arg === "scale_x" ? "flip.horizontal" : "flip.vertical" };
    case "layout":
      if (arg === "ALL_WITH_ASPECT") return { grid: "aspect" };
      if (arg === "ALL_WITHOUT_ASPECT") return { grid: "stretch" };
      return { id: `layout.${lower}` as ClipPresetId };
  }
}

/** What the clip menu calls visual: the reader has video, or the clip draws its waveform. */
function hasVisual(clip: Clip): boolean {
  const reader = isRecord(clip.reader) ? (clip.reader as Record<string, unknown>) : {};
  const hasVideo = reader.has_video;
  return hasVideo === undefined || hasVideo === null || Boolean(hasVideo) || Boolean(clip.waveform);
}

function hasAudio(clip: Clip): boolean {
  const reader = isRecord(clip.reader) ? (clip.reader as Record<string, unknown>) : {};
  return reader.has_audio === undefined || reader.has_audio === null ? true : Boolean(reader.has_audio);
}

/** Undefined when the preset applies to the clip, else why it is skipped. */
function presetSkipReason(spec: ClipMenuPreset, clip: Clip): string | undefined {
  if ((spec.category === "motion" || spec.category === "transform") && !hasVisual(clip)) return "audio-only clip (no picture to move or transform)";
  if (spec.category === "volume" && !hasAudio(clip)) return "clip has no sound";
  if (spec.call === "flip") return mirrorBlocker(spec.args[0] as "scale_x" | "scale_y", "gravity" in clip ? clip.gravity : 4);
  return undefined;
}

function singleValue(curve: unknown): number | undefined {
  const points = curvePoints(curve);
  return points.length === 1 ? pointY(points[0]!) : undefined;
}

/** Reset / level presets that would write what the clip already has: the handler is not even run. */
function alreadyApplied(spec: ClipMenuPreset, clip: Clip, levelPercent: number | null): boolean {
  if (spec.name === "fade_none") {
    return (!hasVisual(clip) || singleValue(clip.alpha) === 1.0) && (!hasAudio(clip) || singleValue(clip.volume) === 1.0);
  }
  if (spec.name === "volume_reset") return singleValue(clip.volume) === 1.0;
  if (spec.name === "volume_level") return singleValue(clip.volume) === Number(levelPercent) / 100.0;
  return false;
}

/** A clip without its timeline-UI cache, for before/after comparison (`_snapshot`). */
function snapshot(clip: Clip | undefined): Record<string, unknown> {
  if (!clip) return {};
  const { ui: _ui, ...rest } = structuredClone(clip) as Record<string, unknown>;
  return rest;
}

/** `_diff`: the keys that changed and the effects added, removed or changed. */
function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => k !== "effects" && !sameValue(before[k], after[k])).sort();
  const effectsOf = (clip: Record<string, unknown>): Map<unknown, Record<string, unknown>> =>
    new Map((Array.isArray(clip.effects) ? clip.effects : []).filter(isRecord).map((e) => [e.id, e]));
  const old = effectsOf(before);
  const now = effectsOf(after);
  const row = (id: unknown, e: Record<string, unknown>) => ({ id, class_name: e.class_name ?? null });
  const out: Record<string, unknown> = { changed: keys };
  const added = [...now].filter(([id]) => !old.has(id)).map(([id, e]) => row(id, e));
  const removed = [...old].filter(([id]) => !now.has(id)).map(([id, e]) => row(id, e));
  const updated = [...now].filter(([id, e]) => old.has(id) && !sameValue(old.get(id), e)).map(([id, e]) => row(id, e));
  if (added.length > 0) out.effects_added = added;
  if (removed.length > 0) out.effects_removed = removed;
  if (updated.length > 0) out.effects_changed = updated;
  return out;
}

function receiptInfo(call: ToolCall, spec: ClipMenuPreset, targets: Clip[], duration: number | null, at: number | null, level: number | null): Record<string, unknown> {
  const info: Record<string, unknown> = {};
  if ((spec.call === "fade" || spec.call === "volume") && spec.zone) {
    info.fade_seconds = duration ? duration : spec.args[0]!.endsWith("SLOW") ? 3.0 : 1.0;
  } else if (spec.zone === "in" || spec.zone === "out" || spec.zone === "emphasis") {
    info.zone_seconds = duration ? duration : 1.0;
  }
  if (spec.zone === "emphasis") {
    const t = at ?? playheadSeconds(call);
    info.emphasis_starts_at = Object.fromEntries(
      targets.map((c) => {
        const time = ClipTime.of(c, call.doc.project);
        return [c.id, roundTo(time.contains(time.fromTimelineSeconds(t)) ? t : time.position, 3)];
      }),
    );
  }
  if (spec.name === "volume_level") info.level_percent = level;
  return info;
}

async function applyClipPresetTool(call: ToolCall, input: ContractInput<"apply_clip_preset_tool">): Promise<ToolOutcome> {
  const preset = input.preset;
  const spec = CLIP_MENU_PRESETS.get(preset);
  if (!spec) throw new ToolError(`unknown preset ${pyReprString(String(preset))}`);
  const duration = input.duration_seconds ?? null;
  const at = input.at_seconds ?? null;
  const level = input.level_percent ?? null;
  if (duration !== null && !["in", "out", "emphasis"].includes(spec.zone)) {
    throw new ToolError(
      `${preset} takes no duration_seconds: ` +
        (spec.zone === "whole"
          ? "camera moves and credits span the whole clip; trim the clip or animate part of it with set_keyframes_tool"
          : "it has no length"),
    );
  }
  if (at !== null && spec.zone !== "emphasis") throw new ToolError(`at_seconds only sets where an Emphasis preset starts; ${preset} is not one`);
  if (spec.name === "volume_level") {
    if (level === null) throw new ToolError("volume_level needs level_percent (0-130, 100 = unchanged)");
  } else if (level !== null) {
    throw new ToolError("level_percent only goes with preset='volume_level'");
  }

  const { clips, skipped } = await resolveTargets(call, input);
  const targets: Clip[] = [];
  for (const clip of clips) {
    const reason = presetSkipReason(spec, clip);
    if (reason) skipped.push({ timeline_clip_id: clip.id, reason });
    else targets.push(clip);
  }
  if (targets.length === 0) {
    throw new ToolError(`${preset} does not apply to the chosen clip(s): ${skipped.map((s) => `${s.timeline_clip_id}: ${s.reason}`).join("; ")}`);
  }
  const project = call.doc.project;
  if (at !== null) {
    const inside = targets.filter((c) => {
      const time = ClipTime.of(c, project);
      return time.contains(time.fromTimelineSeconds(at));
    });
    if (inside.length === 0) throw new ToolError(`at_seconds=${pyFloat(at)} is not over any of the chosen clips`);
  }

  const pending = targets.filter((c) => !alreadyApplied(spec, c, level));
  const ids = pending.map((c) => c.id);
  const info = receiptInfo(call, spec, targets, duration, at, level);
  if (pending.length === 0) {
    return nothingChanged(call, `Nothing to change: ${spec.menu} is already how ${targets.length} clip(s) look.`, {
      preset,
      timeline_clip_ids: targets.map((c) => c.id),
      skipped,
      ...info,
    });
  }

  const before = new Map(ids.map((id) => [id, snapshot(clipById(project, id))]));
  const engine = enginePreset(spec);
  const opts: ClipPresetOptions = {};
  if (duration !== null) {
    if (spec.call === "animate") opts.zoneSeconds = duration;
    else opts.fadeSeconds = duration;
  }
  if (spec.zone === "emphasis") opts.playhead = at ?? playheadSeconds(call);
  if (spec.name === "volume_level") opts.level = Number(level) / 100.0;
  const keepGravity = spec.call === "animate" && ["in", "out", "emphasis"].includes(spec.zone);
  const keptGravity: Record<string, string | number> = {};
  call.commit((tx) => {
    if ("grid" in engine) {
      layoutShowAll(tx, ids, { stretch: engine.grid === "stretch" });
    } else {
      for (const id of ids) applyClipPreset(tx, id, engine.id, { ...opts, ...(engine.range ? { range: engine.range } : {}) });
    }
    if (keepGravity) {
      // The menu recentres every clip it animates. In/Out/Emphasis moves are offsets from the
      // clip's own place, so a corner picture-in-picture stays in its corner.
      for (const id of ids) {
        const gravity = before.get(id)!.gravity;
        if (gravity !== undefined && gravity !== null && gravity !== 4) {
          updateClipValues(tx, id, { gravity });
          keptGravity[id] = typeof gravity === "number" && Number.isInteger(gravity) && gravity >= 0 && gravity < 9 ? GRAVITY_NAMES[gravity]! : (gravity as number);
        }
      }
    }
  });
  const after = call.doc.project;
  const changes = new Map(ids.map((id) => [id, diff(before.get(id)!, snapshot(clipById(after, id)))]));
  const changedIds = ids.filter((id) => {
    const d = changes.get(id)!;
    return (d.changed as string[]).length > 0 || Object.keys(d).length > 1;
  });
  if (changedIds.length === 0) {
    return nothingChanged(call, `Nothing to change: ${spec.menu} left ${ids.length} clip(s) as they were.`, {
      preset,
      timeline_clip_ids: ids,
      skipped,
      ...info,
    });
  }
  const props = [...new Set(changedIds.flatMap((id) => changes.get(id)!.changed as string[]))].sort();
  let note = skipped.length > 0 ? ` Skipped ${skipped.length} clip(s).` : "";
  const kept = Object.keys(keptGravity).length > 0;
  if (kept) note += ` Kept gravity ${[...new Set(Object.values(keptGravity).map(String))].sort().join(", ")} (the menu would recentre).`;
  return ok(call, `Applied ${spec.menu} to ${changedIds.length} clip(s); changed ${props.join(", ") || "effects"}.${note}`, {
    changed: true,
    preset,
    menu: spec.menu,
    clips: changedIds.map((id) => ({ timeline_clip_id: id, ...changes.get(id)! })),
    skipped,
    ...(kept ? { kept_gravity: keptGravity } : {}),
    ...info,
  });
}

export const clipPropsTools: CatalogTool[] = [
  contractTool("get_clip_properties_tool", { annotations: READ, run: (call, input) => run(() => getClipProperties(call, input)) }),
  contractTool("set_clip_properties_tool", { annotations: EDIT, run: (call, input) => run(() => setClipProperties(call, input)) }),
  contractTool("remove_keyframes_tool", { annotations: EDIT, run: (call, input) => run(() => removeKeyframes(call, input)) }),
  contractTool("copy_clip_keyframes_tool", { annotations: EDIT, run: (call, input) => run(() => copyClipKeyframes(call, input)) }),
  contractTool("apply_clip_preset_tool", { annotations: EDIT, run: (call, input) => run(() => applyClipPresetTool(call, input)) }),
];
