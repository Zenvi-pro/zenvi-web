/**
 * `AudioHost.mixPcm` in the browser: the timeline's mix (or a stem) rendered
 * offline by the export's own windows and voices, so master_audio_tool
 * measures what an export of this project encodes (before its limiter).
 */

import type { MixPcm, Project } from "@zenvi/engine";
import { defaultEngine, type RenderEngine } from "../engine.js";
import type { MediaRegistry } from "../media/registry.js";
import { mixRange } from "./mixdown.js";
import { AudioRenderer } from "./renderer.js";

/** Longest timeline `renderMixPcm` reads into memory by default (render-node's limit; stereo float at 48 kHz is ~23 MB a minute). */
export const DEFAULT_MIX_SECONDS = 900;

/** Seconds mixed per offline render, as the exporter does. */
const WINDOW = 10;

export interface MixPcmOptions {
  /** Only these clips (a stem); default all. */
  clipIds?: readonly string[];
  maxSeconds?: number;
  signal?: AbortSignal;
  /** Planner and kernels. Default: `@zenvi/engine`. */
  engine?: RenderEngine;
}

/** The project's mix (or the stem of `clipIds`) from 0 to the end of the last clip, planar float at the project's rate. */
export async function renderMixPcm(project: Project, media: MediaRegistry, options: MixPcmOptions = {}): Promise<MixPcm> {
  const engine = options.engine ?? defaultEngine;
  const last = engine.lastFrame(project);
  const seconds = last > 0 ? engine.frameTime(project, last + 1) : 0;
  if (!(seconds > 0)) throw new Error("The timeline is empty.");
  const limit = options.maxSeconds ?? DEFAULT_MIX_SECONDS;
  if (seconds > limit) throw new Error(`The timeline is ${Math.round(seconds)} s long; measuring is limited to ${limit} s.`);
  const sampleRate = project.sample_rate || 48000;
  const channels = project.channels || 2;
  const wanted = options.clipIds ? new Set(options.clipIds) : undefined;
  const plan = engine.planAudio(project, { start: 0, end: seconds });
  const filtered = wanted ? { ...plan, segments: plan.segments.filter((s) => wanted.has(s.clipId)) } : plan;
  const frames = Math.round(seconds * sampleRate);
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  const renderer = new AudioRenderer({ media, engine });
  try {
    await mixRange(renderer, filtered, { from: 0, to: seconds }, { sampleRate, channels, fps: project.fps, window: WINDOW, signal: options.signal }, (buffer, from) => {
      const offset = Math.round(from * sampleRate);
      for (let c = 0; c < channels; c += 1) out[c]!.set(buffer.getChannelData(c).subarray(0, frames - offset), offset);
    });
  } finally {
    await renderer.dispose();
  }
  return { sampleRate, channels: out };
}
