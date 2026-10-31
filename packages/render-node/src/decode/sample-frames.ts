/**
 * `FrameHost.sampleFrames`: tiny rgb24 frames of a stretch of a media file in
 * one ffmpeg decode (seek, frames picked by timestamp, area scale to the requested size), for the
 * engine's shot analysis (sequence/features.ts).
 */

import { resolveBinary } from "../ffmpeg/binaries.js";
import { AbortedError, spawnManaged } from "../ffmpeg/process.js";

/** More frames than this from one call is a caller mistake (an `every` of a frame over an hour). */
const MAX_FRAMES = 2000;

export async function sampleFrames(
  file: string,
  options: { start: number; end: number; every: number; width: number; height: number; signal?: AbortSignal },
): Promise<Uint8Array[]> {
  const { start, end, every, width, height } = options;
  if (!(start >= 0 && end >= start && every > 0 && width >= 1 && height >= 1)) throw new RangeError("sampleFrames needs 0 <= start <= end, every > 0 and a size");
  // The epsilon keeps 4/30 s at 1/30 s spacing from flooring to 3.
  const count = Math.floor((end - start) / every + 1e-6) + 1;
  if (count > MAX_FRAMES) throw new RangeError(`sampleFrames would decode ${count} frames (max ${MAX_FRAMES})`);
  // Half a sample of slack past `end` so the last requested frame is not lost to rounding.
  const span = end - start + every / 2;
  const managed = spawnManaged(
    resolveBinary("ffmpeg"),
    [
      "-hide_banner", "-loglevel", "error", "-nostdin",
      ...(start > 0 ? ["-ss", String(start)] : []),
      "-i", file, "-t", String(span), "-map", "0:v:0", "-an",
      // Frames picked by their own timestamps (the first, then each one `every` after the last picked): the
      // fps filter rounds to its own grid and can land a frame early or late.
      "-vf", `select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,${every - 1e-3})',scale=${Math.round(width)}:${Math.round(height)}:flags=area`,
      "-fps_mode", "passthrough", "-frames:v", String(count), "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
    ],
    { signal: options.signal },
  );
  const chunks: Buffer[] = [];
  managed.child.stdout!.on("data", (chunk: Buffer) => chunks.push(chunk));
  const code = await managed.exited;
  const spawnError = managed.spawnError();
  if (spawnError) throw spawnError;
  if (options.signal?.aborted) throw new AbortedError();
  if (code !== 0) throw managed.failure(`Sampling frames of ${file} failed`);
  const bytes = Buffer.concat(chunks);
  const size = Math.round(width) * Math.round(height) * 3;
  const out: Uint8Array[] = [];
  for (let o = 0; o + size <= bytes.length; o += size) out.push(new Uint8Array(bytes.subarray(o, o + size)));
  return out;
}
