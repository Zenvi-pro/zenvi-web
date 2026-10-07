/**
 * Vision tools: inspect_timeline_tool, inspect_media_tool. They return
 * JPEG frames as MCP image content (`ToolResult.images`).
 *
 * Ports of zenvi-core (ref b63c39be7) src/classes/agent_tools/inspect.py,
 * inspect_render.py (frame selection, 512 px longest edge),
 * inspect_overlay.py (0-1 grid + caption, requested from the host through
 * `FrameOverlay`) and visible_clips.py.
 *
 * Difference: the desktop's overview mode composes one storyboard sheet
 * (up to 36 tiles, dHash-deduplicated). The engine cannot compose images, so
 * overview returns up to 12 spread-out frames at a smaller size instead.
 */

import type { Project } from "../../model/types.js";
import { contractTool, type CatalogTool, type ToolCall } from "../define.js";
import { projectFps, toFrame, toSeconds, type Fps } from "../frame-time.js";
import { fitSize, renderMediaFrames } from "../media-frames.js";
import { applied, failed, refused } from "../receipt.js";
import type { ToolImage } from "../types.js";
import { fileById, record, text } from "./common.js";
import { fileLooksLikeImage } from "../placement.js";

export const COORDINATE_GRID_NOTE = "0-1, origin top-left";
const DEFAULT_FRAMES = 6;
const MAX_FRAMES = 12;
const OVERVIEW_FRAMES = 12;
const LONGEST_EDGE = 512;
const OVERVIEW_EDGE = 320;
/** agent_tools/output.py MAX_IMAGE_BYTES. */
export const MAX_IMAGE_BYTES = Math.trunc(2.5 * 1024 * 1024);

function clampMaxFrames(raw: unknown): [number, string[]] {
  const warnings: string[] = [];
  let n = raw === undefined || raw === null ? DEFAULT_FRAMES : Math.trunc(Number(raw));
  if (!Number.isFinite(n)) n = DEFAULT_FRAMES;
  if (n < 1) n = 1;
  if (n > MAX_FRAMES) {
    warnings.push(`maxFrames clamped from ${n} to ${MAX_FRAMES}`);
    n = MAX_FRAMES;
  }
  return [n, warnings];
}

/** Evenly spaced mid-bin frames of [start, end) (visible_clips.mid_bin_frames). */
export function midBinFrames(start: number, end: number, count: number): number[] {
  const span = Math.trunc(end) - Math.trunc(start);
  if (span <= 0) return [];
  const n = Math.max(1, Math.min(Math.trunc(count), span));
  return Array.from({ length: n }, (_, i) => Math.trunc(start) + Math.trunc((span * (i + 0.5)) / n));
}

/** Evenly spaced mid-bin times of [start, end) (visible_clips.mid_bin_seconds). */
export function midBinSeconds(start: number, end: number, count: number): number[] {
  const span = end - start;
  if (span <= 0) return [];
  const n = Math.max(1, Math.trunc(count));
  return Array.from({ length: n }, (_, i) => start + (span * (i + 0.5)) / n);
}

/** mm:ss.cc (inspect_overlay.format_timecode). */
export function formatTimecode(seconds: number): string {
  let whole = Math.trunc(Math.max(0, seconds));
  let cent = Math.round((Math.max(0, seconds) - whole) * 100);
  if (cent >= 100) {
    whole += 1;
    cent = 0;
  }
  const mm = Math.floor(whole / 60);
  const ss = whole % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(cent).padStart(2, "0")}`;
}

/** Project length in 0-index frames (inspect_render.total_frames_0). */
export function totalFrames(project: Project, fps: Fps): number {
  const duration = Number(project.duration);
  if (project.duration !== undefined && project.duration !== null && Number.isFinite(duration)) return Math.max(0, toFrame(duration, fps));
  let end = 0;
  for (const c of project.clips ?? []) end = Math.max(end, (Number(c.position) || 0) + Math.max(0, (Number(c.end) || 0) - (Number(c.start) || 0)));
  return Math.max(0, toFrame(end, fps));
}

/**
 * Clips visible at a time, top track first (visible_clips.visible_clips_at).
 * The desktop also treats a track whose `y` is 0 as hidden, but `y` is a UI
 * coordinate that is 0 on every default track, so its lists always came back
 * empty; only an explicit `hidden` flag hides a track here.
 */
export function visibleClipsAt(project: Project, seconds: number, fps: Fps): Record<string, unknown>[] {
  const hidden = new Set(
    (project.layers ?? []).filter((l) => Boolean((l as { hidden?: unknown }).hidden)).map((l) => Math.trunc(Number(l.number))),
  );
  const out: [number, Record<string, unknown>][] = [];
  for (const clip of project.clips ?? []) {
    const layer = Math.trunc(Number(clip.layer ?? 0)) || 0;
    if (hidden.has(layer)) continue;
    const reader = record(clip.reader);
    if (reader.has_video === false || (clip as { id_type?: unknown }).id_type === "audio") continue;
    const position = Number(clip.position) || 0;
    const start = Number(clip.start) || 0;
    const end = clip.end === undefined || clip.end === null ? start : Number(clip.end);
    const duration = end - start;
    if (duration < 0 || !(position <= seconds && seconds < position + Math.max(duration, 1e-9))) continue;
    const entry: Record<string, unknown> = { id: String(clip.id ?? ""), track: layer, position, start, end, landedFrame: toFrame(position, fps) };
    const names = (clip.effects ?? []).map((e) => e.class_name || e.type || e.name).filter(Boolean).map(String);
    if (names.length > 0) entry.effects = names;
    out.push([layer, entry]);
  }
  return out.sort((a, b) => b[0] - a[0]).map(([, e]) => e);
}

function base64Bytes(image: ToolImage): number {
  const len = image.data.length;
  return Math.floor((len * 3) / 4) - (image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0);
}

/** Keep images until the byte budget is spent (output.trim_to_budget). */
export function trimToBudget(images: readonly ToolImage[], limit = MAX_IMAGE_BYTES): [ToolImage[], string[]] {
  const kept: ToolImage[] = [];
  const warnings: string[] = [];
  let total = 0;
  for (const [i, image] of images.entries()) {
    const size = base64Bytes(image);
    if (total + size > limit) {
      warnings.push(`Stopped early at image ${i}/${images.length} to stay under ${limit} byte budget.`);
      break;
    }
    kept.push(image);
    total += size;
  }
  return [kept, warnings];
}

async function renderTimelineFrames(call: ToolCall, project: Project, frames: readonly number[], longestEdge: number) {
  const fps = projectFps(project);
  const [width] = fitSize(project.width || 1920, project.height || 1080, longestEdge);
  const rendered: { frame: number; seconds: number; image: ToolImage; clips: Record<string, unknown>[] }[] = [];
  for (const frame of frames) {
    if (call.signal?.aborted) break;
    const seconds = toSeconds(frame, fps);
    try {
      const image = await call.host.frames!.renderFrame(project, seconds, {
        width,
        format: "jpeg",
        overlay: { grid: true, caption: `f${frame}  ${formatTimecode(seconds)}` },
      });
      rendered.push({ frame, seconds, image, clips: visibleClipsAt(project, seconds, fps) });
    } catch (error) {
      call.host.log?.(`inspect frame ${frame} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return rendered;
}

export const inspectTools: CatalogTool[] = [
  contractTool("inspect_timeline_tool", {
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    requires: ["frames"],
    run: async (call, input) => {
      const tool = "inspect_timeline_tool";
      const project = call.doc.toJSON();
      const fps = projectFps(project);
      const total = totalFrames(project, fps);
      const warnings: string[] = [];
      const overview = Boolean(input.overview);
      let startFrame = input.startFrame;
      let endFrame = input.endFrame;
      const clipId = text(input.clipId);
      if (clipId && (input.start !== undefined || input.end !== undefined)) {
        const clip = (project.clips ?? []).find((c) => String(c.id) === clipId);
        if (!clip) return refused(tool, `Error: Unknown clipId '${clipId}'.`);
        const position = Number(clip.position) || 0;
        const t0 = input.start ?? position;
        const t1 = input.end ?? position + Math.max(0, (Number(clip.end) || 0) - (Number(clip.start) || 0));
        if (!Number.isFinite(t0) || !Number.isFinite(t1)) return refused(tool, "Error: Invalid start/end for watchSuggested window.");
        if (t1 <= t0) return refused(tool, "Error: end must be greater than start.");
        startFrame = toFrame(t0, fps);
        endFrame = toFrame(t1, fps);
        if (endFrame <= startFrame) endFrame = startFrame + 1;
      }
      if (startFrame === undefined && !overview) {
        return refused(tool, "Error: Provide startFrame, or clipId+start+end, or overview=true.");
      }
      if (total <= 0 && (project.clips ?? []).length === 0) return refused(tool, "Error: Timeline is empty — nothing to render.");
      const [maxN, clampWarnings] = clampMaxFrames(input.maxFrames);
      warnings.push(...clampWarnings);

      let frames: number[];
      if (overview) {
        let sf: number;
        let ef: number;
        if (startFrame !== undefined && endFrame !== undefined) [sf, ef] = [startFrame, endFrame];
        else if (startFrame !== undefined) [sf, ef] = [startFrame, Math.max(startFrame + 1, total)];
        else [sf, ef] = [0, Math.max(1, total)];
        if (ef <= sf) return refused(tool, "Error: endFrame must be greater than startFrame.");
        frames = midBinFrames(sf, ef, Math.min(OVERVIEW_FRAMES, Math.max(6, ef - sf)));
        warnings.push("Overview returns spread-out frames here, not a single storyboard sheet.");
      } else if (endFrame === undefined || endFrame === 0) {
        const sf = startFrame!;
        if (sf < 0 || (total > 0 && sf >= total)) return refused(tool, `Error: startFrame ${sf} out of range [0, ${total}).`);
        frames = [sf];
      } else {
        const [sf, ef] = [startFrame!, endFrame];
        if (ef <= sf) return refused(tool, "Error: endFrame must be greater than startFrame.");
        frames = midBinFrames(sf, ef, maxN);
      }

      const rendered = await renderTimelineFrames(call, project, frames, overview ? OVERVIEW_EDGE : LONGEST_EDGE);
      if (rendered.length === 0) return failed(tool, "Error: Failed to render timeline frames.");
      const [images, budgetWarnings] = trimToBudget(rendered.map((r) => r.image));
      warnings.push(...budgetWarnings);
      if (images.length === 0) return failed(tool, "Error: inspect image budget exceeded before first frame.");
      const shown = rendered.slice(0, images.length);
      const [w, h] = fitSize(project.width || 1920, project.height || 1080, overview ? OVERVIEW_EDGE : LONGEST_EDGE);
      const data: Record<string, unknown> = {
        coordinateGrid: COORDINATE_GRID_NOTE,
        width: w,
        height: h,
        fps: fps.num / fps.den,
        totalFrames: total,
        mode: overview ? "overview" : "frames",
        requestedFrames: frames,
        renderedFrames: shown.map((r) => r.frame),
        frames: shown.map((r) => ({ frame: r.frame, seconds: r.seconds, clips: r.clips })),
      };
      if (overview) data.overview = { tileTimestamps: shown.map((r) => r.seconds) };
      return { receipt: applied(tool, `Rendered ${images.length} inspect image(s).`, { warnings, data }, 0), images };
    },
  }),

  contractTool("inspect_media_tool", {
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    requires: ["frames"],
    run: async (call, input) => {
      const tool = "inspect_media_tool";
      const project = call.doc.project;
      const fileId = text(input.fileId);
      if (!fileId) return refused(tool, "Error: fileId is required.");
      const file = fileById(project, fileId);
      if (!file) return refused(tool, `Error: Unknown fileId '${fileId}'.`);
      const path = String(file.path ?? "");
      if (!path) return refused(tool, `Error: Media file not on disk: ${fileId}`);
      const mediaType = String(file.media_type ?? "").toLowerCase();
      const isImage = mediaType === "image" || mediaType === "photo" || fileLooksLikeImage(file);
      const isAudio = (file.has_video === false && Boolean(file.has_audio)) || mediaType === "audio";
      const warnings: string[] = [];
      const [maxN, clampWarnings] = clampMaxFrames(input.maxFrames);
      warnings.push(...clampWarnings);
      const duration = Number(file.duration) || 0;
      const overview = Boolean(input.overview);
      const data: Record<string, unknown> = { fileId, coordinateGrid: COORDINATE_GRID_NOTE, mode: overview ? "overview" : "frames" };
      if (duration) data.duration = duration;
      if (isAudio && !isImage) {
        Object.assign(data, { channels: file.channels, sample_rate: file.sample_rate, hasAudio: true, hasVideo: false });
        return applied(tool, "Audio file — metadata only (no frames).", { data }, 0);
      }
      let t0 = input.start ?? 0;
      let t1 = input.end ?? (duration > 0 ? duration : 0);
      let timestamps: number[];
      if (isImage) timestamps = [0];
      else {
        if (t1 <= t0) {
          if (duration > 0) [t0, t1] = [0, duration];
          else return refused(tool, "Error: Invalid time range.");
        }
        timestamps = overview ? midBinSeconds(t0, t1, OVERVIEW_FRAMES) : midBinSeconds(t0, t1, maxN);
        if (overview) warnings.push("Overview returns spread-out frames here, not a single storyboard sheet.");
      }
      const frames = await renderMediaFrames(call, file, timestamps, {
        longestEdge: overview ? OVERVIEW_EDGE : LONGEST_EDGE,
        overlay: overview ? undefined : (t) => ({ grid: true, caption: formatTimecode(t) }),
      });
      if (frames.length === 0) return failed(tool, "Error: Failed to extract frames.");
      const [images, budgetWarnings] = trimToBudget(frames.map((f) => f.image));
      warnings.push(...budgetWarnings);
      const [w, h] = fitSize(Number(file.width) || project.width, Number(file.height) || project.height, overview ? OVERVIEW_EDGE : LONGEST_EDGE);
      data.frameTimestamps = frames.slice(0, images.length).map((f) => f.timestamp);
      data.width = w;
      data.height = h;
      if (overview) {
        data.overview = { tileTimestamps: data.frameTimestamps };
        delete data.frameTimestamps;
      }
      const clipId = text(input.clipId);
      if (clipId) {
        const clip = (project.clips ?? []).find((c) => String(c.id) === clipId);
        if (clip && (!clip.file_id || String(clip.file_id) === fileId)) {
          const fps = projectFps(project);
          const position = Number(clip.position) || 0;
          const dur = Math.max(0, (Number(clip.end) || 0) - (Number(clip.start) || 0));
          data.timelineMapping = {
            clipId,
            startFrame: toFrame(position, fps),
            endFrame: toFrame(position + dur, fps),
            fps: fps.num / fps.den,
            note: "times are project frames (0-index)",
          };
        }
      }
      return { receipt: applied(tool, `Rendered ${images.length} inspect image(s).`, { warnings, data }, 0), images };
    },
  }),
];
