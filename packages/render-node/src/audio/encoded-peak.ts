/**
 * The export's true-peak ceiling, held on the encoded file (W53 B3). A lossy
 * codec overshoots its input, and not in proportion: ffmpeg's AAC at 160 kb/s
 * turned one transient of a mix limited to -2 dBTP into +0.3 dBTP, and left
 * the same mix limited to -3 at -3.0. So the export's mix is rendered once to
 * a float WAV, then limited, encoded with the export's own codec and measured,
 * the limit lowered by what the file overshot, until the file holds the
 * ceiling. The export encodes that same limited mix (the encoder is
 * deterministic), so its file measures what the last trial did.
 */

import path from "node:path";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { runBinary } from "../ffmpeg/process.js";
import { num, type AudioGraph } from "../render/audio-graph.js";
import { ffmpegMajor } from "../render/encoder.js";
import { graphArgs, truePeakLimiterFilter } from "./mix.js";

/** Trial encodes before the export settles for the lowest peak it reached. */
export const MAX_PEAK_TRIALS = 4;
/** Aim this far under the ceiling when lowering the limit, dB (the overshoot moves a little with the limit). */
const STEP_MARGIN_DB = 0.2;
/** Largest single step down, dB: the overshoot is not proportional, a smaller step often clears it. */
const MAX_STEP_DB = 1;

export interface EncodedPeakOptions {
  sampleRate: number;
  channels: number;
  /** Length of the export's audio, seconds. */
  seconds: number;
  /** The export's audio encoder arguments (codec, bitrate). */
  codecArgs: readonly string[];
  /** Index of the graph's first source input (1 when the video arrives on input 0). */
  firstInput: number;
  /** The encoded file's true-peak ceiling, dBTP. */
  ceilingDb: number;
  /** The first limit tried, dBTP (the ceiling less the usual codec headroom). */
  startDb: number;
  tempDir: string;
  signal?: AbortSignal;
}

export interface EncodedPeakFit {
  /** The export's audio: the mixdown through the limit that held. */
  graph: AudioGraph;
  limitDb: number;
  /** The last trial's true peak, dBTP; null for a silent mix. */
  peakDb: number | null;
  /** Set when no trial held the ceiling. */
  warning?: string;
}

/** True peak of a file's first audio stream, dBTP (ffmpeg `ebur128`); null when silent. */
export async function encodedTruePeak(file: string, signal?: AbortSignal): Promise<number | null> {
  const { stderr } = await runBinary(resolveBinary("ffmpeg"), ["-hide_banner", "-nostats", "-nostdin", "-i", file, "-map", "0:a:0", "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"], {
    signal,
    what: "Measuring the encoded true peak failed",
  });
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const peak = /\bPeak:\s+(-?[\d.]+|-inf)\s+dBFS/.exec(summary)?.[1];
  const value = peak === undefined ? NaN : Number(peak);
  return Number.isFinite(value) && value > -120 ? value : null;
}

/** Render `graph` to a float WAV, then find the limit at which the export's codec keeps the file under `ceilingDb`. */
export async function fitEncodedPeak(graph: AudioGraph, options: EncodedPeakOptions): Promise<EncodedPeakFit> {
  const { sampleRate, channels, tempDir, signal } = options;
  const ffmpeg = resolveBinary("ffmpeg");
  const major = await ffmpegMajor();
  const format = ["-ar", String(sampleRate), "-ac", String(channels)];
  const mixdown = path.join(tempDir, "mixdown.wav");
  await runBinary(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...(await graphArgs(graph, graph.filter, path.join(tempDir, "mixdown.txt"), options.firstInput)), "-map", "[aout]", "-c:a", "pcm_f32le", ...format, mixdown], {
    signal,
    what: "Mixing the audio down failed",
  });
  const limited = (limitDb: number): AudioGraph => ({
    inputs: [{ path: mixdown, seek: 0, duration: options.seconds }],
    filter: `[${options.firstInput}:a]${truePeakLimiterFilter(sampleRate, limitDb, major)}[aout]`,
    warnings: graph.warnings,
  });

  let limitDb = options.startDb;
  let best: { limitDb: number; peakDb: number | null } | undefined;
  for (let trial = 0; trial < MAX_PEAK_TRIALS; trial += 1) {
    const file = path.join(tempDir, `peak-trial-${trial}.mka`);
    await runBinary(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", mixdown, "-af", truePeakLimiterFilter(sampleRate, limitDb, major), ...options.codecArgs, ...format, "-f", "matroska", file], {
      signal,
      what: "Encoding the audio trial failed",
    });
    const peakDb = await encodedTruePeak(file, signal);
    if (peakDb === null || peakDb <= options.ceilingDb) return { graph: limited(limitDb), limitDb, peakDb };
    if (!best || best.peakDb === null || peakDb < best.peakDb) best = { limitDb, peakDb };
    limitDb -= Math.min(peakDb - options.ceilingDb + STEP_MARGIN_DB, MAX_STEP_DB);
  }
  const settled = best!;
  return {
    graph: limited(settled.limitDb),
    limitDb: settled.limitDb,
    peakDb: settled.peakDb,
    warning: `The encoded audio peaks at ${num(settled.peakDb!, 1)} dBTP, over the ${num(options.ceilingDb, 1)} dBTP ceiling, after ${MAX_PEAK_TRIALS} limiter settings: turn the loudest hit down.`,
  };
}
