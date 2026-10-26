/**
 * Beats of a project file's audio: the host decodes (`AudioHost.decodePcm`:
 * ffmpeg on the CLI and in Zenvi Cloud), the engine tracks (analysis/beats.ts).
 * Shared by detect_beats_tool and build_reel_tool.
 */

import { BEAT_SAMPLE_RATE, detectBeats, type BeatAnalysis, type BeatOptions } from "../analysis/beats.js";
import type { ProjectFile } from "../model/types.js";
import type { ToolCall } from "./define.js";

/** Longest stretch of a file analysed, seconds (a song; a long video's first ten minutes). */
const MAX_SECONDS = 600;

export interface FileBeats extends BeatAnalysis {
  /** Seconds of audio analysed. */
  duration: number;
}

/** The host can decode audio for beat tracking. */
export function canTrackBeats(call: ToolCall): boolean {
  return typeof call.host.audio?.decodePcm === "function";
}

/** Track the beats of `file`'s audio, or explain why not (a string starting with "Error:"). */
export async function beatsOfFile(call: ToolCall, file: ProjectFile, options: BeatOptions = {}): Promise<FileBeats | string> {
  const decode = call.host.audio?.decodePcm;
  if (!decode) return "Error: this Zenvi surface cannot decode audio for beat tracking.";
  const path = String(file.path ?? "");
  if (!path) return `Error: file ${file.id} has no media path.`;
  try {
    const { samples, sampleRate } = await decode(path, { sampleRate: BEAT_SAMPLE_RATE, maxSeconds: MAX_SECONDS, signal: call.signal });
    return { ...detectBeats(samples, sampleRate, options), duration: samples.length / sampleRate };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    call.host.log?.(`decodePcm(${path}) failed: ${message}`);
    return /no audio stream/i.test(message) ? `Error: ${file.id} has no audio.` : `Error: Beat detection failed: ${message}`;
  }
}

/** Below this the grid should be checked by ear (analysis/beats.ts, BeatAnalysis.confidence). */
const LOW_CONFIDENCE = 0.4;

/** What a receipt says about a tracked grid: the tempo, how sure, the other octaves and the bar. */
export function tempoReport(beats: BeatAnalysis): Record<string, unknown> {
  return {
    bpm: beats.bpm,
    confidence: beats.confidence,
    ...(beats.foldedFrom ? { folded_from: beats.foldedFrom } : {}),
    alternatives: beats.alternatives,
    beats_per_bar: beats.beatsPerBar,
    bar_confidence: beats.barConfidence,
    ...(beats.forced ? { given_bpm: true } : {}),
  };
}

/** A line for the receipt's warnings when the tracked grid is not trustworthy, else null. */
export function weakGridWarning(beats: BeatAnalysis): string | null {
  if (beats.confidence >= LOW_CONFIDENCE) return null;
  return `The beat grid is not reliable (confidence ${beats.confidence}, ${beats.bpm} BPM): listen to the cuts, or pass bpm + offset_seconds / beats.`;
}
