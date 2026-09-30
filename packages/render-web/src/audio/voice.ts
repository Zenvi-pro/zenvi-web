/**
 * One scheduled piece of audio in a Web Audio graph: an
 * `AudioBufferSourceNode` started at the context time its timeline position
 * maps to, through a `GainNode` automated from the segment's envelope.
 * Works on `AudioContext` (preview) and `OfflineAudioContext` (export) alike.
 */

import { gainEvents, isUnityGain } from "./gain.js";
import type { PreparedPiece } from "./renderer.js";
import { contextTimeOf, lateStart, type ClockAnchor } from "./schedule.js";

export interface Voice {
  source: AudioBufferSourceNode;
  /** Context time at which the voice falls silent. */
  endsAt: number;
  stop(): void;
}

export function scheduleVoice(ctx: BaseAudioContext, destination: AudioNode, prepared: PreparedPiece, anchor: ClockAnchor): Voice | null {
  const { piece, channels, sampleRate } = prepared;
  const frames = channels[0]?.length ?? 0;
  if (frames === 0 || !(anchor.rate > 0)) return null;
  const nodeRate = prepared.speed * anchor.rate;
  const when = contextTimeOf(anchor, piece.timelineStart);
  const start = lateStart(when, ctx.currentTime, frames / sampleRate, nodeRate);
  if (!start) return null;

  const buffer = ctx.createBuffer(channels.length, frames, sampleRate);
  channels.forEach((data, c) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, c));
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = nodeRate;

  const segment = piece.segment;
  const from = piece.timelineStart - segment.timelineStart;
  const to = piece.timelineEnd - segment.timelineStart;
  let gain: GainNode | null = null;
  if (!isUnityGain(segment.gain, from, to)) {
    gain = ctx.createGain();
    for (const event of gainEvents(segment.gain, from, to)) {
      const at = contextTimeOf(anchor, segment.timelineStart + event.t);
      if (event.kind === "set") gain.gain.setValueAtTime(event.value, at);
      else gain.gain.linearRampToValueAtTime(event.value, at);
    }
    gain.connect(destination);
    source.connect(gain);
  } else {
    source.connect(destination);
  }
  source.onended = () => {
    source.disconnect();
    gain?.disconnect();
  };
  source.start(start.when, start.offset, start.duration);
  const endsAt = start.when + start.duration / nodeRate;
  return {
    source,
    endsAt,
    stop: () => {
      try {
        source.stop();
      } catch {
        // Already stopped or never started: nothing to silence.
      }
      source.disconnect();
      gain?.disconnect();
    },
  };
}
