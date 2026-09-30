/**
 * AudioRenderer: plan segments → decoded, processed PCM pieces.
 *
 * One lane per clip holds a continuous decode (`PcmCursor`) and the clip's
 * audio effect state, so consecutive windows of a clip continue exactly where
 * the previous one stopped: effects see one contiguous stream, as in a
 * libopenshot export (libopenshot-semantics §4.4, "zero state at the first
 * sample the render processes for that clip, then contiguous forward
 * processing"). Shared by preview playback and export.
 */

import { AudioSampleSink, type AudioSample } from "mediabunny";
import type { AudioSegment, EffectInstance } from "@zenvi/engine/render";
import type { RenderEngine } from "../engine.js";
import type { MediaLease, MediaRef, MediaRegistry } from "../media/registry.js";
import { PcmCursor } from "./pcm-cursor.js";
import { LinearResampler } from "./resample.js";
import { segmentPiece, type SegmentPiece } from "./schedule.js";

export interface PreparedPiece {
  piece: SegmentPiece;
  /** Processed planar PCM, in timeline order (reversed pieces already flipped). */
  channels: Float32Array[];
  sampleRate: number;
  /** Node playback rate before the player's rate: the segment speed, or 1 when already stretched. */
  speed: number;
}

export interface AudioRendererOptions {
  media: MediaRegistry;
  engine: RenderEngine;
  /** Called once per file whose audio this browser cannot decode. */
  onUnsupported?: (ref: MediaRef) => void;
}

interface Lane {
  lease: MediaLease;
  cursor: PcmCursor<AudioSample> | null;
  /** Frame after the last forward read, to detect discontinuities. */
  lastEnd: number | null;
  resampler: LinearResampler | null;
  effectState: Map<string, Map<string, unknown>>;
}

export class AudioRenderer {
  private readonly media: MediaRegistry;
  private readonly engine: RenderEngine;
  private readonly onUnsupported: ((ref: MediaRef) => void) | undefined;
  private readonly lanes = new Map<string, Promise<Lane>>();
  private readonly unsupported = new Set<string>();

  constructor(options: AudioRendererOptions) {
    this.media = options.media;
    this.engine = options.engine;
    this.onUnsupported = options.onUnsupported;
  }

  /** The part of `segment` inside timeline `[from, to)`, or null when it is silent here. */
  async render(segment: AudioSegment, from: number, to: number): Promise<PreparedPiece | null> {
    const lane = await this.lane(segment);
    if (!lane) return null;
    const audio = lane.lease.media.audio;
    if (!audio || !lane.cursor) return null;
    const piece = segmentPiece(segment, from, to, audio.sampleRate);
    if (!piece) return null;

    const continuous = !piece.reversed && lane.lastEnd === piece.startFrame;
    // Enqueue the read before any other await so reads stay in call order.
    const reading = lane.cursor.read(piece.startFrame, piece.endFrame);
    lane.lastEnd = piece.reversed ? null : piece.endFrame;
    let channels = await reading;
    if (piece.reversed) for (const channel of channels) channel.reverse();

    let speed = piece.speed;
    const kernels = segment.effects.filter((e) => this.engine.getAudioKernel(e.type));
    if (kernels.length > 0) {
      if (!continuous) {
        lane.effectState.clear();
        lane.resampler = null;
      }
      if (speed !== 1) {
        // Effects run after the speed change in libopenshot: stretch first.
        lane.resampler ??= new LinearResampler(channels.length, speed);
        channels = lane.resampler.process(channels);
        speed = 1;
      }
      this.runKernels(kernels, channels, audio.sampleRate, lane.effectState);
    }
    return { piece, channels, sampleRate: audio.sampleRate, speed };
  }

  /** Forget decode positions and effect state (after a seek). */
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

  async dispose(): Promise<void> {
    await this.reset();
  }

  private runKernels(kernels: EffectInstance[], channels: Float32Array[], sampleRate: number, state: Map<string, Map<string, unknown>>): void {
    for (const effect of kernels) {
      const kernel = this.engine.getAudioKernel(effect.type);
      if (!kernel) continue;
      let effectState = state.get(effect.id);
      if (!effectState) {
        effectState = new Map();
        state.set(effect.id, effectState);
      }
      kernel(channels, sampleRate, effect.params, effectState);
    }
  }

  private lane(segment: AudioSegment): Promise<Lane | null> {
    const ref: MediaRef = { fileId: segment.fileId, path: segment.path };
    const key = this.media.keyOf(ref);
    if (key === undefined || this.unsupported.has(key)) return Promise.resolve(null);
    const id = `${key}@${this.media.versionOf(ref)}#${segment.clipId}`;
    let pending = this.lanes.get(id);
    if (!pending) {
      pending = this.media.acquire(ref).then((lease): Lane => {
        const audio = lease.media.audio;
        const cursor =
          audio && audio.canDecode
            ? new PcmCursor(new AudioSampleSink(audio.track), { timeOffset: lease.media.timeOffset, sampleRate: audio.sampleRate, channels: audio.channels })
            : null;
        if (audio && !audio.canDecode && !this.unsupported.has(key)) {
          this.unsupported.add(key);
          this.onUnsupported?.(ref);
        }
        return { lease, cursor, lastEnd: null, resampler: null, effectState: new Map() };
      });
      this.lanes.set(id, pending);
      pending.catch(() => this.lanes.delete(id));
    }
    return pending.then(
      (lane) => lane,
      () => null,
    );
  }
}
