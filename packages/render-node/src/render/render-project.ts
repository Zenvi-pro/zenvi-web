/**
 * Render a project to a file: plan each frame, decode its sources, composite
 * with the engine's CPU compositor, and stream RGBA into one ffmpeg encoder
 * that also mixes the audio graph.
 *
 * The range follows the desktop export dialog: frames 1..Timeline::GetMaxFrame
 * (zenvi-core src/windows/export.py:539, libopenshot Timeline.cpp:481) unless
 * `options.range` narrows it. Output is staged next to the destination and
 * renamed into place only when ffmpeg succeeds.
 */

import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { frameContaining, isSequenceFormat, maxFrame, projectAtFrameRate, type ExportResult, type FramePlan, type Fraction, type Project, type RgbaImage } from "@zenvi/engine";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { binaryVersion } from "../ffmpeg/capabilities.js";
import { AbortedError, spawnManaged } from "../ffmpeg/process.js";
import { SourceManager, type MediaResolver } from "../decode/sources.js";
import type { ScaleQuality } from "../decode/video.js";
import { streamStarts } from "../probe/starts.js";
import { buildAudioGraph } from "./audio-graph.js";
import { processLimits } from "../limits.js";
import { CompositePool, compositeThreads } from "./composite-pool.js";
import { encoderCommand, ffmpegMajorVersion, FORMATS, type NodeExportOptions } from "./encoder.js";
import { nodeTextRasterizer } from "../svg/text.js";
import { defaultRenderEngine, projectNeedsText, type RenderEngine } from "./engine.js";

export interface RenderProgress {
  /** 0..1 */
  fraction: number;
  /** Frames written so far and in total (0 for audio-only formats). */
  frame: number;
  frames: number;
}

export interface RenderProjectOptions {
  resolveMedia: MediaResolver;
  /** Destination file (an image sequence: `name.png` → `name_00001.png`…, or a `%05d` pattern). */
  output: string;
  /** Export options; `encoderPreset` sets the encoder speed (default veryfast). */
  options: NodeExportOptions;
  onProgress?: (progress: RenderProgress) => void;
  signal?: AbortSignal;
  /** Planner + compositor; defaults to `@zenvi/engine/render`. */
  engine?: RenderEngine;
  /** Decode scaling quality. Default "export" (desktop HIGH_QUALITY_SCALING). */
  scaleQuality?: ScaleQuality;
  /**
   * Compositor worker threads (default: `compositeThreads`, from
   * `ZENVI_RENDER_THREADS` or the core count; 0 composites on the main
   * thread). Only the default engine composites on workers.
   */
  threads?: number;
  log?: (message: string) => void;
}

/** Where a render spent its time (milliseconds on the main thread). */
export interface RenderStats {
  threads: number;
  plan: number;
  decode: number;
  /** Compositing on the main thread, or waiting for the workers. */
  composite: number;
  /** Waiting for the encoder to take frames. */
  encode: number;
  total: number;
}

export interface RenderResult extends ExportResult {
  location: string;
  frames: number;
  durationSeconds: number;
  mimeType: string;
  warnings: string[];
  stats: RenderStats;
}

export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderError";
  }
}

function validFps(fps: Fraction | undefined, fallback: Fraction): Fraction {
  return fps && fps.num > 0 && fps.den > 0 ? fps : fallback;
}

/** 1-based inclusive frame range to export. */
export function exportFrameRange(project: Project, fps: Fraction, range?: { start: number; end: number }): { first: number; last: number } {
  if (!range) return { first: 1, last: maxFrame(project, fps) };
  const first = frameContaining(Math.max(0, range.start), fps);
  const frames = range.end * (fps.num / fps.den);
  const last = Math.max(0, Math.ceil(frames - 1e-4));
  return { first, last };
}

function sequencePattern(output: string, extension: string): string {
  if (/%0?\d*d/.test(output)) return output;
  const ext = path.extname(output);
  const stem = ext ? output.slice(0, -ext.length) : output;
  return `${stem}_%05d.${extension}`;
}

let versionPromise: Promise<number> | undefined;
function ffmpegMajor(): Promise<number> {
  versionPromise ??= binaryVersion("ffmpeg")
    .then((v) => ffmpegMajorVersion(v.version))
    .catch(() => 99);
  return versionPromise;
}

export async function renderProject(source: Project, opts: RenderProjectOptions): Promise<RenderResult> {
  const { options } = opts;
  const format = options.format;
  const info = FORMATS[format];
  if (!info) throw new RenderError(`Unsupported export format: ${String(format)}`);
  const fps = validFps(options.fps, source.fps);
  // Frames are planned at the export's rate: keyframes rescaled to it, as the desktop's export does.
  const project = projectAtFrameRate(source, fps);
  const width = Math.round(options.width || project.width);
  const height = Math.round(options.height || project.height);
  if (!(width >= 16 && height >= 16 && width <= 16384 && height <= 16384)) {
    throw new RenderError(`Invalid export size ${width}x${height}.`);
  }
  const { first, last } = exportFrameRange(project, fps, options.range);
  const frames = last - first + 1;
  if (frames <= 0) throw new RenderError("Nothing to render: the timeline is empty.");
  const fpsValue = fps.num / fps.den;
  const start = (first - 1) / fpsValue;
  const end = last / fpsValue;
  const sampleRate = options.sampleRate ?? project.sample_rate ?? 48000;
  const channels = options.channels ?? project.channels ?? 2;
  // channels: 0 means no audio stream (libopenshot reads a zero channel count
  // that way; the engine's "Video Only" export settings use it).
  const withAudio = info.audio && channels > 0;
  if (!info.video && !withAudio) throw new RenderError(`A ${format} export needs audio channels (channels is ${channels}).`);
  const engine = opts.engine ?? (await defaultRenderEngine());
  const signal = opts.signal;
  if (signal?.aborted) throw new AbortedError();

  const sequence = isSequenceFormat(format);
  const destination = path.resolve(sequence ? sequencePattern(opts.output, info.extension) : opts.output);
  const outDir = path.dirname(destination);
  await mkdir(outDir, { recursive: true });
  const token = `${process.pid}-${randomBytes(4).toString("hex")}`;
  const stagingDir = sequence ? path.join(outDir, `.zenvi-render-${token}`) : undefined;
  if (stagingDir) await mkdir(stagingDir, { recursive: true });
  const staged = stagingDir
    ? path.join(stagingDir, path.basename(destination))
    : path.join(outDir, `.${path.basename(destination)}.${token}.partial${path.extname(destination)}`);
  const scriptPath = path.join(outDir, `.zenvi-render-${token}.filtergraph`);

  const warnings: string[] = [...(engine.limitations ?? [])];
  const tempDirs: string[] = [];
  const sources = new SourceManager(project, { resolveMedia: opts.resolveMedia, quality: opts.scaleQuality ?? "export", signal });
  let encoder: ReturnType<typeof spawnManaged> | undefined;
  let pool: CompositePool | undefined;
  let scriptWritten = false;
  const started = performance.now();
  const stats: RenderStats = { threads: 0, plan: 0, decode: 0, composite: 0, encode: 0, total: 0 };
  try {
    const effectsDir = withAudio ? await mkdtemp(path.join(tmpdir(), "zenvi-audio-fx-")) : undefined;
    tempDirs.push(...(effectsDir ? [effectsDir] : []));
    const audio = withAudio
      ? await buildAudioGraph({
          plan: engine.planAudio(project, { start, end }),
          range: { start, end },
          sampleRate,
          channels,
          firstInput: info.video ? 1 : 0,
          resolve: (p) => sources.resolve(p),
          startsOf: (file) => streamStarts(file, signal),
          effects: engine.getAudioKernel
            ? { getKernel: engine.getAudioKernel, tempDir: effectsDir!, blockSize: Math.max(64, Math.round((sampleRate * fps.den) / fps.num)), signal }
            : undefined,
        })
      : undefined;
    if (audio) warnings.push(...audio.warnings);

    const command = encoderCommand({
      format,
      output: staged,
      video: info.video ? { width, height, fps } : undefined,
      audio: audio ? { graph: audio, sampleRate, channels } : undefined,
      options,
      ffmpegMajor: await ffmpegMajor(),
      scriptPath,
    });
    if (command.script) {
      await writeFile(command.script.path, command.script.contents);
      scriptWritten = true;
    }
    encoder = spawnManaged(resolveBinary("ffmpeg"), command.args, { signal, stdin: info.video ? "pipe" : "ignore", stdout: "ignore" });
    const exitedEarly = encoder.exited.then(() => "exited" as const);

    if (info.video) {
      const stdin = encoder.child.stdin!;
      const state = engine.createState();
      const needsText = projectNeedsText(project);
      const text = needsText ? await nodeTextRasterizer() : undefined;
      const threads = opts.engine ? 0 : (opts.threads ?? compositeThreads(frames));
      const limits = processLimits();
      opts.log?.(
        `rendering ${frames} frames with ${threads} compositor worker(s); host CPUs ${availableParallelism()}, ` +
          `container CPUs ${limits.cpus ?? "unlimited"}, memory limit ${limits.memoryBytes ? `${Math.round(limits.memoryBytes / 1048576)} MB` : "unlimited"}`,
      );
      pool = await CompositePool.start(threads, opts.log);
      stats.threads = pool?.size ?? 0;
      // Frames composited ahead of the encoder (each holds one canvas).
      const ahead = pool ? pool.size * 2 + 1 : 0;
      const queue: Promise<RgbaImage>[] = [];
      // A frame with nothing on it is the background: composite it once per color.
      const backgrounds = new Map<string, RgbaImage>();
      const background = (plan: FramePlan): RgbaImage => {
        const key = plan.background.join(",");
        let image = backgrounds.get(key);
        if (!image) {
          image = engine.compositeFrame(plan, { layers: [], state });
          backgrounds.set(key, image);
        }
        return image;
      };
      let written = 0;
      let encoderGone = false;
      const write = async (image: RgbaImage): Promise<void> => {
        if (image.width !== width || image.height !== height) {
          throw new RenderError(`Compositor returned ${image.width}x${image.height}, expected ${width}x${height}.`);
        }
        const bytes = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
        if (!stdin.write(bytes)) {
          // EPIPE means ffmpeg exited: stop writing and report its exit status below.
          const t = performance.now();
          const drained = once(stdin, "drain").then(
            () => "drain" as const,
            () => "exited" as const,
          );
          const winner = await Promise.race([drained, exitedEarly]);
          stats.encode += performance.now() - t;
          if (winner === "exited") encoderGone = true;
        }
        written += 1;
        opts.onProgress?.({ fraction: written / frames, frame: written, frames });
      };
      const next = async (): Promise<RgbaImage> => {
        const t = performance.now();
        const image = await queue.shift()!;
        stats.composite += performance.now() - t;
        return image;
      };
      for (let i = 0; i < frames && !encoderGone; i += 1) {
        if (signal?.aborted) throw new AbortedError();
        let t = performance.now();
        const plan = engine.planFrame(project, first + i, { width, height }, { preview: false });
        stats.plan += performance.now() - t;
        if (plan.layers.length === 0) {
          queue.push(Promise.resolve(background(plan)));
        } else {
          t = performance.now();
          const prepared = await sources.prepare(plan);
          stats.decode += performance.now() - t;
          if (pool) {
            const composited = pool.composite(plan, prepared, needsText);
            // Awaited in order below; never an unhandled rejection meanwhile.
            composited.catch(() => undefined);
            queue.push(composited);
          } else {
            t = performance.now();
            queue.push(Promise.resolve(engine.compositeFrame(plan, { ...prepared, text, state })));
            stats.composite += performance.now() - t;
          }
        }
        while (queue.length > ahead && !encoderGone) await write(await next());
      }
      while (queue.length > 0 && !encoderGone) await write(await next());
      if (!stdin.destroyed) stdin.end();
    }
    const code = await encoder.exited;
    const spawnError = encoder.spawnError();
    if (spawnError) throw spawnError;
    if (signal?.aborted) throw new AbortedError();
    if (code !== 0) throw encoder.failure("Encoding failed");

    let bytes = 0;
    if (stagingDir) {
      const names = (await readdir(stagingDir)).sort();
      for (const name of names) {
        await rename(path.join(stagingDir, name), path.join(outDir, name));
        bytes += (await stat(path.join(outDir, name))).size;
      }
    } else {
      await rename(staged, destination);
      bytes = (await stat(destination)).size;
    }
    if (!info.video) opts.onProgress?.({ fraction: 1, frame: 0, frames: 0 });
    return {
      location: destination,
      bytes,
      durationSeconds: frames / fpsValue,
      mimeType: info.mimeType,
      frames: info.video ? frames : 0,
      warnings,
      stats: { ...stats, total: performance.now() - started },
    };
  } catch (error) {
    await encoder?.kill(200);
    throw error;
  } finally {
    await pool?.close();
    await sources.close();
    for (const d of tempDirs) await rm(d, { recursive: true, force: true });
    if (scriptWritten) await rm(scriptPath, { force: true });
    if (stagingDir) await rm(stagingDir, { recursive: true, force: true });
    else await rm(staged, { force: true });
  }
}
