/**
 * Beats of a project file's audio: the host decodes (`AudioHost.decodePcm`:
 * ffmpeg on the CLI and in Zenvi Cloud), the engine tracks (analysis/beats.ts).
 * Shared by detect_beats_tool and build_reel_tool.
 */

import { BEAT_SAMPLE_RATE, detectBeats, type BeatAnalysis } from "../analysis/beats.js";
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
export async function beatsOfFile(call: ToolCall, file: ProjectFile): Promise<FileBeats | string> {
  const decode = call.host.audio?.decodePcm;
  if (!decode) return "Error: this Zenvi surface cannot decode audio for beat tracking.";
  const path = String(file.path ?? "");
  if (!path) return `Error: file ${file.id} has no media path.`;
  try {
    const { samples, sampleRate } = await decode(path, { sampleRate: BEAT_SAMPLE_RATE, maxSeconds: MAX_SECONDS, signal: call.signal });
    return { ...detectBeats(samples, sampleRate), duration: samples.length / sampleRate };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    call.host.log?.(`decodePcm(${path}) failed: ${message}`);
    return /no audio stream/i.test(message) ? `Error: ${file.id} has no audio.` : `Error: Beat detection failed: ${message}`;
  }
}
