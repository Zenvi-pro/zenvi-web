/**
 * `createScene3dRenderer`: the engine's Scene3dHost on a computer with
 * Blender. A request becomes a fingerprint; a cached movie with that
 * fingerprint is returned at once, otherwise the persistent Blender worker
 * renders a PNG sequence (RGBA) and ffmpeg encodes it: ProRes 4444 with
 * alpha for transparent scenes, H.264 over the backdrop for opaque ones.
 * Movies are written next to their final name and renamed when complete.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SCENE3D_FONT_SCENES, type Scene3dCodec, type Scene3dHost, type Scene3dRender, type Scene3dRenderRequest, type Scene3dId } from "@zenvi/engine";
import { encodeArgs, renderSize, type BlenderJob, type JobMedia } from "./job.js";
import { fileStamp, fingerprint, scriptsHash } from "./fingerprint.js";
import { scriptsDir as defaultScriptsDir } from "./paths.js";
import { BlenderWorker } from "./worker.js";

export interface Scene3dRendererOptions {
  /** Blender executable (findBlender). */
  blender: string;
  /** Movies by fingerprint go to `<cacheDir>/scenes3d`. */
  cacheDir: string;
  ffmpeg?: string;
  scriptsDir?: string;
  /** A project media path to a local file. */
  resolveMedia: (projectPath: string) => string;
  /** A font family (or undefined: the default heavy sans) to a font file. */
  resolveFont?: (family: string | undefined) => Promise<string | undefined>;
  /** Frames are rendered under this folder (default the OS temp folder). */
  tempDir?: string;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  /** A worker to use instead of starting one (tests). */
  worker?: BlenderWorker;
}

export interface Scene3dRenderer extends Scene3dHost {
  /** Quit the Blender worker. */
  close(): void;
}

interface CacheMeta {
  codec: Scene3dCodec;
  width: number;
  height: number;
  fps: { num: number; den: number };
  frames: number;
  renderedAt: string;
  blender: string;
}

function run(command: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"], signal });
    let err = "";
    child.stderr.on("data", (d: Buffer) => {
      err = (err + d.toString()).slice(-2000);
    });
    child.on("error", (e) => reject(new Error(`${command}: ${e.message}`)));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}: ${err.trim()}`))));
  });
}

const isPathLike = (font: string): boolean => /[\\/]/.test(font) || /\.(ttf|otf|ttc|otc)$/i.test(font);

export function createScene3dRenderer(options: Scene3dRendererOptions): Scene3dRenderer {
  const scripts = options.scriptsDir ?? defaultScriptsDir(options.env);
  const worker = options.worker ?? new BlenderWorker({ blender: options.blender, scriptsDir: scripts, env: options.env, log: options.log });
  const cache = path.join(options.cacheDir, "scenes3d");
  const ffmpeg = options.ffmpeg ?? "ffmpeg";

  const font = async (params: Record<string, unknown>, scene: Scene3dId): Promise<string | null> => {
    if (!SCENE3D_FONT_SCENES.includes(scene)) return null;
    const given = typeof params.font === "string" ? params.font.trim() : undefined;
    if (given && isPathLike(given)) {
      if (!existsSync(given)) throw new Error(`font file ${given} does not exist`);
      return given;
    }
    const found = await options.resolveFont?.(given);
    if (given && !found) throw new Error(`no installed font family "${given}" (give a family this computer has, or a .ttf/.otf path)`);
    return found ?? null;
  };

  return {
    close: () => worker.close(),
    async render(request: Scene3dRenderRequest): Promise<Scene3dRender> {
      const started = Date.now();
      const size = renderSize(request.width, request.height, request.quality);
      const media: Record<string, JobMedia> = {};
      const stamps: Record<string, { stamp: unknown; start: number; kind: string }> = {};
      for (const [slot, m] of Object.entries(request.media)) {
        const file = options.resolveMedia(m.path);
        if (!existsSync(file)) throw new Error(`the media of ${m.fileId} is missing (${file})`);
        media[slot] = { file, kind: m.kind, width: m.width, height: m.height, fps: m.fps, frames: m.frames, start: m.start };
        stamps[slot] = { stamp: await fileStamp(file), start: m.start, kind: m.kind };
      }
      const files: Record<string, string> = {};
      const fileStamps: Record<string, unknown> = {};
      for (const [slot, given] of Object.entries(request.files ?? {})) {
        const file = options.resolveMedia(given);
        if (!existsSync(file)) throw new Error(`the ${slot} file ${given} does not exist${file !== given ? ` (${file})` : ""}`);
        files[slot] = file;
        fileStamps[slot] = await fileStamp(file);
      }
      const params = request.params as Record<string, unknown>;
      const fontFile = await font(params, request.scene);
      const transparent = params.background === "transparent";
      const codec: Scene3dCodec = transparent ? "prores4444" : "h264";
      const fp = fingerprint({
        scene: request.scene,
        params,
        width: size.width,
        height: size.height,
        fps: request.fps,
        frames: request.frames,
        quality: request.quality,
        media: stamps,
        files: Object.keys(fileStamps).length > 0 ? fileStamps : undefined,
        font: fontFile ? await fileStamp(fontFile) : null,
        scripts: await scriptsHash(scripts),
      });
      const output = path.join(cache, `${fp}.${codec === "h264" ? "mp4" : "mov"}`);
      const metaFile = `${output}.json`;
      if (existsSync(output) && existsSync(metaFile)) {
        const meta = JSON.parse(await readFile(metaFile, "utf8")) as CacheMeta;
        request.onProgress?.(1, "cached");
        return { path: output, ...meta, fingerprint: fp, cached: true, seconds: 0 };
      }
      await mkdir(cache, { recursive: true });
      const framesDir = await mkdtemp(path.join(options.tempDir ?? tmpdir(), "zenvi-scenes3d-"));
      const partial = path.join(cache, `.${fp}.${randomUUID()}.partial${path.extname(output)}`);
      try {
        const job: BlenderJob = {
          id: randomUUID(),
          scene: request.scene,
          params: request.params,
          width: size.width,
          height: size.height,
          fps: request.fps.num / request.fps.den,
          frames: request.frames,
          quality: request.quality,
          output_dir: framesDir,
          media,
          files,
          font: fontFile,
        };
        request.onProgress?.(0, "starting Blender");
        const done = await worker.run(job, {
          signal: request.signal,
          onFrame: (frame, frames) => request.onProgress?.((0.9 * frame) / Math.max(1, frames), `frame ${frame}/${frames}`),
        });
        if (transparent !== (done.backdrop === null)) throw new Error("the scene script and the request disagree about the backdrop");
        request.onProgress?.(0.9, "encoding");
        await run(ffmpeg, encodeArgs({ framesDir, fps: request.fps, backdrop: done.backdrop, output: partial, quality: request.quality }), request.signal);
        if (!(await stat(partial)).size) throw new Error("ffmpeg wrote an empty movie");
        const meta: CacheMeta = { codec, width: size.width, height: size.height, fps: { ...request.fps }, frames: request.frames, renderedAt: new Date().toISOString(), blender: done.blender };
        await writeFile(metaFile, JSON.stringify(meta));
        await rename(partial, output);
        request.onProgress?.(1, "done");
        options.log?.(`zenvi3d: ${request.scene} ${request.quality} ${size.width}x${size.height}x${request.frames} build ${done.buildSeconds}s render ${done.renderSeconds}s total ${((Date.now() - started) / 1000).toFixed(1)}s`);
        return { path: output, ...meta, fingerprint: fp, cached: false, seconds: (Date.now() - started) / 1000 };
      } finally {
        // A failed or cancelled encode leaves no half-written movie in the cache (after the rename there is none).
        await rm(partial, { force: true });
        await rm(framesDir, { recursive: true, force: true });
      }
    },
  };
}
