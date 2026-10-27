/**
 * The MotionHost the CLI and `zenvi mcp` give the engine's motion block
 * tools: the block catalog, parameter checking and rendering. Renders go to
 * the project's `<project>_assets/links/zenvi-motion/` folder (the desktop's
 * linked-media folder layout, linked_media.py), or a scratch folder while the
 * project is unsaved; the fingerprint names the file, so an identical render
 * is reused.
 */

import { existsSync } from "node:fs";
import { copyFile, link, mkdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { projectAssetsDir, type MotionBlockInfo, type MotionBlockParam, type MotionHost, type MotionRuntimeStatus } from "@zenvi/engine";
import { fingerprint as fileFingerprint, probe } from "@zenvi/render-node";
import { BLOCKS, getBlock } from "../catalog.js";
import { allParams, checkParams, type BlockManifest } from "../params.js";
import { CHROME_DOWNLOAD_MB, findChrome, installChrome } from "./chrome.js";
import { renderBlock, type RenderBlockOptions } from "./render.js";

export interface MotionHostOptions {
  /** The open project file, if saved. */
  projectFile: () => string | undefined;
  /** A project media path → a local file. */
  resolveMedia: (projectPath: string) => string;
  env?: NodeJS.ProcessEnv;
  /** Capture tabs per render (default 3). */
  workers?: number;
  onProgress?: RenderBlockOptions["onProgress"];
}

/** A block's manifest as the engine's tools describe it. */
export function blockInfo(manifest: BlockManifest): MotionBlockInfo {
  const params: MotionBlockParam[] = Object.entries(allParams(manifest)).map(([name, spec]) => {
    const { type, description } = spec;
    const out: MotionBlockParam = { name, type, description };
    if ("default" in spec && spec.default !== undefined) out.default = spec.default;
    if ("min" in spec && spec.min !== undefined) out.min = spec.min;
    if ("max" in spec && spec.max !== undefined) out.max = spec.max;
    if ("maxLength" in spec && spec.maxLength !== undefined) out.maxLength = spec.maxLength;
    if ("minItems" in spec && spec.minItems !== undefined) out.minItems = spec.minItems;
    if ("maxItems" in spec && spec.maxItems !== undefined) out.maxItems = spec.maxItems;
    if ("options" in spec) out.options = [...spec.options];
    if ("accept" in spec) out.accept = [...spec.accept];
    if ("optional" in spec && spec.optional) out.optional = true;
    return out;
  });
  return { id: manifest.id, version: manifest.version, title: manifest.title, description: manifest.description, tags: [...manifest.tags], params, duration: { ...manifest.duration }, aspects: [...manifest.aspects], alpha: manifest.alpha };
}

/** Headless Chrome, as the engine's tools describe it to an agent. */
export async function runtimeStatus(env: NodeJS.ProcessEnv = process.env): Promise<MotionRuntimeStatus> {
  const found = await findChrome(env);
  if (found) return { ready: true, detail: `Headless Chrome is installed (${found}).`, path: found };
  const named = env.ZENVI_CHROME?.trim();
  if (named) return { ready: false, detail: `ZENVI_CHROME names ${named}, which does not exist: fix or unset it.` };
  return { ready: false, detail: `Headless Chrome is not installed, so motion blocks cannot render yet. setup_motion_runtime_tool (or \`zenvi motion setup\`) downloads it: about ${CHROME_DOWNLOAD_MB} MB, once.`, downloadMb: CHROME_DOWNLOAD_MB };
}

export function createMotionHost(options: MotionHostOptions): MotionHost {
  const infos = BLOCKS.map(blockInfo);
  let installing: Promise<MotionRuntimeStatus> | undefined;
  const linksDir = async (): Promise<string> => {
    const project = options.projectFile();
    const dir = project ? path.join(projectAssetsDir(project), "links", "zenvi-motion") : path.join(tmpdir(), "zenvi-media", "links", "zenvi-motion");
    await mkdir(dir, { recursive: true });
    return dir;
  };
  return {
    blocks: () => infos,
    runtime: () => runtimeStatus(options.env),
    // Two calls at once share one download.
    setup() {
      installing ??= (async () => {
        const status = await runtimeStatus(options.env);
        if (status.ready || status.downloadMb === undefined) return status;
        await installChrome(options.env);
        return runtimeStatus(options.env);
      })().finally(() => {
        installing = undefined;
      });
      return installing;
    },
    check(block, params) {
      const manifest = getBlock(block);
      if (!manifest) return { ok: false, error: `unknown motion block ${block}` };
      return checkParams(manifest, params);
    },
    async render(request, signal) {
      const media = Object.fromEntries(Object.entries(request.media).map(([name, p]) => [name, options.resolveMedia(p)]));
      const rendered = await renderBlock(request.block, request.params, {
        width: request.width,
        height: request.height,
        fps: request.fps,
        seconds: request.seconds,
        alpha: request.alpha,
        motionBlurSamples: request.motionBlurSamples,
        draft: request.draft,
        media,
        env: options.env,
        signal,
        workers: options.workers,
        onProgress: options.onProgress,
      });
      const dest = path.join(await linksDir(), `${request.block}-${rendered.fingerprint.slice(0, 16)}${path.extname(rendered.path)}`);
      // A hard link to the cached render where the filesystem allows (ProRes 4444 is large), else a
      // copy renamed into place, so an interrupted copy is never mistaken for a finished render.
      if (!existsSync(dest)) {
        await link(rendered.path, dest).catch(async () => {
          const partial = `${dest}.${process.pid}.partial`;
          await copyFile(rendered.path, partial);
          await rename(partial, dest);
        });
      }
      const info = await probe(dest);
      const fp = await fileFingerprint(dest);
      return {
        media: { path: dest, info, name: path.basename(dest), ...(fp ? { fingerprint: fp } : {}) },
        codec: rendered.codec,
        width: rendered.width,
        height: rendered.height,
        fps: rendered.fps,
        frames: rendered.frames,
        fingerprint: rendered.fingerprint,
        cached: rendered.cached,
        renderSeconds: rendered.renderSeconds,
      };
    },
  };
}
