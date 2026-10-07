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
import type { Fraction } from "@zenvi/engine";
import type { AudioPlan, AudioSegment, EffectInstance } from "@zenvi/engine/render";
import type { RenderEngine } from "../engine.js";
import type { MediaLease, MediaRef, MediaRegistry } from "../media/registry.js";
import { frameBlocks, routeChannels, toTimelineChannels } from "./channels.js";
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

/** The timeline's audio format: what effects and channel routing work in. */
export interface TimelineAudioFormat {
  sampleRate: number;
  channels: number;
  /** Timeline frame rate: audio effects run one timeline frame at a time, as in libopenshot. */
  fps: Fraction;
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
  /** Stretches source audio to the timeline rate for effects; kept while reads are contiguous. */
  resampler: { factor: number; resampler: LinearResampler } | null;
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

  /**
   * The part of `segment` inside timeline `[from, to)`, or null when it is
   * silent here. Without effects or channel routing the source keeps its own
   * rate and layout (Web Audio resamples and up/down-mixes); with them the
   * audio is brought to the timeline's format first, like libopenshot's
   * FrameMapper, so effects run on what libopenshot's see.
   */
  async render(segment: AudioSegment, from: number, to: number, format: TimelineAudioFormat): Promise<PreparedPiece | null> {
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

    const kernels = segment.effects.filter((e) => this.engine.getAudioKernel(e.type));
    const routed = segment.channelFilter !== undefined || segment.channelMapping !== undefined;
    if (kernels.length === 0 && !routed) return { piece, channels, sampleRate: audio.sampleRate, speed: piece.speed };

    channels = toTimelineChannels(channels, format.channels);
    let sampleRate = audio.sampleRate;
    let speed = piece.speed;
    if (kernels.length > 0) {
      if (!continuous) {
        lane.effectState.clear();
        lane.resampler = null;
      }
      // Effects see timeline-rate audio after the speed change (libopenshot-semantics §4.4).
      const factor = (piece.speed * audio.sampleRate) / format.sampleRate;
      if (factor !== 1) {
        if (!lane.resampler || lane.resampler.factor !== factor || lane.resampler.resampler.channels !== channels.length) {
          lane.resampler = { factor, resampler: new LinearResampler(channels.length, factor) };
        }
        channels = lane.resampler.resampler.process(channels);
      }
      sampleRate = format.sampleRate;
      speed = 1;
      this.runKernels(kernels, channels, piece.timelineStart, format, lane.effectState);
    }
    if (routed) channels = routeChannels(channels, format.channels, segment.channelFilter, segment.channelMapping);
    return { piece, channels, sampleRate, speed };
  }

  /**
   * Close the decoders of clips whose segments in `plan` all end at or before
   * `time` (timeline seconds): playback and export have passed them. Without
   * this a long timeline would keep one decoder per clip open.
   */
  async releaseEnded(plan: AudioPlan, time: number): Promise<void> {
    const live = new Set(plan.segments.filter((s) => s.timelineStart + s.duration > time).map((s) => s.clipId));
    const ended = new Set(plan.segments.filter((s) => !live.has(s.clipId)).map((s) => s.clipId));
    if (ended.size === 0) return;
    const closing: Promise<void>[] = [];
    for (const [id, pending] of this.lanes) {
      const clipId = id.slice(id.lastIndexOf("#") + 1);
      if (!ended.has(clipId)) continue;
      this.lanes.delete(id);
      closing.push(
        pending.then(
          async (lane) => {
            await lane.cursor?.close();
            lane.lease.release();
          },
          () => undefined,
        ),
      );
    }
    await Promise.all(closing);
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

  /** Run `kernels` in place, one timeline frame per block, with state per effect instance. */
  private runKernels(kernels: EffectInstance[], channels: Float32Array[], timelineStart: number, format: TimelineAudioFormat, state: Map<string, Map<string, unknown>>): void {
    const length = channels[0]?.length ?? 0;
    for (const [from, to] of frameBlocks(timelineStart, length, format.sampleRate, format.fps, format.channels)) {
      const block = channels.map((channel) => channel.subarray(from, to));
      for (const effect of kernels) {
        const kernel = this.engine.getAudioKernel(effect.type);
        if (!kernel) continue;
        let effectState = state.get(effect.id);
        if (!effectState) {
          effectState = new Map();
          state.set(effect.id, effectState);
        }
        kernel(block, format.sampleRate, effect.params, effectState);
      }
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
