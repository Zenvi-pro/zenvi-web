/**
 * Beats of a project file's audio: the host decodes (`AudioHost.decodePcm`:
 * ffmpeg on the CLI and in Zenvi Cloud), the engine tracks (analysis/beats.ts).
 * Shared by detect_beats_tool and build_reel_tool; transients alone
 * (`onsetsOfFile`) by detect_onsets_tool, snap_cuts_to_onsets_tool and the
 * shot-length ramp.
 */

import { BEAT_SAMPLE_RATE, EDIT_BPM_MAX, detectBeats, detectOnsets, type BeatAnalysis, type BeatOptions, type Onset, type OnsetOptions } from "../analysis/beats.js";
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

/** Decode `file`'s audio (the first ten minutes) or explain why not, like `beatsOfFile`. */
async function pcmOfFile(call: ToolCall, file: ProjectFile): Promise<{ samples: Float32Array; sampleRate: number } | string> {
  const decode = call.host.audio?.decodePcm;
  if (!decode) return "Error: this Zenvi surface cannot decode audio.";
  const path = String(file.path ?? "");
  if (!path) return `Error: file ${file.id} has no media path.`;
  try {
    return await decode(path, { sampleRate: BEAT_SAMPLE_RATE, maxSeconds: MAX_SECONDS, signal: call.signal });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    call.host.log?.(`decodePcm(${path}) failed: ${message}`);
    return /no audio stream/i.test(message) ? `Error: ${file.id} has no audio.` : `Error: decoding the audio of ${file.id} failed: ${message}`;
  }
}

/** Transients of `file`'s audio in file seconds, or why not (a string starting with "Error:"). */
export async function onsetsOfFile(call: ToolCall, file: ProjectFile, options: OnsetOptions = {}): Promise<Onset[] | string> {
  const pcm = await pcmOfFile(call, file);
  return typeof pcm === "string" ? pcm : detectOnsets(pcm.samples, pcm.sampleRate, options);
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

/**
 * The octave of a tracked tempo that suits a style: a 80 BPM loop with a real
 * 160 pulse cuts a hype reel at 160, not at half speed. Null keeps the tracked
 * tempo (it is already the nearest, or no other reading is in the audio).
 * `fast` styles (hype, highlight) take the double tempo whenever it is at most
 * 180 BPM and the audio carries it (a 174 pulse read as 87 is not a ballad).
 */
export function octaveNearStyle(beats: BeatAnalysis, styleBpm: number, fast = false): number | null {
  if (beats.forced) return null;
  const supported = beats.alternatives.filter((a) => a.support >= 0.8 && a.bpm >= 60 && a.bpm <= 200);
  if (fast) {
    const double = supported.find((a) => a.bpm > beats.bpm * 1.9 && a.bpm < beats.bpm * 2.1 && a.bpm <= EDIT_BPM_MAX);
    if (double) return double.bpm;
  }
  const distance = (bpm: number) => Math.abs(Math.log2(bpm / styleBpm));
  const best = supported.sort((a, b) => distance(a.bpm) - distance(b.bpm))[0];
  return best && distance(beats.bpm) - distance(best.bpm) >= 0.25 ? best.bpm : null;
}
