/**
 * The caller's own beat grid, for tools that cut or animate on the beat: a
 * list of times (`beats`), or a tempo and where the first beat falls (`bpm` +
 * `offset_seconds`). It replaces beat detection, which can be a half or double
 * tempo or off the grid on dense or ambient music; with `bpm` alone detection
 * still runs, locked to that tempo (analysis/beats.ts, BeatOptions.bpm).
 */

import { z } from "zod";
import { tempoGrid } from "../motion/grid.js";

export const beatOverrideShape = {
  beats: z
    .array(z.number().min(0))
    .max(4000)
    .optional()
    .describe("Beat times of the music in seconds (e.g. from detect_beats_tool), used as they are instead of detecting the beat."),
  bpm: z
    .number()
    .min(40)
    .max(400)
    .optional()
    .describe("Tempo to use instead of the detected one. Alone: the music is tracked at this tempo (detect_beats_tool's alternatives lists the half/double readings). With offset_seconds: no detection, the grid is exact."),
  offset_seconds: z
    .number()
    .min(0)
    .max(3600)
    .optional()
    .describe("With bpm: where the first beat falls in the music, seconds. The grid runs from there at that tempo."),
};

export interface BeatOverride {
  beats?: number[] | undefined;
  bpm?: number | undefined;
  offset_seconds?: number | undefined;
}

/** What is wrong with the arguments, as an `Error:` line, or null. */
export function beatOverrideProblem(args: BeatOverride): string | null {
  if (args.offset_seconds !== undefined && args.bpm === undefined) return "Error: offset_seconds goes with bpm (the first beat is at offset_seconds, the rest follow at that tempo).";
  if (args.beats && args.beats.length === 1) return "Error: beats needs at least two beat times.";
  return null;
}

/** Beat times covering `seconds` of audio from the caller's `beats`, or `bpm` + `offset_seconds`; null when neither is given. */
export function explicitBeats(args: BeatOverride, seconds: number): { beats: number[]; source: string } | null {
  if (args.beats && args.beats.length >= 2) return { beats: [...new Set(args.beats)].sort((a, b) => a - b), source: "the given beats" };
  if (args.bpm !== undefined && args.offset_seconds !== undefined) {
    const grid = tempoGrid(args.bpm, Math.max(0, seconds - args.offset_seconds), args.offset_seconds);
    return { beats: [...grid.beats], source: `${args.bpm} BPM from ${args.offset_seconds} s` };
  }
  return null;
}
