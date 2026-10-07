/**
 * Per-frame clip audio for effects that read it (AudioVisualization,
 * BeatSync, waveform clips): planar float samples from a source time, like
 * libopenshot's `frame->GetAudioSamples`. One ffmpeg child streams PCM
 * sequentially; a jump restarts it at the new position.
 */

import { resolveBinary } from "../ffmpeg/binaries.js";
import { spawnManaged, type ManagedChild } from "../ffmpeg/process.js";
import type { StreamStarts } from "../probe/starts.js";

export interface LayerAudioRequest {
  fileId: string;
  path: string;
  /** Source seconds (libopenshot audio clock) of the first sample. */
  sourceStart: number;
  samples: number;
  sampleRate: number;
  channels: number;
}

export class AudioSampleReader {
  private child: ManagedChild | undefined;
  private buffered: Buffer[] = [];
  private bufferedBytes = 0;
  private waiters: Array<() => void> = [];
  private ended = false;
  /** Next sample index (at `sampleRate`) the stream will deliver. */
  private position = -1;

  constructor(
    readonly file: string,
    readonly sampleRate: number,
    readonly channels: number,
    private readonly starts: StreamStarts,
    private readonly signal?: AbortSignal,
  ) {}

  private start(sample: number): void {
    void this.child?.kill(200);
    this.buffered = [];
    this.bufferedBytes = 0;
    this.ended = false;
    this.position = sample;
    const anchor = (this.starts.videoStart ?? this.starts.audioStart ?? this.starts.formatStart) - this.starts.formatStart;
    const seek = Math.max(0, anchor + sample / this.sampleRate);
    const child = spawnManaged(
      resolveBinary("ffmpeg"),
      ["-hide_banner", "-loglevel", "error", "-nostdin", ...(seek > 0 ? ["-ss", seek.toFixed(6)] : []), "-i", this.file, "-map", "0:a:0?", "-vn", "-ac", String(this.channels), "-ar", String(this.sampleRate), "-f", "f32le", "pipe:1"],
      { signal: this.signal },
    );
    this.child = child;
    child.child.stdout!.on("data", (chunk: Buffer) => {
      if (this.child !== child) return;
      this.buffered.push(chunk);
      this.bufferedBytes += chunk.length;
      if (this.bufferedBytes > 4 * 1024 * 1024) child.child.stdout!.pause();
      for (const w of this.waiters.splice(0)) w();
    });
    void child.exited.then(() => {
      if (this.child !== child) return;
      this.ended = true;
      for (const w of this.waiters.splice(0)) w();
    });
  }

  private async take(bytes: number): Promise<Buffer> {
    while (this.bufferedBytes < bytes && !this.ended) {
      this.child?.child.stdout?.resume();
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    const all = Buffer.concat(this.buffered);
    const out = Buffer.alloc(bytes);
    all.copy(out, 0, 0, Math.min(bytes, all.length));
    const rest = all.subarray(Math.min(bytes, all.length));
    this.buffered = rest.length ? [rest] : [];
    this.bufferedBytes = rest.length;
    if (this.bufferedBytes < 1024 * 1024) this.child?.child.stdout?.resume();
    return out;
  }

  /** `samples` planar samples starting at `sourceStart` seconds (silence past the end). */
  async read(sourceStart: number, samples: number): Promise<Float32Array[]> {
    const want = Math.max(0, Math.round(sourceStart * this.sampleRate));
    const frameBytes = 4 * this.channels;
    if (this.position < 0 || want < this.position || want - this.position > this.sampleRate * 2) this.start(want);
    else if (want > this.position) {
      await this.take((want - this.position) * frameBytes);
      this.position = want;
    }
    const raw = await this.take(samples * frameBytes);
    this.position += samples;
    const floats = new Float32Array(raw.buffer, raw.byteOffset, samples * this.channels);
    const planar = Array.from({ length: this.channels }, () => new Float32Array(samples));
    for (let i = 0; i < samples; i += 1) for (let c = 0; c < this.channels; c += 1) planar[c]![i] = floats[i * this.channels + c]!;
    return planar;
  }

  async close(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    await child?.kill(200);
  }
}
