/**
 * Placing media on the timeline: add_clip_to_timeline_tool,
 * split_file_add_clip_tool, get_file_info_tool, and the placement planner the
 * import/generation tools share.
 *
 * Ports of zenvi-core src/classes/tool_handlers.py (ref b63c39be7):
 * add_clip_to_timeline, split_file_add_clip, get_file_info,
 * _describe_file_for_llm, _window_is_dialogue_driven,
 * _snap_window_off_boundaries, _lookup_watch_meta; with the keep-window,
 * blind-trim, whole-file and butting rules of zenvi-core develop #168
 * (b17a44cd4: clip_placement.py end_bounds_keep_window, blind_trim_rejected,
 * butt_against_previous_clip; tool_handlers.py _planned_end_by_clip_id).
 *
 * A placement is planned first (async: argument parsing, the vision watch),
 * then applied inside the call's single transaction (`applyPlacement`), so
 * "place + trim" is one undo step like the desktop's `_atomic` group.
 */

import type { ProjectDocument, Transaction } from "../../history/document.js";
import type { Clip, Project, ProjectFile } from "../../model/types.js";
import { addClip } from "../../ops/clips.js";
import { addFile, detectMediaType } from "../../ops/files.js";
import { getEffectiveAiMetadata, filterTagsStringForWindow, materializeClipAiMetadata } from "../ai-metadata.js";
import { cueCoverage, snapWindowToBoundaries, speechWindows } from "../audio-mix.js";
import { resolveRootAiMetadata } from "../clip-context.js";
import { contractTool, type CatalogTool, type ToolCall } from "../define.js";
import { projectFps } from "../frame-time.js";
import {
  blindTrimRejected,
  buttAgainstPreviousClip,
  computeClipTrimBounds,
  endBoundsKeepWindow,
  fileLooksLikeImage,
  isAudioOnlyMedia,
  parseExplicitSourceTimeRange,
  parseSecondsArg,
  parseTimecodeToken,
  placementWatchQuery,
  quantizePlacementSeconds,
  shouldWatchPlacement,
  sourceWindowForFile,
  TimeArgError,
  type ResizedPlacement,
} from "../placement.js";
import { pyFixed, pyFloat, pyG } from "../pyfmt.js";
import { applied } from "../receipt.js";
import { defaultUnderlayLayerNumber, formatTrackLabelForLlm, normalizeTrackOrLayerArg } from "../tracks.js";
import type { ImportedMedia } from "../types.js";
import { confirmWatchWindow, type WatchResult } from "../watch.js";
import { fileById, floatArg, fmtMmss, forgetFile, recallFile, record, rememberFile, selectedTrack, text } from "./common.js";

/** Seconds a text-index window may span before a vision match is required (MAX_PLACE_SPAN_SEC). */
export const MAX_PLACE_SPAN_SEC = 20.0;
/** Share of spoken audio above which a window is cut on transcript cues, not stills (DIALOGUE_COVERAGE). */
export const DIALOGUE_COVERAGE = 0.6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** tool_handlers._window_is_dialogue_driven. */
export function windowIsDialogueDriven(file: unknown, start: number, end: number): boolean {
  const cues = speechWindows(record(file).ai_metadata);
  if (cues.length === 0) return false;
  return cueCoverage(cues, start, end) >= DIALOGUE_COVERAGE;
}

/** tool_handlers._snap_window_off_boundaries. */
export function snapWindowOffBoundaries(file: unknown, start: number, end: number): [number, number, boolean] {
  return snapWindowToBoundaries(start, end, record(file).ai_metadata);
}

/** Media path, duration and transcript cues for a watch (tool_handlers._lookup_watch_meta). */
export function lookupWatchMeta(project: Project, fileId: string, file?: ProjectFile): { file: ProjectFile | undefined; duration: number; cues: unknown[] } {
  let data: ProjectFile | undefined = file;
  if (!data && fileId) {
    const own = fileById(project, fileId);
    const parentId = own && own.parent_file_id ? String(own.parent_file_id) : "";
    data = (parentId && fileById(project, parentId)) || own;
  }
  const ai = isRecord(data?.ai_metadata) ? (data!.ai_metadata as Record<string, unknown>) : {};
  const duration = Number(data?.duration) || 0;
  return { file: data, duration, cues: Array.isArray(ai.transcript_cues) ? ai.transcript_cues : [] };
}

// ---------------------------------------------------------------------------
// get_file_info_tool
// ---------------------------------------------------------------------------

function sourceFpsParts(file: Record<string, unknown>): [number, number, number] {
  const fps = record(file.fps);
  let num = parseTimecodeToken(fps.num) || 30;
  let den = parseTimecodeToken(fps.den) || 1;
  if (num <= 0) num = 30;
  if (den <= 0) den = 1;
  return [Math.trunc(num), Math.trunc(den), num / den];
}

function sourceDurationSeconds(file: Record<string, unknown>): number {
  const start = parseTimecodeToken(file.start) || 0;
  const end = parseTimecodeToken(file.end) || 0;
  if (end > start) return end - start;
  const duration = parseTimecodeToken(file.duration);
  if (duration && duration > 0) return duration;
  const readerDuration = parseTimecodeToken(record(file.reader).duration);
  if (readerDuration && readerDuration > 0) return readerDuration;
  const frames = parseTimecodeToken(file.video_length) || 0;
  const [, , fpsFloat] = sourceFpsParts(file);
  return frames > 0 && fpsFloat > 0 ? frames / fpsFloat : 0;
}

/** tool_handlers._describe_file_for_llm. */
export function describeFileForLlm(project: Project, fileId: string, file: ProjectFile): string {
  const data = file as unknown as Record<string, unknown>;
  const [num, den, fpsFloat] = sourceFpsParts(data);
  const duration = sourceDurationSeconds(data);
  const pfps = record(project.fps);
  const pNum = Math.trunc(parseTimecodeToken(pfps.num) || 30);
  const pDen = Math.trunc(parseTimecodeToken(pfps.den) || 1);
  const mediaType = String(data.media_type || (isAudioOnlyMedia(data) ? "audio" : "video"));
  let line =
    `file_id=${fileId} path=${String(data.path ?? "")} ` +
    `duration_seconds=${pyFixed(duration, 2)} source_fps=${num}/${den} ` +
    `project_fps=${pNum}/${pDen} media_type=${mediaType}`;
  const unreliable = isAudioOnlyMedia(data) || (fpsFloat <= 2.0 && duration > 2.0);
  if (unreliable) {
    line +=
      `\nNOTE: source_fps is ${num}/${den} and cannot be used for frame math. ` +
      "Pass start_seconds/end_seconds (in source seconds) - never frame numbers.";
  }
  return line;
}

function findFileByQuery(project: Project, query: string): ProjectFile | undefined {
  const q = query.toLowerCase();
  const files = (project.files ?? []).filter((f) => !f.zenvi_subclip);
  const byName = files.find((f) => String(f.name || f.path || "").toLowerCase().includes(q));
  if (byName) return byName;
  return files.find((f) => {
    const ai = record(f.ai_metadata);
    return `${String(ai.short_summary ?? "")} ${String(ai.description ?? "")}`.toLowerCase().includes(q);
  });
}

// ---------------------------------------------------------------------------
// Placement planning (add_clip_to_timeline)
// ---------------------------------------------------------------------------

export interface PlacementArgs {
  position_seconds?: unknown;
  track?: unknown;
  duration_seconds?: unknown;
  start_seconds?: unknown;
  end_seconds?: unknown;
  query?: unknown;
  full_file?: unknown;
}

export interface PlacementPlan {
  layer: number;
  position: number;
  /** Source window to trim to; undefined keeps addClip's defaults (the whole file / subclip window). */
  start?: number;
  end?: number;
  snapped: boolean;
  watched: WatchResult | null;
  /** position_seconds as given; null when the planner picked the position. */
  requested: number | null;
  /** The length the caller asked for (the trim, else the whole source), for the planned-end memory. */
  plannedLength: number;
  /** The document whose planned-end memory this placement reads and writes. */
  doc: ProjectDocument;
}

/**
 * Where each placement was planned to end, for placements whose length
 * snapping, a watch or butting changed (tool_handlers._planned_end_by_clip_id),
 * kept per document: timeline clip id → where it was placed and where it was
 * planned to end.
 */
const plannedEnds = new WeakMap<ProjectDocument, Map<string, { placedAt: number; plannedEnd: number }>>();

/** (planned end, actual end) of clips on `layer` this planner resized and nobody moved since (_resized_placements_on_track). */
function resizedPlacementsOnTrack(doc: ProjectDocument, layer: number): ResizedPlacement[] {
  const memo = plannedEnds.get(doc);
  if (!memo) return [];
  const out: ResizedPlacement[] = [];
  for (const clip of doc.project.clips ?? []) {
    const plan = memo.get(String(clip.id ?? ""));
    if (!plan || Number(clip.layer ?? 0) !== layer) continue;
    const pos = Number(clip.position) || 0;
    if (Math.abs(pos - plan.placedAt) <= 1e-6) {
      out.push({ plannedEnd: plan.plannedEnd, actualEnd: pos + (Number(clip.end) || 0) - (Number(clip.start) || 0) });
    }
  }
  return out;
}

/**
 * Plan a placement of `file` (add_clip_to_timeline, up to `_do_add`).
 * Returns an "Error: …" string when the arguments cannot be placed.
 */
export async function planPlacement(call: ToolCall, file: ProjectFile, args: PlacementArgs): Promise<PlacementPlan | string> {
  const project = call.doc.project;
  const fileData = file as unknown as Record<string, unknown>;
  const isAudio = isAudioOnlyMedia(fileData);
  const [srcStart, srcEnd] = sourceWindowForFile(fileData);
  const sourceLen = Math.max(0, srcEnd - srcStart);
  const query = text(args.query);

  let trimStart: number;
  let trimDur: number | null;
  let trimEnd: number | null;
  let posArg: number | null;
  try {
    trimStart = Math.max(0, parseSecondsArg(args.start_seconds, 0, "start_seconds") ?? 0);
    trimDur = parseSecondsArg(args.duration_seconds, null, "duration_seconds");
    trimEnd = parseSecondsArg(args.end_seconds, null, "end_seconds");
    posArg = parseSecondsArg(args.position_seconds, null, "position_seconds");
  } catch (error) {
    if (error instanceof TimeArgError) return `Error: ${error.message}`;
    throw error;
  }
  // end_seconds is the keep-window form (place_moment); duration wins when the
  // two disagree, and an overridden end_seconds is a leftover arg, not a bound.
  const endBoundsWindow = endBoundsKeepWindow(trimStart, trimDur, trimEnd);
  if (endBoundsWindow) {
    if (trimEnd! <= trimStart) {
      return `Error: end_seconds ${pyFloat(trimEnd!)} must be greater than start_seconds ${pyFloat(trimStart)}.`;
    }
    trimDur = trimEnd! - trimStart;
  }
  if (trimDur !== null) trimDur = Math.max(0, trimDur);

  const wholeFile = ["1", "true", "yes"].includes(String(args.full_file ?? "").trim().toLowerCase());
  if (isAudio && !wholeFile && (posArg === null || trimDur === null)) {
    return (
      "Error: audio placement needs position_seconds (where on the timeline) and " +
      "duration_seconds (how much to use), plus start_seconds for the source in-point. " +
      'Pass full_file="true" only when the user asked for one continuous bed.'
    );
  }
  // start_seconds alone keeps the rest of the file from there.
  if (trimDur === null && trimStart > 0 && !wholeFile) {
    if (trimStart >= sourceLen) {
      return `Error: start_seconds ${pyG(trimStart)} is past the end of this file (${pyFixed(sourceLen, 2)}s long).`;
    }
    trimDur = sourceLen - trimStart;
  }

  // Layer-3 watch of a bounded candidate window. No window asked for (no
  // trim, or full_file) means the whole file: a watch refines a window the
  // caller named and never invents one.
  let watched: WatchResult | null = null;
  let watchedStart: number | null = null;
  let watchedEnd: number | null = null;
  const isImage = fileLooksLikeImage(fileData);
  const skipWatch = parseExplicitSourceTimeRange(query) !== null;
  const winS = srcStart + trimStart;
  const winE = trimDur ? Math.min(srcEnd, winS + Math.max(trimDur, 4.0)) : srcEnd;
  const wantsWindow = Boolean(trimDur) && !wholeFile;
  const watchable =
    wantsWindow &&
    shouldWatchPlacement({
      isAudio,
      isImage,
      skipExplicitTimes: skipWatch,
      isAlreadyWatchedSubclip: Boolean(fileData.zenvi_subclip),
      explicitQuery: Boolean(query),
      windowSec: winE - winS,
    });
  if (watchable && !windowIsDialogueDriven(fileData, winS, winE)) {
    const meta = lookupWatchMeta(project, String(file.id), file);
    const result = await confirmWatchWindow(call, {
      file: meta.file,
      start: winS,
      end: winE,
      query: placementWatchQuery(fileData, query),
      fallbackCut: (winS + winE) / 2,
      duration: meta.duration,
      cues: meta.cues,
      fallbackIn: winS,
      fallbackOut: Math.min(srcEnd, winS + (trimDur || winE - winS)),
    });
    // A host that cannot watch at all has not looked at the file.
    if (result.ran) {
      let inS = Math.max(srcStart, Math.min(result.in_source, srcEnd));
      let outS = Math.max(srcStart, Math.min(result.out_source, srcEnd));
      if (outS <= inS + 1e-3) {
        inS = winS;
        outS = Math.min(srcEnd, winE);
      }
      if (trimDur && outS - inS > trimDur + 1e-6) {
        const peak = Math.max(inS, Math.min(result.cut_source || (inS + outS) / 2, outS));
        inS = Math.max(srcStart, peak - trimDur / 2);
        outS = Math.min(srcEnd, inS + trimDur);
        if (outS - inS < trimDur) inS = Math.max(srcStart, outS - trimDur);
      }
      watchedStart = inS;
      watchedEnd = outS;
      watched = result;
    }
  }

  if (
    blindTrimRejected({
      trimDur,
      watchedStart,
      hasExplicitEnd: endBoundsWindow,
      hasExplicitStart: trimStart > 0,
      isAudio,
      isImage,
      isSubclip: Boolean(fileData.zenvi_subclip),
    })
  ) {
    // Never name a remedy the caller already applied (zenvi-core #167).
    if (trimEnd !== null) {
      return (
        `Error: duration_seconds=${pyG(trimDur!)} overrides end_seconds=${pyG(trimEnd)}, so ` +
        `this would keep the first ${pyG(trimDur!)}s of a file nothing has looked at. ` +
        "Drop duration_seconds and pass start_seconds (where the section begins) with end_seconds."
      );
    }
    return (
      "Error: duration_seconds alone cannot trim the first N seconds of a file " +
      "nothing has looked at. Name both edges of the section you want: pass " +
      "start_seconds and end_seconds (the keep window search_clips returned), " +
      "or place_moment with that window." +
      (skipWatch ? " Times written in query are not read as the window." : "")
    );
  }

  // Track (the desktop's _do_add).
  const layers = project.layers ?? [];
  let layer: number;
  const trackText = text(args.track);
  if (!trackText) {
    if (isAudio) layer = defaultUnderlayLayerNumber(layers);
    else {
      const selected = selectedTrack(call);
      layer = selected ? Math.trunc(Number(selected.number)) : defaultUnderlayLayerNumber(layers);
    }
  } else {
    const resolved = normalizeTrackOrLayerArg(trackText, layers);
    if (resolved.error) return resolved.error;
    layer = resolved.layer ?? defaultUnderlayLayerNumber(layers);
  }

  // Position. An explicit position planned on where a resized clip was meant
  // to end butts against that clip's real end.
  const fps = projectFps(project);
  const fpsFloat = fps.num / fps.den;
  let position: number;
  if (posArg === null) {
    if (isAudio) position = 0;
    else {
      const same = (project.clips ?? []).filter((c) => Number(c.layer ?? 0) === layer);
      position = same.length > 0
        ? Math.max(...same.map((c) => (Number(c.position) || 0) + ((Number(c.end) || 0) - (Number(c.start) || 0)))) + 1 / Math.max(fpsFloat, 1)
        : 0;
    }
  } else if (isAudio) {
    position = posArg;
  } else {
    position = buttAgainstPreviousClip(posArg, resizedPlacementsOnTrack(call.doc, layer));
  }

  const plan: PlacementPlan = {
    layer,
    position,
    snapped: false,
    watched,
    requested: posArg,
    plannedLength: trimDur || sourceLen,
    doc: call.doc,
  };
  const applyTrim = watchedStart !== null || (trimDur !== null && trimDur > 0);
  if (applyTrim) {
    let [start, end] =
      watchedStart !== null
        ? [watchedStart, watchedEnd!]
        : computeClipTrimBounds(sourceLen, { trimStart, trimDur: trimDur!, fileStart: srcStart, minDuration: 1 / Math.max(fpsFloat, 1) });
    const [s, e, snapped] = snapWindowOffBoundaries(fileData, start, end);
    [start, end] = quantizePlacementSeconds(s, e, fps);
    plan.start = start;
    plan.end = end;
    plan.snapped = snapped;
  }
  return plan;
}

/** Record a planned placement (inside the call's transaction). Returns the new clip. */
export function applyPlacement(tx: Transaction, fileId: string, plan: PlacementPlan): Clip {
  const clip = addClip(tx, {
    fileId,
    position: plan.position,
    layer: plan.layer,
    ...(plan.start !== undefined ? { start: plan.start } : {}),
    ...(plan.end !== undefined ? { end: plan.end } : {}),
  });
  if (plan.watched && plan.watched.ran && plan.start !== undefined) {
    // Tool-owned provenance keys the desktop stamps on a watched placement.
    tx.update(["clips", { id: clip.id }], {
      zenvi_watch_confirmed: !plan.watched.used_fallback,
      zenvi_watch_confidence: Number(plan.watched.confidence) || 0,
    });
  }
  const placed = (tx.project.clips ?? []).find((c) => c.id === clip.id) ?? clip;
  // The caller planned this clip to end at its position plus the length it
  // asked for; snapping, a watch or butting moves the real end, and the next
  // planned position with it.
  const placedAt = Number(placed.position) || 0;
  const plannedEnd = (plan.requested ?? plan.position) + plan.plannedLength;
  const actualEnd = placedAt + (Number(placed.end) || 0) - (Number(placed.start) || 0);
  if (Math.abs(actualEnd - plannedEnd) > 1e-6) {
    let memo = plannedEnds.get(plan.doc);
    if (!memo) {
      memo = new Map();
      plannedEnds.set(plan.doc, memo);
    }
    memo.set(String(placed.id), { placedAt, plannedEnd });
  }
  return placed;
}

/** "Added clip to timeline at position 5.0s on track …" (add_clip_to_timeline's result). */
export function placementText(project: Project, plan: PlacementPlan, clip: Clip): string {
  const trackLabel = formatTrackLabelForLlm(plan.layer, project.layers);
  const dur = (Number(clip.end) || 0) - (Number(clip.start) || 0);
  const durPart = dur > 0 ? ` duration=${pyFixed(dur, 2)}s` : "";
  const idPart = clip.id ? ` timeline_clip_id=${clip.id}` : "";
  let note = plan.snapped ? ", moved off mid-sentence" : "";
  if (plan.requested !== null && Math.abs(plan.position - plan.requested) > 1e-9) {
    note += `, moved from ${pyFloat(plan.requested)}s to butt against the previous clip`;
  }
  const watchPart = plan.watched && plan.watched.ran ? " (watched)" : "";
  return `Added clip to timeline at position ${pyFloat(plan.position)}s on track ${trackLabel}${durPart}${idPart}${note}${watchPart}.`;
}

/**
 * Place an existing media-bin file with add_clip_to_timeline semantics, as
 * this call's one undo step. Returns the result text (or an error string).
 */
export async function placeExistingFile(call: ToolCall, file: ProjectFile, args: PlacementArgs): Promise<{ text: string; clip?: Clip }> {
  const plan = await planPlacement(call, file, args);
  if (typeof plan === "string") return { text: plan };
  const clip = call.commit((tx) => applyPlacement(tx, String(file.id), plan));
  return { text: placementText(call.doc.project, plan, clip), clip };
}

/** A media-bin entry as addFile would build it, before it exists (for planning an import + place). */
export function provisionalFile(media: ImportedMedia, overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    ...media.info,
    path: media.path,
    id: "",
    media_type: detectMediaType(media),
    ...(media.name !== undefined ? { name: media.name } : {}),
    ...overrides,
  } as ProjectFile;
}

/**
 * Import `media`, then place it (add_clip_to_timeline semantics) in one
 * transaction. `patch` adds keys to the new file entry (AI summary, tags).
 */
export async function importAndPlace(
  call: ToolCall,
  media: ImportedMedia,
  args: PlacementArgs,
  patch: Partial<ProjectFile> = {},
): Promise<{ text: string; file?: ProjectFile; clip?: Clip }> {
  const plan = await planPlacement(call, provisionalFile(media, patch), args);
  if (typeof plan === "string") return { text: plan };
  const { file, clip } = call.commit((tx) => {
    const added = addFile(tx, media, { dedupe: true });
    if (Object.keys(patch).length > 0) tx.update(["files", { id: added.id }], patch);
    return { file: added, clip: applyPlacement(tx, String(added.id), plan) };
  });
  return { text: placementText(call.doc.project, plan, clip), file, clip };
}

// ---------------------------------------------------------------------------
// split_file_add_clip_tool helpers
// ---------------------------------------------------------------------------

/** time_parts.secondsToTime → "HH:MM:SS:FF" parts used in subclip names. */
function secondsToTimeParts(secs: number, fpsNum: number, fpsDen: number): { hour: string; min: string; sec: string; frame: string } {
  const ms = secs * 1000;
  let sec = Math.floor(ms / 1000);
  const milli = ((ms % 1000) + 1000) % 1000;
  let minute = Math.floor(sec / 60);
  sec %= 60;
  let hour = Math.floor(minute / 60);
  minute %= 60;
  hour %= 24;
  const fpsFloat = fpsDen ? fpsNum / fpsDen : 0;
  const x = (milli / 1000) * fpsFloat;
  const f = Math.floor(x);
  let frame = x - f > 0.5 ? f + 1 : x - f < 0.5 ? f : f % 2 === 0 ? f : f + 1;
  if (fpsFloat > 0) frame = Math.max(0, Math.min(frame, Math.trunc(fpsFloat) - 1));
  const pad = (n: number): string => String(Math.trunc(n)).padStart(2, "0");
  return { hour: pad(hour), min: pad(minute), sec: pad(sec), frame: pad(frame) };
}

function stem(path: string): string {
  const base = String(path ?? "").split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const clipTools: CatalogTool[] = [
  contractTool("get_file_info_tool", {
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    run: (call, input) => {
      const project = call.doc.project;
      let id = text(input.file_id);
      if (!id && text(input.query)) id = String(findFileByQuery(project, text(input.query))?.id ?? "");
      if (!id) return "Error: file_id is required.";
      const file = fileById(project, id);
      if (!file) return `Error: File not found for id=${id}.`;
      return describeFileForLlm(project, id, file);
    },
  }),

  contractTool("add_clip_to_timeline_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (call, input) => {
      let fileId = text(input.file_id);
      if (!fileId) {
        fileId = recallFile(call) ?? "";
        if (!fileId) {
          return (
            "Error: No clip was just created. " +
            "Pass tool_args.file_id with a media_bin file id, or run " +
            "split_file_add_clip_tool / import_files_tool / import_stock_media_tool " +
            "immediately before this step (empty file_id only works right after those " +
            "tools in the same session)."
          );
        }
      }
      const file = fileById(call.doc.project, fileId);
      if (!file) return `Error: File not found for id=${fileId}.`;
      const placed = await placeExistingFile(call, file, input);
      if (placed.clip) forgetFile(call);
      return placed.text;
    },
  }),

  contractTool("split_file_add_clip_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (call, input) => {
      const project = call.doc.project;
      const fileId = text(input.file_id);
      if (!fileId) return "Error: file_id is required.";
      const file = fileById(project, fileId);
      if (!file) return `Error: File not found for id=${fileId}.`;
      const data = file as unknown as Record<string, unknown>;
      const fpsData = record(data.fps);
      const fpsNum = Math.trunc(Number(fpsData.num ?? 30));
      const fpsDen = Math.trunc(Number(fpsData.den ?? 1));
      const fps = fpsDen ? fpsNum / fpsDen : 0;
      if (!(fps > 0)) return "Error: Invalid fps.";

      const [srcStart, srcEnd] = sourceWindowForFile(data);
      const query = text(input.query);
      // tool_handlers._coerce_time_arg: float(str(x).strip()) or None.
      const t0Raw = floatArg(input.start_seconds, null);
      const t1Raw = floatArg(input.end_seconds, null);
      if (t0Raw === null || t1Raw === null) {
        return "Error: Provide start_seconds+end_seconds (preferred) or start_frame+end_frame (1-based).";
      }
      let t0 = Math.min(t0Raw, t1Raw);
      let t1 = Math.max(t0Raw, t1Raw);
      t0 = Math.max(srcStart, Math.min(t0, srcEnd));
      t1 = Math.max(srcStart, Math.min(t1, srcEnd));
      if (t1 <= t0 + 1e-3) {
        return `Error: split window is empty after clamping to the file [${pyFixed(srcStart, 2)}s–${pyFixed(srcEnd, 2)}s].`;
      }

      const skipWatch = parseExplicitSourceTimeRange(query) !== null;
      const origSpan = t1 - t0;
      const requireVisual = origSpan > MAX_PLACE_SPAN_SEC;
      let watchedNote = "";
      let watchRecord: WatchResult | null = null;
      if (!skipWatch && !windowIsDialogueDriven(data, t0, t1)) {
        const meta = lookupWatchMeta(project, fileId, file);
        const watched = await confirmWatchWindow(call, {
          file: meta.file,
          start: t0,
          end: t1,
          query: query || "the matching action in this window",
          fallbackCut: (t0 + t1) / 2,
          duration: meta.duration,
          cues: meta.cues,
          fallbackIn: t0,
          fallbackOut: t1,
        });
        if (watched.ran) {
          const inS = Math.max(srcStart, Math.min(watched.in_source, srcEnd));
          const outS = Math.max(srcStart, Math.min(watched.out_source, srcEnd));
          if (outS > inS + 1e-3) {
            t0 = inS;
            t1 = outS;
          }
          if (watched.used_fallback) {
            if (requireVisual) {
              return (
                "Error: no visual match in this chapter-level window " +
                `[${pyFixed(origSpan, 1)}s]. Narrow the query or re-index the file ` +
                "so action-bounded scenes exist; do not place the chapter start."
              );
            }
            watchedNote = " (text-index window; no visual match)";
          } else if (watched.reason) {
            watchedNote = ` (watched: ${Array.from(watched.reason).slice(0, 120).join("")})`;
          }
          watchRecord = watched;
        }
      }
      const [s, e] = snapWindowOffBoundaries(data, t0, t1);
      const [qStart, qEnd] = quantizePlacementSeconds(s, e, projectFps(project));

      const { name: _name, id: _id, ...rest } = data;
      const entry: Record<string, unknown> = { ...structuredClone(rest), start: qStart, end: qEnd, parent_file_id: fileId };
      const ai = record(data.ai_metadata);
      if (ai.analyzed) {
        const [rootAi] = resolveRootAiMetadata(project, data, fileId);
        const effective = rootAi
          ? materializeClipAiMetadata(rootAi, qStart, qEnd, { rebased: true })
          : getEffectiveAiMetadata(data, { start: qStart, end: qEnd }, { rebased: true });
        entry.ai_metadata = effective;
        if (entry.tags) entry.tags = filterTagsStringForWindow(String(entry.tags), effective);
      }
      const t = secondsToTimeParts(s, fpsNum, fpsDen);
      const clipName = `${stem(String(data.path || data.name || "clip"))} (${t.hour}:${t.min}:${t.sec}:${t.frame})`;
      entry.zenvi_subclip = true;
      if (watchRecord) {
        entry.zenvi_watch_confirmed = !watchRecord.used_fallback;
        entry.zenvi_watch_confidence = Number(watchRecord.confidence) || 0;
        entry.zenvi_watch_sparse = Boolean(watchRecord.sparse);
      }

      // The contract's position_seconds/track also place the subclip (one undo step).
      const place = text(input.position_seconds) !== "" || text(input.track) !== "";
      const media: ImportedMedia = {
        path: String(data.path ?? ""),
        info: entry as unknown as ImportedMedia["info"],
        name: clipName,
      };
      let plan: PlacementPlan | string | null = null;
      if (place) {
        plan = await planPlacement(call, provisionalFile(media, { ...(entry as Partial<ProjectFile>), name: clipName }), {
          position_seconds: input.position_seconds,
          track: input.track,
          query,
        });
        if (typeof plan === "string") return plan;
      }
      const placement = plan;
      const result = call.commit((tx) => {
        const sub = addFile(tx, media, { dedupe: false, name: clipName, mediaType: file.media_type });
        const clip = placement ? applyPlacement(tx, String(sub.id), placement) : undefined;
        return { sub, clip };
      });
      const newId = String(result.sub.id);
      let summary =
        `Subclip created: "${clipName}" (file_id=${newId}) ` +
        `from ${fmtMmss(s)}–${fmtMmss(e)} source${watchedNote}. `;
      if (result.clip && placement) {
        summary += placementText(call.doc.project, placement, result.clip);
        forgetFile(call);
      } else {
        summary +=
          `Call add_clip_to_timeline_tool(file_id="${newId}") to place it ` +
          "(do not pass duration_seconds — this subclip is already trimmed).";
        rememberFile(call, newId);
      }
      return result.clip ? summary : applied("split_file_add_clip_tool", summary, { data: { file_id: newId } });
    },
  }),
];
