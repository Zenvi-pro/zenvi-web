/**
 * Audio effects for Node renders: libopenshot runs clip audio effects on
 * each frame's samples before the clip gain (Clip::apply_effects, then
 * Timeline::add_layer). ffmpeg cannot run the engine's DSP kernels, so a
 * segment with effects is decoded to float PCM (with its rate already
 * applied), processed by the engine kernels in timeline-frame-sized blocks
 * with their state kept across blocks, and written to a float WAV that the
 * mix graph then reads in place of the source.
 */

import { open } from "node:fs/promises";
import type { AudioKernel, EffectInstance } from "@zenvi/engine";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { AbortedError, spawnManaged } from "../ffmpeg/process.js";

export interface EffectRenderJob {
  /** Source file, `-ss`, `-t` and the pre-gain filters (asetpts/areverse/atempo/aformat). */
  input: { path: string; seek: number; duration: number };
  filters: string[];
  sampleRate: number;
  channels: number;
  /** Output length (timeline seconds). */
  seconds: number;
  effects: EffectInstance[];
  getKernel: (type: string) => AudioKernel | undefined;
  /** Samples per block (libopenshot processes a frame at a time). */
  blockSize: number;
  output: string;
  signal?: AbortSignal;
}

function wavHeader(sampleRate: number, channels: number, dataBytes: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(3, 20); // IEEE float
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * channels * 4, 28);
  h.writeUInt16LE(channels * 4, 32);
  h.writeUInt16LE(32, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

/** The effects this build can run; the rest are reported. */
export function splitEffects(effects: EffectInstance[], getKernel: (type: string) => AudioKernel | undefined): { runnable: EffectInstance[]; missing: string[] } {
  const runnable = effects.filter((e) => getKernel(e.type));
  return { runnable, missing: effects.filter((e) => !getKernel(e.type)).map((e) => e.type) };
}

export async function renderSegmentEffects(job: EffectRenderJob): Promise<void> {
  const totalFrames = Math.max(0, Math.round(job.seconds * job.sampleRate));
  const channels = job.channels;
  const kernels = job.effects.map((e) => ({ effect: e, kernel: job.getKernel(e.type)!, state: new Map<string, unknown>() }));
  const handle = await open(job.output, "w");
  let written = 0;
  try {
    await handle.write(wavHeader(job.sampleRate, channels, 0), 0, 44, 0);
    const managed = spawnManaged(
      resolveBinary("ffmpeg"),
      [
        "-hide_banner", "-loglevel", "error", "-nostdin",
        ...(job.input.seek > 0 ? ["-ss", job.input.seek.toFixed(6)] : []),
        "-t", job.input.duration.toFixed(6),
        "-i", job.input.path, "-map", "0:a:0", "-vn",
        "-af", job.filters.join(","),
        "-ac", String(channels), "-ar", String(job.sampleRate), "-f", "f32le", "pipe:1",
      ],
      { signal: job.signal },
    );
    const blockBytes = job.blockSize * channels * 4;
    let pending: Buffer = Buffer.alloc(0);
    const writeQueue: Promise<unknown>[] = [];
    const processBlock = (bytes: Buffer, frames: number) => {
      const floats = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + frames * channels * 4));
      const planar = Array.from({ length: channels }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i += 1) for (let c = 0; c < channels; c += 1) planar[c]![i] = floats[i * channels + c]!;
      for (const { effect, kernel, state } of kernels) kernel(planar, job.sampleRate, effect.params, state);
      for (let i = 0; i < frames; i += 1) for (let c = 0; c < channels; c += 1) floats[i * channels + c] = planar[c]![i]!;
      const out = Buffer.from(floats.buffer, floats.byteOffset, frames * channels * 4);
      writeQueue.push(handle.write(out, 0, out.length, 44 + written));
      written += out.length;
    };
    managed.child.stdout!.on("data", (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= blockBytes && written / (channels * 4) < totalFrames) {
        processBlock(pending.subarray(0, blockBytes), job.blockSize);
        pending = pending.subarray(blockBytes);
      }
    });
    const code = await managed.exited;
    const spawnError = managed.spawnError();
    if (spawnError) throw spawnError;
    if (job.signal?.aborted) throw new AbortedError();
    if (code !== 0) throw managed.failure("Decoding audio for effects failed");
    // Tail block, then silence up to the planned length (sources can end early).
    const haveFrames = written / (channels * 4);
    const tailFrames = Math.min(Math.floor(pending.length / (channels * 4)), Math.max(0, totalFrames - haveFrames));
    if (tailFrames > 0) processBlock(pending.subarray(0, tailFrames * channels * 4), tailFrames);
    while (written / (channels * 4) < totalFrames) {
      const frames = Math.min(job.blockSize, totalFrames - written / (channels * 4));
      processBlock(Buffer.alloc(frames * channels * 4), frames);
    }
    await Promise.all(writeQueue);
    await handle.write(wavHeader(job.sampleRate, channels, written), 0, 44, 0);
  } finally {
    await handle.close();
  }
}
