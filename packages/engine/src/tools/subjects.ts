/**
 * Subjects in a media-bin file's frame: the host renders the frame
 * (`FrameHost.renderFrame`, through the same scratch project inspect_media_tool
 * uses), the engine decodes the PNG and runs a detector. Shared by
 * detect_subject_tool and match_cut_montage_tool.
 *
 * Detectors are keyed by kind. `circle` (matchcut/circles.ts) and `blob`
 * (matchcut/blobs.ts: a region brighter or darker than its surroundings) are
 * pure TypeScript; detectors that need a model (faces, objects) would be host
 * capabilities with the same result shape.
 *
 * A hint (`near`, `radius`) re-ranks the candidates: the detector's best is
 * the most circle-like edge in the frame, which can be a highlight or a
 * button rather than the moon the agent means (round 7 match-cut bench:
 * boxes on the wrong object asked for 10-22x zooms).
 */

import { decodePngBase64 } from "../io/png.js";
import { detectBlobs } from "../matchcut/blobs.js";
import { detectCircles } from "../matchcut/circles.js";
import type { SubjectBox } from "../matchcut/fit.js";
import type { ProjectFile } from "../model/types.js";
import type { RgbaImage } from "../render/types.js";
import type { ToolCall } from "./define.js";
import { fitSize, singleFileProject } from "./media-frames.js";

export const SUBJECT_KINDS = ["circle", "blob"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export interface DetectedSubject {
  kind: SubjectKind;
  /** On the source frame, 0-1. */
  box: SubjectBox;
  /** 0..1, how sure the detector is. */
  score: number;
  /** Size, fraction of the frame height: a circle's radius, a blob's equal-area radius. */
  radius: number;
  /** 0..1: score weighed by how well it fits the hint (equal to score without one). */
  confidence: number;
  /** blob: brighter or darker than its surroundings. */
  tone?: "bright" | "dark";
}

export interface SubjectHint {
  /** Where the subject roughly is, 0-1 of the frame. */
  near?: { x: number; y: number };
  /** Its rough radius (half its height), fraction of the frame height. */
  radius?: number;
}

export interface DetectOptions extends SubjectHint {
  /** Circle radius bounds, fractions of the frame height (default 0.04-0.6; the hint only re-ranks). */
  minRadius?: number;
  maxRadius?: number;
  limit?: number;
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

/** How well a candidate fits the hint, 0..1: within about a quarter frame of `near`, within about 1.6x of `radius`. */
export function hintFit(s: { box: SubjectBox; radius: number }, hint: SubjectHint): number {
  let fit = 1;
  if (hint.near) {
    const d = Math.hypot(s.box.x + s.box.w / 2 - hint.near.x, s.box.y + s.box.h / 2 - hint.near.y);
    fit *= Math.exp(-((d / 0.25) ** 2));
  }
  if (hint.radius !== undefined && hint.radius > 0) fit *= Math.exp(-((Math.log(s.radius / hint.radius) / Math.log(1.6)) ** 2));
  return fit;
}

/** `subjects` ordered by confidence under `hint` (the detector's order without one). */
export function rankByHint(subjects: readonly DetectedSubject[], hint: SubjectHint): DetectedSubject[] {
  const ranked = subjects.map((s) => ({ ...s, confidence: Math.round(s.score * hintFit(s, hint) * 1000) / 1000 }));
  return hint.near || hint.radius !== undefined ? ranked.sort((a, b) => b.confidence - a.confidence) : ranked;
}

/** Radius (of the frame height) from which a candidate counts fully big in `pickSubject`. */
const FULL_SUBJECT = 0.15;

/**
 * The candidate an automatic match cut aligns on: with boxes the caller
 * measured, the one closest in size to them; otherwise the strongest weighed
 * by size, since a chain's subject fills the shot and a highlight does not.
 * (Chaining to the first file's pick instead carried a wrong first pick into
 * every shot: round 7 matchcut fixture, 2026-10-29.)
 */
export function pickSubject(subjects: readonly DetectedSubject[], referenceRadius?: number): DetectedSubject | undefined {
  if (referenceRadius !== undefined) return rankByHint(subjects, { radius: referenceRadius })[0];
  const weight = (s: DetectedSubject) => s.score * Math.min(1, s.radius / FULL_SUBJECT);
  return [...subjects].sort((a, b) => weight(b) - weight(a))[0];
}

/** Subjects of `kind` in `file` at `seconds` (source time), best first, or an "Error: …" string. */
export async function detectSubjects(call: ToolCall, file: ProjectFile, seconds: number, kind: SubjectKind, options: DetectOptions = {}): Promise<FrameSubjects | string> {
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
  const limit = options.limit ?? 5;
  const hinted = options.near !== undefined || options.radius !== undefined;
  // With a hint, look at more candidates than are returned: the one meant may not be the detector's best.
  const pool = hinted ? Math.max(limit, 10) : limit;
  const found: DetectedSubject[] =
    kind === "blob"
      ? detectBlobs(image, { limit: pool }).map((b) => ({ kind, box: b.box, score: b.score, radius: b.r, confidence: b.score, tone: b.tone }))
      : detectCircles(image, { limit: pool, minRadius: options.minRadius, maxRadius: options.maxRadius }).map((c) => ({ kind, box: c.box, score: c.score, radius: c.r, confidence: c.score }));
  return { subjects: rankByHint(found, options).slice(0, limit), darkEdges: hasDarkEdges(image) };
}
