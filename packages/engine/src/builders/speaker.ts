/**
 * Speaker cuts for a talking head: each take keeps what is said and drops
 * the pauses between phrases (jump cuts), the takes play in order, and the
 * framing alternates between wide and a tighter punch-in on every jump cut,
 * so a cut inside one shot reads as a choice and not a glitch (the creator
 * talking-head references cut every 1-3 s and change the size each time).
 */

import type { TimedText } from "../analysis/transcription.js";
import type { CaptionWord } from "../captions/words.js";

export interface SpeakerTake {
  fileId: string;
  /** Seconds of media. */
  duration: number;
  /** Words in source seconds, in order (empty: the take plays whole). */
  words: readonly TimedText[];
}

export interface SpeakerSegment {
  fileId: string;
  sourceStart: number;
  sourceEnd: number;
  /** Timeline seconds. */
  position: number;
  /** Scale of the framing: 1 (wide) or the punch-in. */
  scale: number;
}

export interface SpeakerCut {
  segments: SpeakerSegment[];
  /** Every word on the timeline (timeline seconds; `source` = the take's file id). */
  words: CaptionWord[];
  duration: number;
  /** Seconds of the takes not kept (pauses, and silence before and after). */
  removed: number;
}

export interface SpeakerRules {
  /** A pause longer than this is cut (default 0.45 s). */
  maxPause?: number;
  /** Air kept on each side of a phrase (default 0.08 s). */
  pad?: number;
  /** Scale of the alternate framing (default 1.12; 1: no alternation). */
  punch?: number;
  fps: number;
}

const snap = (t: number, fps: number) => Math.round(t * fps) / fps;

/** The kept windows of one take: phrases joined across short pauses, padded, inside the media. */
export function keptWindows(take: SpeakerTake, maxPause: number, pad: number): [number, number][] {
  const words = [...take.words].filter((w) => w.endSec > w.startSec).sort((a, b) => a.startSec - b.startSec);
  if (words.length === 0) return [[0, take.duration]];
  const out: [number, number][] = [];
  for (const w of words) {
    const last = out[out.length - 1];
    if (last && w.startSec - last[1] <= maxPause) last[1] = Math.max(last[1], w.endSec);
    else out.push([w.startSec, w.endSec]);
  }
  return out.map(([a, b]) => [Math.max(0, a - pad), Math.min(take.duration, b + pad)] as [number, number]).filter(([a, b]) => b - a > 0.05);
}

export function planSpeakerCut(takes: readonly SpeakerTake[], rules: SpeakerRules): SpeakerCut {
  const maxPause = rules.maxPause ?? 0.45;
  const pad = rules.pad ?? 0.08;
  const punch = rules.punch ?? 1.12;
  const fps = rules.fps;
  const segments: SpeakerSegment[] = [];
  const words: CaptionWord[] = [];
  let at = 0;
  let removed = 0;
  for (const take of takes) {
    const windows = keptWindows(take, maxPause, pad);
    const kept = windows.reduce((s, [a, b]) => s + (b - a), 0);
    removed += Math.max(0, take.duration - kept);
    for (const [a, b] of windows) {
      const sourceStart = snap(a, fps);
      const length = Math.max(1 / fps, snap(b - a, fps));
      const position = snap(at, fps);
      // A new take opens wide; within a take every jump cut changes the size.
      const prev = segments[segments.length - 1];
      const scale = prev && prev.fileId === take.fileId && prev.scale === 1 ? punch : 1;
      segments.push({ fileId: take.fileId, sourceStart, sourceEnd: sourceStart + length, position, scale });
      for (const w of take.words) {
        if (w.startSec >= sourceStart - 1e-6 && w.startSec < sourceStart + length) {
          words.push({ text: w.text, start: position + (w.startSec - sourceStart), end: Math.min(position + length, position + (w.endSec - sourceStart)), source: take.fileId });
        }
      }
      at = position + length;
    }
  }
  return { segments, words, duration: at, removed };
}
