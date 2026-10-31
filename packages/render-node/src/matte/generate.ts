/**
 * A matte video from a source video: ffmpeg decodes every frame (coded
 * orientation, no autorotate: libopenshot masks the frame before the clip
 * rotates it) to rgb24 at the matte size, the model mattes the frames in
 * order, and ffmpeg encodes the gray frames as H.264 at the source's frame
 * rate, so the matte has the source's frame count and timing.
 */

import { resolveBinary } from "../ffmpeg/binaries.js";
import { AbortedError, spawnManaged } from "../ffmpeg/process.js";
import type { MatteModel } from "./rvm.js";

export interface MatteVideoSource {
  /** Local file. */
  path: string;
  /** Coded frame size (the reader's width/height). */
  width: number;
  height: number;
  fps: { num: number; den: number };
}

export interface MatteVideoOptions {
  /** Matte size relative to the source (rounded to even pixels for 4:2:0). */
  scale: number;
  signal?: AbortSignal;
  onFrame?: (frame: number) => void;
}

export interface MatteVideoResult {
  frames: number;
  width: number;
  height: number;
  /** Frames matted per second of wall time (decode, model and encode together). */
  fps: number;
}

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/** Read exactly `size`-byte frames from a stream. */
export async function* frames(stream: AsyncIterable<Buffer>, size: number): AsyncGenerator<Uint8Array> {
  let buffer: Buffer = Buffer.alloc(0);
  for await (const chunk of stream) {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    while (buffer.length >= size) {
      yield new Uint8Array(buffer.subarray(0, size));
      buffer = buffer.subarray(size);
    }
  }
}

/** Write with backpressure; rejects when the encoder goes away instead of waiting for a drain that never comes. */
function write(stream: NodeJS.WritableStream, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const gone = () => reject(new Error("the matte encoder stopped"));
    const ok = stream.write(bytes, (error) => (error ? reject(error) : undefined));
    if (ok) return resolve();
    stream.once("close", gone);
    stream.once("drain", () => {
      stream.removeListener("close", gone);
      resolve();
    });
  });
}

export async function generateMatteVideo(source: MatteVideoSource, output: string, model: MatteModel, options: MatteVideoOptions): Promise<MatteVideoResult> {
  const width = even(source.width * options.scale);
  const height = even(source.height * options.scale);
  const rate = `${source.fps.num}/${source.fps.den}`;
  const ffmpeg = resolveBinary("ffmpeg");
  const session = await model.open(width, height);
  const decoder = spawnManaged(
    ffmpeg,
    ["-hide_banner", "-loglevel", "error", "-noautorotate", "-i", source.path, "-map", "0:v:0", "-an", "-sn", "-dn",
      "-vf", `scale=${width}:${height}:flags=area,format=rgb24`, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
    { signal: options.signal },
  );
  const encoder = spawnManaged(
    ffmpeg,
    ["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${width}x${height}`, "-framerate", rate, "-i", "pipe:0",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p", "-r", rate, "-movflags", "+faststart", output],
    { signal: options.signal, stdin: "pipe", stdout: "ignore" },
  );
  const started = performance.now();
  let count = 0;
  try {
    for await (const rgb of frames(decoder.child.stdout! as AsyncIterable<Buffer>, width * height * 3)) {
      if (options.signal?.aborted) throw new AbortedError();
      await write(encoder.child.stdin!, await session.matte(rgb));
      count += 1;
      options.onFrame?.(count);
    }
    const decoded = await decoder.exited;
    if (decoder.spawnError()) throw decoder.spawnError()!;
    if (decoded !== 0) throw decoder.failure("decoding the source failed");
    encoder.child.stdin!.end();
    const encoded = await encoder.exited;
    if (encoder.spawnError()) throw encoder.spawnError()!;
    if (encoded !== 0) throw encoder.failure("encoding the matte failed");
  } catch (error) {
    await Promise.all([decoder.kill(), encoder.kill()]);
    throw options.signal?.aborted ? new AbortedError() : error;
  } finally {
    await session.close();
  }
  if (count === 0) throw new Error(`${source.path} has no video frames`);
  const seconds = (performance.now() - started) / 1000;
  return { frames: count, width, height, fps: count / Math.max(seconds, 1e-6) };
}
