/**
 * The audio a layer's video kernels read (`LayerPlan.audio`: waveform clips,
 * AudioVisualization, BeatSync): this frame's window of the clip's source
 * audio, at the timeline rate, like libopenshot's `frame->GetAudioSamples`.
 *
 * Frames of a clip ask for consecutive windows, so one continuous decode per
 * clip (`PcmCursor`) serves playback and export without re-seeking.
 */

import { AudioSampleSink, type AudioSample } from "mediabunny";
import type { KernelAudio, LayerAudioRequest } from "@zenvi/engine/render";
import type { MediaLease, MediaRegistry } from "../media/registry.js";
import { PcmCursor } from "./pcm-cursor.js";

interface Lane {
  lease: MediaLease;
  cursor: PcmCursor<AudioSample> | null;
  lastUsed: number;
}

/** Lanes (decoders) of clips not read for this long are closed. */
const IDLE_LANE_MS = 5000;

/** Stretch `input` (planar) to exactly `frames` frames by linear interpolation. */
export function fitFrames(input: readonly Float32Array[], frames: number): Float32Array[] {
  return input.map((channel) => {
    if (channel.length === frames) return channel;
    const out = new Float32Array(frames);
    if (channel.length === 0) return out;
    const step = frames > 1 ? (channel.length - 1) / (frames - 1) : 0;
    for (let i = 0; i < frames; i += 1) {
      const p = i * step;
      const k = Math.floor(p);
      const a = channel[k] ?? 0;
      const b = channel[k + 1] ?? a;
      out[i] = a + (b - a) * (p - k);
    }
    return out;
  });
}

/** Map `input` channels onto `count` channels (repeat the last, drop extras). */
export function mapChannels(input: readonly Float32Array[], count: number, frames: number): Float32Array[] {
  return Array.from({ length: Math.max(1, count) }, (_, c) => input[Math.min(c, input.length - 1)] ?? new Float32Array(frames));
}

export class KernelAudioSource {
  private readonly lanes = new Map<string, Promise<Lane>>();

  constructor(private readonly media: MediaRegistry) {}

  /** The window `request` asks for, or null when the file has no decodable audio. */
  async read(request: LayerAudioRequest, lane: string): Promise<KernelAudio | null> {
    const entry = await this.lane(request, lane);
    const audio = entry?.lease.media.audio;
    if (!entry?.cursor || !audio) return null;
    entry.lastUsed = performance.now();
    void this.closeIdle(entry.lastUsed);
    const rate = audio.sampleRate;
    // Integer frame bounds: consecutive windows of a clip are contiguous reads.
    const startFrame = Math.round(request.sourceStart * rate);
    const endFrame = Math.round((request.sourceStart + request.samples / request.sampleRate) * rate);
    const raw = await entry.cursor.read(startFrame, Math.max(startFrame, endFrame));
    const samples = Math.max(0, Math.round(request.samples));
    return { sampleRate: request.sampleRate, channels: mapChannels(fitFrames(raw, samples), request.channels, samples) };
  }

  private async closeIdle(now: number): Promise<void> {
    for (const [id, pending] of this.lanes) {
      const lane = await pending.catch(() => null);
      if (!lane || now - lane.lastUsed <= IDLE_LANE_MS || this.lanes.get(id) !== pending) continue;
      this.lanes.delete(id);
      await lane.cursor?.close();
      lane.lease.release();
    }
  }

  /** Forget decode positions (after a seek). */
  async reset(): Promise<void> {
    const lanes = [...this.lanes.values()];
    this.lanes.clear();
    await Promise.all(
      lanes.map((pending) =>
        pending.then(
          async (lane) => {
            await lane.cursor?.close();
            lane.lease.release();
          },
          () => undefined,
        ),
      ),
    );
  }

  private async lane(request: LayerAudioRequest, lane: string): Promise<Lane | null> {
    const ref = { fileId: request.fileId, path: request.path };
    const key = this.media.keyOf(ref);
    if (key === undefined) return null;
    const id = `${key}@${this.media.versionOf(ref)}#${lane}`;
    let pending = this.lanes.get(id);
    if (!pending) {
      pending = this.media.acquire(ref).then((lease): Lane => {
        const audio = lease.media.audio;
        const cursor =
          audio && audio.canDecode
            ? new PcmCursor(new AudioSampleSink(audio.track), { timeOffset: lease.media.timeOffset, sampleRate: audio.sampleRate, channels: audio.channels })
            : null;
        return { lease, cursor, lastUsed: performance.now() };
      });
      this.lanes.set(id, pending);
      pending.catch(() => this.lanes.delete(id));
    }
    return pending.catch(() => null);
  }
}
