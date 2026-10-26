/**
 * The timeline's audio through the export's own audio graph, without the
 * video: `AudioHost.mixPcm` (PCM for the engine's loudness meter) and the
 * two-pass `loudnorm` an export can end with.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { maxFrame, type MixPcm, type Project } from "@zenvi/engine";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { AbortedError, spawnManaged } from "../ffmpeg/process.js";
import { streamStarts } from "../probe/starts.js";
import { buildAudioGraph, num, type AudioGraph } from "../render/audio-graph.js";
import { SCRIPT_THRESHOLD, ffmpegMajor } from "../render/encoder.js";
import { defaultRenderEngine, type RenderEngine } from "../render/engine.js";

/** Longest timeline `renderMixPcm` reads into memory by default (stereo float at 48 kHz is ~23 MB a minute). */
export const DEFAULT_MIX_SECONDS = 900;

export interface MixOptions {
  resolveMedia: (projectPath: string) => string | Promise<string>;
  /** Only these clips (a stem); default all. */
  clipIds?: readonly string[];
  maxSeconds?: number;
  engine?: RenderEngine;
  signal?: AbortSignal;
}

/**
 * ffmpeg arguments that read a graph's inputs and run its filter; large
 * graphs go through a script file. A graph built for an export refers to its
 * sources from `firstInput` (1 when the video arrives on input 0): the
 * inputs before them are placeholders here.
 */
async function graphArgs(graph: AudioGraph, filter: string, scriptPath: string, firstInput = 0): Promise<string[]> {
  const args = ["-nostats", "-nostdin"];
  for (let i = 0; i < firstInput; i += 1) args.push("-f", "lavfi", "-t", "0.1", "-i", "anullsrc");
  for (const input of graph.inputs) args.push("-ss", input.seek.toFixed(6), "-t", input.duration.toFixed(6), "-i", input.path);
  if (filter.length > SCRIPT_THRESHOLD) {
    await writeFile(scriptPath, filter);
    args.push((await ffmpegMajor()) >= 7 ? "-/filter_complex" : "-filter_complex_script", scriptPath);
  } else {
    args.push("-filter_complex", filter);
  }
  return args;
}

/** `graph.filter` with `filters` run on its output before `[aout]`. */
export function appendToOutput(filter: string, filters: string): string {
  if (!filter.endsWith("[aout]")) throw new Error("audio graph does not end in [aout]");
  return `${filter.slice(0, -"[aout]".length)},${filters}[aout]`;
}

/** The timeline range's audio graph for `project`, ready for ffmpeg, and the temp folder holding what it needs. */
async function timelineGraph(project: Project, options: MixOptions, tempDir: string) {
  const engine = options.engine ?? (await defaultRenderEngine());
  const fps = project.fps;
  const seconds = (maxFrame(project, fps) * fps.den) / fps.num;
  if (!(seconds > 0)) throw new Error("The timeline is empty.");
  const limit = options.maxSeconds ?? DEFAULT_MIX_SECONDS;
  if (seconds > limit) throw new Error(`The timeline is ${Math.round(seconds)} s long; measuring is limited to ${limit} s.`);
  const sampleRate = project.sample_rate || 48000;
  const channels = project.channels || 2;
  const wanted = options.clipIds ? new Set(options.clipIds) : undefined;
  const plan = engine.planAudio(project, { start: 0, end: seconds });
  const filtered = wanted ? { ...plan, segments: plan.segments.filter((s) => wanted.has(s.clipId)) } : plan;
  const graph = await buildAudioGraph({
    plan: filtered,
    range: { start: 0, end: seconds },
    sampleRate,
    channels,
    firstInput: 0,
    resolve: async (p) => options.resolveMedia(p),
    startsOf: (file) => streamStarts(file, options.signal),
    effects: engine.getAudioKernel
      ? { getKernel: engine.getAudioKernel, tempDir, blockSize: Math.max(64, Math.round((sampleRate * fps.den) / fps.num)), signal: options.signal }
      : undefined,
  });
  return { graph, sampleRate, channels, seconds };
}

/** `AudioHost.mixPcm`: the project's mix (or the stem of `clipIds`) as planar float PCM at the project's rate. */
export async function renderMixPcm(project: Project, options: MixOptions): Promise<MixPcm> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "zenvi-mix-"));
  try {
    const { graph, sampleRate, channels } = await timelineGraph(project, options, tempDir);
    const args = [
      "-hide_banner",
      "-loglevel", "error",
      ...(await graphArgs(graph, graph.filter, path.join(tempDir, "graph.txt"))),
      "-map", "[aout]",
      "-f", "f32le",
      "-acodec", "pcm_f32le",
      "-ar", String(sampleRate),
      "-ac", String(channels),
      "pipe:1",
    ];
    const managed = spawnManaged(resolveBinary("ffmpeg"), args, { signal: options.signal });
    const chunks: Buffer[] = [];
    managed.child.stdout!.on("data", (chunk: Buffer) => chunks.push(chunk));
    const code = await managed.exited;
    const spawnError = managed.spawnError();
    if (spawnError) throw spawnError;
    if (options.signal?.aborted) throw new AbortedError();
    if (code !== 0) throw managed.failure("Rendering the timeline audio failed");
    const bytes = Buffer.concat(chunks);
    const frames = Math.floor(bytes.length / (4 * channels));
    const interleaved = new Float32Array(frames * channels);
    new Uint8Array(interleaved.buffer).set(bytes.subarray(0, frames * channels * 4));
    const planar = Array.from({ length: channels }, (_, c) => {
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i += 1) out[i] = interleaved[i * channels + c]!;
      return out;
    });
    return { sampleRate, channels: planar };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export interface LoudnessTarget {
  targetLufs: number;
  truePeakDbtp: number;
}

/** First-pass `loudnorm` readings of a mix. */
export interface LoudnormMeasurement {
  inputI: number;
  inputTp: number;
  inputLra: number;
  inputThresh: number;
  targetOffset: number;
}

/**
 * The true-peak ceiling is aimed this far under the requested one: AAC, MP3
 * and Opus overshoot their input by up to a dB on limited material, and the file is
 * what gets measured.
 */
const CODEC_HEADROOM_DB = 1;

/** Most the limiter is asked to take off the loudest peaks, dB. */
const MAX_LIMITING_DB = 6;

/** Loudness range the second pass may keep; wide, so a dynamic mix is gained as one (linear), not squeezed. */
const LOOSE_LRA = 20;

function loudnormBase(target: LoudnessTarget): string {
  return `loudnorm=I=${num(target.targetLufs, 3)}:TP=${num(target.truePeakDbtp - CODEC_HEADROOM_DB, 3)}:LRA=${LOOSE_LRA}`;
}

/** Pass 1: run the export's audio graph through `loudnorm` and read what it measured. Null when the mix is silent. */
export async function measureLoudnorm(graph: AudioGraph, target: LoudnessTarget, tempDir: string, firstInput: number, signal?: AbortSignal): Promise<LoudnormMeasurement | null> {
  const filter = appendToOutput(graph.filter, `${loudnormBase(target)}:print_format=json`);
  const args = ["-hide_banner", "-loglevel", "info", ...(await graphArgs(graph, filter, path.join(tempDir, "loudnorm-pass1.txt"), firstInput)), "-map", "[aout]", "-f", "null", "-"];
  const managed = spawnManaged(resolveBinary("ffmpeg"), args, { signal, stdout: "ignore" });
  const code = await managed.exited;
  const spawnError = managed.spawnError();
  if (spawnError) throw spawnError;
  if (signal?.aborted) throw new AbortedError();
  if (code !== 0) throw managed.failure("Measuring the loudness failed");
  const found = /\{[^{}]*"input_i"[^{}]*\}/.exec(managed.stderr.toString());
  if (!found) throw new Error("ffmpeg's loudnorm printed no measurement.");
  const raw = JSON.parse(found[0]) as Record<string, string>;
  const read = (key: string): number => Number(raw[key]);
  const inputI = read("input_i");
  if (!Number.isFinite(inputI) || inputI < -69) return null;
  return { inputI, inputTp: read("input_tp"), inputLra: read("input_lra"), inputThresh: read("input_thresh"), targetOffset: read("target_offset") };
}

/**
 * Pass 2, from pass 1's readings and back at the export's rate (loudnorm
 * resamples to 192 kHz). When the gain to the target keeps the true peak
 * under the ceiling that is `loudnorm` in linear mode (one gain for the
 * whole mix). A mix whose peaks would pass the ceiling is gained to the
 * target and held under it by a lookahead limiter instead, which is what a
 * mastering chain does: linear `loudnorm` would stop short of the target and
 * its dynamic mode squeezes the whole programme.
 */
export function loudnormPass2(measured: LoudnormMeasurement, target: LoudnessTarget, sampleRate: number): string {
  const ceilingDb = target.truePeakDbtp - CODEC_HEADROOM_DB;
  const ceiling = num(10 ** (ceilingDb / 20), 5);
  const gain = target.targetLufs - measured.inputI;
  if (measured.inputTp + gain <= ceilingDb) {
    return [
      `${loudnormBase(target)}:measured_I=${num(measured.inputI, 3)}:measured_TP=${num(measured.inputTp, 3)}:measured_LRA=${num(measured.inputLra, 3)}:measured_thresh=${num(measured.inputThresh, 3)}:offset=${num(measured.targetOffset, 3)}:linear=true`,
      `aresample=${sampleRate}`,
      `alimiter=limit=${ceiling}:level=disabled`,
    ].join(",");
  }
  // Past MAX_LIMITING_DB of peak reduction the mix would be crushed for the last LU: stop short of the target instead.
  const held = Math.min(gain, ceilingDb - measured.inputTp + MAX_LIMITING_DB);
  return `volume=${num(held, 3)}dB,alimiter=limit=${ceiling}:level=disabled`;
}

/** Normalize `graph`'s output to `target` (mutates the graph's filter). Returns a warning when it left the mix alone. */
export async function normalizeLoudness(graph: AudioGraph, target: LoudnessTarget, sampleRate: number, tempDir: string, firstInput: number, signal?: AbortSignal): Promise<string | undefined> {
  const measured = await measureLoudnorm(graph, target, tempDir, firstInput, signal);
  if (!measured) return "Loudness normalisation skipped: the mix is silent.";
  graph.filter = appendToOutput(graph.filter, loudnormPass2(measured, target, sampleRate));
  return undefined;
}
