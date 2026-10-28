/**
 * `AudioHost.measureMix`: render the project's audio the way an export mixes
 * it (clip gains, fades, speed, audio effects), then measure that mix with
 * ffmpeg: EBU R128 loudness and true peak, and the stretches below a level
 * (silence). Also returns the mix as mono PCM so the engine can track its
 * beats. The mix goes to a temp folder that is removed afterwards.
 */

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MixMeasurement, Project } from "@zenvi/engine";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { runBinary } from "../ffmpeg/process.js";
import type { MediaResolver } from "../decode/sources.js";
import type { RenderEngine } from "../render/engine.js";
import { renderProject } from "../render/render-project.js";
import { decodePcm } from "./analyze.js";

const SAMPLE_RATE = 44100;
/** Beat tracking rate (the engine's BEAT_SAMPLE_RATE). */
const PCM_RATE = 22050;
/** Longest mix measured, seconds. */
const MAX_SECONDS = 600;

export interface MeasureMixOptions {
  resolveMedia: MediaResolver;
  engine?: RenderEngine;
  range?: { start: number; end: number };
  /** Level below which audio counts as silent, dBFS (default -50). */
  silenceDb?: number;
  /** Shortest silence reported, seconds (default 0.4). */
  minSilence?: number;
  signal?: AbortSignal;
}

const dbOrNull = (text: string | undefined): number | null => {
  const value = text === undefined ? NaN : Number(text);
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
};

/** Loudness, peak and silences from ffmpeg's `ebur128` + `silencedetect` log. */
export function parseMixLog(log: string, offset: number, duration: number): Pick<MixMeasurement, "lufs" | "peakDb" | "silences"> {
  const summary = log.slice(log.lastIndexOf("Summary:") >= 0 ? log.lastIndexOf("Summary:") : 0);
  // ebur128 reports its -70 LUFS floor for a mix with nothing above the absolute gate.
  const measured = dbOrNull(/\bI:\s+(-?[\d.]+|-inf)\s+LUFS/.exec(summary)?.[1]);
  const lufs = measured !== null && measured <= -70 ? null : measured;
  const peakDb = dbOrNull(/\bPeak:\s+(-?[\d.]+|-inf)\s+dBFS/.exec(summary)?.[1]);
  const silences: { start: number; end: number }[] = [];
  let open: number | undefined;
  for (const line of log.split(/\r?\n/)) {
    const start = /silence_start:\s*(-?[\d.]+)/.exec(line);
    const end = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (start) open = Math.max(0, Number(start[1]));
    else if (end && open !== undefined) {
      silences.push({ start: Math.round((offset + open) * 100) / 100, end: Math.round((offset + Number(end[1])) * 100) / 100 });
      open = undefined;
    }
  }
  // Silent to the end of the file: silencedetect never prints an end.
  if (open !== undefined) silences.push({ start: Math.round((offset + open) * 100) / 100, end: Math.round((offset + duration) * 100) / 100 });
  return { lufs, peakDb, silences };
}

export async function measureMix(project: Project, options: MeasureMixOptions): Promise<MixMeasurement> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zenvi-mix-"));
  const wav = path.join(dir, "mix.wav");
  try {
    const range = options.range;
    await renderProject(project, {
      resolveMedia: options.resolveMedia,
      output: wav,
      options: { format: "wav", width: project.width, height: project.height, fps: project.fps, sampleRate: SAMPLE_RATE, channels: 2, ...(range ? { range } : {}) },
      engine: options.engine,
      signal: options.signal,
    });
    const silenceDb = options.silenceDb ?? -50;
    const minSilence = options.minSilence ?? 0.4;
    const { stderr } = await runBinary(
      resolveBinary("ffmpeg"),
      ["-hide_banner", "-nostats", "-nostdin", "-i", wav, "-af", `ebur128=peak=true:framelog=verbose,silencedetect=noise=${silenceDb}dB:d=${minSilence}`, "-f", "null", "-"],
      { signal: options.signal, timeoutMs: 120_000, what: "Measuring the mix failed" },
    );
    const pcm = await decodePcm(wav, { sampleRate: PCM_RATE, maxSeconds: MAX_SECONDS, signal: options.signal });
    const duration = pcm.samples.length / PCM_RATE;
    return { ...parseMixLog(stderr, range?.start ?? 0, duration), pcm };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
