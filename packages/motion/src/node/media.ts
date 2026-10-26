/**
 * Media params for the page: a photo is served as is (or converted to PNG
 * when Chrome cannot decode it); a video becomes a JPEG frame per output
 * frame, so the page shows exact frames instead of seeking a <video>
 * (which is not frame-accurate).
 */

import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { probe, resolveBinary, runBinary } from "@zenvi/render-node";
import type { MediaRef } from "../config.js";

const BROWSER_IMAGES = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);

export interface PreparedMedia {
  ref: MediaRef;
  /** The folder served at `/media/<name>/`. */
  dir: string;
}

export interface PrepareOptions {
  /** Output frame size: frames are scaled to cover it. */
  width: number;
  height: number;
  fps: number;
  seconds: number;
  /** Scratch folder for this render. */
  workDir: string;
  signal?: AbortSignal;
}

export async function prepareMedia(name: string, file: string, accept: readonly ("image" | "video")[], options: PrepareOptions): Promise<PreparedMedia> {
  const info = await probe(file);
  const dir = path.join(options.workDir, `media-${name}`);
  await mkdir(dir, { recursive: true });
  const ffmpeg = resolveBinary("ffmpeg");
  const cover = `scale=w=${options.width}:h=${options.height}:force_original_aspect_ratio=increase:flags=lanczos`;
  const isVideo = info.media_type === "video" && Number(info.video_length) > 1;
  if (!isVideo) {
    if (!accept.includes("image")) throw new Error(`${name} takes a video, and ${path.basename(file)} is a still image`);
    const ext = path.extname(file).toLowerCase();
    let served = `image${ext}`;
    if (BROWSER_IMAGES.has(ext)) await copyFile(file, path.join(dir, served));
    else {
      served = "image.png";
      await runBinary(ffmpeg, ["-v", "error", "-y", "-i", file, "-frames:v", "1", "-vf", cover, path.join(dir, served)], { signal: options.signal });
    }
    return { dir, ref: { kind: "image", url: `/media/${name}/${served}`, width: Number(info.width) || options.width, height: Number(info.height) || options.height } };
  }
  if (!accept.includes("video")) throw new Error(`${name} takes a photo, and ${path.basename(file)} is a video`);
  await runBinary(
    ffmpeg,
    ["-v", "error", "-y", "-i", file, "-t", String(options.seconds + 0.1), "-an", "-vf", `fps=${options.fps},${cover}`, "-q:v", "3", path.join(dir, "frame_%05d.jpg")],
    { signal: options.signal },
  );
  const frames = (await readdir(dir)).filter((f) => f.startsWith("frame_")).length;
  if (frames === 0) throw new Error(`no frames could be read from ${path.basename(file)}`);
  return { dir, ref: { kind: "video", pattern: `/media/${name}/frame_{n}.jpg`, frames, fps: options.fps, width: options.width, height: options.height } };
}
