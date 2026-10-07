/**
 * Frames of one media-bin file, rendered through `host.frames`.
 *
 * FrameHost renders timeline frames of a Project, so a file is shown through
 * a scratch project the size of the file with one clip playing it from
 * source time 0 at timeline time 0: timeline second t is source second t.
 * Used by inspect_media_tool and the watch-window confirm (the desktop reads
 * the file directly with FFmpegReader / ffmpeg, agent_tools/inspect_render.py
 * `render_media_frames`, classes/watch_window.py `_extract_one_jpeg`).
 */

import { ProjectDocument } from "../history/document.js";
import { pyRound } from "../model/rounding.js";
import type { Project, ProjectFile } from "../model/types.js";
import { addClip } from "../ops/clips.js";
import type { ToolCall } from "./define.js";
import type { FrameOverlay, ToolImage } from "./types.js";

const SCRATCH_LAYER = 1_000_000;

/** agent_tools/inspect_overlay.py `fit_size`: shrink so the longest edge is at most `longestEdge`. */
export function fitSize(width: number, height: number, longestEdge = 512): [number, number] {
  const w = Math.max(1, Math.trunc(width));
  const h = Math.max(1, Math.trunc(height));
  const longest = Math.max(w, h);
  if (longest <= longestEdge) return [w, h];
  const scale = longestEdge / longest;
  return [Math.max(1, pyRound(w * scale)), Math.max(1, pyRound(h * scale))];
}

function validFps(value: unknown): { num: number; den: number } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const num = Math.trunc(Number((value as { num?: unknown }).num));
  const den = Math.trunc(Number((value as { den?: unknown }).den));
  return num > 0 && den > 0 && num / den > 2 ? { num, den } : undefined;
}

/** A project that shows `file` full-frame, timeline seconds == source seconds. */
export function singleFileProject(project: Project, file: ProjectFile): Project {
  const width = Number(file.width) > 0 ? Number(file.width) : project.width;
  const height = Number(file.height) > 0 ? Number(file.height) : project.height;
  const duration = Math.max(Number(file.duration) || 0, 0.1);
  const base: Project = {
    ...project,
    width,
    height,
    fps: validFps(file.fps) ?? project.fps,
    clips: [],
    effects: [],
    files: [file],
    layers: [{ id: "L1", number: SCRATCH_LAYER, label: "", y: 0, lock: false }],
    markers: [],
    history: { undo: [], redo: [] },
  };
  const scratch = new ProjectDocument(base, { historyLimit: 0 });
  scratch.transaction("inspect", (tx) =>
    addClip(tx, { fileId: String(file.id), position: 0, layer: SCRATCH_LAYER, start: 0, end: duration }),
  );
  return scratch.project;
}

export interface MediaFrame {
  /** Source seconds. */
  timestamp: number;
  image: ToolImage;
}

/**
 * Render `timestamps` (source seconds) of `file`, longest edge `longestEdge`,
 * as JPEG. Frames that fail are skipped; throws only when the scratch project
 * cannot be built.
 */
export async function renderMediaFrames(
  call: ToolCall,
  file: ProjectFile,
  timestamps: readonly number[],
  options: { longestEdge?: number; overlay?: (timestamp: number) => FrameOverlay | undefined } = {},
): Promise<MediaFrame[]> {
  const frames = call.host.frames;
  if (!frames) return [];
  const scratch = singleFileProject(call.doc.project, file);
  const [width] = fitSize(scratch.width, scratch.height, options.longestEdge ?? 512);
  const out: MediaFrame[] = [];
  for (const timestamp of timestamps) {
    if (call.signal?.aborted) break;
    try {
      const overlay = options.overlay?.(timestamp);
      const image = await frames.renderFrame(scratch, timestamp, overlay ? { width, format: "jpeg", overlay } : { width, format: "jpeg" });
      out.push({ timestamp, image });
    } catch (error) {
      call.host.log?.(`media frame ${timestamp}s of ${String(file.id)} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return out;
}
