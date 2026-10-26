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
import type { RgbaImage } from "../render/types.js";
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

export interface FrameSubjects {
  subjects: DetectedSubject[];
  /**
   * The frame's edges are black already (a moon or an eclipse on a night
   * sky): moving or shrinking it shows the canvas around it, which is black
   * too, so it needs no zoom to stay covered.
   */
  darkEdges: boolean;
}

/** Longest edge the frame is rendered at: twice the detector's working size, for sub-pixel centres. */
const DETECT_EDGE = 800;

/** Luma at or below this (of 255) counts as black, like a night sky in compressed footage. */
const BLACK = 28;

/** Whether the outer 4 % band of the frame is black (at most 2 % of its pixels brighter). */
export function hasDarkEdges(image: RgbaImage): boolean {
  const band = Math.max(1, Math.round(Math.min(image.width, image.height) * 0.04));
  let total = 0;
  let bright = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (y >= band && y < image.height - band && x >= band && x < image.width - band) continue;
      const i = (y * image.width + x) * 4;
      total += 1;
      if (0.299 * image.data[i]! + 0.587 * image.data[i + 1]! + 0.114 * image.data[i + 2]! > BLACK) bright += 1;
    }
  }
  return total > 0 && bright / total <= 0.02;
}

/** Subjects of `kind` in `file` at `seconds` (source time), best first, or an "Error: …" string. */
export async function detectSubjects(call: ToolCall, file: ProjectFile, seconds: number, kind: SubjectKind, options: CircleOptions = {}): Promise<FrameSubjects | string> {
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
  return { subjects: detectCircles(image, options).map((c) => ({ kind, box: c.box, score: c.score })), darkEdges: hasDarkEdges(image) };
}
