/**
 * Zenvi FX renderer for Node: probes the source, builds the stack's
 * filtergraph with the engine (`buildFxGraph`), and renders the source
 * range with ffmpeg to ProRes 422 HQ (4444 when the source has alpha) with
 * PCM audio. Renders are cached by fingerprint: sha256 of the source's
 * absolute path, size and mtime, the range, the graph text and
 * FX_RENDERER_VERSION. A render is written to a hidden partial file and
 * renamed into place only when ffmpeg finishes, so the cache never holds a
 * truncated movie.
 */

import { createHash } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { buildFxGraph, FX_RENDERER_VERSION, type FxEffect, type FxHost, type FxRender, type FxRenderRequest } from "@zenvi/engine";
import { runBinary } from "../ffmpeg/process.js";
import { prepareCarry, type CarryInputs } from "./datamosh.js";

export interface FxRendererOptions {
  ffmpeg: string;
  ffprobe: string;
  /** Where renders go (and are looked up): e.g. the project's `_assets/links/zenvi-fx`, else a cache folder. */
  outputDir: () => string;
  /** Other folders to find a cached render in before rendering (the per-user cache). */
  lookupDirs?: () => string[];
  /** A project media path to a local file. */
  resolveMedia: (p: string) => string;
  /** Decode with VideoToolbox on macOS (default true; ZENVI_FX_HWACCEL=0 turns it off). */
  hwaccel?: boolean;
  log?: (message: string) => void;
}

/** What the renderer needs to know about a source. */
export interface FxSourceInfo {
  width: number;
  height: number;
  fps: { num: number; den: number };
  duration: number;
  alpha: boolean;
  audio: boolean;
  codec: string;
  sar: { num: number; den: number };
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_aspect_ratio?: string;
  side_data_list?: { rotation?: number }[];
  tags?: { rotate?: string };
  disposition?: { attached_pic?: number };
}

/** Pixel formats with an alpha plane (the ones ProRes 4444 / qtrle / PNG / VP9 alpha decode to). */
const ALPHA_FORMAT = /^(yuva|rgba|bgra|argb|abgr|gbrap|ya|pal8)/;

function rate(text: string | undefined, sep = "/"): { num: number; den: number } | null {
  const [n, d] = String(text ?? "").split(sep).map(Number);
  return n && d && n > 0 && d > 0 ? { num: n, den: d } : null;
}

export async function probeFxSource(ffprobe: string, file: string, signal?: AbortSignal): Promise<FxSourceInfo> {
  const { stdout } = await runBinary(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { signal, timeoutMs: 30_000, what: "ffprobe" });
  const data = JSON.parse(stdout.toString("utf8")) as { streams?: FfprobeStream[]; format?: { duration?: string } };
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  if (!video?.width || !video.height) throw new Error(`${path.basename(file)} has no video stream.`);
  // ffmpeg rotates phone footage on decode, so a ±90° rotation swaps the frame's sides.
  const rotation = Number(video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0);
  const quarter = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const fps = rate(video.avg_frame_rate) ?? rate(video.r_frame_rate) ?? { num: 30, den: 1 };
  return {
    width: quarter ? video.height : video.width,
    height: quarter ? video.width : video.height,
    fps,
    duration: Number(data.format?.duration) || 0,
    alpha: ALPHA_FORMAT.test(video.pix_fmt ?? ""),
    audio: streams.some((s) => s.codec_type === "audio"),
    codec: video.codec_name ?? "",
    sar: rate(video.sample_aspect_ratio, ":") ?? { num: 1, den: 1 },
  };
}

/** sha256 of what a render depends on (hex). */
export function fxFingerprint(parts: { source: string; size: number; mtimeMs: number; start: number; end: number; graph: string; carry?: { source: string; size: number; mtimeMs: number; at: number } }): string {
  const text = JSON.stringify({ v: FX_RENDERER_VERSION, ...parts });
  return createHash("sha256").update(text).digest("hex");
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    (s) => s.isFile() && s.size > 0,
    () => false,
  );
}

let ffmpegVersion: Promise<string> | undefined;

function versionOf(ffmpeg: string): Promise<string> {
  ffmpegVersion ??= runBinary(ffmpeg, ["-hide_banner", "-version"], { timeoutMs: 15_000 })
    .then(({ stdout }) => /version\s+(\S+)/.exec(stdout.toString("utf8"))?.[1] ?? "unknown")
    .catch(() => "unknown");
  return ffmpegVersion;
}

export function createFxRenderer(options: FxRendererOptions): FxHost {
  return {
    async render(request: FxRenderRequest): Promise<FxRender> {
      const source = path.resolve(options.resolveMedia(request.path));
      const st = await stat(source).catch(() => null);
      if (!st?.isFile()) throw new Error(`the source media ${request.path} is missing.`);
      const info = await probeFxSource(options.ffprobe, source, request.signal);
      const start = Math.max(0, request.start);
      const end = info.duration > 0 ? Math.min(request.end, info.duration) : request.end;
      if (!(end > start)) throw new Error(`the range ${request.start}-${request.end}s is outside ${path.basename(source)} (${info.duration}s).`);
      const duration = end - start;
      const graph = buildFxGraph(request.effects, { width: info.width, height: info.height, fps: info.fps, duration, alpha: info.alpha, audio: info.audio, sar: info.sar });
      const mosh = request.effects.find((e): e is FxEffect<"datamosh_carry"> => e.effect === "datamosh_carry");
      let carry: { source: string; size: number; mtimeMs: number; at: number } | undefined;
      if (mosh) {
        if (!request.carry) throw new Error("datamosh_carry needs the footage before the cut (use datamosh_cut_tool).");
        const before = path.resolve(options.resolveMedia(request.carry.path));
        const bst = await stat(before).catch(() => null);
        if (!bst?.isFile()) throw new Error(`the footage before the cut, ${request.carry.path}, is missing.`);
        carry = { source: before, size: bst.size, mtimeMs: Math.round(bst.mtimeMs), at: request.carry.at };
      }
      const fingerprint = fxFingerprint({ source, size: st.size, mtimeMs: Math.round(st.mtimeMs), start, end, graph: graph.filterComplex, ...(carry ? { carry } : {}) });
      const name = `${fingerprint.slice(0, 20)}.mov`;
      const outDir = options.outputDir();
      const frames = Math.max(1, Math.ceil((graph.duration * info.fps.num) / info.fps.den - 1e-6));
      const codec = info.alpha ? "prores4444" : "prores422";
      const ffmpeg = await versionOf(options.ffmpeg);
      const result = (file: string, cached: boolean, seconds: number): FxRender => ({
        path: file,
        codec,
        width: info.width,
        height: info.height,
        fps: info.fps,
        frames,
        duration: (frames * info.fps.den) / info.fps.num,
        fingerprint,
        cached,
        seconds,
        renderedAt: new Date().toISOString(),
        ffmpeg,
      });
      for (const dir of [outDir, ...(options.lookupDirs?.() ?? [])]) {
        if (await exists(path.join(dir, name))) return result(path.join(dir, name), true, 0);
      }

      await mkdir(outDir, { recursive: true });
      const out = path.join(outDir, name);
      const partial = path.join(outDir, `.${fingerprint.slice(0, 20)}.partial.mov`);
      let mosher: CarryInputs | null = null;
      if (mosh && carry) mosher = await prepareCarry({ ffmpeg: options.ffmpeg, ffprobe: options.ffprobe, source: carry.source, at: carry.at, effect: mosh, target: info, duration, signal: request.signal });
      const hw = options.hwaccel !== false && process.platform === "darwin" && /^(h264|hevc|prores)$/.test(info.codec);
      const audio = graph.audioLabel ? ["-map", `[${graph.audioLabel}]`] : info.audio ? ["-map", "0:a:0?"] : [];
      const args = [
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-y",
        ...(hw ? ["-hwaccel", "videotoolbox"] : []),
        "-ss",
        String(start),
        "-t",
        String(duration),
        "-i",
        source,
        ...(mosher?.args ?? []),
        "-filter_complex",
        graph.filterComplex,
        "-map",
        "[vout]",
        ...audio,
        "-frames:v",
        String(frames),
        "-c:v",
        "prores_ks",
        "-profile:v",
        info.alpha ? "4" : "3",
        "-vendor",
        "apl0",
        "-pix_fmt",
        graph.pixelFormat,
        ...(audio.length > 0 ? ["-c:a", "pcm_s16le"] : []),
        "-f",
        "mov",
        partial,
      ];
      const t0 = Date.now();
      try {
        await runBinary(options.ffmpeg, args, { signal: request.signal, what: "ffmpeg (Zenvi FX)", maxStdout: 1024 * 1024 });
        await rename(partial, out);
      } catch (error) {
        await rm(partial, { force: true });
        throw error;
      } finally {
        await mosher?.dispose();
      }
      const seconds = (Date.now() - t0) / 1000;
      options.log?.(`zenvi fx: ${request.effects.map((e) => e.effect).join("+")} ${info.width}x${info.height} ${duration.toFixed(2)}s in ${seconds.toFixed(1)}s`);
      return result(out, false, seconds);
    },
  };
}
