/**
 * The music bed of a reel (build_reel_tool, footage and motion styles alike):
 * the song from where the reel starts in it, for the reel's length, faded in
 * when it starts mid-song and faded out at the end.
 */

import type { Transaction } from "../../history/document.js";
import { Interpolation, type Clip } from "../../model/types.js";
import { addClip, setClipKeyframes } from "../../ops/clips.js";

export function placeMusicBed(tx: Transaction, musicId: string, start: number | null, duration: number, layer: number, title: string | undefined): Clip {
  const from = start ?? 0;
  const bed = addClip(tx, { fileId: musicId, position: 0, layer, start: from, end: from + duration, title });
  const out = Math.min(1.2, duration / 4);
  setClipKeyframes(tx, bed.id, "volume", [
    { time: 0, value: from > 0 ? 0 : 1, interpolation: Interpolation.LINEAR },
    ...(from > 0 ? [{ time: 0.12, value: 1, interpolation: Interpolation.LINEAR }] : []),
    { time: duration - out, value: 1, interpolation: Interpolation.LINEAR },
    { time: duration, value: 0, interpolation: Interpolation.LINEAR },
  ]);
  return bed;
}
