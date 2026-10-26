/**
 * Subjects in a media-bin file's frame: the host renders the frame
 * (`FrameHost.renderFrame`, through the same scratch project inspect_media_tool
 * uses), the engine decodes the PNG and runs a detector. Shared by
 * detect_subject_tool and match_cut_montage_tool.
 *
 * Detectors are keyed by kind. `circle` is pure TypeScript
 * (matchcut/circles.ts); detectors that need a model (faces, objects) would
 * be host capabilities with the same result shape.
 */

import { decodePngBase64 } from "../io/png.js";
import { detectCircles, type CircleOptions } from "../matchcut/circles.js";
import type { SubjectBox } from "../matchcut/fit.js";
import type { ProjectFile } from "../model/types.js";
import type { ToolCall } from "./define.js";
import { fitSize, singleFileProject } from "./media-frames.js";

export const SUBJECT_KINDS = ["circle"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export interface DetectedSubject {
  kind: SubjectKind;
  /** On the source frame, 0-1. */
  box: SubjectBox;
  /** 0..1, how sure the detector is. */
  score: number;
}

/** Longest edge the frame is rendered at: twice the detector's working size, for sub-pixel centres. */
const DETECT_EDGE = 800;

/** Subjects of `kind` in `file` at `seconds` (source time), best first, or an "Error: …" string. */
export async function detectSubjects(call: ToolCall, file: ProjectFile, seconds: number, kind: SubjectKind, options: CircleOptions = {}): Promise<DetectedSubject[] | string> {
  const frames = call.host.frames;
  if (!frames) return "Error: this Zenvi surface cannot render frames to look for subjects.";
  const scratch = singleFileProject(call.doc.project, file);
  const [width] = fitSize(scratch.width, scratch.height, DETECT_EDGE);
  let image;
  try {
    const png = await frames.renderFrame(scratch, seconds, { width, format: "png" });
    if (png.mimeType !== "image/png") return "Error: this Zenvi surface renders frames this detector cannot read.";
    image = decodePngBase64(png.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    call.host.log?.(`detect ${kind} in ${String(file.id)} at ${seconds}s failed: ${message}`);
    return `Error: could not read the frame of ${String(file.id)} at ${seconds}s: ${message}`;
  }
  return detectCircles(image, options).map((c) => ({ kind, box: c.box, score: c.score }));
}
