/**
 * Channel layout and frame blocks of clip audio, as libopenshot mixes it.
 */

import { frameContaining, frameSampleOffset, type Fraction } from "@zenvi/engine";

/**
 * A source's channels on the timeline's channel count, as libopenshot's
 * FrameMapper delivers them (FFmpeg's resampler): mono is copied to every
 * channel, stereo folds to mono as the average, other layouts keep their
 * first channels (missing ones repeat the last).
 */
export function toTimelineChannels(input: readonly Float32Array[], count: number): Float32Array[] {
  const frames = input[0]?.length ?? 0;
  if (input.length === count) return [...input];
  if (input.length === 0) return Array.from({ length: count }, () => new Float32Array(frames));
  if (count === 1) {
    const mono = new Float32Array(frames);
    for (const channel of input) for (let i = 0; i < frames; i += 1) mono[i]! += channel[i]! / input.length;
    return [mono];
  }
  return Array.from({ length: count }, (_, c) => input[Math.min(c, input.length - 1)]!);
}

/**
 * libopenshot `channel_filter` / `channel_mapping` (`Timeline.cpp:647-749`):
 * every mixed source channel `ch` (only `filter` when set) is added into
 * output channel `mapping ?? ch`.
 */
export function routeChannels(input: readonly Float32Array[], count: number, filter?: number, mapping?: number): Float32Array[] {
  const frames = input[0]?.length ?? 0;
  const out = Array.from({ length: count }, () => new Float32Array(frames));
  input.forEach((channel, ch) => {
    if (filter !== undefined && ch !== filter) return;
    const target = out[mapping ?? ch];
    if (!target) return;
    for (let i = 0; i < frames; i += 1) target[i]! += channel[i]!;
  });
  return out;
}

/**
 * Block bounds `[start, end)` (sample offsets into a buffer whose first
 * sample is timeline time `timelineStart`) at timeline frame boundaries:
 * libopenshot processes audio one timeline frame at a time, and some effects
 * depend on the block (ParametricEQ uses its length as the sample rate).
 */
export function frameBlocks(timelineStart: number, length: number, sampleRate: number, fps: Fraction, channels: number): [number, number][] {
  if (length <= 0) return [];
  const startSample = Math.round(timelineStart * sampleRate);
  const blocks: [number, number][] = [];
  let frame = frameContaining(timelineStart, fps);
  let from = 0;
  while (from < length) {
    const next = frameSampleOffset(frame + 1, fps, sampleRate, channels) - startSample;
    const to = Math.min(length, Math.max(from + 1, next));
    blocks.push([from, to]);
    from = to;
    frame += 1;
  }
  return blocks;
}
