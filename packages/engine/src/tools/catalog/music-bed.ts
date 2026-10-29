/**
 * The music bed of a reel (build_reel_tool, footage and motion styles alike):
 * the song from where the reel starts in it, for the reel's length, faded in
 * when it starts mid-song and faded out at the end. Music looped to reach the
 * asked length (reels/loop.ts) is one clip per stretch, back to back, cut on
 * bar lines.
 */

import type { Transaction } from "../../history/document.js";
import { Interpolation, type Clip } from "../../model/types.js";
import { addClip, setClipKeyframes } from "../../ops/clips.js";
import { segmentsBetween, type MusicSegment } from "../../reels/loop.js";

export function placeMusicBed(tx: Transaction, musicId: string, start: number | null, duration: number, layer: number, title: string | undefined, loop?: readonly MusicSegment[]): Clip {
  const from = start ?? 0;
  const parts = loop ? segmentsBetween(loop, from, duration) : [{ at: 0, from, to: from + duration }];
  const beds = parts.map((p) => addClip(tx, { fileId: musicId, position: p.at, layer, start: p.from, end: p.to, title }));
  const first = beds[0]!;
  const last = beds[beds.length - 1]!;
  const lastLength = parts[parts.length - 1]!.to - parts[parts.length - 1]!.from;
  const out = Math.min(1.2, duration / 4, lastLength);
  const fadeIn = from > 0 ? [{ time: 0, value: 0, interpolation: Interpolation.LINEAR }, { time: 0.12, value: 1, interpolation: Interpolation.LINEAR }] : [];
  const fadeOut = [
    { time: lastLength - out, value: 1, interpolation: Interpolation.LINEAR },
    { time: lastLength, value: 0, interpolation: Interpolation.LINEAR },
  ];
  if (first === last) setClipKeyframes(tx, first.id, "volume", fadeIn.length > 0 ? [...fadeIn, ...fadeOut] : [{ time: 0, value: 1, interpolation: Interpolation.LINEAR }, ...fadeOut]);
  else {
    if (fadeIn.length > 0) setClipKeyframes(tx, first.id, "volume", fadeIn);
    setClipKeyframes(tx, last.id, "volume", fadeOut);
  }
  return first;
}
