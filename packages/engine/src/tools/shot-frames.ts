/**
 * The frames sequence/features.ts reads for one shot (a window of a bin
 * file): its first two and last two frames and up to BODY_FRAMES through it,
 * from `FrameHost.sampleFrames` in a few decodes, or rendered one by one
 * where the host only has `renderFrame` (fewer body frames then).
 */

import { decodePngBase64 } from "../io/png.js";
import type { ProjectFile } from "../model/types.js";
import { THUMB_H, THUMB_W, thumbnail, type ShotFrames } from "../sequence/features.js";
import type { ToolCall } from "./define.js";
import { singleFileProject } from "./media-frames.js";

/** Frames through a shot for its energy (decoded hosts); rendered hosts take RENDERED_BODY. */
const BODY_FRAMES = 48;
const RENDERED_BODY = 5;
/** Rendered frames are this wide before they are scaled down (enough for a 32 px box filter). */
const RENDER_WIDTH = 160;

export interface ShotWindow {
  file: ProjectFile;
  /** Source seconds. */
  start: number;
  end: number;
  still: boolean;
}

async function rendered(call: ToolCall, file: ProjectFile, times: readonly number[]): Promise<Uint8Array[]> {
  const frames = call.host.frames!;
  const scratch = singleFileProject(call.doc.project, file);
  const out: Uint8Array[] = [];
  for (const t of times) {
    const png = await frames.renderFrame(scratch, t, { width: RENDER_WIDTH, format: "png" });
    out.push(thumbnail(decodePngBase64(png.data)));
  }
  return out;
}

/** The shot's frames, or why they cannot be read (a string starting with "Error:"). */
export async function shotFrames(call: ToolCall, shot: ShotWindow, fps: number): Promise<ShotFrames | string> {
  const host = call.host.frames;
  if (!host) return "Error: this Zenvi surface cannot read frames to compare shots.";
  const path = String(shot.file.path ?? "");
  const frame = 1 / fps;
  // The last frame starts a frame before the out point.
  const lastAt = Math.max(shot.start, shot.end - frame);
  const total = Math.max(1, Math.round((shot.end - shot.start) * fps));
  try {
    if (shot.still) {
      const [one] = host.sampleFrames && path ? await host.sampleFrames(path, { start: 0, end: 0, every: 1, width: THUMB_W, height: THUMB_H, signal: call.signal }) : await rendered(call, shot.file, [0]);
      if (!one) return `Error: no picture in ${String(shot.file.id)}.`;
      return { head: [one], tail: [one], body: [one], step: 1 };
    }
    if (host.sampleFrames && path) {
      const sample = (start: number, end: number, every: number) => host.sampleFrames!(path, { start, end, every, width: THUMB_W, height: THUMB_H, signal: call.signal });
      if (total <= BODY_FRAMES) {
        const all = await sample(shot.start, lastAt, frame);
        if (all.length === 0) return `Error: no frames of ${String(shot.file.id)} between ${shot.start}s and ${shot.end}s.`;
        return { head: all.slice(0, 2), tail: all.slice(-2), body: all, step: 1 };
      }
      const step = Math.ceil(total / BODY_FRAMES);
      const [head, tail, body] = [await sample(shot.start, shot.start + frame, frame), await sample(Math.max(shot.start, lastAt - frame), lastAt, frame), await sample(shot.start, lastAt, step * frame)];
      if (head.length === 0 || tail.length === 0) return `Error: no frames of ${String(shot.file.id)} between ${shot.start}s and ${shot.end}s.`;
      return { head, tail, body, step };
    }
    const head = await rendered(call, shot.file, total > 1 ? [shot.start, shot.start + frame] : [shot.start]);
    const tail = total > 1 ? await rendered(call, shot.file, [Math.max(shot.start, lastAt - frame), lastAt]) : head;
    const n = Math.min(RENDERED_BODY, total);
    const body = await rendered(call, shot.file, Array.from({ length: n }, (_, k) => shot.start + ((lastAt - shot.start) * k) / Math.max(1, n - 1)));
    return { head, tail, body, step: Math.max(1, Math.round(total / Math.max(1, n - 1))) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    call.host.log?.(`shot frames of ${String(shot.file.id)} failed: ${message}`);
    return `Error: could not read the frames of ${String(shot.file.id)}: ${message}`;
  }
}
