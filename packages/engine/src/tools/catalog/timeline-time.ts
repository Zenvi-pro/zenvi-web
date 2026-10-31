/**
 * Timeline-edit tools that change timing and sound: set_clip_speed_tool,
 * repeat_clip_tool, freeze_frame_tool, separate_clip_audio_tool,
 * set_clip_audio_video_tool, and the older reverse_clip_tool.
 *
 * Ports of zenvi-core develop 1f80cb3d0
 * src/classes/editor_tools/timeline_edit_time.py (each tool validates, then
 * runs the Clip menu's own edit: Time_Triggered, Repeat_Triggered,
 * Split_Audio_Triggered, here the engine's clip presets and ops) and
 * src/classes/tool_handlers.py `reverse_clip`. set_clip_speed_tool also takes
 * the web's older arguments (clip_id, factor, direction) as aliases.
 */

import type { Transaction } from "../../history/document.js";
import type { Clip, Keyframe, Project } from "../../model/types.js";
import { DEFAULT_IMAGE_LENGTH } from "../../model/defaults.js";
import { pyRound } from "../../model/rounding.js";
import { separateAudio, setClipProperty } from "../../ops/clips.js";
import { applyClipPreset, effectiveSpeed, repeatClip, repeatIsActive } from "../../ops/presets.js";
import { timeCurveIsReversed } from "../../ops/retime.js";
import { shiftAfter, type PlannedItem } from "../../ops/sequence.js";
import { contractTool, type CatalogTool, type ToolCall } from "../define.js";
import { refused } from "../receipt.js";
import { pyFixed, pyFloat, pyG, pyReprString } from "../pyfmt.js";
import type { ContractInput } from "../schemas.gen.js";
import { fileById, playheadSeconds, resolveClip, text } from "./common.js";
import {
  ToolError,
  checkOverlaps,
  clipById,
  clipTitle,
  clipsGiven,
  describeClip,
  editorRun,
  f2,
  gridOf,
  isImageClip,
  layersBottomUp,
  newOverlaps,
  nothingChanged,
  ok,
  r3,
  requireUnlockedTracks,
  resolveLayer,
  spanOf,
  targetClip,
  targetClips,
  trackName,
  uiTrack,
  type ClipsTarget,
  type Grid,
  type OverlapRow,
} from "./timeline-edit-common.js";

const EDIT = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;
const ADD = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

const MIN_SPEED = 0.0625;
const MAX_SPEED = 16.0;

function requireTargets(target: ClipsTarget, verb: string): void {
  if (!clipsGiven(target)) throw new ToolError(`say which clips to ${verb}: timeline_clip_ids, clip_query, or scope`);
}

/** timeline_edit_common.reader_of: the clip's reader, else its file. */
function readerOf(project: Project, clip: Clip): Record<string, unknown> {
  const reader = clip.reader as unknown as Record<string, unknown> | undefined;
  if (reader && typeof reader === "object" && Object.keys(reader).length > 0) return reader;
  const file = fileById(project, String(clip.file_id ?? ""));
  return file ? (file as unknown as Record<string, unknown>) : {};
}

/** timeline_edit_common.media_has_audio: the media has sound (unknown counts as yes). */
function mediaHasAudio(project: Project, clip: Clip): boolean {
  const reader = readerOf(project, clip);
  const hasAudio = reader.has_audio === undefined || reader.has_audio === null ? true : Boolean(reader.has_audio);
  const channels = reader.channels === undefined || reader.channels === null ? null : Math.trunc(Number(reader.channels));
  return hasAudio && (channels === null || Number.isNaN(channels) || channels > 0);
}

/** timeline_edit_common.media_has_video. */
function mediaHasVideo(project: Project, clip: Clip): boolean {
  const reader = readerOf(project, clip);
  return reader.has_video === undefined || reader.has_video === null ? true : Boolean(reader.has_video);
}

/** timeline_edit_common.keyframe_value: the first point of a constant keyframe such as has_audio (-1 auto, 0 off, 1 on). */
function keyframeValue(kf: unknown, fallback = -1): number {
  const points = (kf as Keyframe | undefined)?.Points;
  const y = Array.isArray(points) && points.length > 0 ? Number(points[0]?.co?.Y) : NaN;
  return Number.isFinite(y) ? y : fallback;
}

/** _frames: whole frames, at least one. */
function wholeFrames(g: Grid, seconds: number): number {
  return Math.max(1, pyRound(seconds * g.fps)) / g.fps;
}

/** _reset_duration: the clip's length after Speed ▸ Reset (in point to the end of the source). */
function resetDuration(project: Project, clip: Clip, g: Grid): number {
  if (isImageClip(clip)) return DEFAULT_IMAGE_LENGTH;
  const cache = repeatIsActive(clip) ? (clip.repeat_cache as Record<string, unknown>) : {};
  const start = Number(cache.start ?? clip.start) || 0;
  const source = Number(readerOf(project, clip).duration) || 0;
  return source > 0 ? Math.max(g.frame, source - start) : (Number(clip.end) || 0) - start;
}

/** _timing_receipt: a clip's length before/after and how it plays now. */
function timingReceipt(project: Project, clip: Clip, beforeDuration: number): Record<string, unknown> {
  const now = clipById(project, clip.id) ?? clip;
  const [start, end] = spanOf(now);
  const { speed, direction } = effectiveSpeed(now);
  return {
    timeline_clip_id: clip.id,
    title: clipTitle(clip),
    duration_before: r3(beforeDuration),
    duration_after: r3(end - start),
    effective_speed: speed === null ? null : r3(speed),
    direction,
    position: r3(start),
    end: r3(end),
  };
}

/** _ripple_after: everything starting after the clip moves by its change in length (a crossfade partner too). */
function rippleAfter(tx: Transaction, clip: Clip, start: number, oldDuration: number, g: Grid): string[] {
  const [s, e] = spanOf(clipById(tx.project, clip.id) ?? clip);
  return shiftAfter(tx, clip.layer, start + g.tol, e - s - oldDuration, new Set([clip.id]));
}

function uniqueSorted(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

// ---------------------------------------------------------------------------
// set_clip_speed_tool (Clip menu ▸ Speed)
// ---------------------------------------------------------------------------

async function setClipSpeed(call: ToolCall, input: ContractInput<"set_clip_speed_tool">) {
  const project = call.doc.project;
  // The web's older arguments: clip_id, factor and direction.
  const ids = [...(input.timeline_clip_ids ?? [])];
  const aliasId = text(input.clip_id);
  if (aliasId && !ids.includes(aliasId)) ids.push(aliasId);
  let speed = input.speed ?? 0;
  if (input.factor !== undefined) {
    if (speed && speed !== input.factor) throw new ToolError("give speed or factor (its older name), not both");
    speed = input.factor;
  }
  const reverse = (input.reverse ?? false) || input.direction === "backward";
  const target: ClipsTarget = { ...input, timeline_clip_ids: ids };
  const absolute = input.absolute ?? false;
  const targetDuration = input.target_duration_seconds ?? 0;
  const reset = input.reset ?? false;
  const ripple = input.ripple ?? false;

  requireTargets(target, "retime");
  if (speed && targetDuration) throw new ToolError("give speed or target_duration_seconds, not both");
  if (absolute && !speed) throw new ToolError("absolute=true needs a speed (1 = normal speed)");
  if (!(speed || targetDuration || reverse || reset)) throw new ToolError("nothing to change: give speed, target_duration_seconds, reverse or reset");
  const clips = await targetClips(call, target);
  requireUnlockedTracks(project, clips.map((c) => c.layer));

  const g = gridOf(project);
  const plans = clips.map((clip) => {
    const name = pyReprString(clipTitle(clip));
    const [s, e] = spanOf(clip);
    const duration = e - s;
    const eff = effectiveSpeed(clip).speed;
    if ((speed || targetDuration) && eff === null && !reset) {
      throw new ToolError(`${name} is looped (repeat_clip_tool); pass reset=true to clear the loop before changing its speed`);
    }
    const baseDuration = reset ? resetDuration(project, clip, g) : duration;
    const baseSpeed = reset ? 1 : eff!;
    let factor: number | null = null;
    if (speed) factor = absolute ? speed / baseSpeed : speed;
    else if (targetDuration) factor = baseDuration / targetDuration;
    if (factor !== null) {
      if (Math.abs(factor - 1) < 1e-6) factor = null;
      else if (!(MIN_SPEED - 1e-9 <= factor && factor <= MAX_SPEED + 1e-9)) {
        throw new ToolError(`${name}: that is a ${pyG(factor, 3)}x change; speed changes go from 1/16x to 16x per call`);
      }
    }
    if (factor === null && !reverse && !reset) throw new ToolError(`${name} already plays at that speed; nothing to change`);
    const newDuration = factor ? wholeFrames(g, baseDuration / factor) : baseDuration;
    return { clip, start: s, duration, newDuration, factor };
  });

  let hits: OverlapRow[] = [];
  if (!ripple) {
    const changes = new Map(
      plans.filter((p) => p.newDuration > p.duration + g.tol).map((p) => [p.clip.id, { layer: p.clip.layer, start: p.start, end: p.start + p.newDuration }]),
    );
    hits = checkOverlaps(newOverlaps(project, changes), input.allow_overlap ?? false, "The longer clip");
  }

  const { results, shifted } = call.commit((tx) => {
    const rows: Record<string, unknown>[] = [];
    const moved: string[] = [];
    for (const p of [...plans].sort((a, b) => b.start - a.start)) {
      if (reset) applyClipPreset(tx, p.clip.id, "time.none");
      // The menu's speed label, f"{factor:.6g}X".
      if (p.factor) applyClipPreset(tx, p.clip.id, reverse ? "time.backward" : "time.forward", { speed: Number(pyG(p.factor, 6)) });
      else if (reverse) applyClipPreset(tx, p.clip.id, "time.reverse");
      if (ripple) moved.push(...rippleAfter(tx, p.clip, p.start, p.duration, g));
      rows.push(timingReceipt(tx.project, p.clip, p.duration));
    }
    return { results: rows.reverse(), shifted: moved };
  });
  const one = results[0]!;
  const what = `${reset ? "reset" : ""}${reverse ? " reversed" : ""}`.trim();
  const speedNote = one.effective_speed !== null ? `${pyFloat(one.effective_speed as number)}x ${String(one.direction)}` : String(one.direction);
  const summary =
    `Retimed ${results.length} clip(s)${what ? ` (${what})` : ""}: ${f2(one.duration_before as number)} s -> ${f2(one.duration_after as number)} s, now ${speedNote}` +
    (shifted.length > 0 ? `; ${shifted.length} later item(s) rippled` : "") +
    (hits.length > 0 ? `; overlaps ${hits.length} clip(s)` : "") +
    ".";
  return ok(call, summary, { clips: results, shifted: uniqueSorted(shifted), overlaps: hits });
}

// ---------------------------------------------------------------------------
// repeat_clip_tool (Speed ▸ Repeat)
// ---------------------------------------------------------------------------

async function repeatClips(call: ToolCall, input: ContractInput<"repeat_clip_tool">) {
  const project = call.doc.project;
  requireTargets(input, "repeat");
  const clips = await targetClips(call, input);
  requireUnlockedTracks(project, clips.map((c) => c.layer));
  const g = gridOf(project);
  const times = input.times ?? 2;
  const pattern = input.pattern ?? "loop";
  const ripple = input.ripple ?? false;
  const delayFrames = pyRound((input.delay_seconds ?? 0) * g.fps);
  const ramp = (input.speed_ramp_percent ?? 0) / 100;

  const plans = clips.map((clip) => {
    if (repeatIsActive(clip)) {
      throw new ToolError(`${pyReprString(clipTitle(clip))} is already looped; reset it first (set_clip_speed_tool reset=true) or undo the earlier repeat`);
    }
    const [s, e] = spanOf(clip);
    const duration = e - s;
    const spanFrames = Math.max(1, pyRound(duration * g.fps));
    let total = 0;
    for (let k = 0; k < times; k += 1) total += Math.max(1, pyRound(spanFrames / Math.abs((1 + ramp) ** k)));
    total += (times - 1) * delayFrames;
    const newDuration = total / g.fps;
    if (newDuration > 3 * 3600) {
      throw new ToolError(`${pyReprString(clipTitle(clip))} would become ${pyFixed(newDuration / 3600, 1)} hours long; use fewer passes or a smaller slow-down`);
    }
    return { clip, start: s, duration, newDuration };
  });

  let hits: OverlapRow[] = [];
  if (!ripple) {
    const changes = new Map(plans.map((p) => [p.clip.id, { layer: p.clip.layer, start: p.start, end: p.start + p.newDuration }]));
    hits = checkOverlaps(newOverlaps(project, changes), input.allow_overlap ?? false, "The repeated clip");
  }

  const { results, shifted } = call.commit((tx) => {
    const rows: Record<string, unknown>[] = [];
    const moved: string[] = [];
    for (const p of [...plans].sort((a, b) => b.start - a.start)) {
      repeatClip(tx, p.clip.id, {
        pattern: pattern === "ping_pong" ? "pingpong" : "loop",
        direction: input.reverse ? -1 : 1,
        passes: times,
        delayFrames,
        ramp,
      });
      if (ripple) moved.push(...rippleAfter(tx, p.clip, p.start, p.duration, g));
      rows.push(timingReceipt(tx.project, p.clip, p.duration));
    }
    return { results: rows.reverse(), shifted: moved };
  });
  const one = results[0]!;
  const summary =
    `Repeated ${results.length} clip(s) ${times}x (${pattern.replaceAll("_", "-")}): ${f2(one.duration_before as number)} s -> ${f2(one.duration_after as number)} s` +
    (shifted.length > 0 ? `; ${shifted.length} later item(s) rippled` : "") +
    (hits.length > 0 ? `; overlaps ${hits.length} clip(s)` : "") +
    ".";
  return ok(call, summary, { times, pattern, clips: results, shifted: uniqueSorted(shifted), overlaps: hits });
}

// ---------------------------------------------------------------------------
// freeze_frame_tool (Speed ▸ Freeze)
// ---------------------------------------------------------------------------

async function freezeFrame(call: ToolCall, input: ContractInput<"freeze_frame_tool">) {
  const project = call.doc.project;
  const clip = await targetClip(call, input);
  requireUnlockedTracks(project, [clip.layer]);
  const g = gridOf(project);
  const name = pyReprString(clipTitle(clip));
  const [start, end] = spanOf(clip);
  if (end - start < g.frame - g.tol) throw new ToolError(`${name} is shorter than a frame`);
  const which = input.frame ?? "at_time";
  let t: number;
  if (which === "first") t = start;
  else if (which === "last") t = end - g.frame;
  else {
    const at = input.at_seconds ?? -1;
    t = g.snap(at < 0 ? playheadSeconds(call) : at);
    if (!(start - g.tol <= t && t <= end - g.frame + g.tol)) {
      throw new ToolError(`${f2(t)} s is outside ${name} (${f2(start)}-${f2(end)} s); give a time inside it or frame='first'/'last'`);
    }
  }
  t = Math.min(Math.max(g.snap(t), start), g.snap(end - g.frame));
  const hold = wholeFrames(g, input.hold_seconds ?? 2.0);
  const duration = end - start;
  const zoom = input.zoom ?? false;
  const ripple = input.ripple ?? false;
  const hits = ripple
    ? []
    : checkOverlaps(newOverlaps(project, new Map([[clip.id, { layer: clip.layer, start, end: end + hold }]])), input.allow_overlap ?? false, "The freeze");
  const { receipt, shifted } = call.commit((tx) => {
    // The menu's freeze length, f"{hold:.6g}".
    applyClipPreset(tx, clip.id, zoom ? "time.freeze_zoom" : "time.freeze", { seconds: Number(pyG(hold, 6)), playhead: t });
    const moved = ripple ? rippleAfter(tx, clip, start, duration, g) : [];
    return { receipt: timingReceipt(tx.project, clip, duration), shifted: moved };
  });
  const summary =
    `Froze ${name} at ${f2(t)} s for ${f2(hold)} s${zoom ? " with zoom" : ""}; it now ends at ${f2(receipt.end as number)} s` +
    (shifted.length > 0 ? `; ${shifted.length} later item(s) rippled` : "") +
    (hits.length > 0 ? `; overlaps ${hits.length} clip(s)` : "") +
    ".";
  return ok(call, summary, { frozen_at: r3(t), hold_seconds: r3(hold), clip: receipt, shifted: uniqueSorted(shifted), overlaps: hits });
}

// ---------------------------------------------------------------------------
// separate_clip_audio_tool (Audio ▸ Separate Audio)
// ---------------------------------------------------------------------------

async function separateClipAudio(call: ToolCall, input: ContractInput<"separate_clip_audio_tool">) {
  const project = call.doc.project;
  requireTargets(input, "separate");
  const perChannel = input.per_channel ?? false;
  const toTrack = (input.to_track ?? "").trim();
  if (perChannel && toTrack) throw new ToolError("to_track works with per_channel=false; per-channel clips go on the tracks below");
  const clips = await targetClips(call, input);
  requireUnlockedTracks(project, clips.map((c) => c.layer));
  for (const clip of clips) {
    const name = pyReprString(clipTitle(clip));
    if (!mediaHasAudio(project, clip)) throw new ToolError(`${name} has no audio to separate`);
    if (keyframeValue(clip.has_audio) === 0) {
      throw new ToolError(`${name} already has its audio off (separated before?); turn it back on with set_clip_audio_video_tool(audio='auto') first`);
    }
    if (!mediaHasVideo(project, clip) && !perChannel) throw new ToolError(`${name} is already audio-only; use per_channel=true to split its channels`);
  }

  const order = layersBottomUp(project);
  const dest = toTrack ? resolveLayer(project, toTrack) : undefined;
  const planned: PlannedItem[] = [];
  for (const clip of clips) {
    const [s, e] = spanOf(clip);
    const channels = Math.trunc(Number(readerOf(project, clip).channels)) || 1;
    let lanes: number[];
    if (dest !== undefined) lanes = [dest];
    else {
      // The menu uses the existing tracks below and creates new ones past the
      // bottom; per channel, an audio-only clip keeps channel 1 itself.
      const index = Math.max(0, order.indexOf(clip.layer));
      const below = perChannel ? (mediaHasVideo(project, clip) ? channels : channels - 1) : 1;
      lanes = [];
      for (let k = 1; k <= below; k += 1) if (index - k >= 0) lanes.push(order[index - k]!);
    }
    requireUnlockedTracks(project, lanes, "where the audio would go");
    for (const lane of lanes) planned.push({ label: `audio of ${clipTitle(clip)}`, layer: lane, start: s, end: e });
  }
  checkOverlaps(newOverlaps(project, new Map(), planned), input.allow_overlap ?? false, "The separated audio", false);

  const before = new Set(project.clips.map((c) => c.id));
  call.commit((tx) => {
    for (const clip of clips) separateAudio(tx, clip.id, { perChannel, ...(dest !== undefined ? { layer: dest } : {}) });
  });
  const after = call.doc.project;
  const created = after.clips
    .filter((c) => !before.has(c.id))
    .map((c) => c.id)
    .sort()
    .map((id) => {
      const clip = clipById(after, id)!;
      return { ...describeClip(after, clip), video: keyframeValue(clip.has_video) === 0 ? "off" : "auto" };
    });
  const originals = clips.map((clip) => ({
    timeline_clip_id: clip.id,
    title: clipTitle(clip),
    audio: keyframeValue(clipById(after, clip.id)?.has_audio) === 0 ? "off" : "on",
  }));
  const tracks = [...new Set(created.map((c) => String(c.track)))].sort();
  return ok(
    call,
    // The new ids in the line itself (skc-cinematic: agents read the summary, not data.audio_clips).
    `Separated the audio of ${clips.length} clip(s) into ${created.length} audio clip(s) (${created.map((c) => c.timeline_clip_id).join(", ")}) on track(s) ${tracks.join(", ") || "-"}; the originals are muted.`,
    { audio_clips: created, originals },
  );
}

// ---------------------------------------------------------------------------
// set_clip_audio_video_tool (Enable Audio / Video, waveforms)
// ---------------------------------------------------------------------------

const AV: Record<"on" | "off" | "auto", number> = { on: 1, off: 0, auto: -1 };

function avState(value: number): "on" | "off" | "auto" {
  return value === 1 ? "on" : value === 0 ? "off" : "auto";
}

async function setClipAudioVideo(call: ToolCall, input: ContractInput<"set_clip_audio_video_tool">) {
  const project = call.doc.project;
  requireTargets(input, "change");
  const audio = input.audio ?? "";
  const video = input.video ?? "";
  const waveform = input.waveform ?? "";
  if (!(audio || video || waveform)) throw new ToolError("nothing to change: give audio, video or waveform");
  const clips = await targetClips(call, input);
  requireUnlockedTracks(project, clips.map((c) => c.layer));
  for (const clip of clips) {
    const name = pyReprString(clipTitle(clip));
    if (audio === "on" && !mediaHasAudio(project, clip)) throw new ToolError(`${name} has no audio in its media`);
    if (waveform === "show" && !mediaHasAudio(project, clip)) throw new ToolError(`${name} has no audio, so it has no waveform`);
    if (video === "on" && !mediaHasVideo(project, clip)) throw new ToolError(`${name} has no picture in its media`);
  }
  // The web timeline draws the waveform of every clip with sound and has no per-clip switch:
  // refused in words the Assistant retries without (the audio/video part still works).
  if (waveform === "hide") {
    return refused(
      call.tool,
      `Error: ${call.tool} cannot hide a waveform in this Zenvi surface (the web timeline always draws the waveform of a clip with sound). Call it again without waveform.`,
    );
  }

  const changes = clips
    .map((clip) => {
      const fields: [string, number][] = [];
      if (audio && keyframeValue(clip.has_audio) !== AV[audio]) fields.push(["has_audio", AV[audio]]);
      if (video && keyframeValue(clip.has_video) !== AV[video]) fields.push(["has_video", AV[video]]);
      return { clip, fields };
    })
    .filter((c) => c.fields.length > 0);
  if (changes.length === 0) {
    const why = waveform === "show" && !audio && !video ? "the web timeline already draws the waveform of every clip with sound" : "the clip(s) were already set that way";
    return nothingChanged(call, `Nothing changed: ${why}.`, { clips: [] });
  }
  call.commit((tx) => {
    for (const { clip, fields } of changes) for (const [key, value] of fields) setClipProperty(tx, clip.id, key, value);
  });
  const after = call.doc.project;
  const states = clips.map((clip) => {
    const now = clipById(after, clip.id)!;
    return {
      timeline_clip_id: clip.id,
      title: clipTitle(clip),
      track: uiTrack(after, clip.layer),
      audio: avState(keyframeValue(now.has_audio)),
      video: avState(keyframeValue(now.has_video)),
    };
  });
  const parts: string[] = [];
  if (audio) parts.push(`audio ${audio}`);
  if (video) parts.push(`video ${video}`);
  if (waveform) parts.push(`waveform ${waveform} (always drawn on the web)`);
  return ok(call, `Set ${parts.join(", ")} on ${clips.length} clip(s) on ${trackName(after, clips[0]!.layer)}.`, {
    clips: states,
    waveform_requested: [],
    waveform_hidden: [],
  });
}

// ---------------------------------------------------------------------------
// reverse_clip_tool (tool_handlers.reverse_clip: Speed ▸ Reverse / Reset)
// ---------------------------------------------------------------------------

async function reverseClip(call: ToolCall, input: ContractInput<"reverse_clip_tool">): Promise<string> {
  const action = String(input.mode || "reverse").trim().toLowerCase();
  let reverse: boolean;
  if (["reverse", "backward", "backwards"].includes(action)) reverse = true;
  else if (["reset", "none", "forward", "unreverse"].includes(action)) reverse = false;
  else return "Error: mode must be 'reverse' or 'reset'.";
  if (!text(input.timeline_clip_id) && !text(input.clip_query)) return "Error: reverse_clip_tool requires timeline_clip_id or clip_query.";
  const resolved = await resolveClip(call, input);
  if (!resolved.ok) return resolved.error || "Error: Could not resolve timeline clip.";
  const clip = resolved.clip;
  // Speed ▸ Reverse toggles, so reversing a reversed clip would play it forward again:
  // a no-op must not add an undo step.
  if (reverse && timeCurveIsReversed(clip.time)) return `timeline_clip_id=${clip.id} is already reversed; nothing changed.`;
  const points = clip.time?.Points;
  if (!reverse && (!Array.isArray(points) || points.length <= 1)) return `timeline_clip_id=${clip.id} already plays forward at 1x; nothing changed.`;
  call.commit((tx) => applyClipPreset(tx, clip.id, reverse ? "time.reverse" : "time.none"));
  return `${reverse ? "Reversed" : "Reset time on"} timeline_clip_id=${clip.id}.`;
}

// ---------------------------------------------------------------------------

export const timelineTimeTools: CatalogTool[] = [
  contractTool("reverse_clip_tool", { annotations: EDIT, run: (call, input) => reverseClip(call, input) }),
  contractTool("set_clip_speed_tool", { annotations: EDIT, run: (call, input) => editorRun(() => setClipSpeed(call, input)) }),
  contractTool("repeat_clip_tool", { annotations: EDIT, run: (call, input) => editorRun(() => repeatClips(call, input)) }),
  contractTool("freeze_frame_tool", { annotations: EDIT, run: (call, input) => editorRun(() => freezeFrame(call, input)) }),
  contractTool("separate_clip_audio_tool", { annotations: ADD, run: (call, input) => editorRun(() => separateClipAudio(call, input)) }),
  contractTool("set_clip_audio_video_tool", { annotations: EDIT, run: (call, input) => editorRun(() => setClipAudioVideo(call, input)) }),
];
