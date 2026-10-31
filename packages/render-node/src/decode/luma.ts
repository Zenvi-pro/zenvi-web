/**
 * `MediaHost.decodeLuma`: a file's picture as small greyscale frames at a
 * constant rate, for motion analysis (engine analysis/action.ts). ffmpeg
 * seeks accurately (decoding from the keyframe before `startSeconds`),
 * scales with area averaging (so a fine texture does not alias into
 * motion) and writes raw 8-bit luma.
 */

import type { LumaFrames } from "@zenvi/engine";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { AbortedError, spawnManaged } from "../ffmpeg/process.js";

export class NoVideoError extends Error {
  constructor(file: string) {
    super(`${file} has no video stream.`);
    this.name = "NoVideoError";
  }
}

export async function decodeLuma(
  file: string,
  options: { width: number; height: number; fps: number; startSeconds?: number; maxSeconds?: number; signal?: AbortSignal },
): Promise<LumaFrames> {
  const width = Math.trunc(options.width);
  const height = Math.trunc(options.height);
  if (!(width >= 8 && height >= 8 && width * height <= 640 * 360)) throw new RangeError("width and height must be 8 or more, at most 640x360 pixels");
  if (!(options.fps > 0 && options.fps <= 240)) throw new RangeError("fps must be in (0, 240]");
  const start = options.startSeconds && options.startSeconds > 0 ? options.startSeconds : 0;
  const seek = start > 0 ? ["-ss", String(start)] : [];
  const limit = options.maxSeconds && options.maxSeconds > 0 ? ["-t", String(options.maxSeconds)] : [];
  const managed = spawnManaged(
    resolveBinary("ffmpeg"),
    [
      "-hide_banner", "-loglevel", "error", "-nostdin", ...seek, "-i", file, ...limit,
      "-map", "0:v:0", "-an", "-vf", `fps=${options.fps},scale=${width}:${height}:flags=area,format=gray`, "-f", "rawvideo", "pipe:1",
    ],
    { signal: options.signal },
  );
  const chunks: Buffer[] = [];
  managed.child.stdout!.on("data", (chunk: Buffer) => chunks.push(chunk));
  const code = await managed.exited;
  const spawnError = managed.spawnError();
  if (spawnError) throw spawnError;
  if (options.signal?.aborted) throw new AbortedError();
  if (code !== 0) {
    const stderr = managed.stderr.toString();
    if (/matches no streams|does not contain any stream|Stream map '0:v:0'/i.test(stderr)) throw new NoVideoError(file);
    throw managed.failure(`Decoding the picture of ${file} failed`);
  }
  const bytes = Buffer.concat(chunks);
  const size = width * height;
  const frames: Uint8Array[] = [];
  for (let at = 0; at + size <= bytes.length; at += size) frames.push(new Uint8Array(bytes.subarray(at, at + size)));
  return { fps: options.fps, width, height, startSeconds: start, frames };
}
