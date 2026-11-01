/**
 * The MotionHost the CLI and `zenvi mcp` give the engine's motion block
 * tools: the block catalog, parameter checking and rendering. Renders go to
 * the project's `<project>_assets/links/zenvi-motion/` folder (the desktop's
 * linked-media folder layout, linked_media.py), or a scratch folder while the
 * project is unsaved; the fingerprint names the file, so an identical render
 * is reused.
 */

import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { copyFile, link, mkdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { projectAssetsDir, type MotionBlockInfo, type MotionBlockParam, type MotionHost, type MotionRenderRequest, type MotionRuntimeStatus, type SceneHost, type SceneRequest } from "@zenvi/engine";
import { fingerprint as fileFingerprint, probe } from "@zenvi/render-node";
import { BLOCKS, getBlock } from "../catalog.js";
import { allParams, checkParams, type BlockManifest } from "../params.js";
import { CHROME_DOWNLOAD_MB, findChrome, installChrome } from "./chrome.js";
import { blockEvents, renderBlock, type BlockEventsOptions, type RenderBlockOptions } from "./render.js";
import { draftScene, renderScene } from "./scene-render.js";

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
  const requestOptions = (request: MotionRenderRequest, signal: AbortSignal | undefined): BlockEventsOptions => ({
    width: request.width,
    height: request.height,
    fps: request.fps,
    seconds: request.seconds,
    alpha: request.alpha,
    motionBlurSamples: request.motionBlurSamples,
    draft: request.draft,
    media: Object.fromEntries(Object.entries(request.media).map(([name, p]) => [name, options.resolveMedia(p)])),
    env: options.env,
    signal,
  });
  const linksDir = async (kind = "zenvi-motion"): Promise<string> => {
    const project = options.projectFile();
    const dir = project ? path.join(projectAssetsDir(project), "links", kind) : path.join(tmpdir(), "zenvi-media", "links", kind);
    await mkdir(dir, { recursive: true });
    return dir;
  };
  // A hard link to the cached render where the filesystem allows (ProRes 4444 is large), else a
  // copy renamed into place, so an interrupted copy is never mistaken for a finished render.
  const place = async (cached: string, dest: string): Promise<void> => {
    if (existsSync(dest)) return;
    await link(cached, dest).catch(async () => {
      const partial = `${dest}.${process.pid}.partial`;
      await copyFile(cached, partial);
      await rename(partial, dest);
    });
  };
  const sceneJob = (request: SceneRequest, signal: AbortSignal | undefined) => ({
    code: request.code,
    params: request.params,
    media: Object.fromEntries(Object.entries(request.media).map(([name, p]) => [name, options.resolveMedia(p)])),
    width: request.width,
    height: request.height,
    fps: request.fps,
    allowStrobe: request.allowStrobe,
    env: options.env,
    signal,
  });
  const scenes: SceneHost = {
    async draft(request, signal) {
      // The sheet is named by what it shows, next to the scene's renders.
      const key = createHash("sha256").update(JSON.stringify([request.code, request.params, request.media, request.width, request.height])).digest("hex").slice(0, 16);
      const sheetPath = path.join(await linksDir("zenvi-scene"), "sheets", `sheet-${key}.jpg`);
      const made = await draftScene({ ...sceneJob(request, signal), sheetPath });
      return {
        ...(made.info ? { info: made.info } : {}),
        problems: made.problems,
        ...(made.sheet ? { sheet: { mimeType: "image/jpeg" as const, data: made.sheet.toString("base64") }, sheetPath } : {}),
        cells: made.cells,
        checkSeconds: made.checkSeconds,
      };
    },
    async render(request, signal) {
      const made = await renderScene({ ...sceneJob(request, signal), alpha: request.alpha, motionBlurSamples: request.motionBlurSamples, draft: request.draft, onProgress: options.onProgress });
      if (!made.ok) return made;
      const dest = path.join(await linksDir("zenvi-scene"), `scene-${made.fingerprint.slice(0, 16)}${path.extname(made.path)}`);
      await place(made.path, dest);
      const fp = await fileFingerprint(dest);
      const { path: _cached, ...rest } = made;
      return { ...rest, media: { path: dest, info: await probe(dest), name: path.basename(dest), ...(fp ? { fingerprint: fp } : {}) } };
    },
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
    events: (request, signal) => blockEvents(request.block, request.params, requestOptions(request, signal)),
    async render(request, signal) {
      const rendered = await renderBlock(request.block, request.params, { ...requestOptions(request, signal), workers: options.workers, onProgress: options.onProgress });
      const dest = path.join(await linksDir(), `${request.block}-${rendered.fingerprint.slice(0, 16)}${path.extname(rendered.path)}`);
      await place(rendered.path, dest);
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
        events: rendered.events,
      };
    },
    scenes,
  };
}
