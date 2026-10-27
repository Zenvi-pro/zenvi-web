/**
 * The Zenvi Assistant's older colour tools: apply_color_tool,
 * apply_look_tool, inspect_color_tool, list_looks_tool and
 * match_color_to_reference_tool.
 *
 * Ports of zenvi-core develop (1f80cb3d0) src/classes/tool_handlers.py
 * (`apply_color`, `apply_look`, `inspect_color`, `list_looks`,
 * `match_color_to_reference` and their `_resolve_color_target_ids`,
 * `_render_clip_isolated`, `_profile_clip_dense`, `_profile_media_path`
 * helpers) on top of tools/color-agent.ts (color_agent.py). Results are the
 * desktop's JSON object (as `data`, and as the summary line). Differences:
 *
 * - Preview frames travel as images (MCP image content / the Assistant's
 *   image sidecar); their `*_preview_jpeg` fields say which attached image
 *   they are instead of holding base64.
 * - Scopes measure clipped shadows/highlights as shares of the frame (0-1),
 *   which the thresholds here expect (nuke risk at 0.12, outdoor at 0.05);
 *   the desktop passes FrameScope's pixel counts to them.
 * - match_color_to_reference iterates on a working copy and records the final
 *   grade as one undo step; a merge the desktop would reject halfway (a
 *   saturation below 0.5) refuses the whole call before anything changes.
 */

import { ASSET_KEY, writeAsset } from "../mattes.js";
import type { Clip, Effect, Project, ProjectFile } from "../../model/types.js";
import { isAudioOnlyMedia } from "../../model/media.js";
import { pyRound } from "../../model/rounding.js";
import { createEffect } from "../../effects/registry.js";
import { setClipEffects } from "../../ops/effects.js";
import { idFactory } from "../../model/ids.js";
import { applyFilmGrainPreset, type FilmGrainPreset } from "../../ops/look.js";
import { analyzeFrameScope } from "../../render/frame-scope.js";
import { editedWhileRendering, FrameRenderError, isolatedProject, mediaFileProject, renderPixels, renderPreview, soloRenderSize } from "../color-frames.js";
import {
  applySoftColorPreset,
  assessGradeOutcome,
  buildLookProfile,
  ColorValueError,
  CURVE_ALIASES,
  CURVE_KEYS,
  DELTA_KEYS,
  findColorGrade,
  findFilmGrain,
  gradesMeaningfullyDiffer,
  grainMeaningfullyDiffers,
  isColorGradeEffect,
  isFilmGrainEffect,
  isOutdoorBrightProfile,
  listLooksCatalog,
  LOOK_DISTANCE_MATCHED,
  lookProfileDistance,
  matchGradeAction,
  matchGrainAction,
  mergeColorGrade,
  parseClipIds,
  referenceGapHints,
  resolveLookId,
  sampleCountForDuration,
  SCALAR_ALIASES,
  SCALAR_DEFAULTS,
  SCALAR_KEYS,
  scalarY,
  scopeFromRawVideo,
  setScalar,
  solveGradeFromProfiles,
  summarizeColorGrade,
  summarizeFilmGrain,
  targetProfileForLook,
  toFloat,
  validateColorPatch,
  type ResolvedLook,
} from "../color-agent.js";
import { contractTool, type CatalogTool, type ToolCall } from "../define.js";
import { checkLutFile, colorAgentLutPath, LutError } from "../luts.js";
import { applied, failed, type ToolReceipt } from "../receipt.js";
import type { ToolImage } from "../types.js";
import { parsePythonFloat } from "../coerce.js";
import { playheadSeconds } from "./common.js";
import { isLocked } from "./effects-color-common.js";

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Python `str(x or "").strip()`. */
function text(value: unknown): string {
  if (value === null || value === undefined || value === false || value === "") return "";
  if (value === true) return "True";
  return String(value).trim();
}

/** `_tool_flag`: the first value given (bool or yes/no text) wins; empty ones are skipped. */
export function toolFlag(values: readonly unknown[], fallback = false): boolean {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "boolean") return value;
    const t = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(t)) return true;
    if (["0", "false", "no", "n", "off"].includes(t)) return false;
  }
  return fallback;
}

function fps(project: Project): number {
  const f = project.fps;
  return f && f.num > 0 && f.den > 0 ? f.num / f.den : 30.0;
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

/** `_all_timeline_clip_ids`: every clip with a picture, in project order. */
function allTimelineClipIds(project: Project): string[] {
  const out: string[] = [];
  for (const clip of project.clips) {
    const id = String(clip.id ?? "").trim();
    if (id && !out.includes(id) && !isAudioOnlyMedia(clip.reader)) out.push(id);
  }
  return out;
}

/** `_playhead_timeline_clip_ids`: picture clips under the playhead (stacked tracks give several). */
function playheadTimelineClipIds(call: ToolCall): string[] {
  const t = Math.max(0, playheadSeconds(call));
  const out: string[] = [];
  for (const clip of call.doc.project.clips) {
    const position = Number(clip.position) || 0;
    if (position > t || position + ((Number(clip.end) || 0) - (Number(clip.start) || 0)) < t) continue;
    const id = String(clip.id ?? "").trim();
    if (id && !out.includes(id) && !isAudioOnlyMedia(clip.reader)) out.push(id);
  }
  return out;
}

/** `_resolve_color_target_ids`: explicit ids → all/both/* or all_clips → the selection → the playhead. */
function resolveColorTargetIds(
  call: ToolCall,
  args: { clip_ids?: unknown; clipIds?: unknown; timeline_clip_id?: unknown; clipId?: unknown; all_clips?: boolean },
): string[] {
  const joined = [args.clip_ids, args.clipIds, args.timeline_clip_id, args.clipId].map(text).filter(Boolean).join(" ").trim().toLowerCase();
  let wantAll = Boolean(args.all_clips) || ["all", "*", "both", "every", "everything"].includes(joined);
  if (!wantAll) {
    const parsed = parseClipIds(args.clip_ids, args.clipIds, args.timeline_clip_id, args.clipId);
    if (parsed.length > 0 && parsed.every((p) => ["all", "*", "both"].includes(p.trim().toLowerCase()))) wantAll = true;
    else if (parsed.length > 0) return parsed;
  }
  if (wantAll) return allTimelineClipIds(call.doc.project);
  const clips = new Set(call.doc.project.clips.map((c) => c.id));
  const selected = (call.host.ui?.selectedIds?.() ?? []).filter((id) => clips.has(id));
  if (selected.length > 0) return selected;
  return playheadTimelineClipIds(call);
}

/** `_color_target_error`. */
function colorTargetError(project: Project, action: string): string {
  const available = allTimelineClipIds(project);
  let avail = available.length > 0 ? available.slice(0, 12).join(", ") : "(none)";
  if (available.length > 12) avail += ", …";
  return (
    `Error: ${action} needs a target clip. Select clip(s), park the playhead ` +
    `on a clip, pass timeline_clip_id / clipIds, or clipIds="all" for every ` +
    `timeline clip. On timeline now: ${avail}`
  );
}

/** `_filter_unlocked_color_clip_ids`: drop missing and locked-track clips (with warnings) before any change. */
export function filterUnlocked(project: Project, ids: readonly string[], warnings: string[]): string[] {
  const kept: string[] = [];
  for (const cid of ids) {
    const clip = project.clips.find((c) => c.id === cid);
    if (!clip) {
      warnings.push(`clip ${cid} not found`);
      continue;
    }
    if (isLocked(project, Number(clip.layer) || 0)) {
      warnings.push(`clip ${cid}: track locked — skipped`);
      continue;
    }
    kept.push(cid);
  }
  return kept;
}

/** `_resolve_lut_file`: a LUT id, bundled path or file → what `lut_path` stores; refused before any change. */
export async function resolveLutFile(call: ToolCall, raw: unknown): Promise<string> {
  const value = text(raw);
  const look = resolveLookId(value);
  if (look.kind !== "lut") throw new ColorValueError(`'${value}' is a ${look.kind} look, not a LUT; use apply_look_tool`);
  const resolved = colorAgentLutPath(look.lut_path);
  if (!resolved || resolved.kind === "none") throw new ColorValueError(`LUT file not found: ${look.lut_path}. Call list_looks_tool for LUT ids.`);
  if (resolved.kind === "file") {
    try {
      await checkLutFile(call, resolved.path);
    } catch (error) {
      if (error instanceof LutError) throw new ColorValueError(`LUT file not found: ${look.lut_path}. Call list_looks_tool for LUT ids. (${error.message})`);
      throw error;
    }
  }
  return resolved.path;
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/** `create_color_grade_effect_json` / `_create_film_grain_effect_json`: a fresh effect with a new id. */
export function effectFactory(project: Project): (className: string) => Json {
  const nextId = idFactory(project);
  return (className) => createEffect(className, {}, { id: nextId() }) as unknown as Json;
}

/** Put `effect` where the first ColorGrade is, dropping the others (or append it). */
function replaceFirstGrade(effects: readonly Effect[], effect: Json): Effect[] {
  let replaced = false;
  const out: Effect[] = [];
  for (const e of effects) {
    if (isColorGradeEffect(e)) {
      if (!replaced) {
        out.push(effect as Effect);
        replaced = true;
      }
    } else {
      out.push(e);
    }
  }
  if (!replaced) out.push(effect as Effect);
  return out;
}

/** The clip's effects with `existing` grade (created and appended when missing) merged with `patch`. */
export function mergedGradeEffects(effects: Effect[], patch: Json, create: (cn: string) => Json): { effects: Effect[]; merged: Json } {
  let existing = findColorGrade(effects) as Json | null;
  let list = effects;
  if (existing === null) {
    existing = create("ColorGrade");
    list = [...effects, existing as Effect];
  }
  const merged = mergeColorGrade(existing, patch);
  return { effects: replaceFirstGrade(list, merged), merged };
}

// ---------------------------------------------------------------------------
// Rendering (isolated clip previews and look profiles)
// ---------------------------------------------------------------------------

interface Isolated {
  scopes: Json;
  preview: ToolImage | null;
  localFrame: number;
}

/** `_clip_local_frame_number`: a timeline frame mapped into the clip (its middle when outside it). */
function clipLocalFrameNumber(clip: Pick<Clip, "position" | "start" | "end">, timelineFrame: number, rate: number): number {
  const r = Math.max(rate, 1e-6);
  const pos = Number(clip.position) || 0;
  const start = Number(clip.start) || 0;
  const end = Number(clip.end) || start + 1.0 / r;
  const duration = Math.max(1.0 / r, end - start);
  const timelineSec = Math.max(0.0, (Math.trunc(timelineFrame) - 1) / r);
  let localSec = timelineSec - pos;
  if (localSec < 0 || localSec > duration) localSec = duration * 0.5;
  return Math.max(1, Math.trunc(localSec * rate) + 1);
}

/** `_framescope_from_frame` + scope_from_raw_video (clipped values as shares of the frame, see the module comment). */
function scopesOf(pixels: Parameters<typeof analyzeFrameScope>[0]): Json {
  const scope = analyzeFrameScope(pixels, { vectorscopeSize: 96 });
  if (!scope) return { present: false };
  const area = Math.max(1, pixels.width * pixels.height);
  return scopeFromRawVideo({
    present: true,
    histogram: { luma: Array.from(scope.luma), red: Array.from(scope.red), green: Array.from(scope.green), blue: Array.from(scope.blue) },
    summary: { avg_luma: scope.avgLuma, clipped_shadows: scope.clippedShadows / area, clipped_highlights: scope.clippedHighlights / area },
  });
}

/** `_render_clip_isolated`: the clip alone (effects on) at a timeline frame → scopes and an optional preview. */
async function renderClipIsolated(call: ToolCall, clip: Clip, timelineFrame: number, withPreview: boolean): Promise<Isolated> {
  const project = call.doc.project;
  const localFrame = clipLocalFrameNumber(clip, timelineFrame, fps(project));
  const scratch = isolatedProject(project, clip);
  try {
    const [width] = soloRenderSize(project.width, project.height);
    const frame = await renderPixels(call, scratch, localFrame, width);
    const scopes = scopesOf(frame.pixels);
    scopes.isolated = true;
    scopes.local_frame = localFrame;
    const preview = withPreview ? await renderPreview(call, scratch, localFrame) : null;
    return { scopes, preview, localFrame };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { scopes: { present: false, isolated: false, error: `isolated render failed: ${message}` }, preview: null, localFrame: 0 };
  }
}

/** `_sample_local_frames`: 1-based frames spread evenly across [0, duration). */
function sampleLocalFrames(duration: number, rate: number, count: number): number[] {
  const n = Math.max(1, Math.trunc(count || sampleCountForDuration(duration)));
  const r = Math.max(rate || 30.0, 1e-6);
  const total = Math.max(1, pyRound(Math.max(duration, 1.0 / r) * r));
  if (n === 1) return [Math.max(1, Math.floor(total / 2))];
  const frames: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / Math.max(n - 1, 1);
    frames.push(Math.max(1, Math.min(total, 1 + pyRound(t * (total - 1)))));
  }
  return [...new Set(frames)];
}

/** `_clip_duration_seconds`. */
function clipDurationSeconds(clip: Clip): number {
  const start = Number(clip.start) || 0;
  const end = Number(clip.end) || 0;
  if (end > start) return end - start;
  const dur = Number((clip.reader as unknown as Json | undefined)?.duration) || 0;
  return dur > 0 ? dur : 1.0;
}

/** The sample whose JPEG the desktop returns as `preview_jpeg` (the middle of the first, middle and last). */
function previewIndex(n: number): number {
  const picks = [...new Set([0, Math.floor(n / 2), n - 1])].sort((a, b) => a - b);
  return picks[Math.floor(picks.length / 2)]!;
}

/** Profile frames rendered at once: the renders are independent, and hosts decode each one separately. */
const RENDER_CONCURRENCY = 4;

/** `fn` over `items` with at most `limit` running at a time, results in order; stops starting new ones once aborted (null). */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>, signal?: AbortSignal): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array<R | null>(items.length).fill(null);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length && !signal?.aborted) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export interface ProfilePack {
  profile: Json;
  scopes_samples: number;
  sample_frames: number[];
  preview: ToolImage | null;
  duration_s: number;
}

/** `_profile_clip_dense`: a LookProfile from frames spread across the clip (isolated renders). */
export async function profileClipDense(call: ToolCall, clip: Clip, maxSamples?: number): Promise<ProfilePack> {
  const rate = fps(call.doc.project);
  const duration = clipDurationSeconds(clip);
  let n = sampleCountForDuration(duration);
  if (maxSamples !== undefined) n = Math.max(1, Math.min(Math.trunc(maxSamples), n));
  const frames = sampleLocalFrames(duration, rate, n);
  const solo: Clip = { ...clip, position: 0.0 };
  const pick = previewIndex(frames.length);
  const rendered = await mapLimit(frames, RENDER_CONCURRENCY, (localFrame, i) => renderClipIsolated(call, solo, localFrame, i === pick), call.signal);
  const scopes = rendered.filter((r): r is Isolated => r !== null && Boolean(r.scopes.present)).map((r) => r.scopes);
  const preview = rendered[pick]?.preview ?? null;
  return { profile: buildLookProfile(scopes), scopes_samples: scopes.length, sample_frames: frames, preview, duration_s: duration };
}

/** `_profile_media_path`: a LookProfile of a media-bin file (or a local file the host imports). */
export async function profileMediaFile(call: ToolCall, file: ProjectFile): Promise<ProfilePack> {
  const project = call.doc.project;
  const rate = fps(project);
  const still = Boolean(file.has_single_image) || String(file.media_type ?? "") === "image";
  const duration = still ? 0.0 : Math.max(0, Number(file.duration) || 0);
  const n = duration <= 0.05 ? 1 : sampleCountForDuration(duration);
  const frames = sampleLocalFrames(Math.max(duration, 1.0 / rate), rate, n);
  const scratch = mediaFileProject(project, file, Math.max(duration, 1.0 / rate));
  const [width] = soloRenderSize(project.width, project.height);
  const pick = previewIndex(frames.length);
  let scopes: Json[];
  let preview: ToolImage | null;
  try {
    const measured = await mapLimit(frames, RENDER_CONCURRENCY, async (frame) => scopesOf((await renderPixels(call, scratch, frame, width)).pixels), call.signal);
    scopes = measured.filter((sc): sc is Json => sc !== null && Boolean(sc.present));
    preview = await renderPreview(call, scratch, frames[pick]!);
  } catch (error) {
    return {
      profile: { present: false, error: error instanceof Error ? error.message : String(error) },
      scopes_samples: 0,
      sample_frames: frames,
      preview: null,
      duration_s: duration,
    };
  }
  return { profile: buildLookProfile(scopes), scopes_samples: scopes.length, sample_frames: frames, preview, duration_s: duration };
}

/**
 * `_profile_media_path` for a local file (referenceImagePath): probed where it
 * is (never copied into the project), then profiled like a media-bin file.
 */
async function profileLocalPath(call: ToolCall, path: string): Promise<ProfilePack> {
  try {
    const info = await call.host.media!.probe(path);
    const file = { ...(info as unknown as Json), id: "ZENVIREFIMG", path } as unknown as ProjectFile;
    return await profileMediaFile(call, file);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { profile: { present: false, error: `file not found: ${path} (${reason})` }, scopes_samples: 0, sample_frames: [], preview: null, duration_s: 0 };
  }
}

/** `int(x or default)`: Python int() of an argument, `fallback` when empty, zero-valued or not an integer. */
function pyIntOr(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "" || value === 0 || value === false) return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : fallback;
  const t = String(value).trim();
  return /^[+-]?\d+$/.test(t) ? Number.parseInt(t, 10) : fallback;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Attach preview images; their JSON fields name the attachment instead of holding base64. */
class Previews {
  readonly images: ToolImage[] = [];

  field(image: ToolImage | null | undefined): string {
    if (!image) return "";
    this.images.push(image);
    return `attached image ${this.images.length}`;
  }
}

/** The desktop's `json.dumps(result)` as the receipt (summary line and data), with the previews as images. */
function jsonResult(call: ToolCall, result: Json, previews: Previews): { receipt: ToolReceipt; images: ToolImage[] } {
  return { receipt: applied(call.tool, JSON.stringify(result), { data: result }, 0), images: previews.images };
}

export async function colorTool(call: ToolCall, body: () => Promise<ToolReceipt | { receipt: ToolReceipt; images: ToolImage[] } | string>) {
  try {
    return await body();
  } catch (error) {
    if (error instanceof ColorValueError) return failed(call.tool, `Error: ${error.message}`);
    if (error instanceof FrameRenderError) return failed(call.tool, `Error: ${error.message}`);
    throw error;
  }
}

/** The after-the-change evidence the desktop attaches to apply_color / apply_look. */
async function afterPreview(call: ToolCall, result: Json, firstId: string, warnings: string[], previews: Previews): Promise<Json> {
  const clip = call.doc.project.clips.find((c) => c.id === firstId);
  if (!call.host.frames || !clip) {
    result.after_preview_jpeg = "";
    result.nuke_risk = false;
    result.warnings = [...warnings, `after preview failed: ${call.host.frames ? `clip ${firstId} not found` : "this host does not render frames"}`];
    return {};
  }
  const after = await renderClipIsolated(call, clip, 1, true);
  const scopes = after.scopes;
  result.after_preview_jpeg = previews.field(after.preview);
  result.after_scopes = scopes;
  return scopes;
}

/** `_parse_color_patch_kwargs`: the tool's colour arguments → a merge patch. */
function parseColorPatchKwargs(kwargs: Json): Json {
  const patch: Json = {};
  const json = (value: unknown, message: string): unknown => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      throw new ColorValueError(message);
    }
  };
  const color = kwargs.color;
  if (color !== undefined && color !== null && color !== "") {
    const parsed = json(color, "color must be a JSON object");
    if (!isRecord(parsed)) throw new ColorValueError("color must be an object");
    patch.color = parsed;
  }
  for (const key of [...SCALAR_KEYS, ...Object.keys(SCALAR_ALIASES), ...Object.keys(DELTA_KEYS)]) {
    if (key in kwargs && kwargs[key] !== null && kwargs[key] !== undefined && kwargs[key] !== "") patch[key] = kwargs[key];
  }
  if (kwargs.lut_path !== undefined && kwargs.lut_path !== null && kwargs.lut_path !== "") patch.lut_path = kwargs.lut_path;
  if (kwargs.lut !== undefined && kwargs.lut !== null && kwargs.lut !== "") patch.lut = json(kwargs.lut, "lut must be a JSON object");
  if (kwargs.wheels !== undefined && kwargs.wheels !== null && kwargs.wheels !== "") patch.wheels = json(kwargs.wheels, "wheels must be a JSON object");
  for (const key of [...CURVE_KEYS, ...Object.keys(CURVE_ALIASES)]) {
    if (key in kwargs && kwargs[key] !== null && kwargs[key] !== undefined && kwargs[key] !== "") patch[key] = json(kwargs[key], `${key} must be JSON points`);
  }
  return patch;
}

// ---------------------------------------------------------------------------
// match_color_to_reference: one grading pass over the subjects
// ---------------------------------------------------------------------------

interface BatchState {
  /** Working effects per subject (the project is changed once, at the end). */
  effects: Map<string, Effect[]>;
  create: (cn: string) => Json;
  refClipId: string;
  refEffect: Effect | null;
  refGrain: Effect | null;
  pasteColor: Json | null;
}

/** `_apply_effects_batch`: one grading pass over every subject (first pass: each subject's own grade/grain decision). */
function applyEffectsBatch(state: BatchState, colorMode: string, patch: Json, grainAction: Json, firstPass: boolean): void {
  for (const [cid, current] of state.effects) {
    let effects = [...current];
    let mode = colorMode;
    let paste = state.pasteColor;
    let grain = grainAction;
    if (firstPass && state.refClipId) {
      const gAct = matchGradeAction(findColorGrade(effects), state.refEffect);
      grain = matchGrainAction(findFilmGrain(effects), state.refGrain);
      if (gAct.mode === "reset") {
        mode = "reset";
        paste = null;
      } else if (gAct.mode === "paste") {
        mode = "paste";
        paste = gAct.color as Json;
      } else if (colorMode === "patch") {
        mode = "patch";
      } else {
        mode = "noop";
      }
    }
    if (mode === "reset") {
      effects = effects.filter((e) => !isColorGradeEffect(e));
    } else if (mode === "paste" && paste) {
      effects = mergedGradeEffects(effects, { color: paste }, state.create).effects;
    } else if (mode === "patch" && Object.keys(patch).length > 0) {
      const existing = (findColorGrade(effects) as Json | null) ?? null;
      const kwargs: Json = {};
      for (const [k, v] of Object.entries(patch)) {
        if (!SCALAR_KEYS.includes(k)) continue;
        const dkey = `${k}_delta`;
        if (dkey in DELTA_KEYS) kwargs[dkey] = v;
        else kwargs[k] = (scalarY(existing ?? {}, k) ?? SCALAR_DEFAULTS[k] ?? 0) + Number(v);
      }
      effects = mergedGradeEffects(effects, kwargs, state.create).effects;
    }
    if (firstPass && grain.mode === "reset") {
      effects = effects.filter((e) => !isFilmGrainEffect(e));
    } else if (firstPass && grain.mode === "paste") {
      const pasted: Json = isRecord(grain.grain) ? structuredClone(grain.grain) : {};
      pasted.class_name = "FilmGrain";
      const idxs = effects.flatMap((e, i) => (isFilmGrainEffect(e) ? [i] : []));
      if (idxs.length > 0) {
        const first = effects[idxs[0]!] as Json;
        if (first.id) pasted.id = first.id;
        else if (!pasted.id) pasted.id = state.create("FilmGrain").id;
        effects = effects.filter((_, i) => !idxs.slice(1).includes(i));
        effects[idxs[0]!] = pasted as Effect;
      } else {
        if (!pasted.id) pasted.id = state.create("FilmGrain").id;
        effects = [...effects, pasted as Effect];
      }
    }
    state.effects.set(cid, effects);
  }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const EDIT = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

export const colorAgentTools: CatalogTool[] = [
  contractTool("apply_color_tool", {
    annotations: EDIT,
    run: (call, input) =>
      colorTool(call, async () => {
        const project = call.doc.project;
        const allFlag = toolFlag([input.allClips, input.all_clips]);
        const ids = resolveColorTargetIds(call, { clip_ids: input.clip_ids, clipIds: input.clipIds, timeline_clip_id: input.timeline_clip_id, clipId: input.clipId, all_clips: allFlag });
        if (ids.length === 0) return colorTargetError(project, "apply_color");
        const resetFlag = ["1", "true", "yes", "on"].includes(text(input.reset).toLowerCase());
        const kwargs: Json = {};
        for (const [key, value] of Object.entries(input)) {
          if (!["clipIds", "clip_ids", "timeline_clip_id", "clipId", "all_clips", "allClips", "reset"].includes(key) && value !== null && value !== "") {
            kwargs[key] = value;
          }
        }
        let patch: Json = {};
        if (!resetFlag) {
          patch = parseColorPatchKwargs(kwargs);
          if (Object.keys(patch).length === 0) {
            return "Error: apply_color needs reset=true or at least one colour field (exposure, wheels, lut, color, …).";
          }
          validateColorPatch(patch);
          if (patch.lut_path) patch.lut_path = await resolveLutFile(call, patch.lut_path);
          if (isRecord(patch.lut) && patch.lut.path) patch.lut = { ...patch.lut, path: await resolveLutFile(call, patch.lut.path) };
        }
        const warnings: string[] = [];
        const kept = filterUnlocked(project, ids, warnings);
        if (kept.length === 0) return warnings.length > 0 ? `Error: ${warnings.join("; ")}` : colorTargetError(project, "apply_color");
        const create = effectFactory(project);
        const receipts: Json[] = [];
        const writes: [string, Effect[]][] = [];
        for (const cid of kept) {
          const clip = project.clips.find((c) => c.id === cid)!;
          const effects = [...(clip.effects ?? [])];
          if (resetFlag) {
            const next = effects.filter((e) => !isColorGradeEffect(e));
            if (next.length === effects.length) {
              receipts.push({ timeline_clip_id: cid, status: "noop", color: { present: false } });
              continue;
            }
            writes.push([cid, next]);
            receipts.push({ timeline_clip_id: cid, status: "reset", color: { present: false } });
            continue;
          }
          const { effects: next, merged } = mergedGradeEffects(effects, patch, create);
          writes.push([cid, next]);
          receipts.push({ timeline_clip_id: cid, status: "applied", effect_id: merged.id ?? null, color: summarizeColorGrade(merged) });
        }
        if (writes.length > 0) {
          call.commit((tx) => {
            for (const [cid, effects] of writes) setClipEffects(tx, cid, effects);
          });
        }
        const result: Json = { ok: true, clips: receipts, warnings, undo: "one step" };
        const previews = new Previews();
        // Evidence for the vision loop: the first graded clip, alone, after the change.
        const scopes = await afterPreview(call, result, String(receipts[0]!.timeline_clip_id), warnings, previews);
        if (scopes.present !== undefined) {
          const outdoor = isOutdoorBrightProfile(scopes.present ? buildLookProfile(scopes) : {});
          const hi = Number(scopes.clipped_highlights ?? 0) || 0;
          result.nuke_risk = hi >= 0.12 || (outdoor && hi >= 0.08);
          result.outdoor_bright = outdoor;
        }
        return jsonResult(call, result, previews);
      }),
  }),

  contractTool("inspect_color_tool", {
    annotations: READ,
    requires: ["frames"],
    run: (call, input) =>
      colorTool(call, async () => {
        const project = call.doc.project;
        const ids = resolveColorTargetIds(call, { clipIds: text(input.clipId) || text(input.clip_id), timeline_clip_id: input.timeline_clip_id });
        if (ids.length === 0) return colorTargetError(project, "inspect_color");
        const cid = ids[0]!;
        const want = input.include_preview === undefined || input.include_preview === null || input.include_preview === "" ? "true" : text(input.include_preview);
        const wantJpeg = !["0", "false", "no", "off"].includes(want.toLowerCase());
        const rate = fps(project);
        const clip = project.clips.find((c) => c.id === cid);
        if (!clip) return `Error: clip ${cid} not found.`;
        const grade = summarizeColorGrade(findColorGrade(clip.effects));
        const grain = summarizeFilmGrain(findFilmGrain(clip.effects));
        const frameArg = input.atFrame !== undefined && input.atFrame !== null && input.atFrame !== "" ? input.atFrame : input.at_frame;
        let frameNumber: number;
        if (frameArg !== undefined && frameArg !== null && frameArg !== "") {
          const f = typeof frameArg === "number" ? frameArg : parsePythonFloat(String(frameArg));
          if (f === null || !Number.isFinite(f)) return "Error: atFrame must be an integer frame number.";
          frameNumber = Math.max(1, Math.trunc(f));
        } else {
          frameNumber = Math.trunc(Math.max(0, playheadSeconds(call)) * rate + 1e-9) + 1;
          const pos = Number(clip.position) || 0;
          const duration = Math.max(0, (Number(clip.end) || 0) - (Number(clip.start) || 0));
          const playheadSec = (frameNumber - 1) / Math.max(rate, 1e-6);
          if (playheadSec < pos || playheadSec > pos + duration) frameNumber = Math.max(1, Math.trunc(pos * rate) + 1);
        }
        const previews = new Previews();
        const rendered = await renderClipIsolated(call, clip, frameNumber, wantJpeg);
        const scopes = rendered.scopes;
        const result: Json = {
          ok: true,
          timeline_clip_id: cid,
          atFrame: frameNumber,
          color: grade,
          film_grain: grain,
          scopes,
          preview_jpeg: previews.field(rendered.preview),
        };
        const refId = text(input.reference) || text(input.referenceClipId);
        if (refId) {
          const ref = project.clips.find((c) => c.id === refId);
          if (!ref) {
            result.warnings = [`reference clip ${refId} not found`];
          } else {
            const rgrade = summarizeColorGrade(findColorGrade(ref.effects));
            const rgrain = summarizeFilmGrain(findFilmGrain(ref.effects));
            const pos = Number(ref.position) || 0;
            const duration = Math.max(0, (Number(ref.end) || 0) - (Number(ref.start) || 0));
            const refFrame = Math.max(1, Math.trunc((pos + duration * 0.5) * rate) + 1);
            const refRendered = await renderClipIsolated(call, ref, refFrame, wantJpeg);
            result.reference = { timeline_clip_id: refId, atFrame: refFrame, color: rgrade, film_grain: rgrain, scopes: refRendered.scopes };
            result.reference_preview_jpeg = previews.field(refRendered.preview);
            Object.assign(result, referenceGapHints(scopes, refRendered.scopes));
            result.grades_differ = gradesMeaningfullyDiffer(grade, rgrade);
            result.grain_differ = grainMeaningfullyDiffers(grain, rgrain);
          }
        }
        return jsonResult(call, result, previews);
      }),
  }),

  contractTool("list_looks_tool", {
    annotations: READ,
    run: (call, input) =>
      colorTool(call, async () => {
        const q = [text(input.query) ? String(input.query) : "", text(input.vibe) ? String(input.vibe) : ""].filter(Boolean).join(" ").trim();
        const catalog = listLooksCatalog(q);
        return { receipt: applied(call.tool, JSON.stringify(catalog), { data: catalog }, 0), images: [] };
      }),
  }),

  contractTool("apply_look_tool", {
    annotations: EDIT,
    run: (call, input) =>
      colorTool(call, async () => {
        const project = call.doc.project;
        const allFlag = toolFlag([input.allClips, input.all_clips]);
        const ids = resolveColorTargetIds(call, { clip_ids: input.clip_ids, clipIds: input.clipIds, timeline_clip_id: input.timeline_clip_id, clipId: input.clipId, all_clips: allFlag });
        if (ids.length === 0) return colorTargetError(project, "apply_look");
        const rawLook = text(input.lookId) || text(input.look_id);
        const rawLut = text(input.lutPath) || text(input.lut_path);
        if (!rawLook && !rawLut) return "Error: apply_look requires lookId or lutPath.";
        let resolved: ResolvedLook = rawLook ? resolveLookId(rawLook) : { kind: "lut", lut_path: rawLut, id: rawLut };
        if (rawLut && resolved.kind !== "lut") return "Error: pass either lookId or lutPath for a LUT, not both conflicting kinds.";
        if (rawLut) resolved = { kind: "lut", lut_path: rawLut, id: rawLut };
        const given = (v: unknown): boolean => v !== undefined && v !== null && v !== "";
        const intensityArg = given(input.lutIntensity) ? input.lutIntensity : input.lut_intensity;
        const grainArg = [input.stackGrain, input.stack_grain, input.grainPreset, input.grain_preset].find(given);
        const lutIntensity = given(intensityArg) ? toFloat(intensityArg, "lutIntensity") : null;
        const mix = given(input.mix) ? toFloat(input.mix, "mix") : null;
        let grainId: string | null = null;
        if (given(grainArg)) {
          const g = text(grainArg);
          if (["1", "true", "yes", "on"].includes(g.toLowerCase())) grainId = "35mm_classic";
          else {
            const grainLook = resolveLookId(g.startsWith("grain:") ? g : `grain:${g}`);
            grainId = grainLook.kind === "film_grain" ? grainLook.grain_id : null;
          }
        } else if (resolved.kind === "film_grain") {
          grainId = resolved.grain_id;
        }
        let absLut = resolved.kind === "lut" ? await resolveLutFile(call, resolved.lut_path) : "";
        let generatedHash: string | undefined;
        if (resolved.kind === "generated") {
          if (!call.host.media?.writeGenerated) return `Error: look '${resolved.id}' is a generated LUT, and this Zenvi surface cannot store generated files.`;
          const { stem, cube } = resolved.look.make();
          const asset = await writeAsset(call, stem, "cube", cube, "text/plain");
          absLut = asset.path;
          generatedHash = asset.hash;
        }
        const warnings: string[] = [];
        const kept = filterUnlocked(project, ids, warnings);
        if (kept.length === 0) return warnings.length > 0 ? `Error: ${warnings.join("; ")}` : colorTargetError(project, "apply_look");
        const create = effectFactory(project);
        const receipts: Json[] = [];
        const writes: [string, Effect[]][] = [];
        for (const cid of kept) {
          const clip = project.clips.find((c) => c.id === cid)!;
          let effects = [...(clip.effects ?? [])];
          const receipt: Json = { timeline_clip_id: cid, look: resolved.id };
          if (resolved.kind === "color_preset") {
            if (resolved.preset_name === "reset") {
              const next = effects.filter((e) => !isColorGradeEffect(e));
              if (next.length === effects.length && !grainId) {
                receipt.status = "noop";
                receipts.push(receipt);
                continue;
              }
              effects = next;
              receipt.status = "reset";
            } else {
              const existing = findColorGrade(effects) as Json | null;
              const base = create("ColorGrade");
              if (existing?.id) base.id = existing.id;
              if (existing && "order" in existing) base.order = existing.order;
              const graded = applySoftColorPreset(base, resolved.preset_name);
              if (mix !== null) setScalar(graded, "mix", mix);
              effects = replaceFirstGrade(effects, graded);
              receipt.status = "preset";
              receipt.color = summarizeColorGrade(graded);
            }
          } else if (resolved.kind === "lut" || resolved.kind === "generated") {
            // ColorGrade applies its LUT after the mix, so for a LUT look mix means the LUT's strength.
            const strength = lutIntensity ?? mix ?? (resolved.kind === "generated" ? resolved.look.intensity : null);
            const lut: Json = { path: absLut };
            if (strength !== null) lut.strength = strength;
            const { effects: next, merged } = mergedGradeEffects(effects, { lut }, create);
            // Marks the file as this look's, so the next clip graded with it reuses the file.
            if (generatedHash) (merged as Json)[ASSET_KEY] = generatedHash;
            effects = next;
            receipt.status = "lut";
            receipt.lut_path = merged.lut_path ?? null;
            receipt.color = summarizeColorGrade(merged);
          }
          const gid = grainId ?? (resolved.kind === "film_grain" ? resolved.grain_id : null);
          if (gid) {
            const idxs = effects.flatMap((e, i) => (isFilmGrainEffect(e) ? [i] : []));
            if (gid === "none") {
              receipt.grain = "none";
              if (idxs.length > 0) effects = effects.filter((e) => !isFilmGrainEffect(e));
              else if (receipt.status === undefined) {
                receipt.status = "noop";
                receipts.push(receipt);
                continue;
              }
            } else {
              const source = idxs.length > 0 ? (effects[idxs[0]!] as Json) : create("FilmGrain");
              const grainEffect = applyFilmGrainPreset(source, gid as Exclude<FilmGrainPreset, "none">);
              if (idxs.length > 0) {
                if (source.id) grainEffect.id = source.id;
                effects = effects.filter((_, i) => !idxs.slice(1).includes(i));
                effects[idxs[0]!] = grainEffect as Effect;
              } else {
                effects = [...effects, grainEffect as Effect];
              }
              receipt.grain = gid;
            }
            if (resolved.kind === "film_grain") receipt.status = receipt.status ?? "grain";
          }
          if (receipt.status === undefined && !gid) {
            receipt.status = "noop";
            receipts.push(receipt);
            continue;
          }
          writes.push([cid, effects]);
          receipts.push(receipt);
        }
        if (writes.length > 0) {
          call.commit((tx) => {
            for (const [cid, effects] of writes) setClipEffects(tx, cid, effects);
          });
        }
        const result: Json = { ok: true, clips: receipts, warnings, undo: "one step" };
        const previews = new Previews();
        const scopes = await afterPreview(call, result, String(receipts[0]!.timeline_clip_id), warnings, previews);
        if (scopes.present !== undefined) {
          const hi = Number(scopes.clipped_highlights ?? 0) || 0;
          result.nuke_risk = hi >= 0.12;
          const lookUsed = String(receipts[0]!.look ?? "");
          const goal = targetProfileForLook(lookUsed);
          if (goal && scopes.present) {
            result.look_distance_to_vibe = lookProfileDistance(buildLookProfile(scopes), goal);
            result.vibe_goal = lookUsed;
          }
        }
        return jsonResult(call, result, previews);
      }),
  }),

  contractTool("match_color_to_reference_tool", {
    annotations: EDIT,
    requires: ["frames"],
    run: (call, input) =>
      colorTool(call, async () => {
        const project = call.doc.project;
        const allFlag = toolFlag([input.allClips, input.all_clips]);
        let ids = resolveColorTargetIds(call, {
          clip_ids: text(input.clip_ids) || text(input.clip_id) || text(input.clipId),
          clipIds: text(input.clipIds) || text(input.clipId) || text(input.clip_id),
          timeline_clip_id: input.timeline_clip_id,
          clipId: text(input.clipId) || text(input.clip_id),
          all_clips: allFlag,
        });
        if (ids.length === 0) return colorTargetError(project, "match_color_to_reference");
        const refClipId = text(input.reference) || text(input.referenceClipId);
        const refFileId = text(input.referenceFileId);
        const refImagePath = text(input.referenceImagePath);
        if (!refClipId && !refFileId && !refImagePath) {
          return "Error: match_color_to_reference requires referenceClipId, referenceFileId, or referenceImagePath.";
        }
        if (refClipId && ids.includes(refClipId)) {
          if (ids.length === 1) return "Error: subject and reference are the same clip.";
          ids = ids.filter((cid) => cid !== refClipId);
        }
        if (ids.length === 0) return colorTargetError(project, "match_color_to_reference");
        const dry = toolFlag([input.dryRun, input.dry_run]);
        const maxIters = Math.max(1, Math.min(5, pyIntOr(input.max_iterations, 5)));
        const warnings: string[] = [];
        ids = filterUnlocked(project, ids, warnings);
        if (ids.length === 0) return warnings.length > 0 ? `Error: ${warnings.join("; ")}` : colorTargetError(project, "match_color_to_reference");

        // Reference LookProfile (dense).
        const refKind = refClipId ? "clip" : refFileId ? "file" : "path";
        let refEffect: Effect | null = null;
        let refGrain: Effect | null = null;
        let refPack: ProfilePack;
        if (refClipId) {
          const ref = project.clips.find((c) => c.id === refClipId);
          if (!ref) return `Error: reference clip ${refClipId} not found.`;
          refPack = await profileClipDense(call, ref);
          refEffect = findColorGrade(ref.effects);
          refGrain = findFilmGrain(ref.effects);
        } else if (refFileId) {
          const file = project.files.find((f) => String(f.id) === refFileId);
          if (!file) return `Error: media-bin file ${refFileId} not found.`;
          refPack = await profileMediaFile(call, file);
        } else {
          // Local files are readable where the host imports local paths (the CLI).
          if (!call.host.media?.importPath) {
            return "Error: match_color_to_reference_tool is not available in this Zenvi surface: referenceImagePath needs local file access (Zenvi desktop or the zenvi CLI); import the reference and pass referenceFileId.";
          }
          refPack = await profileLocalPath(call, refImagePath);
        }
        const refProfile = refPack.profile;
        if (!refProfile.present) {
          // The desktop answers this with a JSON object (ok: false), not an "Error:" line.
          const out: Json = { ok: false, error: "Could not measure reference look", reference_kind: refKind, detail: refProfile.error || "no scopes" };
          return jsonResult(call, out, new Previews());
        }

        // Subject profile (the first subject, dense).
        const subjects = new Map<string, Clip>();
        for (const cid of ids) {
          const clip = project.clips.find((c) => c.id === cid);
          if (clip) subjects.set(cid, clip);
        }
        if (subjects.size === 0) return "Error: no matching timeline clips.";
        const primaryId = subjects.has(ids[0]!) ? ids[0]! : [...subjects.keys()][0]!;
        const primary = subjects.get(primaryId)!;
        const beforePack = await profileClipDense(call, primary);
        let beforeProfile = beforePack.profile;
        const outdoor = isOutdoorBrightProfile(beforeProfile);
        const lookDistanceBefore = lookProfileDistance(beforeProfile, refProfile);
        const gradeAction = refClipId ? matchGradeAction(findColorGrade(primary.effects), refEffect) : { mode: "scopes" };
        const grainAction = refClipId ? matchGrainAction(findFilmGrain(primary.effects), refGrain) : { mode: "noop" };
        const solved = solveGradeFromProfiles(beforeProfile, refProfile, 1.0);
        let initial: Json;
        let matchMode: string;
        if (gradeAction.mode === "paste" || gradeAction.mode === "reset") {
          initial = gradeAction;
          matchMode = String(gradeAction.mode);
        } else if (Object.keys(solved).length > 0) {
          initial = { mode: "scopes", patch: solved };
          matchMode = "look_profile";
        } else {
          initial = { mode: "noop" };
          matchMode = "vision";
        }
        const previews = new Previews();
        const result: Json = {
          ok: true,
          timeline_clip_ids: [...subjects.keys()],
          clips_graded: [...subjects.keys()],
          reference_kind: refKind,
          reference: refClipId || refFileId || refImagePath,
          look_distance_before: lookDistanceBefore,
          match_mode: matchMode,
          grain_mode: grainAction.mode,
          samples_used: { subject: beforePack.scopes_samples, reference: refPack.scopes_samples },
          before_profile: beforeProfile,
          reference_profile: refProfile,
          before_preview_jpeg: previews.field(beforePack.preview),
          reference_preview_jpeg: previews.field(refPack.preview),
          outdoor_bright: outdoor,
          vision: "Compare BEFORE vs REFERENCE vs AFTER. Match iterates until look_distance is close or max steps; nuke_risk means recovery ran.",
        };
        if (initial.mode === "noop" && grainAction.mode === "noop" && (lookDistanceBefore === null || lookDistanceBefore < LOOK_DISTANCE_MATCHED)) {
          result.applied = false;
          result.status = "matched";
          result.message = "Already close to reference look.";
          return jsonResult(call, result, previews);
        }
        if (dry) {
          result.applied = false;
          result.proposed_patch = (initial.patch as Json | undefined) ?? (initial.mode === "paste" ? { color: "paste_from_reference" } : {});
          result.proposed_grain = grainAction.mode;
          return jsonResult(call, result, previews);
        }

        // Grade on a working copy; the project changes once, at the end (one undo step).
        const state: BatchState = {
          effects: new Map([...subjects].map(([cid, clip]) => [cid, [...(clip.effects ?? [])]])),
          create: effectFactory(project),
          refClipId,
          refEffect,
          refGrain,
          pasteColor: initial.mode === "paste" ? (initial.color as Json) : null,
        };
        let doReset = initial.mode === "reset";
        let currentPatch: Json = isRecord(initial.patch) ? { ...initial.patch } : {};
        const iterations: Json[] = [];
        let recovered = false;
        let finalStatus = "still_far";
        let afterProfile = beforeProfile;
        let afterPreviewImage: ToolImage | null = null;
        for (let it = 0; it < maxIters; it += 1) {
          const colorMode = doReset && it === 0 ? "reset" : state.pasteColor && it === 0 ? "paste" : "patch";
          const patch = colorMode === "reset" || colorMode === "paste" ? {} : currentPatch;
          if (it === 0 && colorMode === "patch" && Object.keys(patch).length === 0 && !state.pasteColor && !doReset && grainAction.mode === "noop") {
            finalStatus = "still_far";
            break;
          }
          applyEffectsBatch(state, colorMode, patch, grainAction, it === 0);
          const afterPack = await profileClipDense(call, { ...primary, effects: state.effects.get(primaryId)! }, Math.min(24, beforePack.scopes_samples || 16));
          afterProfile = afterPack.profile;
          afterPreviewImage = afterPack.preview;
          const outcome = assessGradeOutcome(beforeProfile, afterProfile, refProfile, outdoor);
          iterations.push({
            iteration: it + 1,
            status: outcome.status,
            look_distance: outcome.look_distance_after,
            nuke_risk: outcome.nuke_risk,
            reasons: outcome.reasons ?? [],
          });
          if (outcome.ok) {
            finalStatus = "matched";
            break;
          }
          if (outcome.nuke_risk) {
            recovered = true;
            currentPatch = isRecord(outcome.suggested_recovery_patch) ? outcome.suggested_recovery_patch : {};
            state.pasteColor = null;
            doReset = false;
            finalStatus = "recovered_from_nuke";
            if (Object.keys(currentPatch).length === 0) break;
            continue;
          }
          // Still far or closer: a smaller solve step.
          currentPatch = solveGradeFromProfiles(afterProfile, refProfile, Math.max(0.25, 0.7 ** (it + 1)));
          state.pasteColor = null;
          doReset = false;
          finalStatus = String(outcome.status || "closer_not_exact");
          if (Object.keys(currentPatch).length === 0) break;
          beforeProfile = afterProfile;
        }
        const writes = [...state.effects].filter(([cid, effects]) => JSON.stringify(effects) !== JSON.stringify(subjects.get(cid)!.effects ?? []));
        // The renders take a while: write nothing over an edit that landed meanwhile.
        for (const [cid] of writes) {
          const stale = editedWhileRendering(call, subjects.get(cid)!, ["effects"]);
          if (stale) return `Error: ${stale}`;
        }
        if (writes.length > 0) {
          call.commit((tx) => {
            for (const [cid, effects] of writes) setClipEffects(tx, cid, effects);
          });
        }
        result.applied = true;
        result.undo = "one step";
        result.iterations = iterations;
        result.iteration_count = iterations.length;
        result.status = finalStatus;
        result.recovered_from_nuke = recovered;
        result.after_profile = afterProfile;
        result.after_preview_jpeg = previews.field(afterPreviewImage);
        result.look_distance_after = lookProfileDistance(afterProfile, refProfile);
        result.nuke_risk = iterations.some((i) => i.nuke_risk) && finalStatus !== "matched";
        if (finalStatus === "matched") {
          result.message = `Matched look on ${subjects.size} clip(s) in ${iterations.length} iteration(s).`;
        } else if (recovered) {
          result.message = "Look was nuking highlights/shadows; recovered with a softer grade. Inspect AFTER vs REFERENCE — nudge if still off.";
        } else {
          result.message = `Closer but not exact (status=${finalStatus}). Look at AFTER vs REFERENCE and nudge, or re-run match.`;
        }
        return jsonResult(call, result, previews);
      }),
  }),
];

