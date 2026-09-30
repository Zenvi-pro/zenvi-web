/**
 * libopenshot `FrameMapper` picture mapping with PULLDOWN_NONE (every clip
 * reader is wrapped this way, Timeline.cpp:508-534), ported from
 * src/FrameMapper.cpp:114-348 and `GetMappedFrame` :350-373.
 *
 * Between 24, 25 and 30 fps libopenshot repeats or skips whole frames on a
 * field schedule; every other pair uses an accumulating linear walk. Both are
 * reproduced literally (the accumulation in doubles decides ties at .5).
 */

import { roundHalfAway } from "../../model/rounding.js";
import type { Fraction } from "../../model/types.js";

function toFloat(f: Fraction): number {
  return Math.fround(Math.fround(f.num) / Math.fround(f.den));
}

function toInt(f: Fraction): number {
  return Math.trunc(roundHalfAway(f.num / f.den));
}

function isSpecial(f: Fraction): boolean {
  const v = toFloat(f);
  return Math.abs(v - 24) < 1e-7 || Math.abs(v - 25) < 1e-7 || Math.abs(v - 30) < 1e-7;
}

/** Source frame for each target frame (index 0 = target frame 1). */
export function buildFrameMapping(source: Fraction, target: Fraction, videoLength: number): Int32Array {
  const fields: number[] = [];
  if (isSpecial(source) && isSpecial(target)) {
    const difference = Math.fround(toInt(target) - toInt(source));
    let fieldInterval = 0;
    let frameInterval = 0;
    if (difference !== 0) {
      fieldInterval = Math.trunc(roundHalfAway(Math.abs(Math.fround(toInt(source) / difference))));
      frameInterval = Math.trunc(fieldInterval * 2);
    }
    let frame = 1;
    const numberOfFields = videoLength * 2;
    for (let field = 1; field <= numberOfFields; field += 1) {
      if (difference === 0) {
        fields.push(frame);
      } else if (difference > 0) {
        fields.push(frame);
        if (field % frameInterval === 0) {
          fields.push(frame);
          fields.push(frame);
        }
      } else if (frame % fieldInterval === 0) {
        // Skip this field and the next one.
        field += 1;
      } else {
        fields.push(frame);
      }
      if (field % 2 === 0 && field > 0) frame += 1;
    }
  } else {
    const rateDiff = target.num / target.den / (source.num / source.den);
    const newLength = Math.trunc(videoLength * rateDiff);
    const increment = videoLength / newLength;
    let original = 1.0;
    for (let n = 1; n <= newLength; n += 1) {
      const f = roundHalfAway(original);
      fields.push(f, f);
      original += increment;
    }
  }
  const frames = new Int32Array(Math.floor(fields.length / 2));
  for (let i = 0; i < frames.length; i += 1) frames[i] = fields[2 * i + 1]!;
  return frames;
}

const cache = new Map<string, Int32Array>();

function mapping(source: Fraction, target: Fraction, videoLength: number): Int32Array {
  const key = `${source.num}/${source.den}>${target.num}/${target.den}#${videoLength}`;
  let table = cache.get(key);
  if (!table) {
    table = buildFrameMapping(source, target, videoLength);
    if (cache.size >= 32) cache.delete(cache.keys().next().value!);
    cache.set(key, table);
  }
  return table;
}

export interface MapperSource {
  fps: Fraction;
  videoLength: number;
  hasVideo: boolean;
  hasAudio: boolean;
  hasSingleImage: boolean;
}

/**
 * `FrameMapper::GetMappedFrame(n).Odd.Frame`: the reader's native frame shown
 * for target frame `n` (clamped to the last mapped frame, so pictures freeze
 * past the end). Single images without audio are not mapped.
 */
export function mappedSourceFrame(src: MapperSource, target: Fraction, n: number): number {
  if (src.hasVideo && !src.hasAudio && src.hasSingleImage) return n;
  const table = mapping(src.fps, target, src.videoLength);
  if (table.length === 0) return 1;
  const index = Math.min(Math.max(n, 1), table.length) - 1;
  return table[index]!;
}
