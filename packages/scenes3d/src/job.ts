/**
 * The job a Blender worker renders (worker.py reads it as JSON) and the
 * command lines that run Blender and ffmpeg.
 */

import path from "node:path";
import type { Scene3dId, Scene3dParams, Scene3dQuality } from "@zenvi/engine";

/** A media slot as the bpy scripts read it (zenvi3d/materials.py `_image_node`). */
export interface JobMedia {
  file: string;
  kind: "image" | "video";
  width: number;
  height: number;
  fps: number;
  frames: number;
  start: number;
}

export interface BlenderJob {
  id: string;
  scene: Scene3dId;
  params: Scene3dParams;
  width: number;
  height: number;
  fps: number;
  frames: number;
  quality: Scene3dQuality;
  output_dir: string;
  media: Record<string, JobMedia>;
  font: string | null;
  /** Only these frames (contact sheets); the whole range when absent. */
  stills?: number[];
}

const even = (n: number): number => Math.max(2, 2 * Math.round(n / 2));

/** Render size: drafts at half size (even, for the encoders). */
export function renderSize(width: number, height: number, quality: Scene3dQuality): { width: number; height: number } {
  const scale = quality === "draft" ? 0.5 : 1;
  return { width: even(width * scale), height: even(height * scale) };
}

/** Blender in the background on the worker script; with `jobFile` it renders one job and exits. */
export function blenderArgs(scriptsDir: string, jobFile?: string): string[] {
  const args = ["--factory-startup", "-b", "-noaudio", "--python-exit-code", "1", "-P", path.join(scriptsDir, "worker.py"), "--"];
  return jobFile ? [...args, "--job", jobFile] : args;
}

export interface EncodeSpec {
  framesDir: string;
  /** Frame rate as a fraction. */
  fps: { num: number; den: number };
  /** Opaque scenes: the backdrop PNG the frames go over (H.264); none: ProRes 4444 with alpha. */
  backdrop: string | null;
  output: string;
  quality: Scene3dQuality;
}

/** ffmpeg arguments: the worker's `f_0001.png…` sequence to a movie. */
export function encodeArgs(spec: EncodeSpec): string[] {
  const rate = `${spec.fps.num}/${spec.fps.den}`;
  const frames = ["-framerate", rate, "-start_number", "1", "-i", path.join(spec.framesDir, "f_%04d.png")];
  if (spec.backdrop === null) {
    // ProRes 4444 keeps alpha through libopenshot (VP9 WebM alpha is dropped).
    return ["-hide_banner", "-loglevel", "error", "-y", ...frames, "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-vendor", "apl0", "-an", spec.output];
  }
  const x264 = spec.quality === "draft" ? ["-preset", "veryfast", "-crf", "20"] : ["-preset", "medium", "-crf", "16"];
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-loop", "1", "-framerate", rate, "-i", spec.backdrop,
    ...frames,
    "-filter_complex", "[0:v][1:v]overlay=shortest=1:format=auto,format=yuv420p[v]",
    "-map", "[v]", "-c:v", "libx264", ...x264, "-movflags", "+faststart", "-an", spec.output,
  ];
}
