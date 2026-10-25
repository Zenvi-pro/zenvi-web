/**
 * `AudioHost.analyzeAudio`: decode a file's audio to mono PCM and return the
 * RMS of each frame (the input of the desktop's energy VAD: 16 kHz mono,
 * 480-sample / 30 ms frames, 16-bit PCM normalized to -1..1). Streams, so a
 * long file never sits in memory.
 *
 * `AudioHost.decodePcm`: the samples themselves (mono float, 22050 Hz by
 * default), for beat tracking. Bounded by `maxSeconds` (default 10 minutes).
 */

import type { AudioEnvelope } from "@zenvi/engine";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { AbortedError, spawnManaged } from "../ffmpeg/process.js";

export class NoAudioError extends Error {
  constructor(file: string) {
    super(`${file} has no audio stream.`);
    this.name = "NoAudioError";
  }
}

export async function analyzeAudio(
  file: string,
  options: { sampleRate?: number; frameSize?: number; signal?: AbortSignal } = {},
): Promise<AudioEnvelope> {
  const sampleRate = options.sampleRate ?? 16000;
  const frameSize = options.frameSize ?? 480;
  if (!(sampleRate >= 1000 && frameSize >= 1)) throw new RangeError("sampleRate must be ≥ 1000 and frameSize ≥ 1");
  const managed = spawnManaged(
    resolveBinary("ffmpeg"),
    ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", file, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", String(sampleRate), "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1"],
    { signal: options.signal },
  );
  const rms: number[] = [];
  let sum = 0;
  let count = 0;
  let carry: Buffer | undefined;
  managed.child.stdout!.on("data", (chunk: Buffer) => {
    let buf = carry ? Buffer.concat([carry, chunk]) : chunk;
    const usable = buf.length - (buf.length % 2);
    carry = usable < buf.length ? buf.subarray(usable) : undefined;
    buf = buf.subarray(0, usable);
    for (let i = 0; i < buf.length; i += 2) {
      const v = buf.readInt16LE(i) / 32768;
      sum += v * v;
      count += 1;
      if (count === frameSize) {
        rms.push(Math.sqrt(sum / frameSize));
        sum = 0;
        count = 0;
      }
    }
  });
  const code = await managed.exited;
  const spawnError = managed.spawnError();
  if (spawnError) throw spawnError;
  if (options.signal?.aborted) throw new AbortedError();
  if (code !== 0) {
    const stderr = managed.stderr.toString();
    if (/matches no streams|does not contain any stream|Stream map '0:a:0'/i.test(stderr)) throw new NoAudioError(file);
    throw managed.failure(`Audio analysis of ${file} failed`);
  }
  if (count > 0) rms.push(Math.sqrt(sum / count));
  return { sampleRate, frameSize, rms: Float32Array.from(rms) };
}

/** Mono float PCM of `file`'s audio (`AudioHost.decodePcm`). */
export async function decodePcm(
  file: string,
  options: { sampleRate?: number; startSeconds?: number; maxSeconds?: number; signal?: AbortSignal } = {},
): Promise<{ sampleRate: number; samples: Float32Array }> {
  const sampleRate = options.sampleRate ?? 22050;
  const maxSeconds = options.maxSeconds ?? 600;
  if (!(sampleRate >= 1000 && maxSeconds > 0)) throw new RangeError("sampleRate must be ≥ 1000 and maxSeconds > 0");
  const seek = options.startSeconds && options.startSeconds > 0 ? ["-ss", String(options.startSeconds)] : [];
  const managed = spawnManaged(
    resolveBinary("ffmpeg"),
    ["-hide_banner", "-loglevel", "error", "-nostdin", ...seek, "-i", file, "-t", String(maxSeconds), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", String(sampleRate), "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1"],
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
    if (/matches no streams|does not contain any stream|Stream map '0:a:0'/i.test(stderr)) throw new NoAudioError(file);
    throw managed.failure(`Decoding the audio of ${file} failed`);
  }
  const bytes = Buffer.concat(chunks);
  const usable = bytes.length - (bytes.length % 4);
  // Copy into an aligned buffer: Buffer pools may start at an odd offset.
  const samples = new Float32Array(usable / 4);
  new Uint8Array(samples.buffer).set(bytes.subarray(0, usable));
  return { sampleRate, samples };
}
