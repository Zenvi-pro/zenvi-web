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
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { frameContaining, maxFrame, type ExportOptions, type ExportResult, type Fraction, type Project } from "@zenvi/engine";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { binaryVersion } from "../ffmpeg/capabilities.js";
import { AbortedError, spawnManaged } from "../ffmpeg/process.js";
import { SourceManager, type MediaResolver } from "../decode/sources.js";
import type { ScaleQuality } from "../decode/video.js";
import { streamStarts } from "../probe/starts.js";
import { buildAudioGraph } from "./audio-graph.js";
import { encoderCommand, ffmpegMajorVersion, FORMATS } from "./encoder.js";
import { defaultRenderEngine, type RenderEngine } from "./engine.js";

export interface RenderProgress {
  /** 0..1 */
  fraction: number;
  /** Frames written so far and in total (0 for audio-only formats). */
  frame: number;
  frames: number;
}

export interface RenderProjectOptions {
  resolveMedia: MediaResolver;
  /** Destination file (png-sequence: `name.png` → `name_00001.png`…, or a `%05d` pattern). */
  output: string;
  options: ExportOptions;
  onProgress?: (progress: RenderProgress) => void;
  signal?: AbortSignal;
  /** Planner + compositor; defaults to `@zenvi/engine/render`. */
  engine?: RenderEngine;
  /** Decode scaling quality. Default "export" (desktop HIGH_QUALITY_SCALING). */
  scaleQuality?: ScaleQuality;
}

export interface RenderResult extends ExportResult {
  location: string;
  frames: number;
  durationSeconds: number;
  mimeType: string;
  warnings: string[];
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

function pngPattern(output: string): string {
  if (/%0?\d*d/.test(output)) return output;
  const ext = path.extname(output);
  const stem = ext ? output.slice(0, -ext.length) : output;
  return `${stem}_%05d.png`;
}

let versionPromise: Promise<number> | undefined;
function ffmpegMajor(): Promise<number> {
  versionPromise ??= binaryVersion("ffmpeg")
    .then((v) => ffmpegMajorVersion(v.version))
    .catch(() => 99);
  return versionPromise;
}

export async function renderProject(project: Project, opts: RenderProjectOptions): Promise<RenderResult> {
  const { options } = opts;
  const format = options.format;
  const info = FORMATS[format];
  if (!info) throw new RenderError(`Unsupported export format: ${String(format)}`);
  const fps = validFps(options.fps, project.fps);
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
  const engine = opts.engine ?? (await defaultRenderEngine());
  const signal = opts.signal;
  if (signal?.aborted) throw new AbortedError();

  const destination = path.resolve(format === "png-sequence" ? pngPattern(opts.output) : opts.output);
  const outDir = path.dirname(destination);
  await mkdir(outDir, { recursive: true });
  const token = `${process.pid}-${randomBytes(4).toString("hex")}`;
  const stagingDir = format === "png-sequence" ? path.join(outDir, `.zenvi-render-${token}`) : undefined;
  if (stagingDir) await mkdir(stagingDir, { recursive: true });
  const staged = stagingDir
    ? path.join(stagingDir, path.basename(destination))
    : path.join(outDir, `.${path.basename(destination)}.${token}.partial${path.extname(destination)}`);
  const scriptPath = path.join(outDir, `.zenvi-render-${token}.filtergraph`);

  const warnings: string[] = [];
  const sources = new SourceManager(project, { resolveMedia: opts.resolveMedia, quality: opts.scaleQuality ?? "export", signal });
  let encoder: ReturnType<typeof spawnManaged> | undefined;
  let scriptWritten = false;
  try {
    const audio = info.audio
      ? await buildAudioGraph({
          plan: engine.planAudio(project, { start, end }),
          range: { start, end },
          sampleRate,
          channels,
          firstInput: info.video ? 1 : 0,
          resolve: (p) => sources.resolve(p),
          startsOf: (file) => streamStarts(file, signal),
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
      for (let i = 0; i < frames; i += 1) {
        if (signal?.aborted) throw new AbortedError();
        const plan = engine.planFrame(project, first + i, { width, height });
        const prepared = await sources.prepare(plan);
        const image = engine.composite(plan, prepared);
        if (image.width !== width || image.height !== height) {
          throw new RenderError(`Compositor returned ${image.width}x${image.height}, expected ${width}x${height}.`);
        }
        const bytes = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
        if (!stdin.write(bytes)) {
          // EPIPE means ffmpeg exited: stop writing and report its exit status below.
          const drained = once(stdin, "drain").then(
            () => "drain" as const,
            () => "exited" as const,
          );
          const winner = await Promise.race([drained, exitedEarly]);
          if (winner === "exited") break;
        }
        opts.onProgress?.({ fraction: (i + 1) / frames, frame: i + 1, frames });
      }
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
    };
  } catch (error) {
    await encoder?.kill(200);
    throw error;
  } finally {
    await sources.close();
    if (scriptWritten) await rm(scriptPath, { force: true });
    if (stagingDir) await rm(stagingDir, { recursive: true, force: true });
    else await rm(staged, { force: true });
  }
}
